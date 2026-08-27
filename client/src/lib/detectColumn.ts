// Substring hints checked (in order) against lowercased headers to auto-suggest which column
// plays each role in a TIDP/MIDP sheet - the user can always override the pick manually.
export const IDENTIFIER_COLUMN_HINTS = [
  "document number",
  "doc number",
  "document no",
  "file name",
  "filename",
];

export const FORMATS_COLUMN_HINTS = ["format"];

export const PLANNED_DATE_COLUMN_HINTS = ["planned issue date", "planned date", "planned issue"];

export const REVISION_COLUMN_HINTS = ["revision", "rev"];

export function detectColumn(headers: string[], hints: string[]): string | null {
  for (const hint of hints) {
    const match = headers.find((header) => header.toLowerCase().includes(hint));
    if (match) return match;
  }
  return null;
}
