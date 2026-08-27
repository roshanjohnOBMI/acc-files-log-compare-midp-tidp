import { useEffect, useMemo, useState } from "react";
import type { SheetData } from "../types/domain";

export interface FilteredRow {
  rowIndex: number;
  values: Record<string, string>;
}

interface DataFilterTableProps {
  sheet: SheetData;
  identifierColumn: string | null;
  formatsColumn: string | null;
  plannedDateColumn: string | null;
  plannedDateValues: string[];
  columnFilters: Record<string, string>;
  onColumnFiltersChange: (filters: Record<string, string>) => void;
  onFilteredRowsChange: (rows: FilteredRow[]) => void;
}

const ALL = "";
// Columns with more distinct values than this (e.g. Document Number/Title on a large MIDP)
// aren't useful as a dropdown anyway and building/rendering that many <option> nodes per
// column is what was freezing the page on real-sized workbooks - skip the dropdown for them.
const MAX_FILTER_OPTIONS = 200;

function roleClass(header: string, identifierColumn: string | null, formatsColumn: string | null, plannedDateColumn: string | null) {
  if (header === identifierColumn) return "identifier-column";
  if (header === formatsColumn) return "formats-column";
  if (header === plannedDateColumn) return "planned-date-column";
  return "";
}

function roleBadge(header: string, identifierColumn: string | null, formatsColumn: string | null, plannedDateColumn: string | null) {
  if (header === identifierColumn) return " 🔑";
  if (header === formatsColumn) return " 🏷️";
  if (header === plannedDateColumn) return " 📅";
  return "";
}

export function DataFilterTable({
  sheet,
  identifierColumn,
  formatsColumn,
  plannedDateColumn,
  plannedDateValues,
  columnFilters,
  onColumnFiltersChange,
  onFilteredRowsChange,
}: DataFilterTableProps) {
  // One picked value per column ("" means "All"). Simple, always-visible dropdowns -
  // no popovers, no per-column search-inside-search, no check-all/uncheck-all buttons.
  // Lifted to the parent (rather than local state) so it can be summarized in exported reports.
  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");

  // Filtering the full (possibly multi-tab-combined) row set on every keystroke is what made
  // typing feel laggy on large workbooks - debounce it so it only runs once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchText(searchText), 200);
    return () => clearTimeout(timer);
  }, [searchText]);

  const rowsWithIndex = useMemo(
    () => sheet.rows.map((values, rowIndex) => ({ rowIndex, values })),
    [sheet]
  );

  // Bails out of a column as soon as it's clearly not dropdown-sized, instead of always
  // scanning every row for every column - the near-unique columns (Document Number,
  // Description, ...) are exactly the ones with the most rows to scan.
  const distinctValues = useMemo(() => {
    const map: Record<string, string[] | null> = {};
    for (const header of sheet.headers) {
      const set = new Set<string>();
      let overflowed = false;
      for (const row of sheet.rows) {
        set.add(row[header] ?? "");
        if (set.size > MAX_FILTER_OPTIONS) {
          overflowed = true;
          break;
        }
      }
      map[header] = overflowed ? null : Array.from(set).sort();
    }
    return map;
  }, [sheet]);

  const filteredRows = useMemo(() => {
    const search = debouncedSearchText.trim().toLowerCase();
    return rowsWithIndex.filter(({ values }) => {
      for (const [column, wanted] of Object.entries(columnFilters)) {
        if (!wanted) continue;
        const actual = values[column] ?? "";
        // Columns with too many distinct values render as a free-text "contains" input
        // instead of a dropdown (see distinctValues), so they need substring matching -
        // an exact-match would never hit since the user is typing a partial value.
        const isFreeText = distinctValues[column] === null;
        if (isFreeText ? !actual.toLowerCase().includes(wanted.toLowerCase()) : actual !== wanted) return false;
      }
      if (plannedDateColumn && plannedDateValues.length > 0) {
        if (!plannedDateValues.includes(values[plannedDateColumn] ?? "")) return false;
      }
      if (search) {
        const haystack = Object.values(values).join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [rowsWithIndex, columnFilters, debouncedSearchText, plannedDateColumn, plannedDateValues, distinctValues]);

  useEffect(() => {
    onFilteredRowsChange(filteredRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRows]);

  const activeFilterCount =
    Object.values(columnFilters).filter((v) => v !== ALL).length + (plannedDateValues.length > 0 ? 1 : 0);

  return (
    <div className="data-filter-table">
      <div className="data-filter-toolbar">
        <input
          type="text"
          placeholder="Search all columns…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <span className="hint">
          {filteredRows.length} of {sheet.rows.length} rows
          {activeFilterCount > 0 ? ` · ${activeFilterCount} column filter(s) active` : ""}
        </span>
        {(activeFilterCount > 0 || searchText) && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              onColumnFiltersChange({});
              setSearchText("");
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {sheet.headers.map((header) => (
                <th key={header}>
                  <span className={roleClass(header, identifierColumn, formatsColumn, plannedDateColumn)}>
                    {header}
                    {roleBadge(header, identifierColumn, formatsColumn, plannedDateColumn)}
                  </span>
                </th>
              ))}
            </tr>
            <tr className="filter-row">
              {sheet.headers.map((header) =>
                header === plannedDateColumn ? (
                  <th key={header}>
                    <span className="filter-row-note">Set above ↑</span>
                  </th>
                ) : distinctValues[header] ? (
                  <th key={header}>
                    <select
                      value={columnFilters[header] ?? ALL}
                      onChange={(e) => onColumnFiltersChange({ ...columnFilters, [header]: e.target.value })}
                    >
                      <option value={ALL}>All</option>
                      {distinctValues[header]!.map((value) => (
                        <option key={value} value={value}>
                          {value || "(blank)"}
                        </option>
                      ))}
                    </select>
                  </th>
                ) : (
                  <th key={header}>
                    <input
                      type="text"
                      placeholder="Contains…"
                      title="Too many distinct values for a dropdown - type to filter this column"
                      value={columnFilters[header] ?? ALL}
                      onChange={(e) => onColumnFiltersChange({ ...columnFilters, [header]: e.target.value })}
                    />
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {filteredRows.slice(0, 500).map(({ rowIndex, values }) => (
              <tr key={rowIndex}>
                {sheet.headers.map((header) => (
                  <td key={header} className={roleClass(header, identifierColumn, formatsColumn, plannedDateColumn)}>
                    {values[header]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {filteredRows.length > 500 && (
          <p className="hint">Showing first 500 of {filteredRows.length} matching rows.</p>
        )}
      </div>
    </div>
  );
}
