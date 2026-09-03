import { Router } from "express";
import type { ReportExportRequest } from "../services/reportExport.service.js";
import { uploadFileToFolder } from "../services/apsDataManagement.service.js";
import { logEntry } from "../services/errorLog.service.js";
import { runTask } from "../workers/workerPool.js";

export const exportRouter = Router();

const REPORT_FILE_NAME = "ACC FILES LOG - MIDP DELIVERABLE CHECKER.xlsx";

exportRouter.post("/export/report", async (req, res, next) => {
  try {
    const body = req.body as ReportExportRequest & {
      saveTo?: { projectId: string; folderId: string };
    };
    if (!body.results || !body.summary) {
      res.status(400).json({ error: "results and summary are required" });
      return;
    }

    const buffer = await runTask("buildQaQcWorkbook", { request: body });

    if (body.saveTo) {
      const { projectId, folderId } = body.saveTo;
      const result = await uploadFileToFolder(req.apsAccessToken, projectId, folderId, REPORT_FILE_NAME, buffer);
      logEntry("export", "info", `Saved QA/QC report "${REPORT_FILE_NAME}" to ACC folder`, {
        folderId,
        itemId: result.itemId,
      });
      res.json({ fileName: REPORT_FILE_NAME, itemId: result.itemId, webViewUrl: result.webViewUrl });
      return;
    }

    logEntry("export", "info", `Generated QA/QC report workbook "${REPORT_FILE_NAME}"`);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${REPORT_FILE_NAME.replace(/"/g, "")}"`);
    res.send(buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build the QA/QC report";
    logEntry("export", "error", message);
    next(err);
  }
});
