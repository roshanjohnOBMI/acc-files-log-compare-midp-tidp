import { apiPost } from "./client";
import type { ExtraFile, IndexedFile, MatchMode, RowMatchResult, SearchSummary } from "../types/domain";

export interface SearchRunRequest {
  projectId?: string;
  rows: { rowIndex: number; identifier: string; discipline: string; sourceRevision: string; formats: string[] }[];
  matchMode: MatchMode;
  fileIndex: IndexedFile[];
}

export interface SearchRunResponse {
  results: RowMatchResult[];
  summary: SearchSummary;
  filesScanned: number;
  extraFiles: ExtraFile[];
}

export function runSearch(request: SearchRunRequest): Promise<SearchRunResponse> {
  return apiPost("/search/run", request);
}
