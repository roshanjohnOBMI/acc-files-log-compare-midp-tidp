import type { NextFunction, Request, Response } from "express";
import { logEntry } from "../services/errorLog.service.js";

/**
 * Duck-typed rather than an `instanceof` check against `cockatiel`'s BrokenCircuitError: cockatiel
 * is only a transitive dependency (pulled in by @aps_sdk/autodesk-sdkmanager), not one of this
 * package's own dependencies, so importing it directly would be fragile. This matches the same
 * check cockatiel's own `isBrokenCircuitError()` helper uses internally.
 */
function isBrokenCircuitError(err: unknown): boolean {
  return err instanceof Error && "isBrokenCircuitError" in err && (err as { isBrokenCircuitError?: unknown }).isBrokenCircuitError === true;
}

/** Duck-typed for the same reason as above - multer's MulterError carries this code. */
function isUploadTooLargeError(err: unknown): boolean {
  return err instanceof Error && (err as { code?: unknown }).code === "LIMIT_FILE_SIZE";
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (isBrokenCircuitError(err)) {
    const message =
      "Autodesk Construction Cloud is temporarily rate-limiting this app after several failed requests. Please wait about a minute and try again.";
    logEntry(req.path, "error", message, { method: req.method, cause: "circuit-breaker-open" });
    console.error(`[${req.method} ${req.path}] APS circuit breaker open`, err);
    res.status(503).json({ error: message });
    return;
  }

  if (isUploadTooLargeError(err)) {
    const message = "That file is larger than this app accepts as an upload. Pick it from ACC instead, or trim the workbook.";
    logEntry(req.path, "error", message, { method: req.method });
    res.status(413).json({ error: message });
    return;
  }

  const message = err instanceof Error ? err.message : "Unexpected server error";
  logEntry(req.path, "error", message, { method: req.method });
  console.error(`[${req.method} ${req.path}]`, err);
  res.status(500).json({ error: message });
}
