import { ApiError } from "./client";
import type { ExtraFile, MatchMode, RowMatchResult, SearchSummary } from "../types/domain";

export interface ReportExportRequest {
  sourceFileName?: string;
  filesLogSourceDescription?: string;
  onlyShared?: boolean;
  sharedKeyword?: string;
  selectedSheetNames?: string[];
  headerRow?: number;
  identifierColumn?: string;
  formatsColumn?: string;
  plannedDateColumn?: string;
  selectedPlannedDates?: string[];
  columnFilters?: Record<string, string>;
  matchMode: MatchMode;
  results: RowMatchResult[];
  summary: SearchSummary;
  extraFiles: ExtraFile[];
  filesScanned: number;
  /** When set, the server saves the workbook into this ACC folder instead of returning it as a download. */
  saveTo?: { projectId: string; folderId: string };
}

export type ExportResult =
  | { savedToAcc: false; fileName: string }
  | { savedToAcc: true; fileName: string; itemId: string; webViewUrl?: string };

const API_BASE = "/api";

/** POSTs the report payload. Without `saveTo`, triggers a browser download of the returned .xlsx
 * workbook; with `saveTo`, the server uploads it directly into the given ACC folder instead. */
export async function exportReport(request: ReportExportRequest): Promise<ExportResult> {
  const res = await fetch(`${API_BASE}/export/report`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error ?? message;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new ApiError(message, res.status);
  }

  if (request.saveTo) {
    const body = await res.json();
    return { savedToAcc: true, fileName: body.fileName, itemId: body.itemId, webViewUrl: body.webViewUrl };
  }

  const disposition = res.headers.get("Content-Disposition") ?? "";
  const fileNameMatch = disposition.match(/filename="?([^"]+)"?/);
  const fileName = fileNameMatch?.[1] ?? "QA_QC Report.xlsx";

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  return { savedToAcc: false, fileName };
}
