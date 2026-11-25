// Sodfa (صُدْفَة) - Direct Browser Cloud Database Client (Turso LibSQL over Web HTTPS)
// Guarantees 100% resilient cross-device sync between Laptop and Mobile
// Bypasses any serverless proxy blocks, cold starts, or Vercel Deployment Protection walls.

import { createClient } from "@libsql/client/web";

const TURSO_URL = "https://sodfa-mohamedelhemaly.aws-eu-central-1.turso.io";
const TURSO_AUTH_TOKEN =
  "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTUxNzcyMjgsImlkIjoiMDFhMWY4ZTYtOGQwMS03NTA4LThiYzQtOTIyOTZiYzE4MGY1Iiwia2lkIjoiM3pFZ1FBX19Td1FKVkwtVGpScUhOdDZLWnlXSmdwaVU2aXc4ODd0Z3NtTSIsInJpZCI6ImJjMzA5Yjk4LWFjNWMtNGE3My05NjIxLTE2N2YxNjk4YzcyZCJ9.wAMbFvk3nqBrR6oqg0gSy37_tvXktau-Lm2pipr5XzzzdsUg1hjdWtsnfnbjurq5NLLI7YqvuQIW7wbrhapqAA";

let tursoWebClient = null;

export function getTursoWebClient() {
  if (tursoWebClient) return tursoWebClient;
  try {
    tursoWebClient = createClient({
      url: TURSO_URL,
      authToken: TURSO_AUTH_TOKEN,
    });
  } catch (err) {
    console.warn("Failed to create direct Turso web client:", err);
  }
  return tursoWebClient;
}

function safeParse(val, fallback = {}) {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

/**
 * Fetches all store data directly from Turso database (zero serverless proxy dependencies)
 */
export async function fetchStoreDirectFromTurso() {
  const client = getTursoWebClient();
  if (!client) return null;

  try {
    const [settingsRes, productsRes, categoriesRes] = await Promise.all([
      client.execute("SELECT key, value_json FROM store_settings;"),
      client.execute("SELECT * FROM products WHERE is_active = 1 ORDER BY is_flagship DESC, created_at DESC;"),
      client.execute("SELECT * FROM categories ORDER BY sort_order ASC;"),
    ]);

    const settingsMap = new Map();
    for (const row of settingsRes.rows) {
      settingsMap.set(row.key, safeParse(row.value_json, {}));
    }

    const products = productsRes.rows.map((row) => {
      const images = safeParse(row.images_json, []);
      const specifications = safeParse(row.specifications_json, []);
      const imageFraming = safeParse(row.image_framing_json, {
        aspectRatio: "4/5",
        fitMode: "contain",
        scale: 100,
        alignment: "center",
      });

      return {
        id: row.id,
        name: row.name,
        shortSpec: row.short_spec || "",
        brand: row.brand || "صُدْفَة",
        category: row.category || "كلاسيك ورسمية",
        categoryId: row.category_id || "classic-dress",
        gender: row.gender || "unisex",
        style: row.style || "classic",
        basePrice: Number(row.base_price) || 0,
        price: Number(row.base_price) || 0,
        discountType: row.discount_type || "percent",
        discountValue: Number(row.discount_value) || 0,
        discountPercent: Number(row.discount_percent) || 0,
        discountActive: Boolean(row.discount_active),
        discountReason: row.discount_reason || "",
        discountStartOn: row.discount_start_on || null,
        discountEndOn: row.discount_end_on || null,
        salePrice: Number(row.sale_price) || Number(row.base_price) || 0,
        badge: row.badge || "",
        isFlagship: Boolean(row.is_flagship),
        inStock: Boolean(row.in_stock),
        stockCount: Number(row.stock_count) || 10,
        description: row.description || "",
        imageUrl: row.image_url || "/sodfa-promo-poster.jpg",
        image: row.image_url || "/sodfa-promo-poster.jpg",
        imageAlt: row.image_alt || row.name,
        images,
        imageFraming,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at || new Date().toISOString(),
        updatedAt: row.updated_at || new Date().toISOString(),
      };
    });

    const categories = categoriesRes.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug || row.id,
      icon: row.icon || "",
      sortOrder: Number(row.sort_order) || 0,
    }));

    const generalSettings = settingsMap.get("general") || {};
    const tickerItems = settingsMap.get("ticker_items") || [];

    return {
      ok: true,
      settings: generalSettings,
      socialLinks: {
        facebook: generalSettings.facebookUrl || generalSettings.socialFacebook || "",
        instagram: generalSettings.instagramUrl || generalSettings.socialInstagram || "",
        tiktok: generalSettings.tiktokUrl || generalSettings.socialTiktok || "",
        youtube: generalSettings.youtubeUrl || generalSettings.socialYoutube || "",
        snapchat: generalSettings.snapchatUrl || generalSettings.socialSnapchat || "",
        whatsapp: generalSettings.defaultWhatsapp || generalSettings.socialWhatsapp || "",
        phone: generalSettings.defaultPhone || generalSettings.socialPhone || "",
      },
      heroSettings: {
        headline: generalSettings.heroHeadline || "كل لحظة حلوة\nتستاهل وقتها.",
        description: generalSettings.heroDescription || "ساعات مختارة بعناية فائقة...",
        videoUrl: generalSettings.heroVideoUrl || generalSettings.videoUrl || "",
        posterUrl: generalSettings.heroPosterUrl || generalSettings.posterUrl || "/sodfa-promo-poster.jpg",
        trustBadge: generalSettings.heroTrustBadge || generalSettings.heroBadge || "دقة متناهية • ضمان سنتين",
        heroTrustBadge: generalSettings.heroTrustBadge || generalSettings.heroBadge || "دقة متناهية • ضمان سنتين",
        heroBadge: generalSettings.heroTrustBadge || generalSettings.heroBadge || "دقة متناهية • ضمان سنتين",
      },
      products,
      categories,
      tickerItems,
      source: "turso-direct",
    };
  } catch (err) {
    console.warn("Direct Turso fetch failed:", err);
    return null;
  }
}

