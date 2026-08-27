import { ResponseType, Scopes } from "@aps_sdk/authentication";
import { authenticationClient } from "./apsClients.js";
import { config } from "../config.js";

export const LOGIN_SCOPES = [
  Scopes.DataRead,
  Scopes.DataWrite,
  Scopes.DataCreate,
  Scopes.DataSearch,
  Scopes.AccountRead,
  Scopes.UserProfileRead,
];

export function buildAuthorizeUrl(state: string, codeChallenge: string): string {
  return authenticationClient.authorize(
    config.aps.clientId,
    ResponseType.Code,
    config.aps.callbackUrl,
    LOGIN_SCOPES,
    {
      state,
      codeChallenge,
      codeChallengeMethod: "S256",
    }
  );
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<StoredTokens> {
  const result = await authenticationClient.getThreeLeggedToken(
    config.aps.clientId,
    code,
    config.aps.callbackUrl,
    {
      clientSecret: config.aps.clientSecret,
      code_verifier: codeVerifier,
    }
  );
  return toStoredTokens(result);
}

export async function refreshTokens(refreshToken: string): Promise<StoredTokens> {
  const result = await authenticationClient.refreshToken(
    refreshToken,
    config.aps.clientId,
    {
      clientSecret: config.aps.clientSecret,
      scopes: LOGIN_SCOPES,
    }
  );
  return toStoredTokens(result);
}

export async function getUserProfile(accessToken: string) {
  const info = await authenticationClient.getUserInfo(accessToken);
  return {
    userId: info.sub ?? "",
    name: info.name ?? info.given_name ?? "Autodesk User",
    email: info.email ?? "",
  };
}

function toStoredTokens(result: {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}): StoredTokens {
  if (!result.access_token || !result.refresh_token || !result.expires_in) {
    throw new Error("APS token response missing required fields");
  }
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresAt: Date.now() + result.expires_in * 1000,
  };
}
