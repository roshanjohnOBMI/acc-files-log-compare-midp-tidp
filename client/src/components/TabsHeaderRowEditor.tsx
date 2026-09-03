import type { SheetData } from "../types/domain";

interface TabsHeaderRowEditorProps {
  /** Header-derived sheets (already reflect each tab's current header row override). */
  sheets: SheetData[];
  selected: string[];
  onChange: (names: string[]) => void;
  activeSheetName: string | undefined;
  getHeaderRow: (sheetName: string) => number;
  onHeaderRowChange: (sheetName: string, row: number) => void;
  onApplyToAll: (row: number) => void;
  headerPreview: string[] | undefined;
}

/** Inline "tabs & header row" editor - every selected tab keeps its own header row, everything
 * below it read as data. Replaces a separate modal picker with one always-visible table so the
 * whole workbook's shape can be reviewed and fixed in one place. */
export function TabsHeaderRowEditor({
  sheets,
  selected,
  onChange,
  activeSheetName,
  getHeaderRow,
  onHeaderRowChange,
  onApplyToAll,
  headerPreview,
}: TabsHeaderRowEditorProps) {
  function toggle(name: string) {
    onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);
  }

  const activeRow = activeSheetName ? getHeaderRow(activeSheetName) : 1;

  return (
    <div className="tabs-header-editor">
      <p className="hint">
        Each selected tab keeps its own header row - everything below it is read as data. If the
        workbook is consistent, set it once here and apply it to every tab.
      </p>
      <div className="tabs-header-editor-controls">
        <label>
          Header row for "{activeSheetName ?? "—"}"
          <input
            type="number"
            min={1}
            value={activeRow}
            onChange={(e) => activeSheetName && onHeaderRowChange(activeSheetName, Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        {sheets.length > 1 && (
          <button type="button" className="btn-secondary" onClick={() => onApplyToAll(activeRow)}>
            Apply row {activeRow} to all {sheets.length} tabs
          </button>
        )}
        <div className="tabs-header-editor-select-actions">
          <button type="button" className="link-button" onClick={() => onChange(sheets.map((s) => s.sheetName))}>
            Select all
          </button>
          <button type="button" className="link-button" onClick={() => onChange([])}>
            Select none
          </button>
        </div>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Tab</th>
              <th>Header row</th>
              <th>Rows</th>
            </tr>
          </thead>
          <tbody>
            {sheets.map((sheet) => (
              <tr key={sheet.sheetName}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.includes(sheet.sheetName)}
                    onChange={() => toggle(sheet.sheetName)}
                  />
                </td>
                <td className="tabs-header-editor-name">{sheet.sheetName}</td>
                <td>
                  <input
                    type="number"
                    min={1}
                    className="tabs-header-editor-row-input"
                    value={getHeaderRow(sheet.sheetName)}
                    onChange={(e) => onHeaderRowChange(sheet.sheetName, Math.max(1, Number(e.target.value) || 1))}
                  />
                </td>
                <td>{sheet.rows.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="tabs-header-editor-preview">
        <summary>What row {activeRow} reads as{activeSheetName ? ` on "${activeSheetName}"` : ""}</summary>
        <p>
          {headerPreview && headerPreview.length > 0
            ? headerPreview.join(" · ")
            : `Row ${activeRow} has no readable columns - try a different row number.`}
        </p>
      </details>
    </div>
  );
}
