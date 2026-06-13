import { logger } from "./logger";

// Process-level safety nets. The non-negotiable guarantee is that no single
// request/job can silently kill the process in a way that leaves the
// service dead with no diagnosis.
//
// - unhandledRejection: log and keep running. Installing a handler also
//   suppresses Node's default "crash on unhandled rejection" behavior, so a
//   stray rejection (e.g. an un-awaited helper deep in the pipeline) degrades
//   into a logged event instead of a downed service.
// - uncaughtException: log and exit cleanly. Per Node's own guidance,
//   resuming after an uncaughtException risks operating on corrupted state;
//   the right move is to fail fast and let the platform restart the process,
//   not to soldier on. `onFatal` lets the caller stop accepting new work
//   (e.g. close the HTTP server) before exit.
export function installProcessSafetyNets(role: "web" | "worker", onFatal?: () => void) {
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason, role }, "Unhandled promise rejection (kept alive)");
  });

  let exiting = false;
  const fatal = (err: unknown, kind: string) => {
    if (exiting) return;
    exiting = true;
    logger.error({ err, role, kind }, "Fatal error; exiting cleanly for platform restart");
    try {
      onFatal?.();
    } catch (cleanupErr) {
      logger.error({ err: cleanupErr, role }, "Error during fatal cleanup");
    }
    // Give logs a moment to flush, then exit non-zero so Railway restarts.
    setTimeout(() => process.exit(1), 250).unref?.();
  };

  process.on("uncaughtException", (err) => fatal(err, "uncaughtException"));
}
