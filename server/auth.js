import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { jwtVerify } from "jose";
import { getPool } from "./db.js";

const APP_SESSION_COOKIE = "webdev_app_session";
const OAUTH_NONCE_COOKIE = "sodfa_oauth_nonce";
const PREVIEW_LOGOUT_COOKIE = "sodfa_admin_logged_out";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;
const PREVIEW_LOGOUT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cookieValue(request, name) {
  const source = request.headers.cookie || "";
  for (const part of source.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return "";
      }
    }
  }
  return "";
}

function sameSite(secure) {
  return secure ? "None" : "Lax";
}

function setCookie(response, name, value, { secure, path = "/", maxAge }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, "HttpOnly", `SameSite=${sameSite(secure)}`];
  if (secure) parts.push("Secure");
  if (Number.isFinite(maxAge)) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  response.append("Set-Cookie", parts.join("; "));
}

function clearCookie(response, name, { secure, path = "/" }) {
  setCookie(response, name, "", { secure, path, maxAge: 0 });
}

function validOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return ["https:", "http:"].includes(parsed.protocol)
      && !parsed.username && !parsed.password
      && parsed.pathname === "/" && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

function adminEmail() {
  return String(process.env.SODFA_ADMIN_EMAIL || "").trim().toLowerCase();
}

function redirectToAdmin(response, redirectUri, query = "") {
  const callback = new URL(redirectUri);
  const target = new URL("/admin", callback.origin);
  if (query) target.searchParams.set("login", query);
  response.redirect(303, target.toString());
}

export async function beginLogin(request, response) {
  if (!adminEmail()) {
    return response.status(503).json({ error: "لم يكتمل إعداد حساب المالك بعد." });
  }

  const origin = String(request.body?.origin || "");
  const browserOrigin = String(request.get("origin") || "");
  if (!origin || origin !== browserOrigin || !validOrigin(origin)) {
    return response.status(400).json({ error: "تعذر التحقق من عنوان الموقع. أعد تحميل الصفحة وحاول مجددًا." });
  }
  if (!process.env.MANUS_PROJECT_ID || !process.env.MANUS_OAUTH_PORTAL_URL) {
    return response.status(503).json({ error: "تسجيل الدخول غير مهيأ لهذا الموقع بعد." });
  }

  const secure = new URL(origin).protocol === "https:";
  const redirectUri = new URL("/api/auth/callback", origin).toString();
  const nonce = randomBytes(32).toString("base64url");
  const state = Buffer.from(JSON.stringify({ redirectUri, nonce }), "utf8").toString("base64");
  const expiresAt = new Date(Date.now() + OAUTH_STATE_MAX_AGE_SECONDS * 1000);
  const pool = getPool();

  await pool.execute("DELETE FROM sodfa_oauth_states WHERE expires_at <= UTC_TIMESTAMP(3)");
  await pool.execute(
    "INSERT INTO sodfa_oauth_states (state_hash, nonce_hash, redirect_uri, secure_cookie, expires_at) VALUES (?, ?, ?, ?, ?)",
    [hash(state), hash(nonce), redirectUri, secure, expiresAt],
  );
  setCookie(response, OAUTH_NONCE_COOKIE, nonce, {
    secure,
    path: "/api/auth/callback",
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });

  const authorizationUrl = new URL(`${process.env.MANUS_OAUTH_PORTAL_URL.replace(/\/+$/, "")}/app-auth`);
  authorizationUrl.searchParams.set("appId", process.env.MANUS_PROJECT_ID);
  authorizationUrl.searchParams.set("redirectUri", redirectUri);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("responseType", "code");
  return response.json({ authorizationUrl: authorizationUrl.toString() });
}

