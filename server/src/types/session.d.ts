import "express-session";

declare module "express-session" {
  interface SessionData {
    pkceVerifier?: string;
    oauthState?: string;
    tokens?: {
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    };
    profile?: {
      name: string;
      email: string;
      userId: string;
    };
  }
}
