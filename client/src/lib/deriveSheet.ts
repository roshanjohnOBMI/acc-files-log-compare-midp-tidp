import type { RawSheetData, SheetData } from "../types/domain";

/** Splits a raw sheet into headers + row objects using whichever row the user picked as the header. */
export function deriveSheet(raw: RawSheetData, headerRowNumber: number): SheetData {
  const headerRow = raw.rows[headerRowNumber - 1] ?? [];
  const headers = dedupeHeaders(headerRow.map((cell) => (cell ?? "").trim()));

  const rows: Record<string, string>[] = [];
  for (let i = headerRowNumber; i < raw.rows.length; i++) {
    const rawRow = raw.rows[i];
    if (!rawRow) continue;
    const values: Record<string, string> = {};
    headers.forEach((header, idx) => {
      if (!header) return;
      values[header] = rawRow[idx] ?? "";
    });
    if (Object.values(values).some((v) => v.trim() !== "")) {
      rows.push(values);
    }
  }

  return { sheetName: raw.sheetName, headers: headers.filter(Boolean), rows };
}

/**
 * Real TIDP/MIDP templates sometimes repeat the same header text for more than one column (e.g.
 * two "Planned Issue Date" columns - original vs revised). Left alone, every column picker keys
 * off the header text: two columns sharing one key would render as one indistinguishable dropdown
 * entry, and the second column's value would silently overwrite the first's for every row. Every
 * column whose header text collides with another one in the same row gets its 1-based spreadsheet
 * column number appended (e.g. "Planned Issue Date (col 5)", "Planned Issue Date (col 9)") so both
 * stay distinct, pickable, and correctly attributed everywhere downstream. Non-duplicated headers
 * are left exactly as-is.
 */
function dedupeHeaders(headers: string[]): string[] {
  const counts = new Map<string, number>();
  for (const header of headers) {
    if (!header) continue;
    const key = header.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return headers.map((header, idx) => {
    if (!header) return header;
    const key = header.toLowerCase();
    return (counts.get(key) ?? 0) > 1 ? `${header} (col ${idx + 1})` : header;
  });
}
