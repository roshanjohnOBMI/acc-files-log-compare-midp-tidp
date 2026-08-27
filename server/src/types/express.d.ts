export {};

declare global {
  namespace Express {
    interface Request {
      apsAccessToken: string;
    }
  }
}
