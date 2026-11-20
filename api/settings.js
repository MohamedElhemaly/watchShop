// Sodfa (صُدْفَة) - Store Settings & Categories Endpoint (Vercel Serverless / Node)
// Admin-protected configuration management for Hero, WhatsApp, Delivery Timeframe,
// Ticker Items, Cloudinary, and Notification Channels.

import {
  ensureInitialized,
  getDb,
  authenticateAdmin,
  safeParseJson,
} from "./_db.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  await ensureInitialized();
  const db = getDb();
  const method = req.method;

  // 1. GET: Fetch settings
  if (method === "GET") {
    try {
      const settingsRes = await db.execute("SELECT key, value_json FROM store_settings;");
      const settingsMap = new Map();
      for (const row of settingsRes.rows) {
        settingsMap.set(row.key, safeParseJson(row.value_json, {}));
      }

      const categoriesRes = await db.execute("SELECT * FROM categories ORDER BY sort_order ASC;");
      const categories = categoriesRes.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug || row.id,
        icon: row.icon || "",
        sortOrder: Number(row.sort_order) || 0,
      }));

      return res.status(200).json({
        ok: true,
        settings: settingsMap.get("general") || {},
        tickerItems: settingsMap.get("ticker_items") || [],
        categories,
      });
    } catch (err) {
      console.error("GET /api/settings error:", err);
      return res.status(500).json({ ok: false, error: "فشل استرجاع إعدادات المتجر." });
    }
  }

  // Admin authentication required for PUT / POST mutations
  const admin = await authenticateAdmin(req);
  if (!admin) {
    return res.status(401).json({ ok: false, error: "غير مصرح. يرجى تسجيل الدخول بحساب مسؤول للمتابعة." });
  }

  if (method === "PUT" || method === "POST") {
    try {
      const b = req.body || {};
      const now = new Date().toISOString();

      // A. Update General Settings
      if (b.settings || (!b.categories && !b.tickerItems)) {
        const incoming = b.settings || b;
        const currentRes = await db.execute("SELECT value_json FROM store_settings WHERE key = 'general' LIMIT 1;");
        const current = currentRes.rows[0] ? safeParseJson(currentRes.rows[0].value_json, {}) : {};

        const merged = { ...current, ...incoming };

        await db.execute({
          sql: "INSERT OR REPLACE INTO store_settings (key, value_json, updated_at) VALUES (?, ?, ?);",
          args: ["general", JSON.stringify(merged), now],
        });
      }

      // B. Update Ticker Items if provided
      if (Array.isArray(b.tickerItems)) {
        await db.execute({
          sql: "INSERT OR REPLACE INTO store_settings (key, value_json, updated_at) VALUES (?, ?, ?);",
          args: ["ticker_items", JSON.stringify(b.tickerItems), now],
        });
      }

      // C. Update Categories if provided
      if (Array.isArray(b.categories)) {
        const catStatements = [
          { sql: "DELETE FROM categories;", args: [] },
          ...b.categories.map((c, idx) => ({
            sql: "INSERT OR REPLACE INTO categories (id, name, slug, icon, sort_order) VALUES (?, ?, ?, ?, ?);",
            args: [
              String(c.id || "").trim(),
              String(c.name || "").trim(),
              String(c.slug || c.id || "").trim(),
              String(c.icon || "").trim(),
              idx,
            ],
          })),
        ];
        await db.batch(catStatements);
      }

      // Return updated snapshot
      const finalSettingsRes = await db.execute("SELECT key, value_json FROM store_settings;");
      const settingsMap = new Map();
      for (const row of finalSettingsRes.rows) {
        settingsMap.set(row.key, safeParseJson(row.value_json, {}));
      }

      const finalCatsRes = await db.execute("SELECT * FROM categories ORDER BY sort_order ASC;");
      const categories = finalCatsRes.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug || row.id,
        icon: row.icon || "",
        sortOrder: Number(row.sort_order) || 0,
      }));

      return res.status(200).json({
        ok: true,
        message: "تم حفظ الإعدادات وتحديث المتجر بنجاح.",
        settings: settingsMap.get("general") || {},
        tickerItems: settingsMap.get("ticker_items") || [],
        categories,
      });
    } catch (err) {
      console.error("PUT /api/settings error:", err);
      return res.status(500).json({ ok: false, error: "فشل حفظ إعدادات المتجر.", details: err?.message });
    }
  }

  return res.status(405).json({ ok: false, error: "Method not allowed." });
}
