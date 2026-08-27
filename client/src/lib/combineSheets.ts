import type { SheetData } from "../types/domain";

export const SOURCE_TAB_COLUMN = "Source Tab";

/** Case/whitespace-insensitive key so header text that drifted slightly between copy-pasted
 * per-discipline tabs (different capitalization, an extra space, a trailing space) still merges
 * into one column instead of silently splitting into two. */
function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Combines the selected tabs of a TIDP/MIDP workbook into one working dataset - mirrors how
 * a MIDP's per-discipline TIDP tabs get merged into one deliverable list. Headers are the
 * union across the selected tabs (most MIDP templates repeat the same columns per tab, but
 * this tolerates minor differences rather than dropping columns some tabs don't have), and
 * every row is tagged with which tab it came from so it stays traceable after merging.
 *
 * Union is by normalized header text, not exact string match: real MIDP templates are usually
 * copies of the same tab per discipline, and it's common for header text to drift slightly
 * between copies (different capitalization, one extra space). Without normalizing, "Deliverable
 * (File Name)" on one tab and "Deliverable (file name) " on another become two separate columns,
 * and whichever exact string a user then picks as the identifier/formats/date column only ever
 * matches rows from the tab(s) that happened to use that exact spelling - every other tab's rows
 * still show up (so row counts look right) but with blank values in that column, so they're
 * silently skipped by the search.
 */
export function combineSheets(sheets: SheetData[], selectedSheetNames: string[]): SheetData {
  const selected = sheets.filter((s) => selectedSheetNames.includes(s.sheetName));

  const canonicalByKey = new Map<string, string>();
  for (const sheet of selected) {
    for (const header of sheet.headers) {
      const key = normalizeHeader(header);
      if (!canonicalByKey.has(key)) canonicalByKey.set(key, header);
    }
  }
  const headers = [SOURCE_TAB_COLUMN, ...canonicalByKey.values()];

  const rows = selected.flatMap((sheet) =>
    sheet.rows.map((row) => {
      const remapped: Record<string, string> = { [SOURCE_TAB_COLUMN]: sheet.sheetName };
      for (const [header, value] of Object.entries(row)) {
        const canonical = canonicalByKey.get(normalizeHeader(header)) ?? header;
        remapped[canonical] = value;
      }
      return remapped;
    })
  );

  const label =
    selected.length === 1
      ? selected[0].sheetName
      : `${selected.length} combined tab${selected.length === 1 ? "" : "s"}`;

  return { sheetName: label, headers, rows };
}
