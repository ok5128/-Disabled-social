/**
 * 道心 App 后端 — 调用独立 Auth 服务验证用户
 * 所有用户认证由 http://127.0.0.1:5000 处理
 * 本服务只做业务逻辑：聊天、上传、动态、设置
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const root = __dirname;

/* ───── Environment ───── */
for (const envFile of [".env.local", ".env"]) {
  const envPath = path.join(root, envFile);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

const port = Number(process.env.PORT || 4188);
const host = process.env.HOST || "0.0.0.0";
const authBaseUrl = (process.env.AUTH_BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const authAppKey = process.env.AUTH_APP_KEY || process.env.UNIFIED_AUTH_APP_KEY || "";
const arkApiKey = process.env.ARK_API_KEY || process.env.DOUBAO_API_KEY || "";
const arkBaseUrl = (process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "");
const arkModel = process.env.ARK_MODEL || "doubao-seed-2-0-pro-260215";
const uploadDir = path.join(root, "uploads");

/* ───── Database ───── */
const dataDir = path.join(root, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "daoxin.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
const schemaPath = path.join(root, "schema.sql");
if (fs.existsSync(schemaPath)) db.exec(fs.readFileSync(schemaPath, "utf8"));

/* ───── Helpers ───── */
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; if (body.length > 25 * 1024 * 1024) { req.destroy(); reject(new Error("Payload too large")); } });
    req.on("end", () => { if (!body) return resolve({}); try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
  });
}

function genId() { return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`; }

function safeUploadName(name, contentType) {
  const extFromName = path.extname(String(name || "")).toLowerCase();
  const extFromType = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "video/mp4": ".mp4", "video/webm": ".webm", "audio/webm": ".webm", "audio/wav": ".wav", "audio/mp4": ".m4a" }[contentType];
  const ext = extFromName.match(/^\.[a-z0-9]{1,8}$/) ? extFromName : extFromType || ".bin";
  return `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
}

/* ───── Auth: call the standalone auth service to verify tokens ───── */
async function resolveUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  try {
    const headers = { "Content-Type": "application/json" };
    if (authAppKey) headers["X-App-Key"] = authAppKey;
    const response = await fetch(`${authBaseUrl}/api/token/verify`, {
      method: "POST", headers, body: JSON.stringify({ token }),
    });
    if (!response.ok) return null;
    const result = await response.json();
    if (!result.valid || !result.user_id) return null;
    return { user_id: String(result.user_id), display_name: result.display_name || "" };
  } catch (error) {
    console.error("Auth service error:", error.message);
    return null;
  }
}

function requireUser(req, res) {
  // We resolve async, so this returns a promise
  return resolveUser(req).then(user => {
    if (!user) { sendJson(res, 401, { error: "invalid_token" }); return null; }
    return user;
  });
}

