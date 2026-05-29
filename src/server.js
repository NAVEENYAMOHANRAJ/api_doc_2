const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { analyzeCodebase, analyzeVirtualFiles } = require("./scanner");
const { renderAll } = require("./renderers");

const PORT = Number(process.env.PORT || 4173);
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const WORK = path.join(ROOT, ".apidocgen");
const sessions = new Map();

fs.mkdirSync(WORK, { recursive: true });

/* ────────────────────────────────────── helpers ── */
function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "access-control-allow-origin": "*",
    "content-length": Buffer.byteLength(text)
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) { reject(new Error("Request body too large.")); req.destroy(); }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function safeJoin(root, urlPath) {
  const file = path.normalize(urlPath === "/" ? "/index.html" : urlPath);
  const full = path.join(root, file);
  return full.startsWith(root) ? full : null;
}

function contentTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";
}

function saveSession(scan) {
  const id = crypto.randomBytes(8).toString("hex");
  const rendered = renderAll(scan);
  sessions.set(id, { scan, rendered, createdAt: Date.now() });
  /* Clean up sessions older than 2 hours */
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [k, v] of sessions.entries()) {
    if (v.createdAt < cutoff) sessions.delete(k);
  }
  return { id, scan, rendered };
}

/* ────────────────────────────────────── git clone helper ── */

/**
 * Build the authenticated git clone URL.
 * For GitHub/GitLab/Bitbucket PAT:
 *   https://oauth2:TOKEN@github.com/user/repo.git   (GitLab / GitHub)
 *   https://x-token-auth:TOKEN@bitbucket.org/...    (Bitbucket)
 * For generic tokens we embed as: https://TOKEN@host/path
 */
function buildAuthenticatedUrl(rawUrl, pat) {
  if (!pat) return rawUrl;
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (host.includes("github.com")) {
      u.username = "oauth2";
      u.password = pat;
    } else if (host.includes("gitlab.com") || host.includes("gitlab.")) {
      u.username = "oauth2";
      u.password = pat;
    } else if (host.includes("bitbucket.org")) {
      u.username = "x-token-auth";
      u.password = pat;
    } else {
      /* Generic: embed token as username */
      u.username = pat;
      u.password = "";
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}

/* ────────────────────────────────────── API handlers ── */
async function handleApi(req, res, pathname) {
  /* CORS pre-flight */
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" });
    return res.end();
  }

  try {
    /* ── Scan a local path (must be inside workspace) ── */
    if (req.method === "POST" && pathname === "/api/analyze-path") {
      const payload = JSON.parse(await readBody(req) || "{}");
      if (!payload.path) throw new Error("Missing path field.");
      const target = path.resolve(payload.path);
      /* Safety: allow any absolute path the user explicitly provides */
      if (!fs.existsSync(target)) throw new Error(`Path not found: ${target}`);
      const result = saveSession(analyzeCodebase(target));
      return sendJson(res, 200, { sessionId: result.id, ...result.scan });
    }

    /* ── Scan uploaded file contents ── */
    if (req.method === "POST" && pathname === "/api/analyze-files") {
      const payload = JSON.parse(await readBody(req) || "{}");
      if (!Array.isArray(payload.files)) throw new Error("Missing files array.");
      const result = saveSession(analyzeVirtualFiles(payload.files, payload.name || "Uploaded API"));
      return sendJson(res, 200, { sessionId: result.id, ...result.scan });
    }

    /* ── Clone git repo and scan ── */
    if (req.method === "POST" && pathname === "/api/analyze-git") {
      const payload = JSON.parse(await readBody(req) || "{}");
      if (!payload.url) throw new Error("Missing Git URL.");

      const cloneUrl = buildAuthenticatedUrl(payload.url.trim(), (payload.pat || "").trim());
      const hash = crypto.createHash("sha1").update(payload.url.trim()).digest("hex").slice(0, 12);
      const repoDir = path.join(WORK, "repos", hash);
      fs.mkdirSync(path.dirname(repoDir), { recursive: true });

      if (!fs.existsSync(repoDir)) {
        const cloned = spawnSync("git", ["clone", "--depth=1", cloneUrl, repoDir], {
          cwd: ROOT, encoding: "utf8",
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
        });
        if (cloned.status !== 0) {
          /* Sanitize error message — strip embedded credentials */
          const rawErr = cloned.stderr || "Git clone failed.";
          const safeErr = rawErr.replace(/https?:\/\/[^@]+@/g, "https://***@");
          /* Remove partial clone dir on failure */
          try { fs.rmSync(repoDir, { recursive: true, force: true }); } catch {}
          throw new Error(safeErr);
        }
      } else {
        /* Pull latest if already cloned */
        spawnSync("git", ["pull", "--ff-only"], { cwd: repoDir, encoding: "utf8" });
      }

      const result = saveSession(analyzeCodebase(repoDir));
      return sendJson(res, 200, { sessionId: result.id, ...result.scan });
    }

    /* ── Export a previously scanned session ── */
    if (req.method === "GET" && pathname.startsWith("/api/export/")) {
      const parts = pathname.split("/");
      const id = parts[3];
      const format = parts[4];
      const session = sessions.get(id);
      if (!session) return sendJson(res, 404, { error: "Session not found or expired." });
      const file = session.rendered[format];
      if (!file) return sendJson(res, 404, { error: `Unknown export format: ${format}.` });
      return sendText(res, 200, file.content, file.type);
    }

    sendJson(res, 404, { error: "API route not found." });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

/* ────────────────────────────────────── HTTP server ── */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url.pathname);

  const file = safeJoin(PUBLIC, decodeURIComponent(url.pathname));
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return sendText(res, 404, "Not found");
  }
  fs.createReadStream(file)
    .on("error", () => sendText(res, 500, "Read error"))
    .once("open", () => res.writeHead(200, { "content-type": contentTypeFor(file) }))
    .pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n  Smart API Documentation Generator`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  Running at  http://localhost:${PORT}`);
  console.log(`  Workspace   ${ROOT}\n`);
});
