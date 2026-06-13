import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { authMiddleware } from "./middlewares/authMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

// JSON body limit. Bodies above this are rejected by express.json with a
// PayloadTooLargeError, which the error middleware below maps to a clean
// 413 — the parser stops reading instead of buffering an oversized payload.
// Sized for the largest legitimate benchmark PDF (Brown-York ~2.4 MB →
// ~3.3 MB base64) with generous headroom.
const JSON_BODY_LIMIT = process.env.MAX_UPLOAD_BODY || "32mb";

const app: Express = express();

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
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
app.use(authMiddleware);

app.use("/api", router);

// Terminal error-handling middleware (4-arg). Any synchronous throw or
// awaited rejection that escapes a route handler lands here and becomes a
// structured HTTP response, so a single bad request can never leave the
// socket hanging or surface as a dead-upstream 502. Oversized bodies from
// express.json arrive here as PayloadTooLargeError → 413.
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const status =
    err?.type === "entity.too.large" || err?.statusCode === 413 || err?.status === 413
      ? 413
      : typeof err?.statusCode === "number"
        ? err.statusCode
        : typeof err?.status === "number"
          ? err.status
          : 500;
  logger.error({ err, status, url: req.url?.split("?")[0], method: req.method }, "Request failed in error middleware");
  if (res.headersSent) return;
  if (status === 413) {
    res.status(413).json({
      error: "Upload too large. The submission exceeds the maximum accepted size.",
      code: "upload_too_large",
    });
    return;
  }
  res.status(status).json({ error: err?.message || "Internal server error" });
});

export default app;
