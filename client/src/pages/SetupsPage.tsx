import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteSetup, listSetups, updateSetup } from "../api/setups";
import { useWorkspace } from "../context/WorkspaceContext";
import type { Setup } from "../types/domain";

export function SetupsPage() {
  const navigate = useNavigate();
  const { applySetup } = useWorkspace();
  const [setups, setSetups] = useState<Setup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  function refresh() {
    setLoading(true);
    listSetups()
      .then(setSetups)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load setups"))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, []);

  function startRename(setup: Setup) {
    setRenamingId(setup.id);
    setRenameValue(setup.name);
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameValue("");
  }

  async function saveRename(setup: Setup) {
    const name = renameValue.trim();
    if (!name || name === setup.name) {
      cancelRename();
      return;
    }
    setRenaming(true);
    try {
      const { id, createdAt, updatedAt, ...rest } = setup;
      const updated = await updateSetup(id, { ...rest, name });
      setSetups((prev) => prev.map((s) => (s.id === id ? updated : s)));
      cancelRename();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename setup");
    } finally {
      setRenaming(false);
    }
  }

  function handleLoad(setup: Setup) {
    applySetup(setup);
    navigate("/");
  }

  return (
    <div className="setups-page">
      <div className="numbered-section-head">
        <h1>Saved setups</h1>
      </div>
      <p className="hint">
        Reusable TIDP/MIDP vs ACC Files Log comparison configurations. Load one to restore the hub,
        project, Files Log source settings, identifier/formats/date columns, and match mode into the
        Workspace - the TIDP/MIDP source file and the Files Log itself (scan or file) need to be
        reselected/rerun.
      </p>
      {loading && <p className="hint">Loading…</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && setups.length === 0 && <p className="hint">No setups saved yet.</p>}

      <div className="saved-setups-list">
        {setups.map((setup) => (
          <div className="saved-setup-row" key={setup.id}>
            <div className="saved-setup-row-main">
              {renamingId === setup.id ? (
                <div className="setup-rename-row">
                  <input
                    type="text"
                    value={renameValue}
                    autoFocus
                    disabled={renaming}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRename(setup);
                      if (e.key === "Escape") cancelRename();
                    }}
                  />
                  <button type="button" onClick={() => saveRename(setup)} disabled={renaming}>
                    {renaming ? "Saving…" : "Save"}
                  </button>
                  <button type="button" className="link-button" onClick={cancelRename} disabled={renaming}>
                    Cancel
                  </button>
                </div>
              ) : (
                <span className="saved-setup-name">{setup.name}</span>
              )}
              <span className="saved-setup-scope">
                {setup.hubName} · {setup.projectName}
                {setup.identifierColumn ? ` · ${setup.identifierColumn}` : ""}
                {setup.headerRow ? ` · header row ${setup.headerRow}` : ""}
              </span>
              <span className="saved-setup-updated">Updated {new Date(setup.updatedAt).toLocaleString()}</span>
            </div>
            <div className="saved-setup-row-actions">
              {renamingId !== setup.id && (
                <button type="button" className="link-button" onClick={() => startRename(setup)}>
                  Rename
                </button>
              )}
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  try {
                    await deleteSetup(setup.id);
                    refresh();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to delete setup");
                  }
                }}
              >
                Delete
              </button>
              <button type="button" className="btn-secondary" onClick={() => handleLoad(setup)}>
                Load
              </button>
            </div>
          </div>
        ))}
      </div>

      {setups.length > 0 && (
        <details className="saved-setups-details">
          <summary>Full configuration table</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Hub</th>
                  <th>Project</th>
                  <th>Header row</th>
                  <th>Identifier column</th>
                  <th>Formats column</th>
                  <th>Planned date column</th>
                  <th>Revision column</th>
                  <th>TIDP/MIDP source</th>
                  <th>TIDP/MIDP folder</th>
                  <th>Files Log mode</th>
                  <th>Only Shared</th>
                  <th>Export folder</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {setups.map((setup) => (
                  <tr key={setup.id}>
                    <td>{setup.name}</td>
                    <td>{setup.hubName}</td>
                    <td>{setup.projectName}</td>
                    <td>{setup.headerRow ?? "—"}</td>
                    <td>{setup.identifierColumn ?? "—"}</td>
                    <td>{setup.formatsColumn ?? "—"}</td>
                    <td>{setup.plannedDateColumn ?? "—"}</td>
                    <td>{setup.revisionColumn ?? "—"}</td>
                    <td>{setup.sourceMode === "upload" ? "Upload" : "ACC"}</td>
                    <td>{setup.sourceFolderPath ?? "—"}</td>
                    <td>
                      {setup.filesLogMode === "upload"
                        ? "Upload"
                        : setup.filesLogMode === "file"
                          ? "Existing file"
                          : "Live scan"}
                    </td>
                    <td>{setup.onlyShared ? `"${setup.sharedKeyword || "Shared"}"` : "No"}</td>
                    <td>{setup.exportFolderPath ?? "—"}</td>
                    <td>{new Date(setup.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