async function exchangeCode(code, redirectUri) {
  const base = process.env.MANUS_OAUTH_API_URL;
  if (!base || !process.env.MANUS_PROJECT_ID) throw new Error("OAuth is not configured.");
  const tokenResponse = await fetch(`${base.replace(/\/+$/, "")}/webdev.v1.WebDevAuthPublicService/ExchangeToken`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      clientId: process.env.MANUS_PROJECT_ID,
      grantType: "authorization_code",
      code,
      redirectUri,
    }),
  });
  const tokens = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokens.accessToken) throw new Error("OAuth token exchange failed.");

  const infoResponse = await fetch(`${base.replace(/\/+$/, "")}/webdev.v1.WebDevAuthPublicService/GetUserInfo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ accessToken: tokens.accessToken }),
  });
  const user = await infoResponse.json().catch(() => ({}));
  if (!infoResponse.ok || !user.openId || !user.email) throw new Error("OAuth identity lookup failed.");
  return user;
}

function parseState(state) {
  try {
    const value = JSON.parse(Buffer.from(state, "base64").toString("utf8"));
    if (typeof value.redirectUri !== "string" || typeof value.nonce !== "string") return null;
    const callback = new URL(value.redirectUri);
    if (!validOrigin(`${callback.origin}/`) || callback.pathname !== "/api/auth/callback") return null;
    return { redirectUri: value.redirectUri, nonce: value.nonce };
  } catch {
    return null;
  }
}

export async function finishLogin(request, response) {
  const state = String(request.query.state || "");
  const parsed = parseState(state);
  if (!parsed) return response.status(400).send("تعذر التحقق من طلب تسجيل الدخول. أغلق الصفحة وحاول من جديد.");

  const nonceCookie = cookieValue(request, OAUTH_NONCE_COOKIE);
  const [rows] = await getPool().execute(
    "SELECT nonce_hash, redirect_uri, secure_cookie FROM sodfa_oauth_states WHERE state_hash = ? AND expires_at > UTC_TIMESTAMP(3) LIMIT 1",
    [hash(state)],
  );
  const stateRow = rows[0];
  const nonceValid = Boolean(stateRow && nonceCookie && hash(nonceCookie) === stateRow.nonce_hash);
  const redirectValid = Boolean(stateRow && stateRow.redirect_uri === parsed.redirectUri);
  if (!nonceValid || !redirectValid) {
    clearCookie(response, OAUTH_NONCE_COOKIE, { secure: new URL(parsed.redirectUri).protocol === "https:", path: "/api/auth/callback" });
    return redirectToAdmin(response, parsed.redirectUri, "failed");
  }

  await getPool().execute("DELETE FROM sodfa_oauth_states WHERE state_hash = ?", [hash(state)]);
  clearCookie(response, OAUTH_NONCE_COOKIE, { secure: Boolean(stateRow.secure_cookie), path: "/api/auth/callback" });

  if (request.query.error || !request.query.code || !adminEmail()) {
    return redirectToAdmin(response, parsed.redirectUri, "failed");
  }

  try {
    const user = await exchangeCode(String(request.query.code), parsed.redirectUri);
    const normalizedEmail = String(user.email).trim().toLowerCase();
    if (normalizedEmail !== adminEmail()) return redirectToAdmin(response, parsed.redirectUri, "unauthorized");

    const pool = getPool();
    await pool.execute(
      "INSERT INTO sodfa_admin_accounts (open_id, email) VALUES (?, ?) ON DUPLICATE KEY UPDATE email = VALUES(email), updated_at = CURRENT_TIMESTAMP(3)",
      [String(user.openId), normalizedEmail],
    );

    const sessionToken = randomBytes(32).toString("base64url");
    const csrfToken = createHmac("sha256", sessionToken).update("sodfa-csrf").digest("base64url");
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
    await pool.execute(
      "INSERT INTO sodfa_admin_sessions (token_hash, open_id, csrf_hash, secure_cookie, expires_at) VALUES (?, ?, ?, ?, ?)",
      [hash(sessionToken), String(user.openId), hash(csrfToken), Boolean(stateRow.secure_cookie), expiresAt],
    );

    setCookie(response, APP_SESSION_COOKIE, sessionToken, {
      secure: Boolean(stateRow.secure_cookie),
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    clearCookie(response, PREVIEW_LOGOUT_COOKIE, { secure: Boolean(stateRow.secure_cookie), path: "/" });
    return redirectToAdmin(response, parsed.redirectUri, "ok");
  } catch (error) {
    console.error("Manus OAuth login failed:", error?.message || "unknown error");
    return redirectToAdmin(response, parsed.redirectUri, "failed");
  }
}

async function authenticate(request) {
  const token = cookieValue(request, APP_SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = hash(token);
  const pool = getPool();
  const [sessions] = await pool.execute(
    `SELECT a.open_id, a.email, s.csrf_hash, s.secure_cookie,
       (s.expires_at > UTC_TIMESTAMP(3)) AS is_active
     FROM sodfa_admin_sessions s
     LEFT JOIN sodfa_admin_accounts a ON a.open_id = s.open_id
     WHERE s.token_hash = ?
     LIMIT 1`,
    [tokenHash],
  );
  if (sessions[0]?.is_active && sessions[0].open_id && sessions[0].email) {
    if (String(sessions[0].email).trim().toLowerCase() !== adminEmail()) return null;
    const csrfToken = createHmac("sha256", token).update("sodfa-csrf").digest("base64url");
    if (hash(csrfToken) !== sessions[0].csrf_hash) return null;
    return {
      openId: sessions[0].open_id,
      email: sessions[0].email,
      csrfToken,
      secureCookie: Boolean(sessions[0].secure_cookie),
      sessionHash: tokenHash,
      platformToken: false,
    };
  }

  const secret = process.env.MANUS_JWT_SECRET;
  if (!secret || !process.env.MANUS_PROJECT_ID) return null;
  try {
    const { payload, protectedHeader } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
    });
    if (protectedHeader.alg !== "HS256" || payload.appId !== process.env.MANUS_PROJECT_ID || !payload.openId
      || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    const [admins] = await pool.execute("SELECT open_id, email FROM sodfa_admin_accounts WHERE open_id = ? LIMIT 1", [String(payload.openId)]);
    if (!admins[0] || String(admins[0].email).trim().toLowerCase() !== adminEmail()) return null;
    if (cookieValue(request, PREVIEW_LOGOUT_COOKIE) === "1") return null;
    const csrfToken = createHmac("sha256", secret).update(`sodfa-csrf:${token}`).digest("base64url");
    return {
      openId: admins[0].open_id,
      email: admins[0].email,
      csrfToken,
      secureCookie: true,
    };
  } catch {
    return null;
  }
}

export async function requireAdmin(request, response, next) {
  try {
    const admin = await authenticate(request);
    if (!admin) return response.status(401).json({ error: "سجّل الدخول بحساب المالك للوصول إلى إدارة المتجر." });
    request.admin = admin;
    return next();
  } catch (error) {
    console.error("Admin session lookup failed:", error?.message || "unknown error");
    return response.status(503).json({ error: "تعذر التحقق من جلسة الأدمن الآن. حاول مجددًا." });
  }
}

export function requireCsrf(request, response, next) {
  const supplied = String(request.get("x-csrf-token") || "");
  const expected = request.admin?.csrfToken || "";
  const valid = safeCsrfEqual(supplied, expected);
  if (!valid) return response.status(403).json({ error: "انتهت صلاحية الجلسة. أعد تحميل لوحة الإدارة." });
  return next();
}

export async function getAdminStatus(request, response) {
  try {
    const admin = await authenticate(request);
    if (!admin) return response.json({ authenticated: false });
    return response.json({ authenticated: true, user: { email: admin.email }, csrfToken: admin.csrfToken });
  } catch (error) {
    console.error("Admin status lookup failed:", error?.message || "unknown error");
    return response.status(503).json({ authenticated: false, error: "تعذر التحقق من الجلسة الآن." });
  }
}

export async function logout(request, response) {
  const token = cookieValue(request, APP_SESSION_COOKIE);
  if (token) {
    await getPool().execute("DELETE FROM sodfa_admin_sessions WHERE token_hash = ?", [hash(token)]);
  }
  clearCookie(response, APP_SESSION_COOKIE, { secure: Boolean(request.admin?.secureCookie), path: "/" });
  setCookie(response, PREVIEW_LOGOUT_COOKIE, "1", {
    secure: Boolean(request.admin?.secureCookie),
    path: "/",
    maxAge: PREVIEW_LOGOUT_MAX_AGE_SECONDS,
  });
  return response.json({ ok: true });
}

export function safeCsrfEqual(left, right) {
  const first = Buffer.from(String(left || ""));
  const second = Buffer.from(String(right || ""));
  return first.length === second.length && first.length > 0 && timingSafeEqual(first, second);
}
