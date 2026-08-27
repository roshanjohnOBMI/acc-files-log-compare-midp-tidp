import { dataManagementClient, ossClient } from "./apsClients.js";
import type { FolderTreeNode } from "../types/domain.js";
import { logEntry } from "./errorLog.service.js";
import { parseStorageUrn } from "../utils/storageUrn.js";

export interface HubSummary {
  id: string;
  name: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
}

export async function listHubs(accessToken: string): Promise<HubSummary[]> {
  const result = await dataManagementClient.getHubs({ accessToken });
  return (result.data ?? [])
    .filter((hub) => Boolean(hub.id && hub.attributes?.name))
    .map((hub) => ({ id: hub.id as string, name: hub.attributes!.name as string }));
}

export async function listProjects(
  accessToken: string,
  hubId: string
): Promise<ProjectSummary[]> {
  const result = await dataManagementClient.getHubProjects(hubId, { accessToken });
  return (result.data ?? [])
    .filter((project) => Boolean(project.id && project.attributes?.name))
    .map((project) => ({ id: project.id as string, name: project.attributes!.name as string }));
}

export async function listTopFolders(
  accessToken: string,
  hubId: string,
  projectId: string
): Promise<FolderTreeNode[]> {
  const result = await dataManagementClient.getProjectTopFolders(hubId, projectId, {
    accessToken,
  });
  return (result.data ?? []).map((folder) => ({
    id: folder.id as string,
    name: folder.attributes?.name ?? "Untitled",
    type: "folder" as const,
    hasChildren: true,
  }));
}

/** A single page of a folder's immediate children, mapped to tree nodes for the FolderTreePicker. */
export async function listFolderChildren(
  accessToken: string,
  projectId: string,
  folderId: string
): Promise<FolderTreeNode[]> {
  const nodes: FolderTreeNode[] = [];
  let pageNumber = 0;

  for (;;) {
    const page = await dataManagementClient.getFolderContents(projectId, folderId, {
      accessToken,
      pageNumber,
      pageLimit: 200,
    });

    for (const entry of page.data ?? []) {
      if (entry.type === "folders") {
        nodes.push({
          id: entry.id,
          name: entry.attributes?.name ?? "Untitled",
          type: "folder",
          hasChildren: true,
        });
      } else if (entry.type === "items") {
        const tipVersionId = entry.relationships?.tip?.data?.id;
        const version = page.included?.find((v) => v.id === tipVersionId);
        const fileName = version?.attributes?.name ?? entry.attributes?.displayName ?? "Untitled";
        nodes.push({
          id: entry.id,
          name: fileName,
          type: "item",
          hasChildren: false,
          extension: extensionOf(fileName),
        });
      }
    }

    if (!page.links?.next || !page.data?.length) break;
    pageNumber += 1;
  }

  return nodes;
}

const REVISION_BATCH_SIZE = 50;
const REVISION_MAX_LOOKUPS = 300;

/**
 * Best-effort fetch of the ACC "Revision" custom attribute for a batch of matched files, via the
 * documented BIM 360/ACC Document Management `versions:batch-get` API - NOT covered by
 * @aps_sdk/data-management, so this is a raw REST call. Only meaningful for files that came from a
 * live scan (they carry a real versionId) - files parsed out of an exported Files Log workbook
 * don't, since the workbook never recorded one.
 * Returns a map of itemId -> revision value; entries with no discoverable revision are simply
 * absent from the map (never throws).
 */
