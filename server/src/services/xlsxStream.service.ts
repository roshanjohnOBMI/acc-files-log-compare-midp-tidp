import { StringDecoder } from "node:string_decoder";
import JSZip from "jszip";
import { SaxesParser } from "saxes";
import type { RawSheetData } from "../types/domain.js";

/** Rows past this are read no further - the stream is dropped right there. */
export const MAX_ROWS_PER_SHEET = 20000;

/** Called when a sheet has more rows than MAX_ROWS_PER_SHEET, once, with that sheet's name. */
type TruncationHandler = (sheetName: string) => void;

interface SheetRef {
  name: string;
  entryPath: string;
}

/**
 * Reads every sheet of an .xlsx into a raw row grid (strings, indexed by real row/column number)
 * without ever building a workbook object model - the XML is streamed through a SAX parser and only
 * cell values are kept, so memory stays proportional to the *output* (plus the shared-string table)
 * rather than to the file's formatting/formula weight. That's what makes 50 MB multi-tab, formula
 * heavy registers feasible: exceljs's in-memory loader needs roughly 30x the file size in heap.
 *
 * The zip is opened with random access (JSZip), so it doesn't matter what order Excel or any other
 * tool wrote the entries in - unlike exceljs's forward-only streaming reader, which silently drops
 * sheets and leaves shared strings unresolved when sharedStrings.xml comes after the sheets (which
 * is how real Excel writes files).
 *
 * Throws on anything it can't read, so the caller can fall back to a heavier, more forgiving loader.
 */
export async function parseXlsxStreaming(
  buffer: Buffer,
  onTruncated: TruncationHandler
): Promise<RawSheetData[]> {
  const zip = await JSZip.loadAsync(buffer);

  const workbookXml = await readEntryText(zip, "xl/workbook.xml");
  if (workbookXml === undefined) throw new Error("not an .xlsx workbook (xl/workbook.xml is missing)");
  const relsXml = (await readEntryText(zip, "xl/_rels/workbook.xml.rels")) ?? "";

  const sheetRefs = resolveSheets(workbookXml, relsXml);
  if (sheetRefs.length === 0) throw new Error("no worksheets found in xl/workbook.xml");
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/i.test(workbookXml);

  const sharedStrings = await readSharedStrings(zip);
  const dateStyles = await readDateStyleIndexes(zip);

  const sheets: RawSheetData[] = [];
  for (const ref of sheetRefs) {
    sheets.push(await readSheet(zip, ref, { sharedStrings, dateStyles, date1904 }, onTruncated));
  }
  return sheets;
}

async function readEntryText(zip: JSZip, entryPath: string): Promise<string | undefined> {
  return zip.file(entryPath)?.async("string");
}

/** Tab order comes from workbook.xml; each sheet's file is found through its relationship id -
 * never by position or sheetId, since after tabs are added/deleted "sheet3.xml" is routinely
 * neither the third tab nor sheetId 3. */
function resolveSheets(workbookXml: string, relsXml: string): SheetRef[] {
  const targetByRelId = new Map<string, string>();
  for (const tag of relsXml.match(/<Relationship\b[^>]*>/g) ?? []) {
    const attrs = parseXmlAttributes(tag);
    if (attrs.Id && attrs.Target) targetByRelId.set(attrs.Id, attrs.Target);
  }

  const refs: SheetRef[] = [];
  for (const tag of workbookXml.match(/<sheet\b[^>]*>/g) ?? []) {
    const attrs = parseXmlAttributes(tag);
    const target = attrs["r:id"] ? targetByRelId.get(attrs["r:id"]) : undefined;
    if (!attrs.name || !target) continue;
    refs.push({ name: attrs.name, entryPath: target.startsWith("/") ? target.slice(1) : `xl/${target}` });
  }
  return refs;
}

function parseXmlAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:.-]+)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXmlEntities(match[2]);
  }
  return attrs;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** JSZip's StreamHelper (returned by the untyped-but-public internalStream()) - just the bits used. */
interface ZipEntryStream {
  on(event: "data", handler: (chunk: Uint8Array) => void): ZipEntryStream;
  on(event: "end", handler: () => void): ZipEntryStream;
  on(event: "error", handler: (err: Error) => void): ZipEntryStream;
  resume(): ZipEntryStream;
  pause(): ZipEntryStream;
}

/** Feeds an entry's XML to a SAX parser chunk by chunk, inflating only as fast as it's parsed.
 * `shouldStop` returning true after a chunk ends the read there (the rest of the entry is never
 * inflated), which is how a sheet is cut off at MAX_ROWS_PER_SHEET. Resolves false if the entry
 * doesn't exist. */
