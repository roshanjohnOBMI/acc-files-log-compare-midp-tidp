import { FolderTreePicker } from "./FolderTreePicker";
import type { FilesLogScanFolder, FilesLogSourceMode } from "../types/domain";

const LOG_FILE_EXTENSIONS = ["xlsx", "xls", "xlsm"];
const LOG_FILE_ACCEPT = ".xlsx,.xls,.xlsm";

interface FilesLogSourcePickerProps {
  hubId: string | null;
  projectId: string | null;

  mode: FilesLogSourceMode;
  onModeChange: (mode: FilesLogSourceMode) => void;

  scanFolders: FilesLogScanFolder[];
  onToggleScanFolder: (id: string, path: string) => void;
  includeSubfolders: boolean;
  onIncludeSubfoldersChange: (value: boolean) => void;
  onRunScan: () => void;

  fileItemId?: string;
  filePath?: string;
  onSelectFile: (id: string, path: string, parentId?: string) => void;

  uploadedFileName?: string;
  onUploadFile: (file: File) => void;

  loading: boolean;
}

export function FilesLogSourcePicker({
  hubId,
  projectId,
  mode,
  onModeChange,
  scanFolders,
  onToggleScanFolder,
  includeSubfolders,
  onIncludeSubfoldersChange,
  onRunScan,
  fileItemId,
  filePath,
  onSelectFile,
  uploadedFileName,
  onUploadFile,
  loading,
}: FilesLogSourcePickerProps) {
  const scanFolderIds = new Set(scanFolders.map((f) => f.folderId));

  return (
    <div className="files-log-source-picker">
      <div className="export-destination-toggle">
        <button type="button" className={mode === "scan" ? "active" : ""} onClick={() => onModeChange("scan")}>
          Scan ACC folder(s) live
        </button>
        <button type="button" className={mode === "file" ? "active" : ""} onClick={() => onModeChange("file")}>
          Pick existing file from ACC
        </button>
        <button type="button" className={mode === "upload" ? "active" : ""} onClick={() => onModeChange("upload")}>
          Upload from computer
        </button>
      </div>

      {mode === "scan" && (
        <>
          <p className="hint">
            Check every folder that should be walked - files in each folder (and, if enabled, its
            subfolders) become the Files Log to compare against. Checking a folder also checks its
            immediate subfolders, expanding it first if needed - with "Include subfolders" on
            below, everything deeper than that is still walked when the scan runs, whether or not
            it's checked here. Checked folders are scanned regardless of nesting (a folder nested
            under another checked folder is only scanned once).
          </p>
          <FolderTreePicker
            hubId={hubId}
            projectId={projectId}
            selectMode="multiFolder"
            selectedFolderIds={scanFolderIds}
            onToggleFolder={onToggleScanFolder}
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeSubfolders}
              onChange={(e) => onIncludeSubfoldersChange(e.target.checked)}
            />
            Include subfolders
          </label>
          {scanFolders.length > 0 && (
            <div className="files-log-selected-folders">
              {scanFolders.map((f) => (
                <span key={f.folderId} className="files-log-folder-chip">
                  {f.pathDisplay}
                  <button type="button" className="link-button" onClick={() => onToggleScanFolder(f.folderId, f.pathDisplay)}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <button type="button" onClick={onRunScan} disabled={loading || scanFolders.length === 0}>
            {loading ? "Scanning…" : `Scan ${scanFolders.length || ""} folder${scanFolders.length === 1 ? "" : "s"}`}
          </button>
        </>
      )}

      {mode === "file" && (
        <>
          <p className="hint">
            Browse the ACC folder tree and pick an already-exported Files Log workbook (e.g. one
            produced by the ACC File Log Extractor tool) - columns like File Name, Folder Path,
            Version, Last Modified, Modified By, and ACC Link are read automatically.
          </p>
          <FolderTreePicker
            hubId={hubId}
            projectId={projectId}
            selectMode="file"
            selectableExtensions={LOG_FILE_EXTENSIONS}
            selectedFolderId={fileItemId}
            selectedPath={filePath}
            onSelect={onSelectFile}
          />
          {loading && <p className="hint">Loading Files Log…</p>}
        </>
      )}

      {mode === "upload" && (
        <>
          <p className="hint">
            Upload an already-exported Files Log workbook straight from your computer - same
            columns as the ACC-picked option, parsed the same way server-side.
          </p>
          <label className="upload-drop">
            <input
              type="file"
              accept={LOG_FILE_ACCEPT}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUploadFile(file);
                e.target.value = "";
              }}
            />
            {loading ? "Uploading…" : uploadedFileName ? `✓ ${uploadedFileName} - choose a different file` : "Choose a Files Log file…"}
          </label>
        </>
      )}
    </div>
  );
}
