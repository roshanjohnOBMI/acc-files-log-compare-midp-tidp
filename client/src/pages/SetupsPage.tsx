import { useEffect, useState } from "react";
import { deleteSetup, listSetups, updateSetup } from "../api/setups";
import type { Setup } from "../types/domain";

export function SetupsPage() {
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

  return (
    <div className="workspace">
      <section className="card">
        <h2>Saved setups</h2>
        <p className="hint">
          Reusable TIDP/MIDP vs ACC Files Log comparison configurations. Load one from the
          Workspace tab to skip re-picking the hub, project, Files Log folders, identifier column,
          and formats - the same page lets you update a loaded setup with your current settings,
          or rename/delete one here.
        </p>
        {loading && <p className="hint">Loading…</p>}
        {error && <p className="error-text">{error}</p>}
        {!loading && setups.length === 0 && <p className="hint">No setups saved yet.</p>}
        <div className="table-scroll">
          {setups.length > 0 && (
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {setups.map((setup) => (
                  <tr key={setup.id}>
                    <td>
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
                        setup.name
                      )}
                    </td>
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
                    <td>
                      <div className="setup-row-actions">
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
