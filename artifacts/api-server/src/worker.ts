import "./routes/papers";
import { logger } from "./lib/logger";
import { installProcessSafetyNets } from "./lib/processSafety";

// A poison job that throws asynchronously must not silently kill the worker
// without a logged reason. An unhandled rejection is logged and survived; an
// uncaughtException exits cleanly so the platform restarts the worker.
// Auto-retry is off, so an interrupted in-flight job lands in manual retry
// rather than crash-looping.
installProcessSafetyNets("worker");

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
