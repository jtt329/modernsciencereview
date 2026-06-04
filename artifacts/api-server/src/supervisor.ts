import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./lib/logger";

const distDir = path.dirname(fileURLToPath(import.meta.url));
const nodeArgs = ["--enable-source-maps"];
let shuttingDown = false;
let workerRestartCount = 0;
let webProcess: ChildProcess | null = null;
let workerProcess: ChildProcess | null = null;

function childEnv(role: "web" | "worker") {
  return {
    ...process.env,
    REVIEW_PROCESS_ROLE: role,
    REVIEW_JOB_PROCESSING_ENABLED: role === "worker" ? "true" : "false",
  };
}

function spawnChild(role: "web" | "worker", entry: string) {
  const child = spawn(process.execPath, [...nodeArgs, path.join(distDir, entry)], {
    env: childEnv(role),
    stdio: "inherit",
  });
  logger.info({ role, pid: child.pid, entry }, "Started child process");
  return child;
}

function startWeb() {
  webProcess = spawnChild("web", "index.mjs");
  webProcess.on("exit", (code, signal) => {
    logger.error({ code, signal }, "Web process exited; supervisor will exit so Railway restarts the service");
    if (!shuttingDown) shutdown(code ?? 1);
  });
}

function startWorker() {
  workerProcess = spawnChild("worker", "worker.mjs");
  workerProcess.on("exit", (code, signal) => {
    if (shuttingDown) return;
    workerRestartCount += 1;
    const delayMs = Math.min(60_000, 1_000 * 2 ** Math.min(workerRestartCount, 6));
    logger.error({ code, signal, workerRestartCount, delayMs }, "Review worker exited; restarting worker without taking down web");
    setTimeout(() => {
      if (!shuttingDown) startWorker();
    }, delayMs).unref?.();
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  workerProcess?.kill("SIGTERM");
  webProcess?.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 2_000).unref?.();
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

logger.info({ pid: process.pid }, "Starting API supervisor");
startWeb();
startWorker();