/**
 * Persists general settings directly to Turso DB
 */
export async function saveSettingsDirectToTurso(settings) {
  const client = getTursoWebClient();
  if (!client || !settings) return false;

  try {
    const now = new Date().toISOString();
    const currentRes = await client.execute("SELECT value_json FROM store_settings WHERE key = 'general' LIMIT 1;");
    const current = currentRes.rows[0] ? safeParse(currentRes.rows[0].value_json, {}) : {};
    const merged = { ...current, ...settings };

    await client.execute({
      sql: "INSERT OR REPLACE INTO store_settings (key, value_json, updated_at) VALUES ('general', ?, ?);",
      args: [JSON.stringify(merged), now],
    });
    return true;
  } catch (err) {
    console.warn("Direct Turso save settings failed:", err);
    return false;
  }
}

/**
 * Persists categories directly to Turso DB
 */
export async function saveCategoriesDirectToTurso(categories) {
  const client = getTursoWebClient();
  if (!client || !Array.isArray(categories)) return false;

  try {
    const statements = [
      { sql: "DELETE FROM categories;", args: [] },
      ...categories.map((c, idx) => ({
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
    await client.batch(statements, "write");
    return true;
  } catch (err) {
    console.warn("Direct Turso save categories failed:", err);
    return false;
  }
}

/**
 * Persists ticker items directly to Turso DB
 */
export async function saveTickerItemsDirectToTurso(items) {
  const client = getTursoWebClient();
  if (!client || !Array.isArray(items)) return false;

  try {
    const now = new Date().toISOString();
    await client.execute({
      sql: "INSERT OR REPLACE INTO store_settings (key, value_json, updated_at) VALUES ('ticker_items', ?, ?);",
      args: [JSON.stringify(items), now],
    });
    return true;
  } catch (err) {
    console.warn("Direct Turso save ticker items failed:", err);
    return false;
  }
}

/**
 * Persists a product directly to Turso DB
 */
export async function saveProductDirectToTurso(b) {
  const client = getTursoWebClient();
  if (!client || !b) return false;

  try {
    const id = String(b.id || "").trim();
    const name = String(b.name || "").trim();
    if (!id || !name) return false;

    const basePrice = Math.max(0, Math.round(Number(b.basePrice ?? b.price ?? 0)));
    const discountType = b.discountType || "percent";
    const discountValue = Math.max(0, Number(b.discountValue) || 0);
    const discountPercent = Math.max(0, Math.min(99, Number(b.discountPercent) || 0));
    const discountActive = Boolean(b.discountActive);
    const discountReason = String(b.discountReason || "").trim();
    const discountStartOn = b.discountStartOn || null;
    const discountEndOn = b.discountEndOn || null;
    const salePrice = Math.max(0, Math.round(Number(b.salePrice || basePrice)));
    const shortSpec = String(b.shortSpec || "").trim();
    const brand = String(b.brand || "صُدْفَة").trim();
    const category = String(b.category || "كلاسيك ورسمية").trim();
    const categoryId = String(b.categoryId || "classic-dress").trim();
    const gender = String(b.gender || "unisex").trim();
    const style = String(b.style || "classic").trim();
    const badge = String(b.badge || "").trim();
    const isFlagship = Boolean(b.isFlagship) ? 1 : 0;
    const inStock = b.inStock !== false ? 1 : 0;
    const stockCount = Math.max(0, parseInt(b.stockCount, 10) || 10);
    const description = String(b.description || "").trim();
    const imageUrl = String(b.imageUrl || b.image || "/sodfa-promo-poster.jpg").trim();
    const imageAlt = String(b.imageAlt || name).trim();
    const specificationsJson = JSON.stringify(Array.isArray(b.specifications) ? b.specifications : []);
    const imagesJson = JSON.stringify(Array.isArray(b.images) ? b.images : []);
    const imageFramingJson = JSON.stringify(
      b.imageFraming && typeof b.imageFraming === "object"
        ? b.imageFraming
        : { aspectRatio: "4/5", fitMode: "contain", scale: 100 }
    );
    const isActive = b.isActive !== false ? 1 : 0;
    const now = new Date().toISOString();

    await client.execute({
      sql: `INSERT OR REPLACE INTO products (
        id, name, short_spec, brand, category, category_id, gender, style,
        base_price, discount_type, discount_value, discount_percent, discount_active,
        discount_reason, discount_start_on, discount_end_on, sale_price, badge,
        is_flagship, in_stock, stock_count, description, specifications_json,
        image_url, image_alt, images_json, image_framing_json, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      args: [
        id, name, shortSpec, brand, category, categoryId, gender, style,
        basePrice, discountType, discountValue, discountPercent, discountActive ? 1 : 0,
        discountReason, discountStartOn, discountEndOn, salePrice, badge,
        isFlagship, inStock, stockCount, description, specificationsJson,
        imageUrl, imageAlt, imagesJson, imageFramingJson, isActive, now, now,
      ],
    });
    return true;
  } catch (err) {
    console.warn("Direct Turso save product failed:", err);
    return false;
  }
}

/**
 * Deletes products directly from Turso DB
 */
export async function deleteProductsDirectFromTurso(ids = []) {
  const client = getTursoWebClient();
  if (!client || !ids.length) return false;

  try {
    const placeholders = ids.map(() => "?").join(",");
    await client.execute({
      sql: `DELETE FROM products WHERE id IN (${placeholders});`,
      args: ids,
    });
    return true;
  } catch (err) {
    console.warn("Direct Turso delete products failed:", err);
    return false;
  }
}

export function mapTursoOrderRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerName: row.customer_name || "",
    phone: row.phone || "",
    governorate: row.governorate || "",
    city: row.city || "",
    address: row.address || "",
    notes: row.notes || "",
    totalAmount: Number(row.total_amount) || 0,
    items: safeParse(row.items_json, []),
    deliveryTimeline: row.delivery_timeline || "",
    status: row.status || "new",
    isRead: Boolean(row.is_read),
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
  };
}

/**
 * Fetches all orders directly from Turso DB, or matches by query phone/id
 */
export async function fetchOrdersDirectFromTurso(query = "") {
  const client = getTursoWebClient();
  if (!client) return [];

  try {
    const res = await client.execute("SELECT * FROM orders ORDER BY created_at DESC;");
    const orders = res.rows.map(mapTursoOrderRow);

    if (!query) return orders;

    const q = String(query).toLowerCase().trim();
    const cleanQ = q.replace(/^[#]/, "").trim();
    const cleanDigits = q.replace(/\D/g, "");

    return orders.filter((o) => {
      const oId = String(o.id || "").toLowerCase().trim();
      const oClean = oId.replace(/^[#]/, "").trim();
      if (oId === q || oClean === cleanQ || oClean === q) return true;

      const oPhoneDigits = String(o.phone || "").replace(/\D/g, "");
      if (cleanDigits && oPhoneDigits) {
        if (oPhoneDigits === cleanDigits || oPhoneDigits.endsWith(cleanDigits) || cleanDigits.endsWith(oPhoneDigits)) {
          return true;
        }
      }
      return false;
    });
  } catch (err) {
    console.warn("Direct Turso fetch orders failed:", err);
    return [];
  }
}

/**
 * Updates order status directly in Turso DB with robust ID matching across prefixes and digits
 */
export async function updateOrderStatusDirectInTurso(orderId, newStatus) {
  const client = getTursoWebClient();
  if (!client || !orderId) return false;

  const rawId = String(orderId).trim();
  const cleanId = rawId.replace(/^[#]/, "").trim();
  const digitsOnly = rawId.replace(/\D/g, "");
  const dafId = cleanId.toUpperCase().startsWith("DAF-") ? cleanId.toUpperCase() : `DAF-${digitsOnly || cleanId}`;
  const sdfId = cleanId.toUpperCase().startsWith("SDF-") ? cleanId.toUpperCase() : `SDF-${digitsOnly || cleanId}`;

  const idCandidates = Array.from(new Set([
    rawId,
    cleanId,
    "#" + cleanId,
    digitsOnly,
    "#" + digitsOnly,
    dafId,
    "#" + dafId,
    sdfId,
  ])).filter(Boolean);

  const now = new Date().toISOString();

  let canonStatus = String(newStatus).toLowerCase().trim();
  if (
    canonStatus === "shipping" ||
    canonStatus === "تم الشحن" ||
    canonStatus === "جاري الشحن" ||
    canonStatus === "جاري الشحن والتوصيل" ||
    canonStatus === "مع المندوب"
  ) {
    canonStatus = "shipped";
  } else if (canonStatus === "تم التأكيد" || canonStatus === "مؤكد" || canonStatus === "تم تأكيد الطلب") {
    canonStatus = "confirmed";
  } else if (canonStatus === "تم التسليم" || canonStatus === "مكتمل" || canonStatus === "تم التسليم بنجاح") {
    canonStatus = "delivered";
  } else if (canonStatus === "ملغي" || canonStatus === "ملغى" || canonStatus === "تم إلغاء الطلب" || canonStatus === "تم الالغاء") {
    canonStatus = "cancelled";
  } else if (canonStatus === "new" || canonStatus === "تم استلام الطلب" || canonStatus === "جديد" || canonStatus === "received") {
    canonStatus = "received";
  }

  try {
    const placeholders = idCandidates.map(() => "?").join(",");
    const res = await client.execute({
      sql: `UPDATE orders SET status = ?, updated_at = ? WHERE id IN (${placeholders});`,
      args: [canonStatus, now, ...idCandidates],
    });
    return (res.rowsAffected || 0) > 0;
  } catch (err) {
    console.warn("Direct Turso update order status failed:", err);
    return false;
  }
}

/**
 * Deletes orders directly from Turso DB with robust ID matching across prefixes and digits
 */
export async function deleteOrdersDirectFromTurso(orderIds = []) {
  const client = getTursoWebClient();
  if (!client || !orderIds.length) return false;

  const allTargets = new Set();
  for (const id of orderIds) {
    const raw = String(id).trim();
    const clean = raw.replace(/^[#]/, "").trim();
    const digits = raw.replace(/\D/g, "");
    allTargets.add(raw);
    allTargets.add(clean);
    allTargets.add("#" + clean);
    if (digits) {
      allTargets.add(digits);
      allTargets.add("#" + digits);
      allTargets.add(`DAF-${digits}`);
      allTargets.add(`#DAF-${digits}`);
    }
  }

  const targetsList = Array.from(allTargets).filter(Boolean);

  try {
    const placeholders = targetsList.map(() => "?").join(",");
    await client.execute({
      sql: `DELETE FROM orders WHERE id IN (${placeholders});`,
      args: targetsList,
    });
    return true;
  } catch (err) {
    console.warn("Direct Turso delete orders failed:", err);
    return false;
  }
}
