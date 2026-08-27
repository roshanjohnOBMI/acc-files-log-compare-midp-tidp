import { Router } from "express";
import { config } from "../config.js";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  getUserProfile,
} from "../services/apsAuth.service.js";
import { generateCodeChallenge, generateCodeVerifier, generateState } from "../utils/pkce.js";
import { logEntry } from "../services/errorLog.service.js";

export const authRouter = Router();

authRouter.get("/login", (req, res) => {
  const verifier = generateCodeVerifier();
  const state = generateState();
  req.session.pkceVerifier = verifier;
  req.session.oauthState = state;
  const url = buildAuthorizeUrl(state, generateCodeChallenge(verifier));
  res.redirect(url);
});

authRouter.get("/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;

  if (error) {
    logEntry("auth", "error", `APS login denied: ${error}`);
    res.redirect(`${config.clientUrl}/login?error=${encodeURIComponent(error)}`);
    return;
  }

  const expectedState = req.session.oauthState;
  const verifier = req.session.pkceVerifier;
  if (!code || !state || !verifier || state !== expectedState) {
    logEntry("auth", "error", "OAuth state/verifier mismatch during callback");
    res.redirect(`${config.clientUrl}/login?error=state_mismatch`);
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code, verifier);
    const profile = await getUserProfile(tokens.accessToken);
    req.session.tokens = tokens;
    req.session.profile = profile;
    req.session.pkceVerifier = undefined;
    req.session.oauthState = undefined;
    res.redirect(config.clientUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Login failed";
    logEntry("auth", "error", message);
    res.redirect(`${config.clientUrl}/login?error=${encodeURIComponent(message)}`);
  }
});

authRouter.get("/me", (req, res) => {
  if (!req.session.tokens || !req.session.profile) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({ profile: req.session.profile });
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.status(204).end();
  });
});
