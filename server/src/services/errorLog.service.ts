import ExcelJS from "exceljs";
import { isMainThread, parentPort } from "node:worker_threads";
import type { LogEntry, LogSeverity } from "../types/domain.js";

const entries: LogEntry[] = [];
// A single search over a large real-world MIDP register can log a warning per missing/duplicate
// row - thousands of entries in one run. Without a cap this grows unbounded for the life of the
// process and the Activity log panel (which polls and re-renders the whole list) gets slower with
// every search. Oldest entries are dropped first, same trade-off the row/rendering caps elsewhere
// in the app already make.
const MAX_ENTRIES = 5000;

export function logEntry(
  stage: string,
  severity: LogSeverity,
  message: string,
  context?: Record<string, unknown>
): void {
  // Excel parsing/matching/export building can run on a worker thread (see workers/workerPool.ts)
  // to keep the main thread's event loop free - but each thread gets its own copy of this module,
  // with its own private `entries` array. A worker's warnings would otherwise vanish into a log
  // nobody ever reads (the /api/log endpoint only ever runs on the main thread). Forward instead
  // of storing locally; workerPool.ts re-calls this same function on the main thread on receipt,
  // which is what actually appends to `entries` and respects MAX_ENTRIES below.
  if (!isMainThread && parentPort) {
    parentPort.postMessage({ __log: true, stage, severity, message, context });
    return;
  }

  entries.push({
    timestamp: new Date().toISOString(),
    stage,
    severity,
    message,
    context,
  });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

export function listEntries(): LogEntry[] {
  return [...entries].reverse();
}

export function clearEntries(): void {
  entries.length = 0;
}

export async function exportWorkbook(): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Error Log");
  sheet.columns = [
    { header: "Timestamp", key: "timestamp", width: 24 },
    { header: "Stage", key: "stage", width: 16 },
    { header: "Severity", key: "severity", width: 10 },
    { header: "Message", key: "message", width: 60 },
    { header: "Context", key: "context", width: 50 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const entry of listEntries()) {
    sheet.addRow({
      timestamp: entry.timestamp,
      stage: entry.stage,
      severity: entry.severity,
      message: entry.message,
      context: entry.context ? JSON.stringify(entry.context) : "",
    });
  }
  return workbook.xlsx.writeBuffer();
}

export function exportCsv(): string {
  const header = ["Timestamp", "Stage", "Severity", "Message", "Context"];
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = listEntries().map((entry) =>
    [
      entry.timestamp,
      entry.stage,
      entry.severity,
      entry.message,
      entry.context ? JSON.stringify(entry.context) : "",
    ]
      .map((value) => escape(String(value)))
      .join(",")
  );
  return [header.map(escape).join(","), ...rows].join("\n");
}
