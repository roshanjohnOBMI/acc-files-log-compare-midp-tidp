import { dataManagementClient } from "./apsClients.js";
import { extensionOf, baseNameOf } from "./apsDataManagement.service.js";
import { logEntry } from "./errorLog.service.js";
import type { FilesLogScanFolder, IndexedFile } from "../types/domain.js";

const FOLDER_CONCURRENCY = 2;
// High enough that the cumulative backoff comfortably outlasts the APS SDK's own shared circuit
// breaker (opens for 60s by default - see isBrokenCircuitError below): 2s,4s,8s,16s,32s,64s is
// ~126s cumulative, so at least one retry always lands after the breaker has closed again.
const QUOTA_RETRY_ATTEMPTS = 6;
const QUOTA_RETRY_BASE_DELAY_MS = 2000;

// 429 (quota/rate limit) plus the server-side statuses ACC's Data Management API is known to
// return transiently under load.
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpStatusOf(err: unknown): number | undefined {
  if (!(err instanceof Error)) return undefined;
  const shaped = err as { httpStatusCode?: () => number; response?: { status?: number } };
  if (typeof shaped.httpStatusCode === "function") {
    try {
      const status = shaped.httpStatusCode();
      if (status !== undefined) return status;
    } catch {
      // fall through to response?.status below
    }
  }
  return shaped.response?.status;
}

/**
 * True for a retryable HTTP status, OR for the APS SDK's own resiliency errors (its shared,
 * process-wide circuit breaker / internal request timeout - see apsDataManagement.service.ts's
 * sibling note on buildFileIndex in the reference tool this was adapted from). Both are cockatiel's
 * own duck-type markers (no `.response`, no `httpStatusCode()`).
 */
function isRetryable(err: unknown): boolean {
  const status = httpStatusOf(err);
  if (status !== undefined) return RETRYABLE_STATUS_CODES.has(status);
  const shaped = err as { isBrokenCircuitError?: boolean; isTaskCancelledError?: boolean } | null;
  return Boolean(shaped?.isBrokenCircuitError || shaped?.isTaskCancelledError);
}

export interface FilesLogScanResult {
  files: IndexedFile[];
  /** Folders that couldn't be listed after retrying (rate-limited or otherwise failed) - if this
   * is non-zero, the result may be missing files that live in those folders. */
  foldersSkipped: number;
}

/**
 * Walks the given root folder(s) (and, if requested, their subfolders) collecting every file
 * item's tip-version details into the Files Log. Root folders are deduplicated against each
 * other's subtrees (a folder reachable from more than one selected root, or nested under another
 * selected root, is only scanned once).
 *
 * Traverses level-by-level (BFS) with up to FOLDER_CONCURRENCY folders fetched in parallel per
 * level, same trade-off as the reference TIDP/MIDP checker tool this was adapted from: a real
 * project search folder can have dozens of subfolders, but the APS SDK wraps every call in a
 * *shared, process-wide* circuit breaker that trips after just 5 consecutive failures and then
 * locks out ALL Data Management calls for 60 seconds, so concurrency is kept deliberately low.
 */
export async function scanFolders(
  accessToken: string,
  projectId: string,
  roots: FilesLogScanFolder[],
  includeSubfolders: boolean
): Promise<FilesLogScanResult> {
  const files: IndexedFile[] = [];
  const visited = new Set<string>();
  let currentLevel: { folderId: string; pathDisplay: string }[] = [];
  let foldersSkipped = 0;

  for (const root of roots) {
    if (visited.has(root.folderId)) continue;
    visited.add(root.folderId);
    currentLevel.push({ folderId: root.folderId, pathDisplay: root.pathDisplay });
  }

  while (currentLevel.length > 0) {
    const nextLevel: { folderId: string; pathDisplay: string }[] = [];

    for (let i = 0; i < currentLevel.length; i += FOLDER_CONCURRENCY) {
      const batch = currentLevel.slice(i, i + FOLDER_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((folder) => listOneFolder(accessToken, projectId, folder.folderId, folder.pathDisplay))
      );
      for (const { items, subfolders, failed } of batchResults) {
        files.push(...items);
        if (failed) foldersSkipped += 1;
        if (includeSubfolders) {
          for (const sub of subfolders) {
            if (!visited.has(sub.folderId)) {
              visited.add(sub.folderId);
              nextLevel.push(sub);
            }
          }
        }
      }
    }

    currentLevel = nextLevel;
  }

  return { files, foldersSkipped };
}

/** Lists one folder's immediate contents (all pages), separating files from subfolders and
 * tagging every file with the display path it was found under. */
async function listOneFolder(
  accessToken: string,
  projectId: string,
  folderId: string,
  pathDisplay: string
): Promise<{ items: IndexedFile[]; subfolders: { folderId: string; pathDisplay: string }[]; failed: boolean }> {
  const items: IndexedFile[] = [];
  const subfolders: { folderId: string; pathDisplay: string }[] = [];
  let pageNumber = 0;

  for (;;) {
    let page;
    let retryAttempt = 0;
    for (;;) {
      try {
        page = await dataManagementClient.getFolderContents(projectId, folderId, {
          accessToken,
          pageNumber,
          pageLimit: 200,
        });
        break;
      } catch (error) {
        if (isRetryable(error) && retryAttempt < QUOTA_RETRY_ATTEMPTS) {
          retryAttempt += 1;
          const delayMs = QUOTA_RETRY_BASE_DELAY_MS * 2 ** (retryAttempt - 1);
          const status = httpStatusOf(error);
          const reason =
            status !== undefined
              ? `ACC returned HTTP ${status}`
              : (error as { isBrokenCircuitError?: boolean }).isBrokenCircuitError
                ? "the shared APS connection briefly paused (circuit breaker open)"
                : "a request to ACC timed out";
          logEntry(
            "files-log",
            "warning",
            `${reason} listing "${pathDisplay}" - retrying in ${(delayMs / 1000).toFixed(1)}s (attempt ${retryAttempt}/${QUOTA_RETRY_ATTEMPTS})`
          );
          await sleep(delayMs);
          continue;
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        logEntry(
          "files-log",
          "warning",
          `Failed to list "${pathDisplay}": ${message} - some files in this folder may be missing from the Files Log`
        );
        return { items, subfolders, failed: true };
      }
    }

    for (const entry of page.data ?? []) {
      if (entry.type === "folders") {
        const name = entry.attributes?.name ?? "Untitled";
        subfolders.push({ folderId: entry.id, pathDisplay: `${pathDisplay}/${name}` });
        continue;
      }
      if (entry.type === "items") {
        const tipVersionId = entry.relationships?.tip?.data?.id;
        const version = page.included?.find((v) => v.id === tipVersionId);
        const fileName = version?.attributes?.name ?? entry.attributes?.displayName ?? "";
        if (!fileName) continue;
        items.push({
          fileName,
          baseName: baseNameOf(fileName),
          extension: extensionOf(fileName),
          itemId: entry.id,
          webViewUrl: entry.links?.webView?.href,
          versionNumber: version?.attributes?.versionNumber,
          versionId: tipVersionId,
          folderPath: pathDisplay,
          lastModifiedTime: version?.attributes?.lastModifiedTime,
          lastModifiedBy: version?.attributes?.lastModifiedUserName,
        });
      }
    }

    if (!page.links?.next || !page.data?.length) break;
    pageNumber += 1;
  }

  return { items, subfolders, failed: false };
}
