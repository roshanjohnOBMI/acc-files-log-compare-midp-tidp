import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  isProduction: process.env.NODE_ENV === "production",
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:5173",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
  aps: {
    get clientId() {
      return required("APS_CLIENT_ID");
    },
    get clientSecret() {
      return process.env.APS_CLIENT_SECRET;
    },
    get callbackUrl() {
      return required("APS_CALLBACK_URL");
    },
  },
};
