import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { Router } from "express";
import cors from "cors";
import session from "express-session";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.routes.js";
import { hubsRouter } from "./routes/hubs.routes.js";
import { excelRouter } from "./routes/excel.routes.js";
import { filesLogRouter } from "./routes/filesLog.routes.js";
import { searchRouter } from "./routes/search.routes.js";
import { setupsRouter } from "./routes/setups.routes.js";
import { logRouter } from "./routes/log.routes.js";
import { exportRouter } from "./routes/export.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requireAuth } from "./middleware/requireAuth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.join(__dirname, "..", "..", "client", "dist");

const app = express();

if (config.isProduction) {
  // Azure App Service terminates TLS at the front door and forwards plain HTTP - without this,
  // Express sees every request as insecure and would never mark the session cookie as secure.
  app.set("trust proxy", 1);
}

app.use(cors({ origin: config.clientUrl, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 15, // matches APS refresh token lifetime (~15 days)
    },
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);

// Every other /api/* route requires a valid session; requireAuth runs exactly once here
// rather than once per feature router, since several of these routers share the "/api" prefix.
const protectedRouter = Router();
protectedRouter.use(requireAuth);
protectedRouter.use(hubsRouter);
protectedRouter.use(excelRouter);
protectedRouter.use(filesLogRouter);
protectedRouter.use(searchRouter);
protectedRouter.use(setupsRouter);
protectedRouter.use(logRouter);
protectedRouter.use(exportRouter);
app.use("/api", protectedRouter);

if (config.isProduction) {
  // Client and API are deployed as one Azure App Service, same origin - serve the built SPA here
  // instead of standing up a second static host, so the session cookie never has to cross origins.
  app.use(express.static(clientDistPath));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(clientDistPath, "index.html"));
  });
}

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});
