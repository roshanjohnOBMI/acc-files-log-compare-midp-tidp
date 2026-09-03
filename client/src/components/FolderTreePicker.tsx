import { useEffect, useState } from "react";
import { listFolderChildren, listTopFolders } from "../api/hubs";
import type { FolderTreeNode } from "../types/domain";

interface TreeNodeState extends FolderTreeNode {
  children?: TreeNodeState[];
  expanded: boolean;
  loading: boolean;
}

interface FolderTreePickerProps {
  projectId: string | null;
  hubId: string | null;
  /** "folder" (default) lets the user pick a single folder; "file" lets them pick a file inside
   * the tree; "multiFolder" lets them check any number of folders (e.g. every folder a live Files
   * Log scan should walk). */
  selectMode?: "folder" | "file" | "multiFolder";
  /** In "file" mode, only files with one of these extensions (lowercase, no dot) are selectable. */
  selectableExtensions?: string[];
  selectedFolderId?: string;
  selectedPath?: string;
  /** parentId is the containing folder's ID - only meaningful in "file" mode (undefined for
   * top-level items, since ACC top folders don't have a single queryable parent in this tree). */
  onSelect?: (id: string, path: string, parentId?: string) => void;
  /** "multiFolder" mode only: which folder ids are currently checked. */
  selectedFolderIds?: Set<string>;
  /** "multiFolder" mode only: called with the folder's id + full display path when its checkbox is toggled. */
  onToggleFolder?: (id: string, path: string) => void;
}

export function FolderTreePicker({
  projectId,
  hubId,
  selectMode = "folder",
  selectableExtensions,
  selectedFolderId,
  selectedPath,
  onSelect,
  selectedFolderIds,
  onToggleFolder,
}: FolderTreePickerProps) {
  const [roots, setRoots] = useState<TreeNodeState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hubId || !projectId) {
      setRoots([]);
      return;
    }
    setLoading(true);
    setError(null);
    listTopFolders(hubId, projectId)
      .then((nodes) =>
        setRoots(nodes.map((n) => ({ ...n, expanded: false, loading: false, children: undefined })))
      )
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load folders"))
      .finally(() => setLoading(false));
  }, [hubId, projectId]);

  function updateNode(
    nodes: TreeNodeState[],
    id: string,
    updater: (node: TreeNodeState) => TreeNodeState
  ): TreeNodeState[] {
    return nodes.map((node) => {
      if (node.id === id) return updater(node);
      if (node.children) {
        return { ...node, children: updateNode(node.children, id, updater) };
      }
      return node;
    });
  }

  async function toggleExpand(node: TreeNodeState) {
    if (node.type !== "folder" || !projectId) return;

    if (node.expanded) {
      setRoots((prev) => updateNode(prev, node.id, (n) => ({ ...n, expanded: false })));
      return;
    }

    if (node.children) {
      setRoots((prev) => updateNode(prev, node.id, (n) => ({ ...n, expanded: true })));
      return;
    }

    setRoots((prev) => updateNode(prev, node.id, (n) => ({ ...n, loading: true })));
    try {
      const children = await fetchAndWrapChildren(node.id);
      setRoots((prev) =>
        updateNode(prev, node.id, (n) => ({ ...n, expanded: true, loading: false, children }))
      );
    } catch (err) {
      setRoots((prev) => updateNode(prev, node.id, (n) => ({ ...n, loading: false })));
      setError(err instanceof Error ? err.message : "Failed to load folder contents");
    }
  }

  async function fetchAndWrapChildren(folderId: string): Promise<TreeNodeState[]> {
    const children = await listFolderChildren(projectId!, folderId);
    return children.map((c) => ({ ...c, expanded: false, loading: false, children: undefined }));
  }

  /**
   * Checking a folder in "multiFolder" mode also checks its immediate children, expanding it first
   * (one extra API call) if they aren't loaded yet - so ticking a project-root-ish folder visibly
   * picks up everything one level down instead of leaving the user to expand and check each
   * subfolder by hand. Unchecking it undoes exactly that (itself + that same one level), leaving
   * any subfolder checked independently, deeper down, alone.
   *
   * Deliberately shallow (one level, not the whole subtree): the actual scan already walks
   * arbitrarily deep server-side when "Include subfolders" is on (see filesLogScan.service.ts),
   * with retry/backoff around ACC's rate limits - recursively auto-expanding every descendant
   * here, client-side, would just be racing that same API with none of those protections.
   */
  async function handleCheckToggle(node: TreeNodeState, path: string) {
    if (node.type !== "folder") return;
    const alreadyChecked = Boolean(selectedFolderIds?.has(node.id));

    let children = node.children;
    if (!alreadyChecked && !children) {
      setRoots((prev) => updateNode(prev, node.id, (n) => ({ ...n, loading: true })));
      try {
        children = await fetchAndWrapChildren(node.id);
        setRoots((prev) =>
          updateNode(prev, node.id, (n) => ({ ...n, expanded: true, loading: false, children }))
        );
      } catch (err) {
        setRoots((prev) => updateNode(prev, node.id, (n) => ({ ...n, loading: false })));
        setError(err instanceof Error ? err.message : "Failed to load folder contents");
        children = [];
      }
    }

    onToggleFolder?.(node.id, path);
    for (const child of children ?? []) {
      if (child.type !== "folder") continue;
      const childChecked = Boolean(selectedFolderIds?.has(child.id));
      // Only flip children whose state actually needs to change to match the parent's new
      // state - onToggleFolder is a plain toggle, so calling it on a child already in the target
      // state would flip it the wrong way.
      if (childChecked === alreadyChecked) {
        onToggleFolder?.(child.id, `${path}/${child.name}`);
      }
    }
  }

  if (!hubId || !projectId) {
    return <p className="hint">Select a hub and project first.</p>;
  }

  return (
    <div className="folder-tree">
      {selectedPath && (
        <div className="folder-tree-selected">
          Selected: <strong>{selectedPath}</strong>
        </div>
      )}
      {loading && <p className="hint">Loading top-level folders…</p>}
      {error && <p className="error-text">{error}</p>}
      <ul className="folder-tree-list">
        {roots.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            depth={0}
            path={node.name}
            parentId={undefined}
            selectMode={selectMode}
            selectableExtensions={selectableExtensions}
            selectedFolderId={selectedFolderId}
            onToggle={toggleExpand}
            onSelect={onSelect}
            selectedFolderIds={selectedFolderIds}
            onCheckToggle={handleCheckToggle}
          />
        ))}
      </ul>
    </div>
  );
}

