/** "deep" tries exact, then startsWith, then contains, in order, and reports which one hit
 * (see FormatMatch.matchedVia). */
export type MatchMode = "exact" | "startsWith" | "contains" | "deep";

export interface FolderTreeNode {
  id: string;
  name: string;
  type: "folder" | "item";
  hasChildren: boolean;
  extension?: string;
}

export type FilesLogSourceMode = "scan" | "file" | "upload";

export type SourceMode = "acc" | "upload";

export interface FilesLogScanFolder {
  folderId: string;
  pathDisplay: string;
}

/** A single file entry in the assembled Files Log, however it was obtained. */
export interface IndexedFile {
  fileName: string;
  baseName: string;
  extension: string;
  itemId?: string;
  webViewUrl?: string;
  versionNumber?: number;
  versionId?: string;
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
  revision?: string;
  revisionMatch?: "match" | "mismatch";
  matchedVia?: "exact" | "startsWith" | "contains";
}

export interface RowMatchResult {
  rowIndex: number;
  identifier: string;
  discipline: string;
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
  filesLogScanFolders?: FilesLogScanFolder[];
  includeSubfolders: boolean;
  filesLogItemId?: string;
  filesLogFileName?: string;
  filesLogPath?: string;
  filesLogFolderId?: string;
  filesLogFolderPath?: string;

  onlyShared: boolean;
  sharedKeyword: string;

  exportFolderId?: string;
  exportFolderPath?: string;
}

export type LogSeverity = "info" | "warning" | "error";

export interface LogEntry {
  timestamp: string;
  stage: string;
  severity: LogSeverity;
  message: string;
  context?: Record<string, unknown>;
}

export interface HubSummary {
  id: string;
  name: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
}

/** A sheet already split into headers + row objects, using whichever row was chosen as the header. */
export interface SheetData {
  sheetName: string;
  headers: string[];
  rows: Record<string, string>[];
}

/** Raw per-sheet grid exactly as returned by the server - the header row hasn't been chosen yet. */
export interface RawSheetData {
  sheetName: string;
  headerRowNumber: number;
  rows: (string[] | null)[];
}
