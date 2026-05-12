import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const here = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(here, "dist", "public");
const indexPath = join(publicDir, "index.html");
const apiProxyTarget = process.env.API_PROXY_TARGET;
const port = Number(process.env.PORT ?? 4173);

const serviceWorkerCleanup = `
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    if (self.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    await self.clients.claim();
    await self.registration.unregister();
    const clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    for (const client of clients) {
      client.navigate(client.url);
    }
  })());
});
`.trimStart();

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

function getStaticPath(url) {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const normalized = normalize(pathname).replace(/^([/\\])+/, "");
  const candidate = join(publicDir, normalized || "index.html");
  if (!candidate.startsWith(publicDir)) return null;
  return candidate;
}

function shouldServeAppShell(req) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (extname(pathname)) return false;
  const accept = req.headers.accept ?? "";
  return accept.includes("text/html") || accept.includes("*/*");
}

function serveServiceWorkerCleanup(req, res) {
  res.writeHead(200, {
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
    "service-worker-allowed": "/",
    "content-length": Buffer.byteLength(serviceWorkerCleanup),
  });
  res.end(req.method === "HEAD" ? undefined : serviceWorkerCleanup);
}

async function serveStatic(req, res) {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (pathname === "/sw.js" || pathname === "/service-worker.js") {
    serveServiceWorkerCleanup(req, res);
    return;
  }

  const requestedPath = getStaticPath(req.url ?? "/");
  if (!requestedPath) {
    send(res, 403, "Forbidden");
    return;
  }

  let filePath = requestedPath;
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) filePath = join(filePath, "index.html");
  } catch {
    if (!shouldServeAppShell(req)) {
      send(res, 404, "Not Found", {
        "content-type": "text/plain; charset=utf-8",
      });
      return;
    }
    filePath = indexPath;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    const contentType = mimeTypes.get(extname(filePath)) ?? "application/octet-stream";
    res.writeHead(200, {
      "content-type": contentType,
      "content-length": fileStat.size,
      "cache-control": filePath === indexPath ? "no-cache" : "public, max-age=31536000, immutable",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  } catch {
    const index = await readFile(indexPath);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": index.length,
      "cache-control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : index);
  }
}

function copyProxyHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (["connection", "host", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"].includes(lower)) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }

  headers.set("x-forwarded-host", req.headers.host ?? "");
  headers.set("x-forwarded-proto", "https");
  return headers;
}

async function proxyApi(req, res) {
  if (!apiProxyTarget) {
    send(res, 502, JSON.stringify({ error: "API_PROXY_TARGET is not configured" }), {
      "content-type": "application/json; charset=utf-8",
    });
    return;
  }

  const target = new URL(req.url ?? "/", apiProxyTarget);
  const upstream = await fetch(target, {
    method: req.method,
    headers: copyProxyHeaders(req),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : Readable.toWeb(req),
    redirect: "manual",
    duplex: "half",
  });

  res.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    if (["content-encoding", "content-length", "connection", "transfer-encoding", "set-cookie"].includes(key.toLowerCase())) return;
    res.setHeader(key, value);
  });

  const setCookies = typeof upstream.headers.getSetCookie === "function" ? upstream.headers.getSetCookie() : [];
  if (setCookies.length) {
    res.setHeader("set-cookie", setCookies);
  } else {
    const cookie = upstream.headers.get("set-cookie");
    if (cookie) res.setHeader("set-cookie", cookie);
  }

  if (req.method === "HEAD" || !upstream.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstream.body).pipe(res);
}

const server = createServer((req, res) => {
  Promise.resolve()
    .then(() => {
      if (req.url?.startsWith("/api/")) return proxyApi(req, res);
      return serveStatic(req, res);
    })
    .catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, "Internal Server Error");
      else res.end();
    });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`SciReview web server listening on ${port}`);
});
