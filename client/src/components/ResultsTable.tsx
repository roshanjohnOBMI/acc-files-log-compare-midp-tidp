import { useMemo, useState } from "react";
import type { ExtraFile, FormatMatchStatus, RowMatchResult, SearchSummary } from "../types/domain";

interface ResultsTableProps {
  results: RowMatchResult[];
  summary: SearchSummary;
  extraFiles: ExtraFile[];
  sourceFileName?: string;
}

type DeliverableStatus = FormatMatchStatus | "not_found_in_source" | "skipped";

interface DeliverableRow {
  key: string;
  identifier: string;
  format: string;
  status: DeliverableStatus;
  discipline: string;
  fileName: string;
  webViewUrl?: string;
  versionNumber: string;
  folderPath: string;
  lastModifiedBy: string;
  logRevision: string;
  sourceRevision: string;
  revisionMatch: "match" | "mismatch" | "";
  matchedVia: "exact" | "startsWith" | "contains" | "";
}

const MATCHED_VIA_LABEL: Record<DeliverableRow["matchedVia"], string> = {
  exact: "Exact",
  startsWith: "Starts With",
  contains: "Contains",
  "": "",
};

const ALL = "";
const RENDER_LIMIT = 500;
const STATUS_LABEL: Record<DeliverableStatus, string> = {
  match: "Match",
  not_found_in_log: "Not Found in Files Log",
  duplicate_in_log: "Duplicate in Files Log",
  duplicate_in_source: "Duplicate in TIDP/MIDP",
  not_found_in_source: "Not Found in TIDP/MIDP",
  skipped: "Skipped",
};

/** Flattens one row-per-document (with N formats each) into one row-per-document-per-format. Files
 * in the Files Log that don't correspond to any TIDP/MIDP row are appended as their own "Not Found
 * in TIDP/MIDP" rows.
 *
 * "Skipped" rows (a TIDP/MIDP row with a blank identifier and/or no formats listed) are left out
 * entirely - not a real deliverable to compare, just an empty/incomplete row in the source
 * register, so listing it here is only noise. Still counted in the "Skipped" summary stat above
 * (read from `summary.skipped` directly, not from this list), just not row-by-row here. */
function flatten(results: RowMatchResult[], extraFiles: ExtraFile[]): DeliverableRow[] {
  const rows: DeliverableRow[] = [];
  for (const result of results) {
    if (result.formats.length === 0) continue;
    for (const format of result.formats) {
      rows.push({
        key: `${result.rowIndex}-${format.format}`,
        identifier: result.identifier,
        format: format.format.toUpperCase(),
        status: format.status,
        discipline: result.discipline,
        fileName: format.fileName ?? "",
        webViewUrl: format.webViewUrl,
        versionNumber: format.versionNumber ? `V${format.versionNumber}` : "",
        folderPath: format.folderPath ?? "",
        lastModifiedBy: format.lastModifiedBy ?? "",
        logRevision: format.revision ?? "",
        sourceRevision: result.sourceRevision,
        revisionMatch: format.revisionMatch ?? "",
        matchedVia: format.matchedVia ?? "",
      });
    }
  }
  for (const file of extraFiles) {
    rows.push({
      key: `extra-${file.itemId ?? file.fileName}`,
      identifier: "Not found in TIDP/MIDP",
      format: file.extension.toUpperCase(),
      status: "not_found_in_source",
      discipline: file.discipline,
      fileName: file.fileName,
      webViewUrl: file.webViewUrl,
      versionNumber: file.versionNumber ? `V${file.versionNumber}` : "",
      folderPath: file.folderPath ?? "",
      lastModifiedBy: file.lastModifiedBy ?? "",
      logRevision: file.revision ?? "",
      sourceRevision: "",
      revisionMatch: "",
      matchedVia: "",
    });
  }
  return rows;
}

