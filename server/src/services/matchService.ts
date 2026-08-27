import type {
  ExtraFile,
  FormatMatch,
  IndexedFile,
  MatchMode,
  RowMatchResult,
  SearchSummary,
} from "../types/domain.js";
import { logEntry } from "./errorLog.service.js";

export interface MatchInputRow {
  rowIndex: number;
  identifier: string;
  discipline: string;
  sourceRevision: string;
  formats: string[];
}

export function matchRows(
  rows: MatchInputRow[],
  matchMode: MatchMode,
  fileIndex: IndexedFile[]
): { results: RowMatchResult[]; summary: SearchSummary; extraFiles: ExtraFile[] } {
  const results: RowMatchResult[] = [];
  const matchedFileKeys = new Set<string>();
  const index = buildLookupIndex(fileIndex);

  // A document number repeated across TIDP/MIDP rows is a data-quality problem in the register
  // itself - flagged as "duplicate_in_source" for every format on that row, without even checking
  // the Files Log, since which of the duplicate rows is "the real one" can't be determined from
  // the sheet alone.
  const identifierCounts = new Map<string, number>();
  for (const row of rows) {
    const id = row.identifier?.trim().toLowerCase();
    if (id) identifierCounts.set(id, (identifierCounts.get(id) ?? 0) + 1);
  }

  for (const row of rows) {
    const discipline = row.discipline?.trim() ?? "";
    const sourceRevision = row.sourceRevision?.trim() ?? "";
    const identifier = row.identifier?.trim() ?? "";
    if (!identifier) {
      logEntry("search", "warning", `Row ${row.rowIndex + 1} has a blank identifier - skipped`);
      results.push({ rowIndex: row.rowIndex, identifier: "", discipline, sourceRevision, formats: [], status: "skipped" });
      continue;
    }

    const normalizedFormats = Array.from(
      new Set((row.formats ?? []).map((f) => f.trim().toLowerCase()).filter(Boolean))
    );
    if (normalizedFormats.length === 0) {
      logEntry("search", "warning", `Row ${row.rowIndex + 1} ("${identifier}") has no formats listed - skipped`);
      results.push({ rowIndex: row.rowIndex, identifier, discipline, sourceRevision, formats: [], status: "skipped" });
      continue;
    }

    const isDuplicateInSource = (identifierCounts.get(identifier.toLowerCase()) ?? 0) > 1;
    if (isDuplicateInSource) {
      logEntry(
        "search",
        "warning",
        `"${identifier}" appears more than once in the TIDP/MIDP - flagged as a duplicate instead of matched against the Files Log`,
        { rowIndex: row.rowIndex }
      );
    }

    const formatMatches: FormatMatch[] = isDuplicateInSource
      ? normalizedFormats.map((format) => ({ format, status: "duplicate_in_source" as const }))
      : normalizedFormats.map((format) => findMatch(identifier, format, matchMode, index, matchedFileKeys));

    const matchCount = formatMatches.filter((m) => m.status === "match").length;
    const status =
      matchCount === 0 ? "missing" : matchCount === formatMatches.length ? "complete" : "partial";

    if (status === "missing" && !isDuplicateInSource) {
      logEntry("search", "warning", `No files found for "${identifier}"`, { rowIndex: row.rowIndex });
    } else if (status === "partial") {
      const unresolvedFormats = formatMatches.filter((m) => m.status !== "match").map((m) => m.format);
      logEntry(
        "search",
        "warning",
        `"${identifier}" is missing formats: ${unresolvedFormats.join(", ")}`,
        { rowIndex: row.rowIndex }
      );
    }

    results.push({ rowIndex: row.rowIndex, identifier, discipline, sourceRevision, formats: formatMatches, status });
  }

  const extraFiles: ExtraFile[] = fileIndex
    .filter((file) => !matchedFileKeys.has(fileKey(file)))
    .map((file) => ({
      fileName: file.fileName,
      itemId: file.itemId,
      webViewUrl: file.webViewUrl,
      extension: file.extension,
      discipline: disciplineFromFileName(file.baseName),
      versionNumber: file.versionNumber,
      folderPath: file.folderPath,
      lastModifiedTime: file.lastModifiedTime,
      lastModifiedBy: file.lastModifiedBy,
    }));

  const summary: SearchSummary = {
    total: results.length,
    complete: results.filter((r) => r.status === "complete").length,
    partial: results.filter((r) => r.status === "partial").length,
    missing: results.filter((r) => r.status === "missing").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    extra: extraFiles.length,
  };

  return { results, summary, extraFiles };
}

/**
 * Extra files have no TIDP/MIDP row to pull a Discipline from, so it's inferred from the file name
 * itself. ISO 19650-style names put the discipline code as the 4th dash-separated field (e.g.
 * "REH-MD01-HYH-AR-OBM-1059-M3-000004" -> "AR") - a convention, not a guarantee, so this is a
 * best-effort label and comes back blank for names that don't fit the pattern.
 */
