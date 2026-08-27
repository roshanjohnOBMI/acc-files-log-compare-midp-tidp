import { useEffect, useMemo, useRef, useState } from "react";
import { HubProjectSelect } from "../components/HubProjectSelect";
import { FolderTreePicker } from "../components/FolderTreePicker";
import { FilesLogSourcePicker } from "../components/FilesLogSourcePicker";
import { TabSelector } from "../components/TabSelector";
import { OutputLog } from "../components/OutputLog";
import { DataFilterTable, type FilteredRow } from "../components/DataFilterTable";
import { ColumnSelect } from "../components/ColumnSelect";
import { PlannedDateFilter } from "../components/PlannedDateFilter";
import { RowPreviewTable } from "../components/RowPreviewTable";
import { ResultsTable } from "../components/ResultsTable";
import { ErrorLogPanel } from "../components/ErrorLogPanel";
import { SetupSaveDialog } from "../components/SetupSaveDialog";
import { parseTidpFromAcc, uploadTidpFile } from "../api/excel";
import { scanFilesLog, parseFilesLog, uploadFilesLog } from "../api/filesLog";
import { combineSheets, SOURCE_TAB_COLUMN } from "../lib/combineSheets";
import { deriveSheet } from "../lib/deriveSheet";
import { disciplineFromSheetName } from "../lib/discipline";
import { parseFormatList } from "../lib/parseFormats";
import {
  detectColumn,
  FORMATS_COLUMN_HINTS,
  IDENTIFIER_COLUMN_HINTS,
  PLANNED_DATE_COLUMN_HINTS,
  REVISION_COLUMN_HINTS,
} from "../lib/detectColumn";
import { runSearch, type SearchRunResponse } from "../api/search";
import { exportReport, type ExportResult } from "../api/export";
import { listSetups, type SetupInput } from "../api/setups";
import type {
  FilesLogScanFolder,
  FilesLogSourceMode,
  HubSummary,
  IndexedFile,
  MatchMode,
  ProjectSummary,
  RawSheetData,
  Setup,
  SourceMode,
} from "../types/domain";

const SOURCE_EXTENSIONS = ["xlsx", "xls", "xlsm"];
const DEFAULT_SHARED_KEYWORD = "Shared";