export async function fetchRevisions(
  accessToken: string,
  projectId: string,
  lookups: { itemId: string; versionId: string }[]
): Promise<Map<string, string>> {
  const revisions = new Map<string, string>();
  const capped = lookups.slice(0, REVISION_MAX_LOOKUPS);
  if (capped.length < lookups.length) {
    logEntry(
      "search",
      "info",
      `Revision lookup capped at ${REVISION_MAX_LOOKUPS} of ${lookups.length} matched file(s) for performance`
    );
  }

  // BIM 360/ACC Document Management APIs use the raw project ID, not the "b."-prefixed form
  // Data Management API URNs use.
  const bareProjectId = projectId.replace(/^b\./, "");
  const url = `https://developer.api.autodesk.com/bim360/docs/v1/projects/${bareProjectId}/versions:batch-get`;

  for (let i = 0; i < capped.length; i += REVISION_BATCH_SIZE) {
    const batch = capped.slice(i, i + REVISION_BATCH_SIZE);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ urns: batch.map((b) => b.itemId) }),
      });
      if (!res.ok) {
        logEntry(
          "search",
          "warning",
          `Revision metadata isn't available for this ACC project (HTTP ${res.status} from the versions:batch-get API) - the Revision column will stay blank`
        );
        break;
      }
      const body: unknown = await res.json();
      for (const result of extractBatchResults(body)) {
        const itemId = result.itemUrn;
        if (!itemId) continue;
        const revisionAttr = (result.customAttributes ?? []).find(
          (attr) => typeof attr?.name === "string" && /revision/i.test(attr.name)
        );
        if (revisionAttr?.value !== undefined && revisionAttr.value !== null && revisionAttr.value !== "") {
          revisions.set(itemId, String(revisionAttr.value));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logEntry(
        "search",
        "warning",
        `Revision metadata lookup failed (${message}) - the Revision column will stay blank`
      );
      break;
    }
  }

  return revisions;
}

interface BatchGetResult {
  itemUrn?: string;
  customAttributes?: { name?: string; value?: unknown }[];
}

function extractBatchResults(body: unknown): BatchGetResult[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object" && Array.isArray((body as { results?: unknown }).results)) {
    return (body as { results: BatchGetResult[] }).results;
  }
  return [];
}

export interface UploadResult {
  itemId: string;
  webViewUrl?: string;
}

// ACC/BIM 360 Docs projects (this app only targets ACC) use these extension types for uploaded
// files, per the Data Management API's "Create an Item"/"Create a Version" documentation.
const BIM360_FILE_EXTENSION_TYPE = "items:autodesk.bim360:File";
const BIM360_VERSION_EXTENSION_TYPE = "versions:autodesk.bim360:File";

/** Finds an existing item by exact display name within a single folder (non-recursive). */
async function findItemByName(
  accessToken: string,
  projectId: string,
  folderId: string,
  displayName: string
): Promise<{ itemId: string; webViewUrl?: string } | undefined> {
  const target = displayName.trim().toLowerCase();
  let pageNumber = 0;
  for (;;) {
    const page = await dataManagementClient.getFolderContents(projectId, folderId, {
      accessToken,
      pageNumber,
      pageLimit: 200,
    });
    for (const entry of page.data ?? []) {
      if (entry.type === "items" && (entry.attributes?.displayName ?? "").trim().toLowerCase() === target) {
        return { itemId: entry.id, webViewUrl: entry.links?.webView?.href };
      }
    }
    if (!page.links?.next || !page.data?.length) break;
    pageNumber += 1;
  }
  return undefined;
}

/**
 * Uploads a generated file (the QA/QC report workbook) into an ACC folder: creates an OSS storage
 * location, uploads the bytes there, then either creates a brand new item or - if a file with the
 * same name already exists in that folder - a new version of it, so re-exporting to the same
 * folder updates the previous report instead of piling up duplicates.
 */
