interface PlannedDateFilterProps {
  column: string | null;
  values: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}

/** Multi-select checkbox filter for the Planned Issue Date column - unlike every other column's
 * single-value AutoFilter-style dropdown, checking multiple dates here is a common real workflow
 * (checking a batch of documents due across several milestone dates at once). */
export function PlannedDateFilter({ column, values, selected, onChange }: PlannedDateFilterProps) {
  if (!column) return null;

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <div className="planned-date-filter">
      <div className="data-filter-toolbar">
        <span className="hint">
          {selected.length === 0
            ? `All ${values.length} planned issue date(s) included`
            : `${selected.length} of ${values.length} planned issue date(s) selected`}
        </span>
        <button type="button" className="link-button" onClick={() => onChange(values)}>
          Select all
        </button>
        {selected.length > 0 && (
          <button type="button" className="link-button" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </div>
      <div className="planned-date-filter-list">
        {values.map((value) => (
          <label key={value || "(blank)"} className="planned-date-chip">
            <input type="checkbox" checked={selected.includes(value)} onChange={() => toggle(value)} />
            {value || "(blank)"}
          </label>
        ))}
      </div>
    </div>
  );
}
