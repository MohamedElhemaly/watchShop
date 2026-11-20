// Sodfa (صُدْفَة) - Cloudinary Media Upload Signature & Proxy (Vercel Serverless / Node)
// Supports secure client-side unsigned/signed direct uploads to Cloudinary CDN
// with instant URL generation that bypasses server bandwidth limitations.

import { createHash } from "node:crypto";
import { ensureInitialized, getDb, safeParseJson, authenticateAdmin } from "./_db.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  await ensureInitialized();

  // 1. GET: Return Cloudinary config and/or signed upload signature
  if (req.method === "GET") {
    try {
      const db = getDb();
      const settingsRes = await db.execute("SELECT value_json FROM store_settings WHERE key = 'general' LIMIT 1;");
      const settings = settingsRes.rows[0] ? safeParseJson(settingsRes.rows[0].value_json, {}) : {};

      const cloudName = process.env.CLOUDINARY_CLOUD_NAME || settings.cloudinaryCloudName || "";
      const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || settings.cloudinaryUploadPreset || "";
      const apiKey = process.env.CLOUDINARY_API_KEY || "";
      const apiSecret = process.env.CLOUDINARY_API_SECRET || "";

      // If API secret is present, generate a signed signature for tamper-proof uploads
      if (cloudName && apiKey && apiSecret) {
        const timestamp = Math.round(Date.now() / 1000);
        const folder = "sodfa_watches";
        const stringToSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
        const signature = createHash("sha1").update(stringToSign).digest("hex");

        return res.status(200).json({
          ok: true,
          mode: "signed",
          cloudName,
          apiKey,
          timestamp,
          folder,
          signature,
        });
      }

      // Otherwise return unsigned upload preset configuration
      return res.status(200).json({
        ok: true,
        mode: "unsigned",
        cloudName,
        uploadPreset,
      });
    } catch (err) {
      console.error("GET /api/uploads error:", err);
      return res.status(500).json({ ok: false, error: "فشل استرجاع بيانات الرفع السحابي." });
    }
  }

  // 2. POST: Direct upload proxy fallback (Admin only)
  if (req.method === "POST") {
    const admin = await authenticateAdmin(req);
    if (!admin) {
      return res.status(401).json({ ok: false, error: "غير مصرح لرفع الوسائط." });
    }

    try {
      const { file, folder = "sodfa_watches" } = req.body || {};
      if (!file) {
        return res.status(400).json({ ok: false, error: "الملف مطلوب." });
      }

      const db = getDb();
      const settingsRes = await db.execute("SELECT value_json FROM store_settings WHERE key = 'general' LIMIT 1;");
      const settings = settingsRes.rows[0] ? safeParseJson(settingsRes.rows[0].value_json, {}) : {};

      const cloudName = process.env.CLOUDINARY_CLOUD_NAME || settings.cloudinaryCloudName;
      const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || settings.cloudinaryUploadPreset;

      if (!cloudName) {
        // Return file as-is (e.g. data URL) if no Cloudinary configured
        return res.status(200).json({ ok: true, url: file });
      }

      // Upload to Cloudinary REST API
      const formData = new URLSearchParams();
      formData.append("file", file);
      if (uploadPreset) {
        formData.append("upload_preset", uploadPreset);
      }
      formData.append("folder", folder);

      const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/auto/upload`, {
        method: "POST",
        body: formData,
      });

      if (!cloudRes.ok) {
        const errText = await cloudRes.text();
        return res.status(502).json({ ok: false, error: "فشل الرفع إلى Cloudinary", details: errText });
      }

      const cloudData = await cloudRes.json();
      return res.status(200).json({
        ok: true,
        url: cloudData.secure_url || cloudData.url,
        publicId: cloudData.public_id,
        format: cloudData.format,
      });
    } catch (err) {
      console.error("POST /api/uploads error:", err);
      return res.status(500).json({ ok: false, error: "تعذر إتمام عملية الرفع.", details: err?.message });
    }
  }

  return res.status(405).json({ ok: false, error: "Method not allowed." });
}
