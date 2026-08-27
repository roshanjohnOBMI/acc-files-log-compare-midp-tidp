/** "deep" tries exact, then startsWith, then contains, in order, and reports which one hit
 * (see FormatMatch.matchedVia) - naming drift (extra suffixes, version tags, casing) doesn't cause
 * a false "missing" the way committing to a single mode up front can. */
export type MatchMode = "exact" | "startsWith" | "contains" | "deep";

export interface FolderTreeNode {
  id: string;
  name: string;
  type: "folder" | "item";
  hasChildren: boolean;
  extension?: string;
}

/** Where the "Files Log" (the set of files being checked against) comes from. */
export type FilesLogSourceMode = "scan" | "file" | "upload";

/** Where the TIDP/MIDP source workbook comes from. */
export type SourceMode = "acc" | "upload";

/** One folder root to walk when scanning ACC live for the Files Log. */
export interface FilesLogScanFolder {
  folderId: string;
  pathDisplay: string;
}

/** A single file entry in the assembled Files Log, however it was obtained - either walked live
 * from ACC folders, or read out of an already-exported Files Log workbook (e.g. one produced by
 * the ACC File Log Extractor tool). Both sources normalize into this same shape so matching and
 * display logic doesn't need to know which one it came from. */
export interface IndexedFile {
  fileName: string;
  baseName: string;
  extension: string;
  /** Present when the entry came from a live ACC scan (has a real Data Management item id) - not
   * present for a file parsed out of an exported log workbook, since that log only recorded an
   * "ACC Link" URL, not the raw item id (see filesLogParse.service.ts). */
  itemId?: string;
  webViewUrl?: string;
  versionNumber?: number;
  /** Tip version id - only present for a live scan (needed for the Revision custom-attribute lookup). */
  versionId?: string;
  /** Folder the file lives in, e.g. "Project Files/Shared/Drawings" - used both for display and
   * for the "only count files in the Shared folder" filter. */
  folderPath?: string;
  lastModifiedTime?: string;
  lastModifiedBy?: string;
}

export type FormatMatchStatus = "match" | "duplicate_in_log" | "duplicate_in_source" | "not_found_in_log";

export interface FormatMatch {
  format: string;
  status: FormatMatchStatus;
  fileName?: string;
  itemId?: string;
  webViewUrl?: string;
  versionNumber?: number;
  folderPath?: string;
  lastModifiedTime?: string;
  lastModifiedBy?: string;
  /** Revision read from the matched file's ACC custom metadata, if available (live scan only). */
  revision?: string;
  /** Set only when both a Files Log revision and a source (TIDP/MIDP) revision are known for this row/format. */
  revisionMatch?: "match" | "mismatch";
  /** Only set when matchMode is "deep" - which of the three strategies actually found this match. */
  matchedVia?: "exact" | "startsWith" | "contains";
}

export interface RowMatchResult {
  rowIndex: number;
  identifier: string;
  discipline: string;
  /** Revision read from the TIDP/MIDP sheet's own revision column, if one was mapped. */
  sourceRevision: string;
  formats: FormatMatch[];
  status: "complete" | "partial" | "missing" | "skipped";
}

export interface SearchSummary {
  total: number;
  complete: number;
  partial: number;
  missing: number;
  skipped: number;
  extra: number;
}

/** A file present in the Files Log that wasn't matched to any expected TIDP/MIDP deliverable. */
export interface ExtraFile {
  fileName: string;
  itemId?: string;
  webViewUrl?: string;
  extension: string;
  discipline: string;
  versionNumber?: number;
  folderPath?: string;
  lastModifiedTime?: string;
  lastModifiedBy?: string;
  revision?: string;
}

export interface Setup {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  hubId: string;
  hubName: string;
  projectId: string;
  projectName: string;
  sourceMode: SourceMode;
  sourceItemId?: string;
  sourceFileName?: string;
  sourcePath?: string;
  /** Parent folder of the last-selected TIDP/MIDP source file, so the file picker can start there next time. */
  sourceFolderId?: string;
  sourceFolderPath?: string;
  selectedSheetNames?: string[];
  headerRow?: number;
  identifierColumn?: string;
  formatsColumn?: string;
  plannedDateColumn?: string;
  revisionColumn?: string;
  matchMode: MatchMode;

  filesLogMode: FilesLogSourceMode;
  /** "scan" mode: which folder(s) to walk live. */
  filesLogScanFolders?: FilesLogScanFolder[];
  includeSubfolders: boolean;
  /** "file" mode: the already-exported Files Log workbook to pick up from ACC. */
  filesLogItemId?: string;
  filesLogFileName?: string;
  filesLogPath?: string;
  filesLogFolderId?: string;
  filesLogFolderPath?: string;

  onlyShared: boolean;
  sharedKeyword: string;

  /** ACC folder the QA/QC report gets saved to when "Save to ACC folder" is used. */
  exportFolderId?: string;
  exportFolderPath?: string;
}

/** Raw per-sheet grid as parsed from the workbook - the client decides which row is the header. */
export interface RawSheetData {
  sheetName: string;
  headerRowNumber: number;
  rows: string[][];
}

export type LogSeverity = "info" | "warning" | "error";

export interface LogEntry {
  timestamp: string;
  stage: string;
  severity: LogSeverity;
  message: string;
  context?: Record<string, unknown>;
}
