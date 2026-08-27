import type { NextFunction, Request, Response } from "express";
import { refreshTokens } from "../services/apsAuth.service.js";

const REFRESH_MARGIN_MS = 60_000;

/**
 * True only when Autodesk's token endpoint itself rejected the refresh token (HTTP 400/401 -
 * e.g. "invalid_grant" for a revoked/expired refresh token). Anything else - a network blip, an
 * APS outage, or the SDK's own circuit breaker being open from an unrelated burst of failures
 * elsewhere - says nothing about whether the refresh token is still good, so it shouldn't be
 * treated as a real session expiry.
 */
function isAuthRejection(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const shaped = err as { response?: { status?: number }; httpStatusCode?: () => number };
  let status: number | undefined;
  if (typeof shaped.httpStatusCode === "function") {
    try {
      status = shaped.httpStatusCode();
    } catch {
      status = undefined;
    }
  }
  status ??= shaped.response?.status;
  return status === 400 || status === 401;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const tokens = req.session.tokens;
  if (!tokens) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  if (tokens.expiresAt - Date.now() < REFRESH_MARGIN_MS) {
    try {
      const refreshed = await refreshTokens(tokens.refreshToken);
      req.session.tokens = refreshed;
      req.apsAccessToken = refreshed.accessToken;
      next();
    } catch (error) {
      if (isAuthRejection(error)) {
        req.session.tokens = undefined;
        res.status(401).json({ error: "Session expired, please log in again" });
        return;
      }
      // Transient failure - leave the session intact so the next request can retry the refresh
      // once the underlying issue (rate limiting, a brief outage, an open circuit breaker) clears,
      // instead of forcing a full re-login for a problem unrelated to the token's validity.
      const message = error instanceof Error ? error.message : "Unable to reach Autodesk right now";
      res.status(503).json({ error: `Temporarily unable to refresh your Autodesk session (${message}). Please try again shortly.` });
    }
    return;
  }

  req.apsAccessToken = tokens.accessToken;
  next();
}