export async function uploadFileToFolder(
  accessToken: string,
  projectId: string,
  folderId: string,
  fileName: string,
  buffer: Buffer
): Promise<UploadResult> {
  const storage = await dataManagementClient.createStorage(
    projectId,
    {
      jsonapi: { version: "1.0" },
      data: {
        type: "objects",
        attributes: { name: fileName },
        relationships: { target: { data: { type: "folders", id: folderId } } },
      },
    },
    { accessToken }
  );
  const storageUrn = storage.data?.id;
  if (!storageUrn) {
    throw new Error("ACC did not return a storage location for the upload");
  }

  const { bucketKey, objectKey } = parseStorageUrn(storageUrn);
  // exceljs/APS-SDK Buffer-shim typing quirk: the SDK declares its own Buffer type for isomorphic
  // use that a real Node Buffer doesn't structurally satisfy, even though it works at runtime.
  await ossClient.uploadObject(bucketKey, objectKey, buffer as never, { accessToken });

  const existing = await findItemByName(accessToken, projectId, folderId, fileName);

  if (existing) {
    await dataManagementClient.createVersion(
      projectId,
      {
        jsonapi: { version: "1.0" },
        data: {
          type: "versions",
          attributes: {
            name: fileName,
            extension: { type: BIM360_VERSION_EXTENSION_TYPE, version: "1.0" },
          },
          relationships: {
            item: { data: { type: "items", id: existing.itemId } },
            storage: { data: { type: "objects", id: storageUrn } },
          },
        },
      },
      { accessToken }
    );
    return existing;
  }

  const item = await dataManagementClient.createItem(
    projectId,
    {
      jsonapi: { version: "1.0" },
      data: {
        type: "items",
        attributes: {
          displayName: fileName,
          extension: { type: BIM360_FILE_EXTENSION_TYPE, version: "1.0" },
        },
        relationships: {
          tip: { data: { type: "versions", id: "1" } },
          parent: { data: { type: "folders", id: folderId } },
        },
      },
      included: [
        {
          type: "versions",
          id: "1",
          attributes: {
            name: fileName,
            extension: { type: BIM360_VERSION_EXTENSION_TYPE, version: "1.0" },
          },
          relationships: {
            storage: { data: { type: "objects", id: storageUrn } },
          },
        },
      ],
    },
    { accessToken }
  );

  if (!item.data?.id) {
    throw new Error("ACC did not return an item ID after upload");
  }
  return { itemId: item.data.id, webViewUrl: item.data.links?.webView?.href };
}

export interface ItemContent {
  buffer: Buffer;
  fileName: string;
}

/**
 * Downloads the tip version's bytes for an ACC item, fully buffered - used to fetch the
 * TIDP/MIDP source file, and an already-exported Files Log workbook, for parsing.
 *
 * Deliberately bypasses `ossClient.downloadObject()`: its internal chunked-stream downloader
 * (`OSSFileTransfer.download` in @aps_sdk/oss) pipes each chunk into a PassThrough with
 * `{ end: false }` and never calls `.end()` on it afterwards, so the stream's "end" event never
 * fires and the download hangs forever (surfacing here as our own request timeout, no matter how
 * small the file is). Getting the signed S3 URL directly and fetching it ourselves sidesteps that
 * bug entirely and is a single plain HTTP request instead of sequential 5MB-chunk round trips.
 */
export async function downloadItemContent(
  accessToken: string,
  projectId: string,
  itemId: string
): Promise<ItemContent> {
  const tip = await dataManagementClient.getItemTip(projectId, itemId, { accessToken });
  const fileName = tip.data?.attributes?.name ?? "download.xlsx";
  const storageUrn = tip.data?.relationships?.storage?.data?.id;
  if (!storageUrn) {
    throw new Error(`Item ${itemId} has no downloadable storage location`);
  }

  const { bucketKey, objectKey } = parseStorageUrn(storageUrn);
  const signed = await ossClient.signedS3Download(bucketKey, objectKey, { accessToken });

  if (signed.status !== "complete" && signed.status !== "fallback") {
    throw new Error(`"${fileName}" is still being processed by ACC (status: ${signed.status}) - try again shortly`);
  }
  if (!signed.url) {
    throw new Error(`ACC did not return a download URL for "${fileName}"`);
  }

  const response = await fetch(signed.url);
  if (!response.ok) {
    throw new Error(`Failed to download "${fileName}" from ACC storage (HTTP ${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  return { buffer, fileName };
}

export function extensionOf(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx === -1 ? "" : fileName.slice(idx + 1).toLowerCase();
}

export function baseNameOf(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return (idx === -1 ? fileName : fileName.slice(0, idx)).trim().toLowerCase();
}
