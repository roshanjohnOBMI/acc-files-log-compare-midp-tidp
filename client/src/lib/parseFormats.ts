/** Parses a cell like "PDF, dwg, .ifc" into a deduped, lowercased, extension-only list. */
export function parseFormatList(text: string | undefined): string[] {
  return Array.from(
    new Set(
      (text ?? "")
        .split(",")
        .map((t) => t.trim().toLowerCase().replace(/^\./, ""))
        .filter(Boolean)
    )
  );
}
