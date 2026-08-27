/** Extracts a discipline code from a TIDP tab/sheet name - the last token when split on common
 * separators (space, hyphen, underscore), e.g. "REH MIDP - AR" -> "AR", "01_Architecture_AR" ->
 * "AR". MIDP registers are typically assembled from one TIDP tab per discipline, with the
 * discipline code as a suffix in the tab name, so this is a more reliable signal than trying to
 * guess a "Discipline" column (which many templates don't even have, since the tab IS the
 * discipline split). */
export function disciplineFromSheetName(sheetName: string): string {
  const tokens = sheetName.trim().split(/[\s\-_]+/).filter(Boolean);
  return tokens.length ? tokens[tokens.length - 1].toUpperCase() : "";
}
