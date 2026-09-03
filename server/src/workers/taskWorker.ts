import { parentPort } from "node:worker_threads";
import { parseWorkbookBuffer } from "../services/excelParse.service.js";
import { parseFilesLogWorkbook } from "../services/filesLogParse.service.js";
import { matchRows } from "../services/matchService.js";
import { buildQaQcWorkbook } from "../services/reportExport.service.js";
import type { WorkerRequestMessage, WorkerResponseMessage } from "./tasks.js";

if (!parentPort) {
  throw new Error("taskWorker.ts must only be run as a worker thread, via workerPool.ts");
}

// Bound once (not `let parentPort` inline below) so TypeScript's null-check above narrows it for
// every use in this file, including inside the async message handler.
const port = parentPort;

/** Runs exactly one of the app's known CPU-heavy jobs and posts its outcome back - `logEntry()`
 * calls made from any of these (a large-workbook warning, a duplicate-row notice, ...) are
 * forwarded to the main thread automatically, see errorLog.service.ts's isMainThread check. */
async function run(message: WorkerRequestMessage): Promise<unknown> {
  switch (message.task) {
    case "parseTidpWorkbook":
      return parseWorkbookBuffer(message.payload.buffer, message.payload.fileName);
    case "parseFilesLogWorkbook":
      return parseFilesLogWorkbook(message.payload.buffer, message.payload.fileName);
    case "matchRows":
      return matchRows(message.payload.rows, message.payload.matchMode, message.payload.fileIndex);
    case "buildQaQcWorkbook":
      return buildQaQcWorkbook(message.payload.request);
    default:
      // Not reachable for any task tasks.ts currently declares - only trips if a new
      // WorkerTaskName is added there without adding a matching case above.
      throw new Error(`Unknown worker task: ${(message as { task: string }).task}`);
  }
}

port.on("message", (message: WorkerRequestMessage) => {
  run(message)
    .then((result) => {
      const response: WorkerResponseMessage = { id: message.id, ok: true, result };
      port.postMessage(response);
    })
    .catch((err) => {
      const response: WorkerResponseMessage = {
        id: message.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      port.postMessage(response);
    });
});
