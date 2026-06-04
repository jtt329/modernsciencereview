import "./routes/papers";
import { logger } from "./lib/logger";

logger.info({
  processRole: process.env.REVIEW_PROCESS_ROLE || "worker",
  pid: process.pid,
}, "Review worker started");

const keepAlive = setInterval(() => {
  // The DB-backed recovery loop uses unref'ed timers so it cannot keep the web
  // process alive accidentally. A standalone worker should stay alive.
}, 60 * 60 * 1000);

process.on("SIGTERM", () => {
  logger.info("Review worker received SIGTERM");
  clearInterval(keepAlive);
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("Review worker received SIGINT");
  clearInterval(keepAlive);
  process.exit(0);
});
