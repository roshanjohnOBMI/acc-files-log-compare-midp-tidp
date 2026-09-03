import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ColumnSelect } from "../components/ColumnSelect";
import { DataFilterTable } from "../components/DataFilterTable";
import { FilesLogFilterPanel } from "../components/FilesLogFilterPanel";
import { PlannedDateFilter } from "../components/PlannedDateFilter";
import { RowPreviewTable } from "../components/RowPreviewTable";
import { TabsHeaderRowEditor } from "../components/TabsHeaderRowEditor";
import { useWorkspace } from "../context/WorkspaceContext";

type SetupTab = "tabs" | "map" | "filter" | "fileslog" | "preview";

const TABS: { key: SetupTab; label: string }[] = [
  { key: "tabs", label: "Tabs & header row" },
  { key: "map", label: "Column mapping" },
  { key: "filter", label: "Filter rows" },
  { key: "fileslog", label: "ACC Files Log filter" },
  { key: "preview", label: "Preview" },
];

export function SetupMappingPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<SetupTab>("tabs");
  const {
    sourceFileName,
    rawSheets,
    derivedSheets,
    selectedSheetNames,
    setSelectedSheetNames,
    activeSheetName,
    effectiveHeaderRow,
    setHeaderRowFor,
    setHeaderRowForAllTabs,
    headerPreview,
    combinedSheet,
    identifierColumn,
    setIdentifierColumn,
    formatsColumn,
    setFormatsColumn,
    plannedDateColumn,
    setPlannedDateColumn,
    revisionColumn,
    setRevisionColumn,
    matchMode,
    setMatchMode,
    plannedDateValues,
    selectedPlannedDates,
    setSelectedPlannedDates,
    columnFilters,
    setColumnFilters,
    setFilteredRows,
    filteredRows,
    filesLogLoaded,
    onlyShared,
    setOnlyShared,
    sharedKeyword,
    setSharedKeyword,
    filesLogIndex,
    visibleFileIndex,
    filesLogFoldersSkipped,
  } = useWorkspace();

  if (rawSheets.length === 0) {
    return (
      <div className="setup-mapping-shell">
        <div className="setup-mapping-empty">
          <h1>Setup &amp; mapping</h1>
          <p className="hint">
            Pick a TIDP/MIDP file from the Workspace tab first - its tabs, columns, and rows will
            show up here to configure.
          </p>
          <button type="button" className="btn-primary" onClick={() => navigate("/")}>
            Go to Workspace
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-mapping-shell">
      <div className="setup-mapping-head">
        <h1>Setup &amp; mapping</h1>
        <span className="hint">
          {sourceFileName ?? "Untitled workbook"} · {activeSheetName ?? "no tab"} ·{" "}
          {combinedSheet?.rows.length ?? 0} filled row(s)
        </span>
        <div className="setup-mapping-head-actions">
          <button type="button" className="btn-ghost" onClick={() => navigate("/")}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={() => navigate("/")}>
            Apply &amp; return to workspace
          </button>
        </div>
      </div>

      <div className="setup-mapping-body">
        <nav className="setup-mapping-nav">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`setup-mapping-nav-item${tab === t.key ? " active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="setup-mapping-pane">
          {tab === "tabs" && (
            <>
              <h2>Tabs &amp; header row</h2>
              <TabsHeaderRowEditor
                sheets={derivedSheets}
                selected={selectedSheetNames}
                onChange={setSelectedSheetNames}
                activeSheetName={activeSheetName}
                getHeaderRow={effectiveHeaderRow}
                onHeaderRowChange={setHeaderRowFor}
                onApplyToAll={setHeaderRowForAllTabs}
                headerPreview={headerPreview}
              />
            </>
          )}

          {tab === "map" && (
            <>
              <h2>Column mapping</h2>
              {combinedSheet ? (
                <>
                  <p className="hint">
                    Columns matching common TIDP/MIDP header names are pre-selected - change them
                    if they're wrong. Discipline is read automatically from the last part of each
                    tab's name (e.g. "MIDP - AR" → AR), so there's nothing to pick for it.
                  </p>
                  <ColumnSelect
                    headers={combinedSheet.headers}
                    identifierColumn={identifierColumn}
                    formatsColumn={formatsColumn}
                    plannedDateColumn={plannedDateColumn}
                    revisionColumn={revisionColumn}
                    matchMode={matchMode}
                    onChangeColumn={setIdentifierColumn}
                    onChangeFormatsColumn={setFormatsColumn}
                    onChangePlannedDateColumn={setPlannedDateColumn}
                    onChangeRevisionColumn={setRevisionColumn}
                    onChangeMatchMode={setMatchMode}
                  />
                </>
              ) : (
                <p className="hint">Select at least one tab in "Tabs &amp; header row" first.</p>
              )}
            </>
          )}

          {tab === "filter" && (
            <>
              <h2>Filter the filled rows</h2>
              {combinedSheet ? (
                <>
                  <p className="hint">
                    Apply filters on any column, like Excel's AutoFilter, to narrow what gets
                    compared.
                  </p>
                  <PlannedDateFilter
                    column={plannedDateColumn}
                    values={plannedDateValues}
                    selected={selectedPlannedDates}
                    onChange={setSelectedPlannedDates}
                  />
                  <DataFilterTable
                    sheet={combinedSheet}
                    identifierColumn={identifierColumn}
                    formatsColumn={formatsColumn}
                    plannedDateColumn={plannedDateColumn}
                    plannedDateValues={selectedPlannedDates}
                    columnFilters={columnFilters}
                    onColumnFiltersChange={setColumnFilters}
                    onFilteredRowsChange={setFilteredRows}
                  />
                </>
              ) : (
                <p className="hint">Select at least one tab in "Tabs &amp; header row" first.</p>
              )}
            </>
          )}

          {tab === "fileslog" && (
            <>
              <h2>ACC Files Log filter</h2>
              <FilesLogFilterPanel
                loaded={filesLogLoaded}
                onlyShared={onlyShared}
                onOnlySharedChange={setOnlyShared}
                sharedKeyword={sharedKeyword}
                onSharedKeywordChange={setSharedKeyword}
                totalCount={filesLogIndex.length}
                visibleCount={visibleFileIndex.length}
                foldersSkipped={filesLogFoldersSkipped}
              />
            </>
          )}

          {tab === "preview" && (
            <>
              <h2>Preview what will be compared</h2>
              {combinedSheet && (identifierColumn || formatsColumn) ? (
                <RowPreviewTable
                  rows={filteredRows}
                  identifierColumn={identifierColumn}
                  formatsColumn={formatsColumn}
                  plannedDateColumn={plannedDateColumn}
                />
              ) : (
                <p className="hint">Map an identifier and formats column first, in "Column mapping".</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
