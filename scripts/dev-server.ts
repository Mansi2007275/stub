/**
 * Runs the WHOLE Stub project on one origin:
 *   /api/*  -> the real api/*.ts handlers (same code Vercel runs), talking to the live Arc contract
 *   /*      -> proxied to the Vite dev server (hot reload); falls back to dist/ if Vite is down
 *
 *   npm run dev:full        (alongside `npm run dev` for hot reload)
 *
 * Vite must be reachable on 127.0.0.1 — see server.host in vite.config.ts.
 */
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.env.PORT || 4178);
const VITE = { host: "127.0.0.1", port: 5173 };

// --- env ------------------------------------------------------------------
// .env.local is read first so its values win, then .env fills the gaps - the same
// precedence Vite applies. Only variable NAMES are ever logged, never values.

/** No default in lib/server/env.ts (PublicEnv + SecretEnv) or api/feed.ts, so the handlers need these. */
const REQUIRED_ENV = [
  "VITE_ESCROW_ADDRESS",
  "VITE_ESCROW_DEPLOY_BLOCK",
  "FULFILLER_PRIVATE_KEY",
  "GEMINI_API_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;

/** Applies `file` without overwriting anything already set: first file to define a key wins. */
function loadEnvFile(file: string): number {
  if (!fs.existsSync(file)) return 0;
  let applied = 0;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = v;
      applied++;
    }
  }
  return applied;
}

const envFiles = [".env.local", ".env"].map((name) => ({ name, applied: loadEnvFile(path.join(ROOT, name)) }));
const used = envFiles.filter((f) => f.applied > 0).map((f) => `${f.name} (${f.applied} vars)`);
console.log(`[dev-server] env loaded from: ${used.length ? used.join(" then ") : "nothing - copy .env.example to .env"}`);

const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length) console.warn(`[dev-server] MISSING required env (names only): ${missingEnv.join(", ")}`);
else console.log(`[dev-server] all ${REQUIRED_ENV.length} required env vars present`);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".json": "application/json", ".woff2": "font/woff2", ".map": "application/json",
};

type Handler = (req: unknown, res: unknown) => Promise<unknown>;
const cache = new Map<string, Handler>();

async function loadHandler(file: string): Promise<Handler | null> {
  if (cache.has(file)) return cache.get(file)!;
  if (!fs.existsSync(file)) return null;
  const mod = (await import(pathToFileURL(file).href)) as { default: Handler };
  cache.set(file, mod.default);
  return mod.default;
}

/** /api/foo/bar -> api/foo/bar.ts, else a trailing [param].ts segment. */
function resolveApi(pathname: string) {
  const segs = pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  if (!segs.length) return null;
  const direct = path.join(ROOT, "api", ...segs) + ".ts";
  if (fs.existsSync(direct)) return { file: direct, params: {} as Record<string, string> };
  const dir = path.join(ROOT, "api", ...segs.slice(0, -1));
  if (fs.existsSync(dir)) {
    const dyn = fs.readdirSync(dir).find((f) => /^\[.+\]\.ts$/.test(f));
    if (dyn) return { file: path.join(dir, dyn), params: { [dyn.slice(1, dyn.indexOf("]"))]: segs.at(-1)! } };
  }
  return null;
}

let viteUp = false;
const checkVite = () =>
  new Promise<boolean>((resolve) => {
    const s = net.connect(VITE.port, VITE.host);
    s.on("connect", () => { s.destroy(); resolve(true); });
    s.on("error", () => resolve(false));
    setTimeout(() => { s.destroy(); resolve(false); }, 700);
  });

const server = http.createServer((rawReq, rawRes) => {
  void (async () => {
    const url = new URL(rawReq.url || "/", `http://localhost:${PORT}`);

    // ---------- API ----------
    if (url.pathname.startsWith("/api/")) {
      const match = resolveApi(url.pathname);
      // Always answer with JSON, even on 404 - the SDK calls res.json() unconditionally.
      if (!match) {
        rawRes.writeHead(404, { "content-type": "application/json" });
        return rawRes.end(JSON.stringify({ error: "not_found", detail: url.pathname }));
      }
      const chunks: Buffer[] = [];
      for await (const c of rawReq) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown;
      if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }

      const query: Record<string, string> = { ...match.params };
      url.searchParams.forEach((v, k) => (query[k] = v));

      const req = Object.assign(rawReq, { query, body, cookies: {} });
      const res = Object.assign(rawRes, {
        status(code: number) { rawRes.statusCode = code; return res; },
        json(payload: unknown) {
          if (!rawRes.headersSent) rawRes.setHeader("content-type", "application/json");
          rawRes.end(JSON.stringify(payload));
          return res;
        },
        send(payload: unknown) {
          if (payload && typeof payload === "object") return res.json(payload);
          if (!rawRes.headersSent) rawRes.setHeader("content-type", "text/plain");
          rawRes.end(String(payload ?? ""));
          return res;
        },
      });

      const started = Date.now();
      try {
        const fn = await loadHandler(match.file);
        await fn!(req, res);
      } catch (e) {
        console.error(`[api] ${url.pathname} threw:`, (e as Error).message.split("\n")[0]);
        if (!rawRes.headersSent) rawRes.writeHead(500, { "content-type": "application/json" });
        if (!rawRes.writableEnded) rawRes.end(JSON.stringify({ error: "internal_error" }));
      }
      // never leave a body-less response: that is what breaks res.json() in the browser
      if (!rawRes.writableEnded) rawRes.end(JSON.stringify({ error: "empty_response" }));
      console.log(`[api] ${rawReq.method} ${url.pathname} -> ${rawRes.statusCode} ${Date.now() - started}ms`);
      return;
    }

    // ---------- frontend: proxy to Vite, else serve dist/ ----------
    if (viteUp) {
      const proxy = http.request(
        { host: VITE.host, port: VITE.port, path: rawReq.url, method: rawReq.method, headers: { ...rawReq.headers, host: `localhost:${VITE.port}` } },
        (pRes) => { rawRes.writeHead(pRes.statusCode || 200, pRes.headers); pRes.pipe(rawRes); },
      );
      proxy.on("error", () => { if (!rawRes.headersSent) { rawRes.writeHead(502); rawRes.end("vite proxy error"); } });
      return rawReq.pipe(proxy);
    }
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
    rawRes.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(rawRes);
  })();
});

// Vite HMR websocket
server.on("upgrade", (req, socket, head) => {
  if (!viteUp) return socket.destroy();
  const up = net.connect(VITE.port, VITE.host, () => {
    up.write(
      `${req.method} ${req.url} HTTP/1.1\r\n` +
        Object.entries(req.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(",") : v}`).join("\r\n") +
        "\r\n\r\n",
    );
    if (head?.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on("error", () => socket.destroy());
});

void checkVite().then((up) => {
  viteUp = up;
  setInterval(() => { void checkVite().then((v) => (viteUp = v)); }, 5000).unref?.();
  server.listen(PORT, () => {
    console.log(`\n  Stub is running:  http://localhost:${PORT}\n`);
    console.log(`   frontend : ${viteUp ? "Vite dev server (hot reload)" : "dist/ build  [run 'npm run dev' for hot reload]"}`);
    console.log(`   backend  : real api/*.ts handlers`);
    console.log(`   contract : StubEscrow ${process.env.VITE_ESCROW_ADDRESS} on Arc Testnet\n`);
  });
});
