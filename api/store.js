// Sodfa (صُدْفَة) - Public Storefront Data Endpoint (Vercel Serverless / Node)
// Returns real-time products, categories, ticker items, delivery options, and store settings.
// Fully optimized for mobile with Cache-Control: no-store for instant cross-device sync.

import { ensureInitialized, getDb, mapProductRow, safeParseJson } from "./_db.js";

export default async function handler(req, res) {
  // Enforce no-cache headers for instant cross-device consistency
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed. Use GET." });
  }

  try {
    await ensureInitialized();
    const db = getDb();

    // 1. Fetch active products
    const productsRes = await db.execute(
      "SELECT * FROM products WHERE is_active = 1 ORDER BY is_flagship DESC, created_at DESC;"
    );
    const products = productsRes.rows.map(mapProductRow);

    // 2. Fetch categories
    const categoriesRes = await db.execute("SELECT * FROM categories ORDER BY sort_order ASC;");
    const categories = categoriesRes.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug || row.id,
      icon: row.icon || "",
      sortOrder: Number(row.sort_order) || 0,
    }));

    // 3. Fetch store settings & ticker items
    const settingsRes = await db.execute("SELECT key, value_json FROM store_settings;");
    const settingsMap = new Map();
    for (const row of settingsRes.rows) {
      settingsMap.set(row.key, safeParseJson(row.value_json, {}));
    }

    const generalSettings = settingsMap.get("general") || {};
    const tickerItems = settingsMap.get("ticker_items") || [];

    // Compute dynamic delivery timeframe
    const minDays = Number(generalSettings.deliveryMinDays) || 2;
    const maxDays = Math.max(minDays, Number(generalSettings.deliveryMaxDays) || 4);
    const unitText = (generalSettings.deliveryUnitText || "أيام عمل").trim();
    let deliveryFormatted = `خلال ${minDays} إلى ${maxDays} ${unitText}`;
    if (minDays === maxDays) {
      deliveryFormatted = minDays === 1 ? "خلال 1 يوم عمل" : minDays === 2 ? "خلال يومين عمل" : `خلال ${minDays} ${unitText}`;
    }

    // Public sanitized store state
    const responsePayload = {
      ok: true,
      brandName: generalSettings.brandName || "صُدْفَة",
      brandSubtitle: generalSettings.brandSubtitle || "سَاعَةٌ لِكُلِّ لَحْظَةٍ",
      announcement: generalSettings.announcement || "",
      products,
      categories,
      tickerItems,
      settings: generalSettings,
      whatsappNumber: generalSettings.defaultWhatsapp || generalSettings.defaultPhone || "",
      delivery: {
        minDays,
        maxDays,
        unitText,
        formatted: deliveryFormatted,
      },
      heroSettings: {
        headline: generalSettings.heroHeadline || "كل لحظة حلوة\nتستاهل وقتها.",
        description: generalSettings.heroDescription || "ساعات مختارة بعناية فائقة، تجمع بين دقة صناعة الساعات العالمية وجمال الخطوط المعاصرة.",
        videoUrl: generalSettings.heroVideoUrl || "",
        posterUrl: generalSettings.heroPosterUrl || "/sodfa-promo-poster.jpg",
        featuredTag: generalSettings.featuredTag || "القطعة المميزة",
        featuredName: generalSettings.featuredName || "صُدْفَة هيريتدج كرونوغراف",
        featuredSpec: generalSettings.featuredSpec || "",
      },
      serverNow: new Date().toISOString(),
    };

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error("Storefront API error:", error?.message || error);
    return res.status(500).json({
      ok: false,
      error: "تعذر تحميل بيانات المتجر من قاعدة البيانات.",
      details: error?.message || String(error),
    });
  }
}