export function ResultsTable({ results, summary, extraFiles, sourceFileName }: ResultsTableProps) {
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  const deliverables = useMemo(() => flatten(results, extraFiles), [results, extraFiles]);

  const duplicateCount = useMemo(
    () => deliverables.filter((d) => d.status === "duplicate_in_log" || d.status === "duplicate_in_source").length,
    [deliverables]
  );

  const distinctValues = useMemo(() => {
    const columns: (keyof DeliverableRow)[] = ["format", "status", "discipline"];
    const map: Record<string, string[]> = {};
    for (const column of columns) {
      const set = new Set<string>();
      for (const row of deliverables) {
        set.add(column === "status" ? STATUS_LABEL[row.status] : String(row[column] ?? ""));
      }
      map[column] = Array.from(set).sort();
    }
    return map;
  }, [deliverables]);

  const filteredDeliverables = useMemo(
    () =>
      deliverables.filter((row) => {
        if (columnFilters.format && row.format !== columnFilters.format) return false;
        if (columnFilters.status && STATUS_LABEL[row.status] !== columnFilters.status) return false;
        if (columnFilters.discipline && row.discipline !== columnFilters.discipline) return false;
        return true;
      }),
    [deliverables, columnFilters]
  );

  // "Not Found in TIDP/MIDP" (extra Files Log entries) rows are always appended after every
  // matched TIDP/MIDP row (see flatten above), so a plain slice(0, RENDER_LIMIT) on a register with
  // 500+ deliverable rows silently cut every extra file out of view. Every non-"match" row
  // (missing/duplicate/extra/skipped/partial) is the reason this tool exists, so those are never
  // trimmed - only "match" rows give up their spot once the render budget runs out.
  const visibleDeliverables = useMemo(() => {
    const nonMatchCount = filteredDeliverables.reduce((n, row) => (row.status === "match" ? n : n + 1), 0);
    let matchBudget = Math.max(0, RENDER_LIMIT - nonMatchCount);
    const visible: DeliverableRow[] = [];
    for (const row of filteredDeliverables) {
      if (row.status !== "match") {
        visible.push(row);
      } else if (matchBudget > 0) {
        visible.push(row);
        matchBudget -= 1;
      }
    }
    return visible;
  }, [filteredDeliverables]);

  const subtitle = sourceFileName ? sourceFileName.replace(/\.[^./\\]+$/, "") : null;

  return (
    <div className="results-table">
      <div className="results-title-bar">
        TIDP/MIDP Deliverables{subtitle ? `  -  ${subtitle}` : ""}
      </div>
      <div className="results-summary">
        <SummaryStat label="Total rows" value={summary.total} />
        <SummaryStat label="Complete" value={summary.complete} className="status-complete" />
        <SummaryStat label="Partial" value={summary.partial} className="status-partial" />
        <SummaryStat label="Missing" value={summary.missing} className="status-missing" />
        <SummaryStat label="Duplicates" value={duplicateCount} className="status-duplicate" />
        <SummaryStat label="Skipped" value={summary.skipped} className="status-skipped" />
        <SummaryStat label="Extra in Log" value={summary.extra} className="status-extra" />
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>TIDP/MIDP Deliverable</th>
              <th>Format</th>
              <th>Status</th>
              <th>Discipline</th>
              <th>Files Log Entry</th>
              <th>Version</th>
              <th>Folder Path</th>
              <th>Modified By</th>
              <th>Log Revision</th>
              <th>TIDP/MIDP Revision</th>
              <th>Revision Match</th>
              <th>Matched Via</th>
            </tr>
            <tr className="filter-row">
              <th />
              {(["format", "status", "discipline"] as const).map((column) => (
                <th key={column}>
                  <select
                    value={columnFilters[column] ?? ALL}
                    onChange={(e) => setColumnFilters((prev) => ({ ...prev, [column]: e.target.value }))}
                  >
                    <option value={ALL}>All</option>
                    {distinctValues[column].map((value) => (
                      <option key={value} value={value}>
                        {value || "(blank)"}
                      </option>
                    ))}
                  </select>
                </th>
              ))}
              <th />
              <th />
              <th />
              <th />
              <th />
              <th />
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {visibleDeliverables.map((row) => (
              <tr key={row.key}>
                <td>{row.identifier}</td>
                <td>{row.format}</td>
                <td>
                  <span className={`status-badge status-${row.status.replace(/_/g, "-")}`}>
                    {STATUS_LABEL[row.status]}
                  </span>
                </td>
                <td>{row.discipline}</td>
                <td>
                  {row.fileName ? (
                    row.webViewUrl ? (
                      <a href={row.webViewUrl} target="_blank" rel="noreferrer">
                        {row.fileName}
                      </a>
                    ) : (
                      row.fileName
                    )
                  ) : (
                    ""
                  )}
                </td>
                <td>{row.versionNumber}</td>
                <td>{row.folderPath}</td>
                <td>{row.lastModifiedBy}</td>
                <td>{row.logRevision}</td>
                <td>{row.sourceRevision}</td>
                <td>
                  {row.revisionMatch && (
                    <span className={`status-badge status-revision-${row.revisionMatch}`}>
                      {row.revisionMatch === "match" ? "Match" : "Mismatch"}
                    </span>
                  )}
                </td>
                <td>{MATCHED_VIA_LABEL[row.matchedVia]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibleDeliverables.length < filteredDeliverables.length && (
          <p className="hint">
            Showing {visibleDeliverables.length} of {filteredDeliverables.length} row(s) (every
            Missing/Duplicate/Extra/Skipped row is included; only Match rows were trimmed) - narrow
            with a filter above, or use "Export QA/QC report" for the complete list.
          </p>
        )}
      </div>
    </div>
  );
}

function SummaryStat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className={`summary-stat ${className ?? ""}`}>
      <span className="summary-stat-value">{value}</span>
      <span className="summary-stat-label">{label}</span>
    </div>
  );
}
