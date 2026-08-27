import { apiGet, apiPost, apiUpload } from "./client";
import type { FilesLogScanFolder, IndexedFile } from "../types/domain";

export interface FilesLogResponse {
  files: IndexedFile[];
  foldersSkipped: number;
  fileName?: string;
}

// Must stay above the server's own request handling time for a large multi-folder scan - a scan
// can legitimately take a while on a big project tree, so this is generous rather than matching
// the TIDP/MIDP parse timeout.
const SCAN_TIMEOUT_MS = 180_000;
const PARSE_TIMEOUT_MS = 65_000;

export function scanFilesLog(
  projectId: string,
  folders: FilesLogScanFolder[],
  includeSubfolders: boolean
): Promise<FilesLogResponse> {
  return apiPost("/files-log/scan", { projectId, folders, includeSubfolders }, SCAN_TIMEOUT_MS);
}

export function parseFilesLog(projectId: string, itemId: string): Promise<FilesLogResponse> {
  return apiGet(
    `/files-log/parse?projectId=${encodeURIComponent(projectId)}&itemId=${encodeURIComponent(itemId)}`,
    PARSE_TIMEOUT_MS
  );
}

export function uploadFilesLog(file: File): Promise<FilesLogResponse> {
  return apiUpload("/files-log/upload", file, PARSE_TIMEOUT_MS);
}