function disciplineFromFileName(baseName: string): string {
  const segments = baseName.split("-");
  return segments.length >= 4 ? segments[3].toUpperCase() : "";
}

/** Files parsed out of an exported log workbook may have no itemId (see filesLogParse.service.ts) -
 * fall back to fileName+folderPath so "already matched" tracking and "extra files" still work. */
function fileKey(file: IndexedFile): string {
  return file.itemId ?? `${file.folderPath ?? ""}/${file.fileName}`;
}

interface LookupIndex {
  /** extension -> files (used for startsWith/contains). */
  byExtension: Map<string, IndexedFile[]>;
  /** extension -> baseName -> files - O(1) exact lookups instead of scanning every file of that
   * extension for every row. */
  byExtensionAndName: Map<string, Map<string, IndexedFile[]>>;
}

/**
 * Groups the file index once per search instead of rescanning the full Files Log for every row x
 * format combination - with thousands of TIDP/MIDP rows against thousands of logged files that
 * linear scan was the dominant cost of a search. Grouping by extension alone already cuts the
 * candidate set way down for startsWith/contains; every mode also gets a baseName hashmap for
 * O(1) exact lookups, since "deep" mode always tries exact first regardless of the chosen mode.
 */
function buildLookupIndex(fileIndex: IndexedFile[]): LookupIndex {
  const byExtension = new Map<string, IndexedFile[]>();
  for (const file of fileIndex) {
    const list = byExtension.get(file.extension);
    if (list) list.push(file);
    else byExtension.set(file.extension, [file]);
  }

  const byExtensionAndName = new Map<string, Map<string, IndexedFile[]>>();
  for (const [extension, files] of byExtension) {
    const byName = new Map<string, IndexedFile[]>();
    for (const file of files) {
      const list = byName.get(file.baseName);
      if (list) list.push(file);
      else byName.set(file.baseName, [file]);
    }
    byExtensionAndName.set(extension, byName);
  }

  return { byExtension, byExtensionAndName };
}

const DEEP_STRATEGY_ORDER = ["exact", "startsWith", "contains"] as const;

/** Candidates for a single strategy (exact/startsWith/contains), independent of matchMode. */
function candidatesFor(
  strategy: "exact" | "startsWith" | "contains",
  format: string,
  normalizedIdentifier: string,
  index: LookupIndex
): IndexedFile[] {
  if (strategy === "exact") {
    return index.byExtensionAndName.get(format)?.get(normalizedIdentifier) ?? [];
  }
  const sameExtension = index.byExtension.get(format) ?? [];
  return sameExtension.filter((file) =>
    strategy === "startsWith"
      ? file.baseName.startsWith(normalizedIdentifier)
      : file.baseName.includes(normalizedIdentifier)
  );
}

/**
 * Finds every Files Log entry matching an identifier+format. More than one candidate means the
 * Files Log itself has duplicates for that deliverable - reported as "duplicate_in_log" rather than
 * silently picking the first one, since there's no way to know which copy is authoritative. Every
 * candidate is recorded into `matchedFileKeys` (even in the duplicate case) so none of them also
 * show up as "not found in TIDP/MIDP" - they ARE accounted for, just ambiguously.
 *
 * "deep" mode tries exact, then startsWith, then contains, in that order, stopping at the first
 * strategy that finds anything (including a duplicate) - it never blends candidates from more than
 * one strategy together, so a clean exact match is never diluted by broader results.
 */
function findMatch(
  identifier: string,
  format: string,
  matchMode: MatchMode,
  index: LookupIndex,
  matchedFileKeys: Set<string>
): FormatMatch {
  const normalizedIdentifier = identifier.toLowerCase();

  let candidates: IndexedFile[] = [];
  let matchedVia: "exact" | "startsWith" | "contains" | undefined;

  if (matchMode === "deep") {
    for (const strategy of DEEP_STRATEGY_ORDER) {
      candidates = candidatesFor(strategy, format, normalizedIdentifier, index);
      if (candidates.length > 0) {
        matchedVia = strategy;
        break;
      }
    }
  } else {
    candidates = candidatesFor(matchMode, format, normalizedIdentifier, index);
  }

  for (const candidate of candidates) matchedFileKeys.add(fileKey(candidate));

  if (candidates.length === 0) {
    return { format, status: "not_found_in_log" };
  }
  if (candidates.length > 1) {
    return { format, status: "duplicate_in_log" };
  }

  const candidate = candidates[0];
  return {
    format,
    status: "match",
    fileName: candidate.fileName,
    itemId: candidate.itemId,
    webViewUrl: candidate.webViewUrl,
    versionNumber: candidate.versionNumber,
    folderPath: candidate.folderPath,
    lastModifiedTime: candidate.lastModifiedTime,
    lastModifiedBy: candidate.lastModifiedBy,
    matchedVia,
  };
}