export function WorkspacePage() {
  const [hub, setHub] = useState<HubSummary | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);

  const [sourceMode, setSourceMode] = useState<SourceMode>("acc");
  const [sourceItemId, setSourceItemId] = useState<string | undefined>();
  const [sourceFileName, setSourceFileName] = useState<string | undefined>();
  const [sourcePath, setSourcePath] = useState<string | undefined>();
  const [sourceFolderId, setSourceFolderId] = useState<string | undefined>();
  const [sourceFolderPath, setSourceFolderPath] = useState<string | undefined>();
  const [loadingSource, setLoadingSource] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  const [rawSheets, setRawSheets] = useState<RawSheetData[]>([]);
  const [selectedSheetNames, setSelectedSheetNames] = useState<string[]>([]);
  // Per-sheet header row overrides, keyed by sheet name - a sheet with no entry here uses its own
  // server auto-detected header row (raw.headerRowNumber).
  const [headerRowOverrides, setHeaderRowOverrides] = useState<Record<string, number>>({});

  const [identifierColumn, setIdentifierColumn] = useState<string | null>(null);
  const [formatsColumn, setFormatsColumn] = useState<string | null>(null);
  const [plannedDateColumn, setPlannedDateColumn] = useState<string | null>(null);
  const [selectedPlannedDates, setSelectedPlannedDates] = useState<string[]>([]);
  const [revisionColumn, setRevisionColumn] = useState<string | null>(null);
  const [matchMode, setMatchMode] = useState<MatchMode>("exact");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [filteredRows, setFilteredRows] = useState<FilteredRow[]>([]);

  // Files Log source (what gets compared against) - either a live multi-folder scan or an
  // already-exported Files Log workbook picked from ACC.
  const [filesLogMode, setFilesLogMode] = useState<FilesLogSourceMode>("scan");
  const [scanFolders, setScanFolders] = useState<FilesLogScanFolder[]>([]);
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [filesLogItemId, setFilesLogItemId] = useState<string | undefined>();
  const [filesLogFileName, setFilesLogFileName] = useState<string | undefined>();
  const [filesLogPath, setFilesLogPath] = useState<string | undefined>();
  const [filesLogFolderId, setFilesLogFolderId] = useState<string | undefined>();
  const [filesLogFolderPath, setFilesLogFolderPath] = useState<string | undefined>();
  const [filesLogIndex, setFilesLogIndex] = useState<IndexedFile[]>([]);
  const [filesLogLoaded, setFilesLogLoaded] = useState(false);
  const [filesLogFoldersSkipped, setFilesLogFoldersSkipped] = useState(0);
  const [loadingFilesLog, setLoadingFilesLog] = useState(false);
  const [filesLogError, setFilesLogError] = useState<string | null>(null);
  const [filesLogLog, setFilesLogLog] = useState<string[]>([]);
  const [onlyShared, setOnlyShared] = useState(true);
  const [sharedKeyword, setSharedKeyword] = useState(DEFAULT_SHARED_KEYWORD);

  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchRunResponse | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDestination, setExportDestination] = useState<"download" | "acc">("download");
  const [exportFolderId, setExportFolderId] = useState<string | undefined>();
  const [exportFolderPath, setExportFolderPath] = useState<string | undefined>();
  const [exportLog, setExportLog] = useState<string[]>([]);
  const [exportedLink, setExportedLink] = useState<string | undefined>();

  const [setups, setSetups] = useState<Setup[]>([]);
  const [activeSetup, setActiveSetup] = useState<{ id: string; name: string } | null>(null);
  // A setup's sheet/column choices can't be applied until the TIDP/MIDP file itself is
  // (re)selected - its item id isn't persisted, since it could point at a stale/renamed file by
  // next submittal. This holds the loaded setup between "pick it from the dropdown" and "pick the
  // file", so handleSelectSource can restore its column choices instead of wiping them back to defaults.
  const pendingRestoreRef = useRef<Setup | null>(null);
  const [progressLog, setProgressLog] = useState<string[]>([]);

  function logStep(message: string) {
    setProgressLog((prev) => [...prev, message]);
  }

  function logFilesLogStep(message: string) {
    setFilesLogLog((prev) => [...prev, message]);
  }

  function logExportStep(message: string) {
    setExportLog((prev) => [...prev, message]);
  }

  useEffect(() => {
    listSetups().then(setSetups).catch(() => undefined);
  }, []);

  const activeSheetName = selectedSheetNames[0] ?? rawSheets[0]?.sheetName;

  function effectiveHeaderRow(sheetName: string | undefined): number {
    if (!sheetName) return 1;
    return headerRowOverrides[sheetName] ?? rawSheets.find((s) => s.sheetName === sheetName)?.headerRowNumber ?? 1;
  }

  function setHeaderRowFor(sheetName: string, row: number) {
    setHeaderRowOverrides((prev) => ({ ...prev, [sheetName]: row }));
  }

  function setHeaderRowForAllTabs(row: number) {
    setHeaderRowOverrides(() => {
      const next: Record<string, number> = {};
      for (const raw of rawSheets) next[raw.sheetName] = row;
      return next;
    });
  }

  const derivedSheets = useMemo(
    () => rawSheets.map((raw) => deriveSheet(raw, headerRowOverrides[raw.sheetName] ?? raw.headerRowNumber)),
    [rawSheets, headerRowOverrides]
  );

  const headerPreview = derivedSheets.find((s) => s.sheetName === activeSheetName)?.headers;

  const combinedSheet = useMemo(
    () =>
      derivedSheets.length && selectedSheetNames.length
        ? combineSheets(derivedSheets, selectedSheetNames)
        : null,
    [derivedSheets, selectedSheetNames]
  );

  const plannedDateValues = useMemo(() => {
    if (!combinedSheet || !plannedDateColumn) return [];
    const set = new Set<string>();
    for (const row of combinedSheet.rows) set.add(row[plannedDateColumn] ?? "");
    return Array.from(set).sort();
  }, [combinedSheet, plannedDateColumn]);

  useEffect(() => {
    setSelectedPlannedDates([]);
  }, [plannedDateColumn]);

  useEffect(() => {
    setColumnFilters({});
    setSelectedPlannedDates([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSheetNames]);

  useEffect(() => {
    if (!combinedSheet) return;
    const known = new Set(combinedSheet.headers);
    const reconcile = (current: string | null, hints: string[], setColumn: (c: string | null) => void) => {
      if (current && known.has(current)) return;
      const detected = detectColumn(combinedSheet.headers, hints);
      setColumn(detected ?? null);
    };

    reconcile(identifierColumn, IDENTIFIER_COLUMN_HINTS, setIdentifierColumn);
    reconcile(formatsColumn, FORMATS_COLUMN_HINTS, setFormatsColumn);
    reconcile(plannedDateColumn, PLANNED_DATE_COLUMN_HINTS, setPlannedDateColumn);
    reconcile(revisionColumn, REVISION_COLUMN_HINTS, setRevisionColumn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedSheet]);

  // The Files Log actually compared against - filtered down to entries whose folder path contains
  // the Shared keyword when "Only Shared" is on. Recomputed instantly client-side (no re-scan/
  // re-parse needed), same pattern as every other filter in this app.
  const visibleFileIndex = useMemo(() => {
    if (!onlyShared) return filesLogIndex;
    const keyword = sharedKeyword.trim().toLowerCase();
    if (!keyword) return filesLogIndex;
    return filesLogIndex.filter((f) => (f.folderPath ?? "").toLowerCase().includes(keyword));
  }, [filesLogIndex, onlyShared, sharedKeyword]);

  const filesLogSourceDescription = useMemo(() => {
    if (filesLogMode === "scan") {
      if (scanFolders.length === 0) return "—";
      const names = scanFolders.map((f) => f.pathDisplay).join("; ");
      return `Live scan of: ${names}${includeSubfolders ? " (incl. subfolders)" : ""}`;
    }
    if (filesLogMode === "upload") {
      return filesLogFileName ? `Uploaded workbook: ${filesLogFileName}` : "—";
    }
    return filesLogPath ? `Files Log workbook: ${filesLogPath}` : "—";
  }, [filesLogMode, scanFolders, includeSubfolders, filesLogPath, filesLogFileName]);

  function applySetup(setup: Setup) {
    pendingRestoreRef.current = setup;
    setActiveSetup({ id: setup.id, name: setup.name });
    setHub({ id: setup.hubId, name: setup.hubName });
    setProject({ id: setup.projectId, name: setup.projectName });
    setSourceMode(setup.sourceMode ?? "acc");
    setSourceFolderId(setup.sourceFolderId);
    setSourceFolderPath(setup.sourceFolderPath);
    setIdentifierColumn(setup.identifierColumn ?? null);
    setFormatsColumn(setup.formatsColumn ?? null);
    setPlannedDateColumn(setup.plannedDateColumn ?? null);
    setRevisionColumn(setup.revisionColumn ?? null);
    setMatchMode(setup.matchMode);
    setExportFolderId(setup.exportFolderId);
    setExportFolderPath(setup.exportFolderPath);

    setFilesLogMode(setup.filesLogMode ?? "scan");
    setScanFolders(setup.filesLogScanFolders ?? []);
    setIncludeSubfolders(setup.includeSubfolders ?? true);
    setFilesLogFolderId(setup.filesLogFolderId);
    setFilesLogFolderPath(setup.filesLogFolderPath);
    setOnlyShared(setup.onlyShared ?? true);
    setSharedKeyword(setup.sharedKeyword || DEFAULT_SHARED_KEYWORD);
    // filesLogItemId/index aren't restored - the Files Log needs to be re-scanned or re-picked
    // (it's live data that could have changed since the setup was saved), same as the TIDP/MIDP
    // source file. sourceFolderId/Path and filesLogFolderId/Path ARE restored though, so the
    // pickers below can start in the right place instead of the user re-navigating from scratch.
    setFilesLogIndex([]);
    setFilesLogLoaded(false);
  }

  function buildSetupInput(): Omit<SetupInput, "name"> {
    return {
      hubId: hub?.id ?? "",
      hubName: hub?.name ?? "",
      projectId: project?.id ?? "",
      projectName: project?.name ?? "",
      sourceMode,
      sourceItemId,
      sourceFileName,
      sourcePath,
      sourceFolderId,
      sourceFolderPath,
      selectedSheetNames,
      headerRow: effectiveHeaderRow(activeSheetName),
      identifierColumn: identifierColumn ?? undefined,
      formatsColumn: formatsColumn ?? undefined,
      plannedDateColumn: plannedDateColumn ?? undefined,
      revisionColumn: revisionColumn ?? undefined,
      matchMode,
      filesLogMode,
      filesLogScanFolders: scanFolders,
      includeSubfolders,
      filesLogItemId,
      filesLogFileName,
      filesLogPath,
      filesLogFolderId,
      filesLogFolderPath,
      onlyShared,
      sharedKeyword,
      exportFolderId,
      exportFolderPath,
    };
  }

  /** Shared post-processing once the TIDP/MIDP workbook's raw sheets are in hand, regardless of
   * whether they came from an ACC pick or a local upload - restores a pending setup's sheet/column
   * choices, or falls back to auto-detected defaults. */
  function applyParsedSource(fileName: string, parsedSheets: RawSheetData[], startedAt: number) {
    const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
    logStep(
      `Loaded "${fileName}" in ${elapsed}s - found ${parsedSheets.length} tab${parsedSheets.length === 1 ? "" : "s"}.`
    );
    const defaultSheets = parsedSheets.map((s) => s.sheetName);
    if (defaultSheets.length) {
      const totalRows = parsedSheets.reduce(
        (n, s) => n + deriveSheet(s, s.headerRowNumber).rows.length,
        0
      );
      logStep(
        `Selected all ${defaultSheets.length} tab${defaultSheets.length === 1 ? "" : "s"} by default - ${totalRows} filled row(s) total. Deselect any non-data tabs below if needed.`
      );
    }
    setSourceFileName(fileName);
    setRawSheets(parsedSheets);

    const restore = pendingRestoreRef.current;
    pendingRestoreRef.current = null;
    const restoredSheetNames = restore?.selectedSheetNames?.filter((name) =>
      parsedSheets.some((s) => s.sheetName === name)
    );
    const sheetNamesToUse = restoredSheetNames?.length ? restoredSheetNames : defaultSheets;
    const overrides: Record<string, number> = {};
    if (restore?.headerRow && sheetNamesToUse[0]) {
      overrides[sheetNamesToUse[0]] = restore.headerRow;
    }
    const restoredHeaders = new Set<string>();
    for (const sheetName of sheetNamesToUse) {
      const raw = parsedSheets.find((s) => s.sheetName === sheetName);
      if (raw) {
        deriveSheet(raw, overrides[sheetName] ?? raw.headerRowNumber).headers.forEach((h) =>
          restoredHeaders.add(h)
        );
      }
    }
    const restoredColumn = (column: string | undefined) =>
      column && restoredHeaders.has(column) ? column : null;

    setSelectedSheetNames(sheetNamesToUse);
    setHeaderRowOverrides(overrides);
    setIdentifierColumn(restoredColumn(restore?.identifierColumn));
    setFormatsColumn(restoredColumn(restore?.formatsColumn));
    setPlannedDateColumn(restoredColumn(restore?.plannedDateColumn));
    setRevisionColumn(restoredColumn(restore?.revisionColumn));
    setColumnFilters({});
    setSearchResult(null);
  }

  async function handleSelectSource(itemId: string, path: string, parentFolderId?: string) {
    if (!project) return;
    setLoadingSource(true);
    setSourceError(null);
    setProgressLog([]);
    const startedAt = performance.now();
    logStep(`Loading workbook from ACC…`);
    try {
      const { fileName, sheets: parsedSheets } = await parseTidpFromAcc(project.id, itemId);
      setSourceItemId(itemId);
      setSourcePath(path);
      if (parentFolderId) {
        setSourceFolderId(parentFolderId);
        setSourceFolderPath(path.split("/").slice(0, -1).join("/"));
      }
      applyParsedSource(fileName, parsedSheets, startedAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load the file from ACC";
      setSourceError(message);
      logStep(`Failed: ${message}`);
    } finally {
      setLoadingSource(false);
    }
  }

  async function handleUploadSource(file: File) {
    setLoadingSource(true);
    setSourceError(null);
    setProgressLog([]);
    const startedAt = performance.now();
    logStep(`Uploading "${file.name}"…`);
    try {
      const { fileName, sheets: parsedSheets } = await uploadTidpFile(file);
      setSourceItemId(undefined);
      setSourcePath(file.name);
      setSourceFolderId(undefined);
      setSourceFolderPath(undefined);
      applyParsedSource(fileName, parsedSheets, startedAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to upload the file";
      setSourceError(message);
      logStep(`Failed: ${message}`);
    } finally {
      setLoadingSource(false);
    }
  }

  function handleToggleScanFolder(id: string, path: string) {
    setScanFolders((prev) =>
      prev.some((f) => f.folderId === id) ? prev.filter((f) => f.folderId !== id) : [...prev, { folderId: id, pathDisplay: path }]
    );
  }

  async function handleRunScan() {
    if (!project || scanFolders.length === 0) return;
    setLoadingFilesLog(true);
    setFilesLogError(null);
    setFilesLogLog([]);
    setSearchResult(null);
    const startedAt = performance.now();
    logFilesLogStep(`Scanning ${scanFolders.length} folder(s)…`);
    try {
      const result = await scanFilesLog(project.id, scanFolders, includeSubfolders);
      const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
      setFilesLogIndex(result.files);
      setFilesLogLoaded(true);
      setFilesLogFoldersSkipped(result.foldersSkipped);
      logFilesLogStep(`Scan complete in ${elapsed}s - ${result.files.length} file(s) found.`);
      if (result.foldersSkipped > 0) {
        logFilesLogStep(
          `Warning: ${result.foldersSkipped} folder(s) could not be scanned because ACC rate-limited the request - the Files Log may be missing files from those folders. Scan again to retry.`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to scan ACC";
      setFilesLogError(message);
      logFilesLogStep(`Failed: ${message}`);
    } finally {
      setLoadingFilesLog(false);
    }
  }

  async function handleSelectFilesLogFile(itemId: string, path: string, parentFolderId?: string) {
    if (!project) return;
    setLoadingFilesLog(true);
    setFilesLogError(null);
    setFilesLogLog([]);
    setSearchResult(null);
    const startedAt = performance.now();
    logFilesLogStep(`Loading Files Log workbook from ACC…`);
    try {
      const result = await parseFilesLog(project.id, itemId);
      const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
      setFilesLogItemId(itemId);
      setFilesLogFileName(result.fileName);
      setFilesLogPath(path);
      if (parentFolderId) {
        setFilesLogFolderId(parentFolderId);
        setFilesLogFolderPath(path.split("/").slice(0, -1).join("/"));
      }
      setFilesLogIndex(result.files);
      setFilesLogLoaded(true);
      setFilesLogFoldersSkipped(0);
      logFilesLogStep(`Loaded "${result.fileName}" in ${elapsed}s - ${result.files.length} file(s) found.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load the Files Log from ACC";
      setFilesLogError(message);
      logFilesLogStep(`Failed: ${message}`);
    } finally {
      setLoadingFilesLog(false);
    }
  }

  async function handleUploadFilesLog(file: File) {
    setLoadingFilesLog(true);
    setFilesLogError(null);
    setFilesLogLog([]);
    setSearchResult(null);
    const startedAt = performance.now();
    logFilesLogStep(`Uploading "${file.name}"…`);
    try {
      const result = await uploadFilesLog(file);
      const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
      const fileName = result.fileName ?? file.name;
      setFilesLogItemId(undefined);
      setFilesLogFileName(fileName);
      setFilesLogPath(undefined);
      setFilesLogFolderId(undefined);
      setFilesLogFolderPath(undefined);
      setFilesLogIndex(result.files);
      setFilesLogLoaded(true);
      setFilesLogFoldersSkipped(0);
      logFilesLogStep(`Loaded "${fileName}" in ${elapsed}s - ${result.files.length} file(s) found.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to upload the Files Log";
      setFilesLogError(message);
      logFilesLogStep(`Failed: ${message}`);
    } finally {
      setLoadingFilesLog(false);
    }
  }

  async function handleSearch() {
    if (!project || !identifierColumn || !formatsColumn) return;
    setSearching(true);
    setSearchError(null);
    logStep(`Comparing ${filteredRows.length} row(s) against ${visibleFileIndex.length} Files Log entr${visibleFileIndex.length === 1 ? "y" : "ies"}…`);
    try {
      const rows = filteredRows.map((row) => ({
        rowIndex: row.rowIndex,
        identifier: row.values[identifierColumn] ?? "",
        discipline: disciplineFromSheetName(row.values[SOURCE_TAB_COLUMN] ?? ""),
        sourceRevision: revisionColumn ? row.values[revisionColumn] ?? "" : "",
        formats: parseFormatList(row.values[formatsColumn]),
      }));
      const result = await runSearch({
        projectId: project.id,
        rows,
        matchMode,
        fileIndex: visibleFileIndex,
      });
      setSearchResult(result);
      logStep(
        `Compared against ${result.filesScanned} file(s) - ${result.summary.complete} complete, ${result.summary.partial} partial, ${result.summary.missing} missing.`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Comparison failed";
      setSearchError(message);
      logStep(`Failed: ${message}`);
    } finally {
      setSearching(false);
    }
  }

  async function handleExport() {
    if (!searchResult || !project) return;
    setExporting(true);
    setExportError(null);
    setExportedLink(undefined);
    const savingToAcc = exportDestination === "acc";
    logExportStep(savingToAcc ? "Building QA/QC report workbook and saving to ACC…" : "Building QA/QC report workbook…");
    try {
      const result: ExportResult = await exportReport({
        sourceFileName,
        filesLogSourceDescription,
        onlyShared,
        sharedKeyword,
        selectedSheetNames,
        headerRow: effectiveHeaderRow(activeSheetName),
        identifierColumn: identifierColumn ?? undefined,
        formatsColumn: formatsColumn ?? undefined,
        plannedDateColumn: plannedDateColumn ?? undefined,
        selectedPlannedDates,
        columnFilters,
        matchMode,
        results: searchResult.results,
        summary: searchResult.summary,
        extraFiles: searchResult.extraFiles,
        filesScanned: searchResult.filesScanned,
        saveTo: savingToAcc && exportFolderId ? { projectId: project.id, folderId: exportFolderId } : undefined,
      });
      if (result.savedToAcc) {
        logExportStep(`Saved "${result.fileName}" to the selected ACC folder.`);
        setExportedLink(result.webViewUrl);
      } else {
        logExportStep(`Downloaded "${result.fileName}".`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to export the report";
      setExportError(message);
      logExportStep(`Failed: ${message}`);
    } finally {
      setExporting(false);
    }
  }

  const canSearch = Boolean(
    project && filesLogLoaded && identifierColumn && formatsColumn && filteredRows.length > 0
  );
  const canSaveSetup = Boolean(hub && project);

  return (
    <div className="workspace">
      {setups.length > 0 && (
        <section className="card">
          <h2>Load a saved setup</h2>
          <select
            value={activeSetup?.id ?? ""}
            onChange={(e) => {
              const setup = setups.find((s) => s.id === e.target.value);
              if (setup) applySetup(setup);
            }}
          >
            <option value="" disabled>
              Choose a saved setup…
            </option>
            {setups.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="hint">
            Restores the hub, project, Files Log source settings, identifier/formats/date columns,
            and match mode. Column filters, the TIDP/MIDP source file, and the Files Log itself
            (scan or file) need to be reselected/rerun.
          </p>
          {activeSetup && (
            <p className="hint">
              Editing <strong>{activeSetup.name}</strong> - use "Update" near the search button below to
              save changes back to it, or{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  pendingRestoreRef.current = null;
                  setActiveSetup(null);
                }}
              >
                start fresh instead
              </button>
              .
            </p>
          )}
        </section>
      )}

      <section className="card">
        <h2>1. Hub &amp; project</h2>
        <HubProjectSelect
          hubId={hub?.id ?? null}
          projectId={project?.id ?? null}
          onChangeHub={setHub}
          onChangeProject={setProject}
        />
      </section>

      <section className="card">
        <h2>2. Select the TIDP/MIDP file</h2>
        <div className="export-destination-toggle">
          <button type="button" className={sourceMode === "acc" ? "active" : ""} onClick={() => setSourceMode("acc")}>
            Pick from ACC
          </button>
          <button type="button" className={sourceMode === "upload" ? "active" : ""} onClick={() => setSourceMode("upload")}>
            Upload from computer
          </button>
        </div>

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

        {rawSheets.length > 0 && (
          <div className="header-row-picker">
            <label>
              Header row for "{activeSheetName}" (everything below is filtered from here)
              <input
                type="number"
                min={1}
                value={effectiveHeaderRow(activeSheetName)}
                onChange={(e) =>
                  activeSheetName && setHeaderRowFor(activeSheetName, Math.max(1, Number(e.target.value) || 1))
                }
              />
            </label>
            {rawSheets.length > 1 && (
              <button
                type="button"
                onClick={() => setHeaderRowForAllTabs(effectiveHeaderRow(activeSheetName))}
              >
                Apply row {effectiveHeaderRow(activeSheetName)} to all {rawSheets.length} tabs
              </button>
            )}
            <p className="hint">
              If every tab uses the same header row, set it here once and click "Apply to all
              tabs" instead of fixing each tab individually. Otherwise, each selected tab keeps its
              own header row - adjust a specific tab (including this one) in "Select Tabs…" below
              if it shows 0 rows or looks wrong.
            </p>
            <p className="hint">
              {headerPreview && headerPreview.length > 0
                ? `Row ${effectiveHeaderRow(activeSheetName)} reads as: ${headerPreview.join(", ")}`
                : `Row ${effectiveHeaderRow(activeSheetName)} has no readable columns - try a different row number.`}
            </p>
          </div>
        )}

        {derivedSheets.length > 1 && (
          <TabSelector
            sheets={derivedSheets}
            selected={selectedSheetNames}
            onChange={setSelectedSheetNames}
            getHeaderRow={effectiveHeaderRow}
            onHeaderRowChange={setHeaderRowFor}
          />
        )}
      </section>

      {combinedSheet && (
        <section className="card">
          <h2>3. Filter the filled rows &amp; map columns</h2>
          <p className="hint">
            {combinedSheet.rows.length} filled row(s) loaded from "{combinedSheet.sheetName}". Apply
            filters on any column (like Excel's AutoFilter) to narrow down - e.g. pick a specific
            Planned Issue Date - then confirm which column holds each document's base filename and
            which holds its expected formats (comma-separated, e.g. "pdf, dwg"). Columns matching
            common TIDP/MIDP header names are pre-selected below; change them if they're wrong.
            Discipline is read automatically from the last part of each tab's name (e.g. "MIDP - AR"
            → AR), so there's nothing to pick for it.
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
        </section>
      )}

      {combinedSheet && (identifierColumn || formatsColumn) && (
        <section className="card">
          <h2>4. Preview what will be compared</h2>
          <p className="hint">Check this before running the comparison - each row's identifier and formats are read straight from the columns above.</p>
          <RowPreviewTable
            rows={filteredRows}
            identifierColumn={identifierColumn}
            formatsColumn={formatsColumn}
            plannedDateColumn={plannedDateColumn}
          />
        </section>
      )}

      {combinedSheet && (
        <section className="card">
          <h2>5. ACC Files Log</h2>
          <p className="hint">
            The set of files to check the TIDP/MIDP deliverables above against. Scan folder(s) live
            for an always-current list, pick an already-exported Files Log workbook from ACC, or
            upload one from your computer.
          </p>
          <FilesLogSourcePicker
            hubId={hub?.id ?? null}
            projectId={project?.id ?? null}
            mode={filesLogMode}
            onModeChange={(mode) => {
              setFilesLogMode(mode);
              setFilesLogItemId(undefined);
              setFilesLogFileName(undefined);
              setFilesLogPath(undefined);
              setFilesLogIndex([]);
              setFilesLogLoaded(false);
              setSearchResult(null);
            }}
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

          {filesLogLoaded && (
            <div className="files-log-shared-filter">
              <label className="checkbox-label">
                <input type="checkbox" checked={onlyShared} onChange={(e) => setOnlyShared(e.target.checked)} />
                Only count files whose folder path contains
              </label>
              <input
                type="text"
                value={sharedKeyword}
                onChange={(e) => setSharedKeyword(e.target.value)}
                disabled={!onlyShared}
                placeholder="Shared"
              />
              <span className="hint">
                {filesLogIndex.length} file(s) in the Files Log
                {onlyShared ? ` · ${visibleFileIndex.length} match "${sharedKeyword}" and will be compared` : " · all will be compared"}
                {filesLogFoldersSkipped > 0
                  ? ` · ${filesLogFoldersSkipped} folder(s) could not be scanned (rate-limited) - some files may be missing`
                  : ""}
              </span>
            </div>
          )}
        </section>
      )}

      {combinedSheet && (
        <section className="card">
          <h2>6. Run the comparison</h2>
          <button type="button" onClick={handleSearch} disabled={!canSearch || searching}>
            {searching ? "Comparing…" : `Compare ${filteredRows.length} row(s)`}
          </button>
          {searchError && <p className="error-text">{searchError}</p>}

          <SetupSaveDialog
            disabled={!canSaveSetup}
            getInput={buildSetupInput}
            activeSetup={activeSetup}
            onSaved={(s) => {
              setSetups((prev) => [...prev, s]);
              setActiveSetup({ id: s.id, name: s.name });
            }}
            onUpdated={(s) => setSetups((prev) => prev.map((x) => (x.id === s.id ? s : x)))}
          />
        </section>
      )}

      {searchResult && (
        <section className="card">
          <h2>7. Results &amp; export log</h2>
          <p className="hint">Compared against {searchResult.filesScanned} file(s) in the Files Log.</p>

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

          <ResultsTable
            results={searchResult.results}
            summary={searchResult.summary}
            extraFiles={searchResult.extraFiles}
            sourceFileName={sourceFileName}
          />
        </section>
      )}

      <section className="card">
        <ErrorLogPanel />
      </section>
    </div>
  );
}
