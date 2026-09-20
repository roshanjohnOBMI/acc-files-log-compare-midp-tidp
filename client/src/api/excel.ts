import { apiGet, apiUpload } from "./client";
import type { RawSheetData } from "../types/domain";

export interface ParseTidpResponse {
  fileName: string;
  sheets: RawSheetData[];
}

// Must stay above the server's longest possible parse timeout (excel.routes.ts's
// MAX_PARSE_TIMEOUT_MS) plus a large file's ACC download / browser upload time, so the server's
// clearer timeout error wins instead of the client aborting the request first.
const PARSE_TIMEOUT_MS = 330_000;

export function parseTidpFromAcc(projectId: string, itemId: string): Promise<ParseTidpResponse> {
  return apiGet(
    `/excel/parse?projectId=${encodeURIComponent(projectId)}&itemId=${encodeURIComponent(itemId)}`,
    PARSE_TIMEOUT_MS
  );
}

export function uploadTidpFile(file: File): Promise<ParseTidpResponse> {
  return apiUpload("/excel/upload", file, PARSE_TIMEOUT_MS);
}
