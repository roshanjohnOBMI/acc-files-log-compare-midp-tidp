import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderTreePicker } from "../components/FolderTreePicker";
import { FilesLogSourcePicker } from "../components/FilesLogSourcePicker";
import { OutputLog } from "../components/OutputLog";
import { ResultsTable } from "../components/ResultsTable";
import { ErrorLogPanel } from "../components/ErrorLogPanel";
import { SetupSaveDialog } from "../components/SetupSaveDialog";
import { StepGuide } from "../components/StepGuide";
import { useOnceFlag } from "../hooks/useOnceFlag";
import { SOURCE_EXTENSIONS, useWorkspace } from "../context/WorkspaceContext";

type ResultTab = "table" | "log";

export function WorkspacePage() {
  const navigate = useNavigate();
  const [resultTab, setResultTab] = useState<ResultTab>("table");
  const {
    hub,
    project,
    sourceMode,
    setSourceMode,
    sourceItemId,
    sourceFileName,
    sourcePath,
    sourceFolderPath,
    loadingSource,
    sourceError,
    progressLog,
    rawSheets,
    selectedSheetNames,
    activeSheetName,
    effectiveHeaderRow,
    combinedSheet,
    identifierColumn,
    formatsColumn,
    plannedDateColumn,
    revisionColumn,
    matchMode,
    filteredRows,
    filesLogMode,
    scanFolders,
    includeSubfolders,
    setIncludeSubfolders,
    handleToggleScanFolder,
    handleRunScan,
    filesLogItemId,
    filesLogPath,
    handleSelectFilesLogFile,
    filesLogFileName,
    handleUploadFilesLog,
    onChangeFilesLogMode,
    loadingFilesLog,
    filesLogError,
    filesLogLog,
    filesLogLoaded,
    filesLogIndex,
    visibleFileIndex,
    onlyShared,
    sharedKeyword,
    filesLogFoldersSkipped,
    handleSelectSource,
    handleUploadSource,
    searching,
    searchError,
    handleSearch,
    canSearch,
    canSaveSetup,
    buildSetupInput,
    activeSetup,
    setActiveSetup,
    setSetups,
    searchResult,
    exporting,
    exportError,
    exportDestination,
    setExportDestination,
    exportFolderId,
    setExportFolderId,
    exportFolderPath,
    setExportFolderPath,
    handleExport,
    exportLog,
    exportedLink,
  } = useWorkspace();

  const editSetup = () => navigate("/setup");

  // Once a source is loaded, its full picker (mode toggle + folder tree/upload zone) collapses
  // down to a compact summary chip - showing "Pick from ACC" and "Upload" side by side forever,
  // for a choice already made, was just noise. "Change source" re-expands it; a successful new
  // pick (sourcePath/filesLogIndex changing identity) auto-collapses it again.
  const [editingSource, setEditingSource] = useState(false);
  const [editingFilesLog, setEditingFilesLog] = useState(false);
  useEffect(() => setEditingSource(false), [sourcePath]);
  useEffect(() => setEditingFilesLog(false), [filesLogIndex]);

  // First-visit-only "start here" nudge, pointing at the very first thing there is to click in a
  // brand new session - dismissed for good (this browser, forever) either explicitly or the
  // moment a file actually gets picked, whichever comes first.
  const [onboardingSeen, markOnboardingSeen] = useOnceFlag("acc-tidp-onboarding-seen");
  const showOnboarding = !onboardingSeen && !combinedSheet;
  useEffect(() => {
    if (combinedSheet) markOnboardingSeen();
  }, [combinedSheet, markOnboardingSeen]);

  return (
    <div className="workspace">
      <StepGuide
        steps={[
          { label: "TIDP/MIDP file", done: Boolean(combinedSheet) },
          { label: "ACC Files Log", done: filesLogLoaded },
          { label: "Results", done: Boolean(searchResult) },
        ]}
      />

      {activeSetup && (
        <div className="active-setup-banner">
          Editing <strong>{activeSetup.name}</strong> - use "Update" near the Results section below to
          save changes back to it, or{" "}
          <button type="button" className="link-button" onClick={() => setActiveSetup(null)}>
            start fresh instead
          </button>
          .
        </div>
      )}

      <section className="numbered-section">
        {showOnboarding && (
          <div className="onboarding-callout">
            <span className="onboarding-callout-icon" aria-hidden="true">👋</span>
            <span>Start here - pick your TIDP/MIDP file from ACC, or upload one from your computer.</span>
            <button type="button" className="link-button" onClick={markOnboardingSeen}>
              Got it
            </button>
          </div>
        )}
        <div className="numbered-section-head">
          <span className="numbered-section-num">01</span>
          <h2>TIDP / MIDP file</h2>
          {(!sourcePath || editingSource) && (
            <div className={`numbered-section-actions${showOnboarding ? " cta-pulse" : ""}`}>
              <button type="button" className={`btn-secondary${sourceMode === "acc" ? " active" : ""}`} onClick={() => setSourceMode("acc")}>
                Pick from ACC
              </button>
              <button type="button" className={`btn-secondary${sourceMode === "upload" ? " active" : ""}`} onClick={() => setSourceMode("upload")}>
                Upload
              </button>
            </div>
          )}
        </div>

        {sourcePath && !editingSource ? (
          <div className="source-summary-chip">
            <span className="source-summary-chip-mark">✓</span>
            <span className="source-summary-chip-name">{sourceFileName ?? sourcePath}</span>
            <button type="button" className="link-button" onClick={() => setEditingSource(true)}>
              Change source
            </button>
          </div>
        ) : (
          <>
            {sourceMode === "acc" ? (
              <>
                <p className="hint">Browse the ACC folder tree and pick the live TIDP/MIDP workbook.</p>
                {sourceFolderPath && !sourceItemId && (
                  <p className="hint">This setup's TIDP/MIDP file is usually in: <strong>{sourceFolderPath}</strong></p>
                )}
                <FolderTreePicker
                  hubId={hub?.id ?? null}
                  projectId={project?.id ?? null}
                  selectMode="file"
                  selectableExtensions={SOURCE_EXTENSIONS}
                  selectedFolderId={sourceItemId}
                  selectedPath={sourcePath}
                  onSelect={handleSelectSource}
                />
              </>
            ) : (
              <>
                <p className="hint">Upload the TIDP/MIDP workbook straight from your computer.</p>
                <p className="warning-note">
                  ⚠ Uploaded files aren't linked to ACC's version history - there's no way for the
                  app to confirm this is the latest revision, or trace back to a previous one. Pick
                  it from ACC instead when you can.
                </p>
                <label className="upload-drop">
                  <input
                    type="file"
                    accept={SOURCE_EXTENSIONS.map((ext) => `.${ext}`).join(",")}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUploadSource(file);
                      e.target.value = "";
                    }}
                  />
                  {loadingSource ? "Uploading…" : sourcePath && !sourceItemId ? `✓ ${sourcePath} - choose a different file` : "Choose a TIDP/MIDP file…"}
                </label>
              </>
            )}
            {sourceError && <p className="error-text">{sourceError}</p>}
            <OutputLog lines={progressLog} />
          </>
        )}

        {rawSheets.length > 0 && (
          <div className="setup-pill-row">
            <span className="tag tag-neutral">
              SETUP: {activeSheetName ?? "no tab selected"} · header row {effectiveHeaderRow(activeSheetName)} ·{" "}
              {combinedSheet?.rows.length ?? 0} filled row(s) ·{" "}
              {selectedSheetNames.length} of {rawSheets.length} tab(s) ·{" "}
              ID = {identifierColumn ?? "not set"} · formats = {formatsColumn ?? "not set"} ·{" "}
              {matchMode} match
              {plannedDateColumn ? ` · dated by ${plannedDateColumn}` : ""}
              {revisionColumn ? ` · revision ${revisionColumn}` : ""}
            </span>
            <button type="button" className="link-button" onClick={editSetup}>
              Edit / Setup
            </button>
          </div>
        )}
      </section>

      <section className="numbered-section">
        <div className="numbered-section-head">
          <span className="numbered-section-num">02</span>
          <h2>ACC Files Log</h2>
        </div>

        {filesLogLoaded && !editingFilesLog ? (
          <div className="source-summary-chip">
            <span className="source-summary-chip-mark">✓</span>
            <span className="source-summary-chip-name">
              {filesLogIndex.length} file(s) loaded via{" "}
              {filesLogMode === "scan" ? "live folder scan" : filesLogMode === "file" ? "an ACC file" : "an uploaded file"}
            </span>
            <button type="button" className="link-button" onClick={() => setEditingFilesLog(true)}>
              Change source
            </button>
          </div>
        ) : (
          <>
            <p className="hint">
              The set of files to check the TIDP/MIDP deliverables above against. Scan folder(s) live
              for an always-current list, pick an already-exported Files Log workbook from ACC, or
              upload one from your computer.
            </p>
            <FilesLogSourcePicker
              hubId={hub?.id ?? null}
              projectId={project?.id ?? null}
              mode={filesLogMode}
              onModeChange={onChangeFilesLogMode}
              scanFolders={scanFolders}
              onToggleScanFolder={handleToggleScanFolder}
              includeSubfolders={includeSubfolders}
              onIncludeSubfoldersChange={setIncludeSubfolders}
              onRunScan={handleRunScan}
              fileItemId={filesLogItemId}
              filePath={filesLogPath}
              onSelectFile={handleSelectFilesLogFile}
              uploadedFileName={filesLogMode === "upload" ? filesLogFileName : undefined}
              onUploadFile={handleUploadFilesLog}
              loading={loadingFilesLog}
            />
            {filesLogError && <p className="error-text">{filesLogError}</p>}
            <OutputLog lines={filesLogLog} />
          </>
        )}

        {filesLogLoaded && (
          <div className="setup-pill-row">
            <span className="tag tag-neutral">
              FILES LOG FILTER: {onlyShared ? `folder path contains "${sharedKeyword}"` : "no folder filter"} ·{" "}
              {visibleFileIndex.length} of {filesLogIndex.length} files will be compared
            </span>
            {filesLogFoldersSkipped > 0 && (
              <span className="tag tag-warning" title="ACC rate-limited these requests - the Files Log may be missing files from them. Scan again to retry.">
                ⚠ {filesLogFoldersSkipped} folder(s) could not be scanned
              </span>
            )}
            <button type="button" className="link-button" onClick={editSetup}>
              Edit / Setup
            </button>
          </div>
        )}
      </section>

      <section className="numbered-section">
        <div className="numbered-section-head">
          <span className="numbered-section-num">03</span>
          <h2>Results</h2>
          {searchResult && (
            <span className="hint numbered-section-subtitle">
              {filteredRows.length} deliverables vs {searchResult.filesScanned} file(s)
            </span>
          )}
        </div>

        {!combinedSheet && (
          <p className="hint">
            Pick a TIDP/MIDP file above (and select its tabs in Setup &amp; mapping) to unlock
            comparison.
          </p>
        )}

        {combinedSheet && (
          <div className="run-comparison-bar">
            <button
              type="button"
              className={`btn-primary${canSearch && !searching && !searchResult ? " cta-pulse" : ""}`}
              onClick={handleSearch}
              disabled={!canSearch || searching}
            >
              {searching ? "Comparing…" : `Compare ${filteredRows.length} row(s)`}
            </button>
            {!canSearch && !searching && (
              <span className="hint">
                Needs: a Files Log loaded, and an identifier + formats column mapped in Setup &amp;
                mapping.
              </span>
            )}
            {searchError && <p className="error-text">{searchError}</p>}
            <SetupSaveDialog
              disabled={!canSaveSetup}
              getInput={buildSetupInput}
              activeSetup={activeSetup}
              onSaved={(s) => {
                setSetups((prev) => [...prev, s]);
                setActiveSetup({ id: s.id, name: s.name });
              }}
              onUpdated={(s) => {
                setSetups((prev) => prev.map((x) => (x.id === s.id ? s : x)));
                setActiveSetup({ id: s.id, name: s.name });
              }}
            />
          </div>
        )}

        {searchResult && (
          <>
            <div className="export-controls">
              <div className="export-destination-toggle">
                <button
                  type="button"
                  className={exportDestination === "download" ? "active" : ""}
                  onClick={() => setExportDestination("download")}
                >
                  Download
                </button>
                <button
                  type="button"
                  className={exportDestination === "acc" ? "active" : ""}
                  onClick={() => setExportDestination("acc")}
                >
                  Save to ACC folder
                </button>
              </div>
              {exportDestination === "acc" && (
                <FolderTreePicker
                  hubId={hub?.id ?? null}
                  projectId={project?.id ?? null}
                  selectedFolderId={exportFolderId}
                  selectedPath={exportFolderPath}
                  onSelect={(id, path) => {
                    setExportFolderId(id);
                    setExportFolderPath(path);
                  }}
                />
              )}
              <button
                type="button"
                className="btn-primary"
                onClick={handleExport}
                disabled={exporting || (exportDestination === "acc" && !exportFolderId)}
              >
                {exporting
                  ? "Building report…"
                  : exportDestination === "acc"
                    ? "Save QA/QC report to ACC"
                    : "Download QA/QC report (.xlsx)"}
              </button>
              {exportError && <p className="error-text">{exportError}</p>}
              {exportedLink && (
                <p className="hint">
                  <a href={exportedLink} target="_blank" rel="noreferrer">
                    Open the saved report in ACC
                  </a>
                </p>
              )}
              <OutputLog lines={exportLog} />
            </div>

            <div className="result-tabs">
              <button
                type="button"
                className={`result-tab${resultTab === "table" ? " active" : ""}`}
                onClick={() => setResultTab("table")}
              >
                Results table
              </button>
              <button
                type="button"
                className={`result-tab${resultTab === "log" ? " active" : ""}`}
                onClick={() => setResultTab("log")}
              >
                Activity &amp; error log
              </button>
            </div>

            {resultTab === "table" && (
              <ResultsTable
                results={searchResult.results}
                summary={searchResult.summary}
                extraFiles={searchResult.extraFiles}
              />
            )}
            {resultTab === "log" && <ErrorLogPanel />}
          </>
        )}
      </section>

      {!searchResult && (
        <section className="card">
          <ErrorLogPanel />
        </section>
      )}
    </div>
  );
}