function streamXml(
  zip: JSZip,
  entryPath: string,
  configure: (parser: SaxesParser) => void,
  shouldStop?: () => boolean
): Promise<boolean> {
  const entry = zip.file(entryPath);
  if (!entry) return Promise.resolve(false);

  return new Promise((resolve, reject) => {
    const parser = new SaxesParser();
    let failure: Error | undefined;
    parser.on("error", (err) => {
      failure ??= err;
    });
    configure(parser);

    const stream = (entry as unknown as { internalStream(type: "uint8array"): ZipEntryStream }).internalStream(
      "uint8array"
    );
    // A StringDecoder reassembles a multi-byte character that's split across two chunks instead of
    // turning it into replacement characters.
    const decoder = new StringDecoder("utf8");
    let settled = false;
    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      stream.pause();
      if (err) reject(err);
      else resolve(true);
    };

    stream
      .on("data", (chunk) => {
        if (settled) return;
        try {
          parser.write(decoder.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
          if (failure) throw failure;
          if (shouldStop?.()) settle();
        } catch (err) {
          settle(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .on("end", () => {
        try {
          parser.close();
          if (failure) throw failure;
          settle();
        } catch (err) {
          settle(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .on("error", (err) => settle(err))
      .resume();
  });
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const strings: string[] = [];
  let current = "";
  let inText = false;
  let phoneticDepth = 0;

  await streamXml(zip, "xl/sharedStrings.xml", (parser) => {
    parser.on("opentag", (tag) => {
      if (tag.name === "si") current = "";
      else if (tag.name === "t" && phoneticDepth === 0) inText = true;
      else if (tag.name === "rPh") phoneticDepth++;
    });
    parser.on("text", (text) => {
      if (inText) current += text;
    });
    parser.on("closetag", (tag) => {
      if (tag.name === "t") inText = false;
      else if (tag.name === "rPh") phoneticDepth--;
      else if (tag.name === "si") strings.push(current);
    });
  });
  return strings;
}

const BUILTIN_DATE_FORMAT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

function isDateFormatCode(code: string): boolean {
  const stripped = code.replace(/\[[^\]]*]/g, "").replace(/"[^"]*"/g, "");
  return /[ymdhs]/i.test(stripped);
}

/** Style (cellXfs) indexes whose number format is a date/time - a numeric cell only means a date
 * when its style says so, and that lives here rather than on the cell. */
async function readDateStyleIndexes(zip: JSZip): Promise<Set<number>> {
  const customFormats = new Map<number, string>();
  const cellFormatIds: number[] = [];
  let inCellXfs = false;

  await streamXml(zip, "xl/styles.xml", (parser) => {
    parser.on("opentag", (tag) => {
      if (tag.name === "numFmt") {
        customFormats.set(Number(tag.attributes.numFmtId), String(tag.attributes.formatCode ?? ""));
      } else if (tag.name === "cellXfs") {
        inCellXfs = true;
      } else if (tag.name === "xf" && inCellXfs) {
        cellFormatIds.push(Number(tag.attributes.numFmtId ?? 0));
      }
    });
    parser.on("closetag", (tag) => {
      if (tag.name === "cellXfs") inCellXfs = false;
    });
  });

  const dateStyles = new Set<number>();
  cellFormatIds.forEach((formatId, styleIndex) => {
    const custom = customFormats.get(formatId);
    if (custom !== undefined ? isDateFormatCode(custom) : BUILTIN_DATE_FORMAT_IDS.has(formatId)) {
      dateStyles.add(styleIndex);
    }
  });
  return dateStyles;
}

interface CellContext {
  sharedStrings: string[];
  dateStyles: Set<number>;
  date1904: boolean;
}

function serialToIsoDate(serial: number, date1904: boolean): string {
  const millis = date1904 ? serial * 86400000 + Date.UTC(1904, 0, 1) : Math.round((serial - 25569) * 86400000);
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function cellText(type: string, style: number, raw: string, inline: string, ctx: CellContext): string {
  switch (type) {
    case "s":
      return ctx.sharedStrings[Number(raw)] ?? "";
    case "inlineStr":
      return inline || raw;
    case "b":
      return raw === "1" ? "true" : "false";
    case "d":
      return raw.slice(0, 10);
    case "str":
    case "e":
      return raw;
    default: {
      if (raw === "") return "";
      const value = Number(raw);
      if (Number.isNaN(value)) return raw;
      return ctx.dateStyles.has(style) ? serialToIsoDate(value, ctx.date1904) : String(value);
    }
  }
}

/** "AB12" -> 28 (1-based column). */
function columnFromRef(ref: string): number {
  let column = 0;
  for (let i = 0; i < ref.length; i++) {
    const code = ref.charCodeAt(i);
    if (code < 65 || code > 90) break;
    column = column * 26 + (code - 64);
  }
  return column;
}

async function readSheet(
  zip: JSZip,
  ref: SheetRef,
  ctx: CellContext,
  onTruncated: TruncationHandler
): Promise<RawSheetData> {
  // Indexed by actual row number (rows[0] = row 1) so a chosen header row lines up directly, with
  // gaps left for fully-blank rows.
  const rows: string[][] = [];
  let frozenRows: number | undefined;
  let truncated = false;

  let rowNumber = 0;
  let values: string[] = [];
  let rowHasText = false;

  let colNumber = 0;
  let cellType = "n";
  let cellStyle = 0;
  let inCell = false;
  let raw = "";
  let inline = "";
  let inValue = false;
  let inInlineText = false;
  let phoneticDepth = 0;

  const found = await streamXml(
    zip,
    ref.entryPath,
    (parser) => {
      parser.on("opentag", (tag) => {
        switch (tag.name) {
          case "pane":
            if (frozenRows === undefined && tag.attributes.state === "frozen") {
              const ySplit = Number(tag.attributes.ySplit);
              if (ySplit >= 1) frozenRows = ySplit;
            }
            break;
          case "row":
            rowNumber = tag.attributes.r ? Number(tag.attributes.r) : rowNumber + 1;
            colNumber = 0;
            values = [];
            rowHasText = false;
            if (rowNumber > MAX_ROWS_PER_SHEET) truncated = true;
            break;
          case "c":
            colNumber = tag.attributes.r ? columnFromRef(tag.attributes.r) : colNumber + 1;
            cellType = tag.attributes.t ?? "n";
            cellStyle = Number(tag.attributes.s ?? 0);
            inCell = true;
            raw = "";
            inline = "";
            break;
          case "v":
            if (inCell) inValue = true;
            break;
          case "t":
            if (inCell && phoneticDepth === 0) inInlineText = true;
            break;
          case "rPh":
            phoneticDepth++;
            break;
        }
      });
      parser.on("text", (text) => {
        if (inValue) raw += text;
        else if (inInlineText) inline += text;
      });
      parser.on("closetag", (tag) => {
        switch (tag.name) {
          case "v":
            inValue = false;
            break;
          case "t":
            inInlineText = false;
            break;
          case "rPh":
            phoneticDepth--;
            break;
          case "c": {
            inCell = false;
            if (raw === "" && inline === "") break;
            const text = cellText(cellType, cellStyle, raw, inline, ctx).trim();
            values[colNumber - 1] = text;
            if (text) rowHasText = true;
            break;
          }
          case "row":
            if (rowHasText && rowNumber <= MAX_ROWS_PER_SHEET) rows[rowNumber - 1] = values;
            break;
        }
      });
    },
    () => truncated
  );
  if (!found) throw new Error(`worksheet part "${ref.entryPath}" is missing from the file`);

  if (truncated) onTruncated(ref.name);
  return { sheetName: ref.name, headerRowNumber: findHeaderRowNumber(frozenRows, rows), rows };
}

/**
 * Suggests the header row instead of assuming row 1. Real-world TIDP/MIDP templates often put a
 * title/metadata row (project name, revision) above the actual column headers, and authors almost
 * always freeze panes right below the header row so it stays visible while scrolling - that frozen
 * row count (`ySplit`) is a precise, author-declared signal for exactly which row is the header, so
 * it's tried first. Only when no freeze pane is set do we fall back to a heuristic: scan the loaded
 * rows and pick whichever has the most filled cells (a title row usually has only one or two).
 * Either way this is just the default the UI pre-fills - the user can override it.
 *
 * The fallback scans every loaded row rather than a fixed window: real-world MIDP tabs that lost
 * their freeze pane often have the header well past row 10, after several title/notes rows.
 */
export function findHeaderRowNumber(frozenRows: number | undefined, rows: string[][]): number {
  if (frozenRows !== undefined && frozenRows >= 1) {
    return frozenRows;
  }

  let bestRow = 1;
  let bestCount = -1;
  for (let rowNumber = 1; rowNumber <= rows.length; rowNumber++) {
    const count = (rows[rowNumber - 1] ?? []).filter((v) => v && v.trim() !== "").length;
    if (count > bestCount) {
      bestCount = count;
      bestRow = rowNumber;
    }
  }
  return bestRow;
}
