import { useMemo } from "react";
import type { FilteredRow } from "./DataFilterTable";
import { parseFormatList } from "../lib/parseFormats";

interface RowPreviewTableProps {
  rows: FilteredRow[];
  identifierColumn: string | null;
  formatsColumn: string | null;
  plannedDateColumn: string | null;
}

const PREVIEW_LIMIT = 200;

/** Shows exactly what will be searched - per row, before the search actually runs. */
export function RowPreviewTable({ rows, identifierColumn, formatsColumn, plannedDateColumn }: RowPreviewTableProps) {
  const preview = useMemo(
    () =>
      rows.map((row) => ({
        rowIndex: row.rowIndex,
        plannedDate: plannedDateColumn ? row.values[plannedDateColumn] ?? "" : "",
        identifier: identifierColumn ? row.values[identifierColumn] ?? "" : "",
        formats: formatsColumn ? parseFormatList(row.values[formatsColumn]) : [],
      })),
    [rows, identifierColumn, formatsColumn, plannedDateColumn]
  );

  if (!identifierColumn || !formatsColumn) return null;

  const blankIdentifierCount = preview.filter((r) => !r.identifier.trim()).length;
  const blankFormatsCount = preview.filter((r) => r.formats.length === 0).length;

  return (
    <div className="row-preview-table">
      <div className="data-filter-toolbar">
        <span className="hint">
          {preview.length} row(s) will be searched
          {blankIdentifierCount > 0 ? ` · ${blankIdentifierCount} with a blank identifier (skipped)` : ""}
          {blankFormatsCount > 0 ? ` · ${blankFormatsCount} with no formats listed (skipped)` : ""}
        </span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Row</th>
              {plannedDateColumn && <th>Planned Issue Date</th>}
              <th>Identifier</th>
              <th>Formats</th>
            </tr>
          </thead>
          <tbody>
            {preview.slice(0, PREVIEW_LIMIT).map((row) => (
              <tr key={row.rowIndex}>
                <td>{row.rowIndex + 1}</td>
                {plannedDateColumn && <td>{row.plannedDate}</td>}
                <td className={row.identifier.trim() ? "" : "warning-text"}>
                  {row.identifier.trim() || "(blank)"}
                </td>
                <td className={row.formats.length ? "" : "warning-text"}>
                  {row.formats.length ? row.formats.map((f) => `.${f}`).join(", ") : "(none)"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {preview.length > PREVIEW_LIMIT && (
          <p className="hint">Showing first {PREVIEW_LIMIT} of {preview.length} rows.</p>
        )}
      </div>
    </div>
  );
}
