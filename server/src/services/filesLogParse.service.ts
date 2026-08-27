import ExcelJS from "exceljs";
import { baseNameOf, extensionOf } from "./apsDataManagement.service.js";
import { logEntry } from "./errorLog.service.js";
import type { IndexedFile } from "../types/domain.js";

// Column header hints, checked case-insensitively as a substring - matches the column names the
// ACC File Log Extractor tool writes (File Name, Folder Path, Version, Last Modified, Modified By,
// ACC Link), which is the expected shape of an already-exported "Files Log" workbook, but tolerant
// of near-variants (e.g. "Filename", "Path") in case a log was hand-edited or exported by a
// different tool.
const FILE_NAME_HINTS = ["file name", "filename"];
const FOLDER_PATH_HINTS = ["folder path", "path"];
const VERSION_HINTS = ["version"];
const LAST_MODIFIED_HINTS = ["last modified", "modified date", "modified"];
const MODIFIED_BY_HINTS = ["modified by", "author"];
const ACC_LINK_HINTS = ["acc link", "link", "url"];

function findColumn(headers: string[], hints: string[]): number {
  // Array.from (unlike .map()) does not skip holes in a sparse headers array (e.g. a blank header
  // cell between filled ones) - it reads every index up to length and surfaces a hole as
  // undefined, which `?? ""` then normalizes. .map() would silently skip those same holes and
  // leave them as holes in the result, and findIndex() below does NOT skip holes - it calls back
  // with a real `undefined`, which used to throw on `.includes()`.
  const lower = Array.from(headers, (h) => (h ?? "").trim().toLowerCase());
  for (const hint of hints) {
    const idx = lower.findIndex((h) => h.includes(hint));
    if (idx !== -1) return idx;
  }
  return -1;
}

// Broad set of file extensions commonly seen in AEC/ACC file logs - used to content-sniff the File
// Name column when the header text itself doesn't say "File Name" (a raw ACC export report, as
// opposed to the ACC File Log Extractor's own schema, can label this column anything - "Document",
// "Item", or nothing recognizable at all).
const KNOWN_FILE_EXTENSIONS = new Set([
  "xlsx", "xls", "xlsm", "csv",
  "doc", "docx", "dot", "dotx",
  "ppt", "pptx",
  "pdf", "html", "htm", "txt", "zip", "rar", "7z",
  "dwg", "dxf", "dwf", "dwfx",
  "rvt", "rfa", "rte", "rft",
  "nwd", "nwc", "nwf",
  "ifc", "ifczip",
  "skp", "pln", "gbxml", "ids",
  "png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff",
  "3dm", "obj", "fbx", "step", "stp", "iges", "igs",
]);

function extensionOfValue(value: string): string {
  const idx = value.lastIndexOf(".");
  return idx === -1 ? "" : value.slice(idx + 1).toLowerCase().trim();
}

/** Content-based fallback for locating the File Name column: samples data rows below the header
 * and picks whichever column has the highest share of values ending in a recognized file
 * extension (at least half, to avoid a false hit on some unrelated free-text column). Only used
 * when header-text matching (findColumn) comes up empty. */
function findFileNameColumnByContent(worksheet: ExcelJS.Worksheet, headerRowNumber: number, columnCount: number): number {
  const SAMPLE_ROWS = 30;
  const matches: number[] = new Array(columnCount).fill(0);
  const totals: number[] = new Array(columnCount).fill(0);
  let sampled = 0;

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber || sampled >= SAMPLE_ROWS) return;
    sampled += 1;
    for (let col = 0; col < columnCount; col++) {
      const value = cellToString(row.getCell(col + 1).value).trim();
      if (!value) continue;
      totals[col] += 1;
      if (KNOWN_FILE_EXTENSIONS.has(extensionOfValue(value))) {
        matches[col] += 1;
      }
    }
  });

  let bestCol = -1;
  let bestRatio = 0;
  for (let col = 0; col < columnCount; col++) {
    if (totals[col] === 0) continue;
    const ratio = matches[col] / totals[col];
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestCol = col;
    }
  }

  return bestRatio >= 0.5 ? bestCol : -1;
}

