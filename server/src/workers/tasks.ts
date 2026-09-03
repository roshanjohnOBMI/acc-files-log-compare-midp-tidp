import type { MatchInputRow } from "../services/matchService.js";
import type { ReportExportRequest } from "../services/reportExport.service.js";
import type {
  ExtraFile,
  IndexedFile,
  MatchMode,
  RawSheetData,
  RowMatchResult,
  SearchSummary,
} from "../types/domain.js";

/** Every CPU-heavy job the pool knows how to run - each one is a plain, already-existing service
 * function (see workers/taskWorker.ts) with no dependency on Express or the request/response
 * cycle, which is what makes it safe to run on a worker thread instead of the main one. */
export type WorkerTaskName =
  | "parseTidpWorkbook"
  | "parseFilesLogWorkbook"
  | "matchRows"
  | "buildQaQcWorkbook";

export interface WorkerTaskPayloadMap {
  parseTidpWorkbook: { buffer: Buffer; fileName: string };
  parseFilesLogWorkbook: { buffer: Buffer; fileName: string };
  matchRows: { rows: MatchInputRow[]; matchMode: MatchMode; fileIndex: IndexedFile[] };
  buildQaQcWorkbook: { request: ReportExportRequest };
}

export interface WorkerTaskResultMap {
  parseTidpWorkbook: RawSheetData[];
  parseFilesLogWorkbook: IndexedFile[];
  matchRows: { results: RowMatchResult[]; summary: SearchSummary; extraFiles: ExtraFile[] };
  buildQaQcWorkbook: Buffer;
}

/** Main thread -> worker. Written as a mapped type distributed over each task name (rather than a
 * generic with a defaulted type parameter) specifically so it comes out as a real discriminated
 * union - `{ task: "matchRows"; payload: {...} } | { task: "buildQaQcWorkbook"; payload: {...} } |
 * ...` - which is what lets `switch (message.task)` in taskWorker.ts narrow `message.payload`'s
 * type per case instead of leaving it as the union of every task's payload shape at once. */
export type WorkerRequestMessage = {
  [T in WorkerTaskName]: { id: number; task: T; payload: WorkerTaskPayloadMap[T] };
}[WorkerTaskName];

/** Worker -> main thread: either a forwarded logEntry() call (see errorLog.service.ts's
 * isMainThread check) or a task's outcome - distinguished by the `__log` flag so the pool doesn't
 * mistake one for the other. */
export type WorkerResponseMessage =
  | { __log: true; stage: string; severity: string; message: string; context?: Record<string, unknown> }
  | { __log?: false; id: number; ok: true; result: unknown }
  | { __log?: false; id: number; ok: false; error: string };
