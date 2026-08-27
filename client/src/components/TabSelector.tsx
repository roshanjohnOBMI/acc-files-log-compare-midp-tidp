import { useState } from "react";
import type { SheetData } from "../types/domain";

interface TabSelectorProps {
  sheets: SheetData[];
  selected: string[];
  onChange: (names: string[]) => void;
  /** Effective header row currently in use for a sheet (an override, or its own auto-detected default). */
  getHeaderRow: (sheetName: string) => number;
  onHeaderRowChange: (sheetName: string, headerRow: number) => void;
}

export function TabSelector({ sheets, selected, onChange, getHeaderRow, onHeaderRowChange }: TabSelectorProps) {
  const [open, setOpen] = useState(false);

  function toggle(name: string) {
    if (selected.includes(name)) {
      onChange(selected.filter((n) => n !== name));
    } else {
      onChange([...selected, name]);
    }
  }

  return (
    <div className="tab-selector">
      <span className="tab-selector-summary">
        {selected.length} of {sheets.length} tab{sheets.length === 1 ? "" : "s"} selected
      </span>
      <button type="button" onClick={() => setOpen(true)}>
        Select Tabs…
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h3>Select tabs to include</h3>
            <p className="hint">
              Rows from every checked tab are combined into one working dataset, tagged with
              which tab they came from. If a tab shows 0 rows, its header row was probably
              auto-detected wrong - adjust "hdr row" for that tab until its row count looks right.
            </p>
            <div className="tab-selector-actions">
              <button type="button" onClick={() => onChange(sheets.map((s) => s.sheetName))}>
                Select all
              </button>
              <button type="button" onClick={() => onChange([])}>
                Select none
              </button>
            </div>
            <div className="tab-selector-list">
              {sheets.map((sheet) => (
                <div className="tab-selector-row" key={sheet.sheetName}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(sheet.sheetName)}
                      onChange={() => toggle(sheet.sheetName)}
                    />
                    <span className="tab-selector-name">{sheet.sheetName}</span>
                  </label>
                  <span className="tab-selector-count">{sheet.rows.length} row(s)</span>
                  <label className="tab-selector-header-row">
                    hdr row
                    <input
                      type="number"
                      min={1}
                      value={getHeaderRow(sheet.sheetName)}
                      onChange={(e) =>
                        onHeaderRowChange(sheet.sheetName, Math.max(1, Number(e.target.value) || 1))
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
