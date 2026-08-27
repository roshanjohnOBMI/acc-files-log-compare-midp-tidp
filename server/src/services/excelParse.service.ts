import ExcelJS from "exceljs";
import JSZip from "jszip";
import { logEntry } from "./errorLog.service.js";
import type { RawSheetData } from "../types/domain.js";

const MAX_ROWS_PER_SHEET = 20000;

// Worksheet XML sections we don't need (we only read cell values) and that real-world TIDP/MIDP
// templates lean on heavily - data-validation dropdowns and conditional-formatted status columns
// especially. Skipping these is what actually made real files slow, far more than blank rows did.
// "sheetViews" is deliberately NOT in this list - it's where the freeze-pane row lives, which is
// how we find the real header row (see findHeaderRowNumber).
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
 * Parses a workbook server-side with exceljs's standard loader. (An earlier version of this used
 * exceljs's row-streaming reader for extra speed, but that reader throws on multi-sheet workbooks
 * - exactly the shape a MIDP with several TIDP tabs has - so it's not usable here. Parsing still
 * happens in Node rather than being shipped to the browser, which is where most of the original
 * speedup came from; `ignoreNodes` below skips the specific XML sections that made real files slow.)
 *
 * Returns the raw row grid rather than pre-splitting into headers/data: which row actually holds
 * the headers is a judgment call (see findHeaderRowNumber) that the UI lets the user override, and
 * doing that client-side against the already-downloaded raw grid means changing it is instant -
 * no re-download, no re-parse.
 */
export async function parseWorkbookBuffer(buffer: Buffer, fileName: string): Promise<RawSheetData[]> {
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

    if (truncated) {
      logEntry(
        "excel",
        "warning",
        `"${worksheet.name}" has more than ${MAX_ROWS_PER_SHEET} rows - only the first ${MAX_ROWS_PER_SHEET} were loaded`,
        { fileName }
      );
    }

    const headerRowNumber = findHeaderRowNumber(worksheet, rows);

    return { sheetName: worksheet.name, headerRowNumber, rows };
  });
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
 * The fallback used to cap its scan at 10 rows, which missed real-world MIDP tabs that are copies
 * of a frozen-pane tab but lost the freeze (or never had one) - their header row (often 13-14, past
 * several title/notes rows) fell outside that window, so every tab defaulted to row 1 and came out
 * with 0 filled rows. Scanning the full set of loaded rows (already read above, capped at
 * MAX_ROWS_PER_SHEET) instead of re-walking the worksheet with a fixed cutoff avoids that.
 */
function findHeaderRowNumber(worksheet: ExcelJS.Worksheet, rows: string[][]): number {
  const frozenView = worksheet.views.find(
    (view): view is ExcelJS.WorksheetViewFrozen => view.state === "frozen"
  );
  if (frozenView?.ySplit && frozenView.ySplit >= 1) {
    return frozenView.ySplit;
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