/** Best-effort extraction of a Data Management item id from a "best-effort deep link" of the form
 * `.../docs/files/projects/{projectId}?entityId={itemId}` - the shape the ACC File Log Extractor
 * writes into its "ACC Link" column. Absent or unrecognized links simply leave itemId unset; the
 * file is still matchable by name, it just can't be revision-looked-up or deep-linked from results. */
function extractItemId(accLink: string): string | undefined {
  const match = accLink.match(/[?&]entityId=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value) return String(value.text);
    if ("hyperlink" in value) return String((value as { hyperlink: string }).hyperlink);
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("result" in value) return cellToString(value.result as ExcelJS.CellValue);
  }
  return String(value);
}

const ALL_COLUMN_HINTS = [
  FILE_NAME_HINTS,
  FOLDER_PATH_HINTS,
  VERSION_HINTS,
  LAST_MODIFIED_HINTS,
  MODIFIED_BY_HINTS,
  ACC_LINK_HINTS,
];

/** How many of the known Files Log columns (File Name, Folder Path, Version, ...) this header row
 * appears to have - used both to pick the header row within a worksheet and, in
 * parseFilesLogWorkbook, to pick which worksheet actually holds the Files Log. */
function scoreHeaders(headers: string[]): number {
  const lower = headers.map((h) => h.toLowerCase());
  return ALL_COLUMN_HINTS.filter((hints) => hints.some((hint) => lower.some((h) => h.includes(hint)))).length;
}

/** Finds the header row within one worksheet: whichever row scores highest against the known
 * column hints above - same "most filled cells" style heuristic the TIDP/MIDP source parser uses
 * for its own header detection, but scored against known Files Log column names specifically
 * rather than "most non-blank cells", since a Files Log workbook's own title/breadcrumb rows can
 * have several filled cells too. */
function findHeaderRow(worksheet: ExcelJS.Worksheet): { rowNumber: number; headers: string[]; score: number } {
  let bestRow = 1;
  let bestScore = -1;
  let bestHeaders: string[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 50) return; // header is always near the top
    // includeEmpty: true so a blank cell between filled header cells still gets an explicit ""
    // entry instead of leaving a hole in the array - a hole here used to propagate as a genuine
    // `undefined` (not "") into findColumn's findIndex() call below and crash the parse.
    const headers: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      headers[colNumber - 1] = cellToString(cell.value).trim();
    });
    const score = scoreHeaders(headers);
    if (score > bestScore) {
      bestScore = score;
      bestRow = rowNumber;
      bestHeaders = headers;
    }
  });

  return { rowNumber: bestRow, headers: bestHeaders, score: bestScore };
}

/**
 * Parses an already-exported "Files Log" workbook (the shape the ACC File Log Extractor tool
 * produces: File Name / Folder Path / Version / Size (KB) / Last Modified / Modified By / ACC Link)
 * into the same IndexedFile[] shape a live ACC scan produces, so matchService can treat both
 * sources identically.
 */
