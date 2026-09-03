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
      {/* Each label's text is its own <span> (not a bare text node) so `.column-select label`'s
          `display: contents` (see index.css) can hand it off as an independent grid item, sized
          to its own line count - which is what keeps every <select> below starting at the same
          height regardless of how many lines its own label text happens to wrap to. */}
      <label>
        <span className="field-label-text">Identifier column (base filename to search for)</span>
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
        <span className="field-label-text">Formats column (comma-separated, e.g. "pdf, dwg")</span>
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
        <span className="field-label-text">Planned Issue Date column (optional - filter below)</span>
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
        <span className="field-label-text">Revision column (optional - checked against the Files Log)</span>
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
        <span className="field-label-text">Match mode</span>
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
