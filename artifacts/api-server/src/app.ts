import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { loadUser } from "./lib/auth";

const app: Express = express();
// Behind the Vite dev proxy or a hosting proxy: trust its X-Forwarded-* headers for the public address.
app.set("trust proxy", "loopback, linklocal, uniquelocal");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Lesson HTML pasted from Word can be large.
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(loadUser);

app.use("/api", router);

// On a single-server host (cPanel) the built website sits in public/ next to dist/, and this server hands it out.
// Locally that folder doesn't exist and Vite serves the site instead.
const webDir = process.env.WEB_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
if (existsSync(path.join(webDir, "index.html"))) {
  // File names under assets/ contain a content hash, so they can be cached for good.
  app.use("/assets", express.static(path.join(webDir, "assets"), { immutable: true, maxAge: "1y", fallthrough: false }));
  app.use(express.static(webDir, { index: false, maxAge: "1h" }));
  // Every other page address is handled by the website's own router.
  app.get(/^(?!\/api(\/|$)).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(webDir, "index.html"));
  });
  logger.info({ webDir }, "Serving the website");
}

export default app;
