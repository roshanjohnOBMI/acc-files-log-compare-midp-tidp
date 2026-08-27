import { Router } from "express";
import { clearEntries, exportCsv, exportWorkbook, listEntries } from "../services/errorLog.service.js";

export const logRouter = Router();

logRouter.get("/log", (_req, res) => {
  res.json(listEntries());
});

logRouter.delete("/log", (_req, res) => {
  clearEntries();
  res.status(204).end();
});

logRouter.get("/log/export", async (req, res, next) => {
  try {
    const format = (req.query.format as string) ?? "xlsx";
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=error-log.csv");
      res.send(exportCsv());
      return;
    }
    const buffer = await exportWorkbook();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=error-log.xlsx");
    res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
});
