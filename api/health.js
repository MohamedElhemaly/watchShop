// Sodfa (صُدْفَة) - Cloud DB Health Diagnostic Endpoint (Vercel Serverless / Node)
// Checks Turso credentials, executes lightweight SELECT 1, and reports actionable diagnostics.

import { createClient as createWebClient } from "@libsql/client/web";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const rawUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  // 1. Check if Turso environment variables are configured in Vercel
  if (!rawUrl || !authToken) {
    return res.status(200).json({
      ok: false,
      connected: false,
      reason: "MISSING_ENV_VARS",
      error: "متغيرات البيئة TURSO_DATABASE_URL أو TURSO_AUTH_TOKEN غير مضافة في إعدادات Vercel.",
      details: `TURSO_DATABASE_URL: ${rawUrl ? "موجود" : "مفقود"} | TURSO_AUTH_TOKEN: ${authToken ? "موجود" : "مفقود"}`,
      solution: "يرجى إضافة متغيرات TURSO_DATABASE_URL و TURSO_AUTH_TOKEN في لوحة تحكم مشروعك على Vercel (Project Settings -> Environment Variables) ثم إعادة النشر (Redeploy).",
    });
  }

  // 2. Perform lightweight SELECT 1 test query using pure Web HTTP API (zero native binary crashes)
  try {
    const webUrl = rawUrl.replace(/^libsql:\/\//, "https://");
    const client = createWebClient({
      url: webUrl,
      authToken,
    });

    const start = Date.now();
    await client.execute("SELECT 1 as health_check;");
    const latencyMs = Date.now() - start;

    return res.status(200).json({
      ok: true,
      connected: true,
      reason: "CONNECTED",
      latencyMs,
      database: webUrl.replace(/^https:\/\//, ""),
      provider: "Turso LibSQL Cloud (Pure Web API)",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Health check DB error:", err);
    const msg = String(err?.message || err);
    let reason = "DB_ERROR";
    let errorArabic = `فشل الاتصال بقاعدة بيانات Turso السحابية: ${msg}`;

    if (msg.includes("401") || msg.includes("UNAUTHORIZED") || msg.includes("auth") || msg.includes("token")) {
      reason = "AUTH_FAILED";
      errorArabic = "فشل المصادقة مع Turso: رمز المصادقة TURSO_AUTH_TOKEN غير صحيح أو منتهي الصلاحية.";
    } else if (msg.includes("ENOTFOUND") || msg.includes("Connect Timeout") || msg.includes("fetch failed") || msg.includes("UND_ERR_CONNECT_TIMEOUT")) {
      reason = "DB_ERROR";
      errorArabic = `تعذر الوصول إلى مضيف قاعدة البيانات (${rawUrl}). يرجى التحقق من صحة رابط TURSO_DATABASE_URL.`;
    }

    return res.status(200).json({
      ok: false,
      connected: false,
      reason,
      error: errorArabic,
      details: msg,
      solution: "تأكد من إنشاء قاعدة بيانات Turso وتوليد Token صالح عبر الأمر: turso db tokens create sodfa-db ثم إضافته في Vercel.",
    });
  }
}
