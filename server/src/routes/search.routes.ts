import { Router } from "express";
import { fetchRevisions } from "../services/apsDataManagement.service.js";
import type { MatchInputRow } from "../services/matchService.js";
import type { IndexedFile, MatchMode } from "../types/domain.js";
import { logEntry } from "../services/errorLog.service.js";
import { runTask } from "../workers/workerPool.js";

export const searchRouter = Router();

interface SearchRunBody {
  /** Needed for the Revision custom-attribute lookup, which is a project-scoped API call. */
  projectId?: string;
  rows: MatchInputRow[];
  matchMode: MatchMode;
  /** The Files Log to match against - already fetched (via /files-log/scan or /files-log/parse)
   * and, if requested, already filtered down to Shared-folder entries client-side. */
  fileIndex: IndexedFile[];
}

searchRouter.post("/search/run", async (req, res, next) => {
  try {
    const { projectId, rows, matchMode, fileIndex } = req.body as SearchRunBody;

    if (!Array.isArray(rows) || !Array.isArray(fileIndex)) {
      res.status(400).json({ error: "rows and fileIndex are required" });
      return;
    }

    logEntry("search", "info", `Comparing ${rows.length} row(s) against ${fileIndex.length} Files Log entr${fileIndex.length === 1 ? "y" : "ies"}`);

    const { results, summary, extraFiles } = await runTask("matchRows", {
      rows,
      matchMode: matchMode ?? "exact",
      fileIndex,
    });

    // Best-effort ACC "Revision" custom-attribute lookup for every unambiguously matched file
    // (clean matches + extras) - duplicates/not-found rows have no single file to look up, and
    // files with no versionId (parsed out of an exported log workbook) can't be looked up either.
    if (projectId) {
      const versionIdByItemId = new Map(
        fileIndex.filter((f): f is IndexedFile & { itemId: string } => Boolean(f.itemId)).map((f) => [f.itemId, f.versionId])
      );
      const matchedItemIds = results
        .flatMap((r) => r.formats)
        .map((f) => f.itemId)
        .filter((itemId): itemId is string => Boolean(itemId));
      const lookupItemIds = [...matchedItemIds, ...extraFiles.map((f) => f.itemId).filter((id): id is string => Boolean(id))];
      const revisionLookups = lookupItemIds
        .map((itemId) => ({ itemId, versionId: versionIdByItemId.get(itemId) }))
        .filter((lookup): lookup is { itemId: string; versionId: string } => Boolean(lookup.versionId));

      if (revisionLookups.length > 0) {
        const revisions = await fetchRevisions(req.apsAccessToken, projectId, revisionLookups);
        if (revisions.size > 0) {
          for (const result of results) {
            for (const format of result.formats) {
              if (format.itemId && revisions.has(format.itemId)) {
                format.revision = revisions.get(format.itemId);
              }
              // Only meaningful for a clean single match - duplicates/not-found have no definite
              // file to compare against, and either side being blank isn't a mismatch worth flagging.
              if (format.status === "match" && format.revision && result.sourceRevision) {
                format.revisionMatch =
                  format.revision.trim().toLowerCase() === result.sourceRevision.trim().toLowerCase()
                    ? "match"
                    : "mismatch";
              }
            }
          }
          for (const file of extraFiles) {
            if (file.itemId && revisions.has(file.itemId)) {
              file.revision = revisions.get(file.itemId);
            }
          }
        }
      }
    }

    logEntry(
      "search",
      "info",
      `Comparison complete: ${summary.complete} complete, ${summary.partial} partial, ${summary.missing} missing, ${summary.extra} extra file(s) in the Files Log`
    );

    res.json({ results, summary, filesScanned: fileIndex.length, extraFiles });
  } catch (err) {
    next(err);
  }
});
