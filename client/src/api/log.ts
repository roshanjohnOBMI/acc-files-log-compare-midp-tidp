import { apiDelete, apiGet } from "./client";
import type { LogEntry } from "../types/domain";

export function listLog(): Promise<LogEntry[]> {
  return apiGet("/log");
}

export function clearLog(): Promise<void> {
  return apiDelete("/log");
}

export function exportLogUrl(format: "xlsx" | "csv"): string {
  return `/api/log/export?format=${format}`;
}