export async function parseFilesLogWorkbook(buffer: Buffer, fileName: string): Promise<IndexedFile[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);

  if (workbook.worksheets.length === 0) {
    throw new Error(`"${fileName}" has no worksheets`);
  }

  // The Files Log data isn't always on the first worksheet (e.g. a cover/summary tab in front of
  // it, or an export tool that writes the log to a second tab) - score every worksheet's best
  // header row the same way findHeaderRow scores rows within one sheet, and use whichever
  // worksheet's best row matches the most known Files Log columns.
  let best: { worksheet: ExcelJS.Worksheet; rowNumber: number; headers: string[]; score: number } | null = null;
  for (const candidateSheet of workbook.worksheets) {
    const candidate = findHeaderRow(candidateSheet);
    if (!best || candidate.score > best.score) {
      best = { worksheet: candidateSheet, ...candidate };
    }
  }

  if (!best) {
    throw new Error(`"${fileName}" has no worksheets`);
  }

  const { worksheet, rowNumber: headerRowNumber, headers } = best;
  if (workbook.worksheets.length > 1) {
    logEntry(
      "files-log",
      "info",
      `"${fileName}": using worksheet "${worksheet.name}" (best match against known Files Log columns, out of ${workbook.worksheets.length} worksheets)`
    );
  }

  let fileNameCol = findColumn(headers, FILE_NAME_HINTS);
  if (fileNameCol === -1) {
    // The header text alone didn't say "File Name" - fall back to content: whichever column's
    // values mostly end in a recognized file extension (.xlsx, .rvt, .dwg, ...) is almost
    // certainly it, regardless of what its header is actually labeled.
    const columnCount = Math.max(headers.length, worksheet.columnCount ?? 0);
    fileNameCol = findFileNameColumnByContent(worksheet, headerRowNumber, columnCount);
    if (fileNameCol !== -1) {
      const columnLetter = worksheet.getColumn(fileNameCol + 1).letter;
      logEntry(
        "files-log",
        "info",
        `"${fileName}": no column header says "File Name" - using column ${columnLetter} instead, detected by its values' file extensions (e.g. .xlsx, .rvt, .dwg)`
      );
    }
  }
  if (fileNameCol === -1) {
    throw new Error(
      `Couldn't find a "File Name" column in "${fileName}" (checked ${workbook.worksheets.length} worksheet${workbook.worksheets.length === 1 ? "" : "s"}) - expected a Files Log workbook (columns like File Name, Folder Path, Version, Last Modified, Modified By, ACC Link).`
    );
  }

  const folderPathCol = findColumn(headers, FOLDER_PATH_HINTS);
  const versionCol = findColumn(headers, VERSION_HINTS);
  const lastModifiedCol = findColumn(headers, LAST_MODIFIED_HINTS);
  const modifiedByCol = findColumn(headers, MODIFIED_BY_HINTS);
  const accLinkCol = findColumn(headers, ACC_LINK_HINTS);

  const files: IndexedFile[] = [];
  let skippedBlank = 0;

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    const rawFileName = cellToString(row.getCell(fileNameCol + 1).value).trim();
    if (!rawFileName) {
      skippedBlank += 1;
      return;
    }
    const accLink = accLinkCol !== -1 ? cellToString(row.getCell(accLinkCol + 1).value).trim() : "";
    const versionRaw = versionCol !== -1 ? cellToString(row.getCell(versionCol + 1).value).trim() : "";
    const versionNumber = versionRaw ? Number(versionRaw.replace(/^v/i, "")) : undefined;

    files.push({
      fileName: rawFileName,
      baseName: baseNameOf(rawFileName),
      extension: extensionOf(rawFileName),
      itemId: accLink ? extractItemId(accLink) : undefined,
      webViewUrl: accLink || undefined,
      versionNumber: versionNumber !== undefined && !Number.isNaN(versionNumber) ? versionNumber : undefined,
      folderPath: folderPathCol !== -1 ? cellToString(row.getCell(folderPathCol + 1).value).trim() : undefined,
      lastModifiedTime: lastModifiedCol !== -1 ? cellToString(row.getCell(lastModifiedCol + 1).value).trim() : undefined,
      lastModifiedBy: modifiedByCol !== -1 ? cellToString(row.getCell(modifiedByCol + 1).value).trim() : undefined,
    });
  });

  if (folderPathCol === -1) {
    logEntry(
      "files-log",
      "warning",
      `"${fileName}" has no recognizable "Folder Path" column - the "only count Shared files" filter won't be able to tell which files are Shared and will leave every file in.`
    );
  }
  logEntry(
    "files-log",
    "info",
    `Parsed "${fileName}": ${files.length} file(s)${skippedBlank ? `, ${skippedBlank} blank row(s) skipped` : ""}`
  );

  return files;
}