/* ───── AI Chat ───── */
async function callArkChat({ message, spiritName, language }) {
  if (!arkApiKey) return { content: language === "en" ? "Doubao is not configured yet." : "豆包 API key 还没有配置。", configured: false };
  const response = await fetch(`${arkBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${arkApiKey}` },
    body: JSON.stringify({
      model: arkModel,
      messages: [
        { role: "system", content: `你是"道心"里的${spiritName || "灵魂体"}，回答要温和、简洁、有启发。用户使用${language === "en" ? "English" : "中文"}时，用同一种语言回答。` },
        { role: "user", content: message },
      ],
      max_completion_tokens: 600,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Ark API failed: ${response.status} ${result.error?.message || ""}`);
  return { content: result.choices?.[0]?.message?.content || "", configured: true, usage: result.usage || null };
}

/* ───── MIME ───── */
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8", ".png": "image/png", ".jpeg": "image/jpeg", ".jpg": "image/jpeg",
  ".mp4": "video/mp4", ".webm": "audio/webm", ".wav": "audio/wav", ".m4a": "audio/mp4",
};

/* ───── API Handler ───── */
async function handleApi(req, res, url) {

  /* Health */
  if (url.pathname === "/api/health" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, ark_configured: Boolean(arkApiKey), ark_model: arkModel, auth_base_url: authBaseUrl, auth_mode: "remote-auth-service" });
  }

  /* ── Chat (no auth required, but saves if authenticated) ── */
  if (url.pathname === "/api/chat" && req.method === "POST") {
    const body = await readJson(req);
    const message = String(body.message || "").trim();
    if (!message) return sendJson(res, 400, { error: "message_required" });
    const reply = await callArkChat({ message, spiritName: String(body.spirit_name || ""), language: String(body.language || "zh") });
    // Save to DB if authenticated
    const user = await resolveUser(req);
    if (user && reply.content) {
      const threadId = String(body.thread_id || genId());
      db.prepare("INSERT OR IGNORE INTO chat_threads (id, user_id, spirit_id) VALUES (?, ?, ?)").run(threadId, user.user_id, String(body.spirit_id || ""));
      db.prepare("INSERT INTO chat_messages (id, thread_id, user_id, spirit_id, role, content) VALUES (?, ?, ?, ?, 'user', ?)").run(genId(), threadId, user.user_id, String(body.spirit_id || ""), message);
      db.prepare("INSERT INTO chat_messages (id, thread_id, user_id, spirit_id, role, content) VALUES (?, ?, ?, ?, 'assistant', ?)").run(genId(), threadId, user.user_id, String(body.spirit_id || ""), reply.content);
    }
    return sendJson(res, 200, reply);
  }

  /* ── Uploads (no auth) ── */
  if (url.pathname === "/api/uploads" && req.method === "POST") {
    const body = await readJson(req);
    const contentType = String(body.type || "application/octet-stream");
    const data = String(body.data || "").replace(/^data:[^;]+;base64,/, "");
    if (!data) return sendJson(res, 400, { error: "file_required" });
    const buffer = Buffer.from(data, "base64");
    if (!buffer.length || buffer.length > 20 * 1024 * 1024) return sendJson(res, 400, { error: "invalid_file_size" });
    fs.mkdirSync(uploadDir, { recursive: true });
    const fileName = safeUploadName(body.name, contentType);
    fs.writeFileSync(path.join(uploadDir, fileName), buffer);
    return sendJson(res, 201, { type: contentType.startsWith("video") ? "video" : contentType.startsWith("audio") ? "audio" : "image", src: `/uploads/${fileName}`, title: String(body.name || fileName), content_type: contentType, size: buffer.length });
  }

  /* ── Authenticated endpoints ── */
  const user = await requireUser(req, res); if (!user) return;

  // Threads
  if (url.pathname === "/api/threads" && req.method === "GET") {
    return sendJson(res, 200, { items: db.prepare("SELECT * FROM chat_threads WHERE user_id = ? ORDER BY updated_at DESC").all(user.user_id) });
  }
  const threadMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/messages$/);
  if (threadMatch && req.method === "GET") {
    return sendJson(res, 200, { items: db.prepare("SELECT * FROM chat_messages WHERE thread_id = ? AND user_id = ? ORDER BY created_at ASC").all(threadMatch[1], user.user_id) });
  }

  // Messages
  if (url.pathname === "/api/messages" && req.method === "GET") {
    return sendJson(res, 200, { items: db.prepare("SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 200").all(user.user_id) });
  }

  // Settings
  if (url.pathname === "/api/settings" && req.method === "GET") {
    const row = db.prepare("SELECT * FROM user_settings WHERE user_id = ?").get(user.user_id);
    return sendJson(res, 200, row || { user_id: user.user_id, language: "zh", soul_status: "blind", profile_json: "{}" });
  }
  if (url.pathname === "/api/settings" && req.method === "PUT") {
    const body = await readJson(req);
    const lang = String(body.language || "zh"), status = String(body.soul_status || "blind"), pj = JSON.stringify(body.profile || {});
    db.prepare("INSERT INTO user_settings (user_id, language, soul_status, profile_json) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET language=?, soul_status=?, profile_json=?, updated_at=datetime('now')")
      .run(user.user_id, lang, status, pj, lang, status, pj);
    return sendJson(res, 200, { ok: true });
  }

  // Dynamics
  if (url.pathname === "/api/dynamics" && req.method === "GET") {
    return sendJson(res, 200, { items: db.prepare("SELECT * FROM soul_dynamics WHERE user_id = ? ORDER BY created_at DESC LIMIT 20").all(user.user_id) });
  }
  if (url.pathname === "/api/dynamics" && req.method === "POST") {
    const body = await readJson(req);
    const id = genId();
    db.prepare("INSERT INTO soul_dynamics (id, user_id, media_type, media_url, title, note) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, user.user_id, String(body.media_type || "image"), String(body.media_url || ""), String(body.title || ""), String(body.note || ""));
    return sendJson(res, 201, { id, ok: true });
  }

  // Proxy: recent users from auth service
  if (url.pathname === "/api/users/recent" && req.method === "GET") {
    try {
      const headers = {};
      if (authAppKey) headers["X-App-Key"] = authAppKey;
      const authHeader = req.headers.authorization;
      if (authHeader) headers["Authorization"] = authHeader;
      const r = await fetch(`${authBaseUrl}/api/users/recent?limit=${url.searchParams.get("limit") || 20}&offset=${url.searchParams.get("offset") || 0}`, { headers });
      const data = await r.json();
      return sendJson(res, r.status, data);
    } catch (e) { return sendJson(res, 503, { error: "auth_service_unavailable" }); }
  }

  // Proxy: public user profile from auth service
  const profileMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (profileMatch && req.method === "GET") {
    try {
      const headers = {};
      if (authAppKey) headers["X-App-Key"] = authAppKey;
      const authHeader = req.headers.authorization;
      if (authHeader) headers["Authorization"] = authHeader;
      const r = await fetch(`${authBaseUrl}/api/users/${profileMatch[1]}`, { headers });
      const data = await r.json();
      return sendJson(res, r.status, data);
    } catch (e) { return sendJson(res, 503, { error: "auth_service_unavailable" }); }
  }

  sendJson(res, 404, { error: "not_found" });
}

/* ───── Static ───── */
function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const filePath = path.resolve(root, pathname);
  if (!filePath.startsWith(root)) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.readFile(filePath, (error, data) => {
    if (error) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

/* ───── Server ───── */
http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch((error) => sendJson(res, 500, { error: "server_error", message: error.message }));
    return;
  }
  serveStatic(req, res, url);
}).listen(port, host, () => {
  console.log(`Daoxin app server listening at http://${host}:${port}`);
});