interface TreeNodeProps {
  node: TreeNodeState;
  depth: number;
  path: string;
  parentId?: string;
  selectMode: "folder" | "file" | "multiFolder";
  selectableExtensions?: string[];
  selectedFolderId?: string;
  onToggle: (node: TreeNodeState) => void;
  onSelect?: (id: string, path: string, parentId?: string) => void;
  selectedFolderIds?: Set<string>;
  /** "multiFolder" mode only: checking a folder also checks its immediate children (see
   * handleCheckToggle above) - takes the node (not just its id) since it needs to know whether
   * children are already loaded. */
  onCheckToggle?: (node: TreeNodeState, path: string) => void;
}

function TreeNode({
  node,
  depth,
  path,
  parentId,
  selectMode,
  selectableExtensions,
  selectedFolderId,
  onToggle,
  onSelect,
  selectedFolderIds,
  onCheckToggle,
}: TreeNodeProps) {
  const isFolder = node.type === "folder";
  const isSelected = node.id === selectedFolderId;
  const isChecked = Boolean(selectedFolderIds?.has(node.id));
  const isFileSelectable =
    !isFolder &&
    selectMode === "file" &&
    (!selectableExtensions?.length || selectableExtensions.includes(node.extension ?? ""));

  return (
    <li>
      <div
        className={`folder-tree-row${isSelected || isChecked ? " selected" : ""}${!isFolder ? " file-row" : ""}`}
        style={{ paddingLeft: depth * 18 }}
      >
        {isFolder ? (
          <button
            type="button"
            className="folder-tree-toggle"
            onClick={() => onToggle(node)}
            aria-label={node.expanded ? "Collapse" : "Expand"}
          >
            {node.loading ? "…" : node.expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="folder-tree-toggle" />
        )}
        {isFolder && selectMode === "multiFolder" && (
          <input
            type="checkbox"
            className="folder-tree-checkbox"
            checked={isChecked}
            onChange={() => onCheckToggle?.(node, path)}
          />
        )}
        <span className="folder-tree-icon">{isFolder ? "📁" : "📄"}</span>
        {isFolder ? (
          <button
            type="button"
            className="folder-tree-name"
            onClick={() => onToggle(node)}
            title="Click to browse into this folder"
          >
            {node.name}
          </button>
        ) : (
          <span className={`folder-tree-name file${isFileSelectable ? "" : " dimmed"}`}>
            {node.name}
          </span>
        )}
        {isFolder && selectMode === "folder" && (
          <button
            type="button"
            className={`folder-tree-select${isSelected ? " selected" : ""}`}
            onClick={() => onSelect?.(node.id, path)}
          >
            {isSelected ? "✓ Selected" : "Use this folder"}
          </button>
        )}
        {isFileSelectable && (
          <button
            type="button"
            className={`folder-tree-select${isSelected ? " selected" : ""}`}
            onClick={() => onSelect?.(node.id, path, parentId)}
          >
            {isSelected ? "✓ Selected" : "Select this file"}
          </button>
        )}
      </div>
      {isFolder && node.expanded && node.children && (
        <ul>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              path={`${path}/${child.name}`}
              parentId={node.id}
              selectMode={selectMode}
              selectableExtensions={selectableExtensions}
              selectedFolderId={selectedFolderId}
              onToggle={onToggle}
              onSelect={onSelect}
              selectedFolderIds={selectedFolderIds}
              onCheckToggle={onCheckToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
