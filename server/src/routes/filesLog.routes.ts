import { Router } from "express";
import multer from "multer";
import { scanFolders } from "../services/filesLogScan.service.js";
import { downloadItemContent } from "../services/apsDataManagement.service.js";
import { logEntry } from "../services/errorLog.service.js";
import { runTask } from "../workers/workerPool.js";
import type { FilesLogScanFolder, IndexedFile } from "../types/domain.js";

export const filesLogRouter = Router();

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

interface ScanBody {
  projectId: string;
  folders: FilesLogScanFolder[];
  includeSubfolders: boolean;
}

export interface FilesLogResponse {
  files: IndexedFile[];
  foldersSkipped: number;
  fileName?: string;
}

filesLogRouter.post("/files-log/scan", async (req, res, next) => {
  try {
    const { projectId, folders, includeSubfolders } = req.body as ScanBody;
    if (!projectId || !Array.isArray(folders) || folders.length === 0) {
      res.status(400).json({ error: "projectId and at least one folder are required" });
      return;
    }

    logEntry("files-log", "info", `Scanning ${folders.length} folder(s) for the Files Log`, {
      includeSubfolders,
    });

    const { files, foldersSkipped } = await scanFolders(
      req.apsAccessToken,
      projectId,
      folders,
      Boolean(includeSubfolders)
    );

    logEntry(
      "files-log",
      "info",
      `Files Log scan complete: ${files.length} file(s) found` +
        (foldersSkipped > 0 ? ` - ${foldersSkipped} folder(s) could not be scanned due to ACC rate limiting` : "")
    );

    const response: FilesLogResponse = { files, foldersSkipped };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

filesLogRouter.get("/files-log/parse", async (req, res, next) => {
  const { projectId, itemId } = req.query as { projectId?: string; itemId?: string };
  if (!projectId || !itemId) {
    res.status(400).json({ error: "projectId and itemId are required" });
    return;
  }

  try {
    const { buffer, fileName } = await downloadItemContent(req.apsAccessToken, projectId, itemId);
    logEntry("files-log", "info", `Downloaded Files Log "${fileName}" from ACC (${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);

    const files = await runTask("parseFilesLogWorkbook", { buffer, fileName });

    const response: FilesLogResponse = { files, foldersSkipped: 0, fileName };
    res.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load the Files Log from ACC";
    logEntry("files-log", "error", message, { itemId });
    next(err);
  }
});

/** Parses a Files Log workbook uploaded directly from the user's computer instead of read from
 * ACC - e.g. a "SHARED FILES LOG.xlsx" / "WIP FILES LOG.xlsx" export already saved locally. Same
 * parser, same response shape as the ACC-sourced paths. */
filesLogRouter.post("/files-log/upload", upload.single("file"), async (req, res, next) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded (expected a \"file\" field)" });
    return;
  }

  try {
    logEntry(
      "files-log",
      "info",
      `Received uploaded Files Log "${req.file.originalname}" (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`
    );
    const files = await runTask("parseFilesLogWorkbook", { buffer: req.file.buffer, fileName: req.file.originalname });
    const response: FilesLogResponse = { files, foldersSkipped: 0, fileName: req.file.originalname };
    res.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse the uploaded Files Log";
    logEntry("files-log", "error", message, { fileName: req.file.originalname });
    next(err);
  }
});
