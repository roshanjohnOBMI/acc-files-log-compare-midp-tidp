interface FilesLogFilterPanelProps {
  loaded: boolean;
  onlyShared: boolean;
  onOnlySharedChange: (value: boolean) => void;
  sharedKeyword: string;
  onSharedKeywordChange: (value: string) => void;
  totalCount: number;
  visibleCount: number;
  foldersSkipped: number;
}

/** "ACC Files Log filter" pane - narrows the assembled Files Log down to entries whose folder
 * path contains a keyword (e.g. "03_PUBLISHED" or "Shared") before it's compared against. */
export function FilesLogFilterPanel({
  loaded,
  onlyShared,
  onOnlySharedChange,
  sharedKeyword,
  onSharedKeywordChange,
  totalCount,
  visibleCount,
  foldersSkipped,
}: FilesLogFilterPanelProps) {
  if (!loaded) {
    return (
      <p className="hint">
        Load the ACC Files Log from the Workspace tab first, then come back here to filter it.
      </p>
    );
  }

  return (
    <div className="files-log-filter-pane">
      <p className="hint">
        Narrow the Files Log before it's compared. Only files whose folder path contains the text
        below are counted.
      </p>
      <label className="checkbox-label">
        <input type="checkbox" checked={onlyShared} onChange={(e) => onOnlySharedChange(e.target.checked)} />
        Only count files whose folder path contains
      </label>
      <input
        type="text"
        value={sharedKeyword}
        onChange={(e) => onSharedKeywordChange(e.target.value)}
        disabled={!onlyShared}
        placeholder="Shared"
      />
      <div className="files-log-filter-effect">
        <span className="micro-label">Effect</span>
        <p>
          {totalCount} file(s) in the Files Log
          {onlyShared
            ? ` · ${visibleCount} match "${sharedKeyword}" and will be compared · ${Math.max(totalCount - visibleCount, 0)} excluded`
            : " · all will be compared"}
          {foldersSkipped > 0
            ? ` · ${foldersSkipped} folder(s) could not be scanned (rate-limited) - some files may be missing`
            : ""}
        </p>
      </div>
    </div>
  );
}
