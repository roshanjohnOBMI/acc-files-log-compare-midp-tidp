import type { MatchMode } from "../types/domain";

interface ColumnSelectProps {
  headers: string[];
  identifierColumn: string | null;
  formatsColumn: string | null;
  plannedDateColumn: string | null;
  revisionColumn: string | null;
  matchMode: MatchMode;
  onChangeColumn: (column: string) => void;
  onChangeFormatsColumn: (column: string) => void;
  onChangePlannedDateColumn: (column: string) => void;
  onChangeRevisionColumn: (column: string) => void;
  onChangeMatchMode: (mode: MatchMode) => void;
}

export function ColumnSelect({
  headers,
  identifierColumn,
  formatsColumn,
  plannedDateColumn,
  revisionColumn,
  matchMode,
  onChangeColumn,
  onChangeFormatsColumn,
  onChangePlannedDateColumn,
  onChangeRevisionColumn,
  onChangeMatchMode,
}: ColumnSelectProps) {
  return (
    <div className="column-select">
      <label>
        Identifier column (base filename to search for)
        <select value={identifierColumn ?? ""} onChange={(e) => onChangeColumn(e.target.value)}>
          <option value="">Select a column…</option>
          {headers.map((header) => (
            <option key={header} value={header}>
              {header}
            </option>
          ))}
        </select>
      </label>
      <label>
        Formats column (comma-separated, e.g. "pdf, dwg")
        <select value={formatsColumn ?? ""} onChange={(e) => onChangeFormatsColumn(e.target.value)}>
          <option value="">Select a column…</option>
          {headers.map((header) => (
            <option key={header} value={header}>
              {header}
            </option>
          ))}
        </select>
      </label>
      <label>
        Planned Issue Date column (optional - filter below)
        <select value={plannedDateColumn ?? ""} onChange={(e) => onChangePlannedDateColumn(e.target.value)}>
          <option value="">None</option>
          {headers.map((header) => (
            <option key={header} value={header}>
              {header}
            </option>
          ))}
        </select>
      </label>
      <label>
        Revision column (optional - checked against the Files Log)
        <select value={revisionColumn ?? ""} onChange={(e) => onChangeRevisionColumn(e.target.value)}>
          <option value="">None</option>
          {headers.map((header) => (
            <option key={header} value={header}>
              {header}
            </option>
          ))}
        </select>
      </label>
      <label>
        Match mode
        <select value={matchMode} onChange={(e) => onChangeMatchMode(e.target.value as MatchMode)}>
          <option value="exact">Exact match</option>
          <option value="startsWith">File name starts with identifier</option>
          <option value="contains">File name contains identifier</option>
          <option value="deep">Deep search (exact → starts with → contains)</option>
        </select>
      </label>
    </div>
  );
}
