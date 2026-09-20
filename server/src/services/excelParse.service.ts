import ExcelJS from "exceljs";
import JSZip from "jszip";
import { logEntry } from "./errorLog.service.js";
import { MAX_ROWS_PER_SHEET, findHeaderRowNumber, parseXlsxStreaming } from "./xlsxStream.service.js";
import type { RawSheetData } from "../types/domain.js";

// Worksheet XML sections the in-memory fallback loader doesn't need (it only reads cell values) and
// that real-world TIDP/MIDP templates lean on heavily - data-validation dropdowns and
// conditional-formatted status columns especially. "sheetViews" is deliberately NOT in this list -
// it's where the freeze-pane row lives, which is how we find the real header row.
const IGNORE_NODES = [
  "dataValidations",
  "conditionalFormatting",
  "mergeCells",
  "hyperlinks",
  "picture",
  "drawing",
  "extLst",
  "tableParts",
  "sheetProtection",
  "autoFilter",
  "rowBreaks",
  "pageSetup",
  "headerFooter",
  "printOptions",
  "pageMargins",
];

/**
 * Parses a workbook server-side into a raw row grid per sheet. Uses the streaming parser
 * (xlsxStream.service.ts) first: it never builds the workbook object model, so a 50 MB multi-tab,
 * formula-heavy MIDP costs a few hundred MB and seconds instead of ~2 GB and minutes - the
 * in-memory loader below was running past the request timeout on files that size. The in-memory
 * loader stays as a fallback for anything the streaming parser can't read.
 *
 * Returns the raw row grid rather than pre-splitting into headers/data: which row actually holds
 * the headers is a judgment call (see findHeaderRowNumber) that the UI lets the user override, and
 * doing that client-side against the already-downloaded raw grid means changing it is instant -
 * no re-download, no re-parse.
 */
export async function parseWorkbookBuffer(buffer: Buffer, fileName: string): Promise<RawSheetData[]> {
  try {
    return await parseXlsxStreaming(buffer, (sheetName) => warnTruncated(sheetName, fileName));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEntry(
      "excel",
      "warning",
      `Fast parse of "${fileName}" failed (${message}) - retrying with the slower full loader`
    );
    return parseWorkbookInMemory(buffer, fileName);
  }
}

function warnTruncated(sheetName: string, fileName: string) {
  logEntry(
    "excel",
    "warning",
    `"${sheetName}" has more than ${MAX_ROWS_PER_SHEET} rows - only the first ${MAX_ROWS_PER_SHEET} were loaded`,
    { fileName }
  );
}

async function parseWorkbookInMemory(buffer: Buffer, fileName: string): Promise<RawSheetData[]> {
  const cleaned = await stripTableParts(buffer, fileName);

  const workbook = new ExcelJS.Workbook();
  // exceljs's own .d.ts declares a local `Buffer` shim (for browser use without @types/node)
  // that's structurally stricter than the real Node Buffer type from @types/node - cast past it.
  await workbook.xlsx.load(cleaned as never, { ignoreNodes: IGNORE_NODES });

  return workbook.worksheets.map((worksheet) => {
    // Indexed by actual row number (rows[0] = row 1) so a chosen header row lines up directly,
    // even though eachRow() skips fully-blank rows and leaves gaps.
    const rows: string[][] = [];
    let truncated = false;
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > MAX_ROWS_PER_SHEET) {
        truncated = true;
        return;
      }
      const values: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        values[colNumber - 1] = cellToString(cell.value).trim();
      });
      rows[rowNumber - 1] = values;
    });

    if (truncated) warnTruncated(worksheet.name, fileName);

    const frozenView = worksheet.views?.find(
      (view): view is ExcelJS.WorksheetViewFrozen => view.state === "frozen"
    );
    const headerRowNumber = findHeaderRowNumber(frozenView?.ySplit, rows);

    return { sheetName: worksheet.name, headerRowNumber, rows };
  });
}

const TABLE_PART_PATTERN = /^xl\/tables\/table\d+\.xml$/i;

/**
 * Removes `xl/tables/*.xml` entries (Excel structured-table definitions - filters, styling,
 * totals rows) from the workbook zip before exceljs ever sees them. We only read cell values, so
 * this metadata is unused - but exceljs's table-XML parser (TableXform/FilterColumnXform) doesn't
 * recognize every filter variant real-world templates use (e.g. `colorFilter`, "filter by cell
 * color") and throws on unsupported nodes, aborting the entire load. exceljs discovers table parts
 * purely by walking the zip's actual entry names (see xlsx.js's `xl/tables/(table\d+).xml` regex),
 * not via [Content_Types].xml, so deleting the entries here is enough - no dangling references.
 */
async function stripTableParts(buffer: Buffer, fileName: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const tableEntries = Object.keys(zip.files).filter((path) => TABLE_PART_PATTERN.test(path));
  if (tableEntries.length === 0) return buffer;

  for (const path of tableEntries) zip.remove(path);
  logEntry("excel", "info", `Removed ${tableEntries.length} Excel table definition(s) from "${fileName}" before parsing (filter metadata isn't used, and some variants crash exceljs's parser)`);

  return zip.generateAsync({ type: "nodebuffer" });
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("text" in value) {
      return String(value.text);
    }
    if ("result" in value) {
      return cellToString(value.result as ExcelJS.CellValue);
    }
    if ("error" in value) {
      return String(value.error);
    }
    return "";
  }
  return String(value);
}
