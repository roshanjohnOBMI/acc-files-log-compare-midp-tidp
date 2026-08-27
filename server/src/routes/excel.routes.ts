import { Router } from "express";
import multer from "multer";
import { downloadItemContent } from "../services/apsDataManagement.service.js";
import { parseWorkbookBuffer } from "../services/excelParse.service.js";
import { logEntry } from "../services/errorLog.service.js";

export const excelRouter = Router();

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

async function parseWithTimeout(buffer: Buffer, fileName: string) {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(
            "Loading this workbook is taking too long - it may have excessive formatting or blank rows. Try again, or trim the file."
          )
        ),
      REQUEST_TIMEOUT_MS
    );
  });

  return Promise.race([
    (async () => {
      const parseStarted = Date.now();
      const parsed = await parseWorkbookBuffer(buffer, fileName);
      const parseMs = Date.now() - parseStarted;
      logEntry(
        "excel",
        "info",
        `Parsed "${fileName}" in ${parseMs}ms - ${parsed.length} sheet(s), ${parsed.reduce((n, s) => n + s.rows.length, 0)} filled row(s) total`
      );
      return { fileName, sheets: parsed };
    })(),
    timeout,
  ]);
}

excelRouter.get("/excel/parse", async (req, res, next) => {
  const { projectId, itemId } = req.query as { projectId?: string; itemId?: string };
  if (!projectId || !itemId) {
    res.status(400).json({ error: "projectId and itemId are required" });
    return;
  }

  try {
    const downloadStarted = Date.now();
    const { buffer, fileName } = await downloadItemContent(req.apsAccessToken, projectId, itemId);
    const downloadMs = Date.now() - downloadStarted;
    logEntry(
      "excel",
      "info",
      `Downloaded "${fileName}" from ACC in ${downloadMs}ms (${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB)`
    );

    const sheets = await parseWithTimeout(buffer, fileName);
    res.json(sheets);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load the file from ACC";
    logEntry("excel", "error", message, { itemId });
    next(err);
  }
});

/** Parses a TIDP/MIDP workbook uploaded directly from the user's computer instead of picked from
 * ACC - same parser, same response shape, so the client's downstream sheet/column logic doesn't
 * need to know which path the file came in through. */
excelRouter.post("/excel/upload", upload.single("file"), async (req, res, next) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded (expected a \"file\" field)" });
    return;
  }

  try {
    logEntry(
      "excel",
      "info",
      `Received uploaded workbook "${req.file.originalname}" (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`
    );
    const sheets = await parseWithTimeout(req.file.buffer, req.file.originalname);
    res.json(sheets);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse the uploaded file";
    logEntry("excel", "error", message, { fileName: req.file.originalname });
    next(err);
  }
});
