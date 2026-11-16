import { randomUUID } from "node:crypto";
import { Router } from "express";
import { calculateDiscountedPrice } from "../../src/pricing.js";
import { getPool } from "../db.js";
import { requireAdmin, requireCsrf } from "../auth.js";
import { isValidDateOnly, isDiscountActive } from "../discounts.js";

const router = Router();
const MAX_PRICE_EGP = 10_000_000;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_ALT_LENGTH = 200;
const MAX_COLOR_LABEL_LENGTH = 80;
const MAX_DISCOUNT_REASON_LENGTH = 120;
const MAX_IMAGES = 8;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isStoredImageUrl(value) {
  return /^\/manus-storage\/[A-Za-z0-9/_-]+\.(?:jpg|png|webp)$/i.test(value)
    && !value.includes("..")
    && value.length <= 512;
}

function asProduct(row, images = [], now = new Date()) {
  const basePrice = Number(row.base_price);
  const discountPercent = Number(row.discount_percent);
  const discountStartOn = row.discount_start_on || null;
  const discountEndOn = row.discount_end_on || null;
  const discountReason = String(row.discount_reason || "");
  const discountActive = isDiscountActive({ discountPercent, discountStartOn, discountEndOn }, now);
  const gallery = images.length
    ? images
    : row.image_url
      ? [{ imageUrl: row.image_url, imageAlt: row.image_alt || "", colorLabel: "", sortOrder: 0 }]
      : [];
  const cover = gallery[0];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    basePrice,
    discountPercent,
    discountStartOn,
    discountEndOn,
    discountReason,
    categoryId: row.category_id || null,
    discountActive,
    salePrice: calculateDiscountedPrice(basePrice, discountActive ? discountPercent : 0),
    imageUrl: cover?.imageUrl || row.image_url || "",
    imageAlt: cover?.imageAlt || row.image_alt || "",
    images: gallery,
    active: Boolean(row.is_active),
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const selectFields = `id, name, description, base_price, discount_percent,
  DATE_FORMAT(discount_start_on, '%Y-%m-%d') AS discount_start_on,
  DATE_FORMAT(discount_end_on, '%Y-%m-%d') AS discount_end_on, discount_reason,
  category_id, image_url, image_alt, is_active, sort_order, created_at, updated_at`;

async function withImages(rows, now = new Date()) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  const [imageRows] = await getPool().execute(
    `SELECT product_id, image_url, image_alt, color_label, sort_order
     FROM sodfa_product_images
     WHERE product_id IN (${placeholders})
     ORDER BY product_id ASC, sort_order ASC, created_at ASC`,
    ids,
  );
  const imageMap = new Map();
  for (const image of imageRows) {
    const items = imageMap.get(image.product_id) || [];
    items.push({
      imageUrl: image.image_url,
      imageAlt: image.image_alt || "",
      colorLabel: image.color_label || "",
      sortOrder: Number(image.sort_order),
    });
    imageMap.set(image.product_id, items);
  }
  return rows.map((row) => asProduct(row, imageMap.get(row.id) || [], now));
}

export function parseProduct(body = {}) {
  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim();
  const legacyImageUrl = String(body.imageUrl || "").trim();
  const legacyImageAlt = String(body.imageAlt || "").trim();
  const basePrice = Number(body.basePrice);
  const discountPercent = Number(body.discountPercent ?? 0);
  const rawDiscountStartOn = String(body.discountStartOn || "").trim();
  const rawDiscountEndOn = String(body.discountEndOn || "").trim();
  const rawDiscountReason = String(body.discountReason || "").trim();
  const rawCategoryId = body.categoryId == null ? "" : String(body.categoryId).trim();
  const sortOrder = Number(body.sortOrder ?? 0);
  const active = body.active;
  const errors = {};

  if (!name || name.length > MAX_NAME_LENGTH) errors.name = `اكتب اسمًا من 1 إلى ${MAX_NAME_LENGTH} حرفًا.`;
  if (description.length > MAX_DESCRIPTION_LENGTH) errors.description = `الوصف والمواصفات يجب ألا يتجاوزا ${MAX_DESCRIPTION_LENGTH} حرف.`;
  if (!Number.isInteger(basePrice) || basePrice < 1 || basePrice > MAX_PRICE_EGP) errors.basePrice = "أدخل سعرًا صحيحًا بالجنيه المصري.";
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 99) errors.discountPercent = "نسبة الخصم تكون من 0% إلى 99%.";
  if (discountPercent > 0) {
    if (!isValidDateOnly(rawDiscountStartOn)) errors.discountStartOn = "حدد تاريخ بداية صحيحًا للعرض.";
    if (!isValidDateOnly(rawDiscountEndOn)) errors.discountEndOn = "حدد تاريخ نهاية صحيحًا للعرض.";
    if (isValidDateOnly(rawDiscountStartOn) && isValidDateOnly(rawDiscountEndOn) && rawDiscountStartOn > rawDiscountEndOn) {
      errors.discountEndOn = "تاريخ النهاية يجب أن يكون في يوم البداية نفسه أو بعده.";
    }
    if (!rawDiscountReason || rawDiscountReason.length > MAX_DISCOUNT_REASON_LENGTH) {
      errors.discountReason = `اكتب سبب العرض في 1 إلى ${MAX_DISCOUNT_REASON_LENGTH} حرفًا.`;
    }
  }
  if (typeof active !== "boolean") errors.active = "اختر حالة نشر صحيحة.";
  if (rawCategoryId && !UUID_PATTERN.test(rawCategoryId)) errors.categoryId = "اختر تصنيفًا صالحًا.";
  if (legacyImageAlt.length > MAX_ALT_LENGTH) errors.imageAlt = `النص البديل يجب ألا يتجاوز ${MAX_ALT_LENGTH} حرفًا.`;
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100_000) errors.sortOrder = "ترتيب العرض غير صالح.";

  let rawImages;
  if (body.images === undefined) {
    rawImages = legacyImageUrl ? [{ imageUrl: legacyImageUrl, imageAlt: legacyImageAlt, colorLabel: "" }] : [];
  } else if (Array.isArray(body.images)) {
    rawImages = body.images;
  } else {
    rawImages = [];
    errors.images = "قائمة صور الساعة غير صالحة.";
  }
  if (rawImages.length > MAX_IMAGES) errors.images = `يمكن إضافة حتى ${MAX_IMAGES} صور للساعة.`;

  const images = rawImages.slice(0, MAX_IMAGES).map((item, index) => {
    const imageUrl = String(item?.imageUrl || "").trim();
    const imageAlt = String(item?.imageAlt || (index === 0 ? legacyImageAlt : "")).trim();
    const colorLabel = String(item?.colorLabel || "").trim();
    if (!isStoredImageUrl(imageUrl)) errors.images = "ارفع كل الصور إلى تخزين المتجر قبل الحفظ.";
    if (imageAlt.length > MAX_ALT_LENGTH) errors.images = `النص البديل للصورة يجب ألا يتجاوز ${MAX_ALT_LENGTH} حرفًا.`;
    if (colorLabel.length > MAX_COLOR_LABEL_LENGTH) errors.images = `اسم اللون يجب ألا يتجاوز ${MAX_COLOR_LABEL_LENGTH} حرفًا.`;
    return { imageUrl, imageAlt, colorLabel, sortOrder: index };
  });

  const imageUrl = images[0]?.imageUrl || "";
  const imageAlt = images[0]?.imageAlt || legacyImageAlt;
  if (active && !imageUrl) errors.images = "أضف صورة واحدة على الأقل قبل نشر الساعة في الكتالوج.";
  if (Object.keys(errors).length) return { errors };

  return {
    value: {
      name,
      description,
      basePrice,
      discountPercent,
      discountStartOn: discountPercent > 0 ? rawDiscountStartOn : null,
      discountEndOn: discountPercent > 0 ? rawDiscountEndOn : null,
      discountReason: discountPercent > 0 ? rawDiscountReason : "",
      categoryId: rawCategoryId || null,
      imageUrl,
      imageAlt,
      images,
      active,
      sortOrder,
    },
  };
}

async function replaceImages(connection, productId, images) {
  await connection.execute("DELETE FROM sodfa_product_images WHERE product_id = ?", [productId]);
  for (const image of images) {
    await connection.execute(
      `INSERT INTO sodfa_product_images
        (id, product_id, image_url, image_alt, color_label, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), productId, image.imageUrl, image.imageAlt, image.colorLabel, image.sortOrder],
    );
  }
}

router.get("/products", async (_request, response) => {
  const [rows] = await getPool().execute(
    `SELECT ${selectFields} FROM sodfa_products
     WHERE is_active = TRUE AND deleted_at IS NULL
     ORDER BY sort_order ASC, created_at DESC`,
  );
  const serverNow = new Date();
  return response.json({ products: await withImages(rows, serverNow), serverNow: serverNow.toISOString() });
});

router.get("/products/:id", async (request, response) => {
  const [rows] = await getPool().execute(
    `SELECT ${selectFields} FROM sodfa_products
     WHERE id = ? AND is_active = TRUE AND deleted_at IS NULL LIMIT 1`,
    [request.params.id],
  );
  if (!rows[0]) return response.status(404).json({ error: "الساعة غير متاحة أو غير موجودة." });
  const serverNow = new Date();
  const [product] = await withImages(rows, serverNow);
  return response.json({ product, serverNow: serverNow.toISOString() });
});

router.get("/admin/products", requireAdmin, async (_request, response) => {
  const [rows] = await getPool().execute(
    `SELECT ${selectFields} FROM sodfa_products
     WHERE deleted_at IS NULL
     ORDER BY is_active DESC, sort_order ASC, created_at DESC`,
  );
  const serverNow = new Date();
  return response.json({ products: await withImages(rows, serverNow), serverNow: serverNow.toISOString() });
});

router.post("/admin/products", requireAdmin, requireCsrf, async (request, response) => {
  const parsed = parseProduct(request.body);
  if (parsed.errors) return response.status(422).json({ error: "راجع البيانات المدخلة.", fields: parsed.errors });

  const product = parsed.value;
  const id = randomUUID();
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    if (product.categoryId) {
      const [categories] = await connection.execute(
        "SELECT id FROM sodfa_categories WHERE id = ? FOR UPDATE",
        [product.categoryId],
      );
      if (!categories.length) {
        await connection.rollback();
        return response.status(422).json({ error: "التصنيف المحدد غير موجود. حدّث قائمة التصنيفات.", fields: { categoryId: "اختر تصنيفًا موجودًا." } });
      }
    }
    await connection.execute(
      `INSERT INTO sodfa_products
        (id, name, description, base_price, discount_percent, discount_start_on, discount_end_on, discount_reason,
         category_id, image_url, image_alt, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, product.name, product.description, product.basePrice, product.discountPercent,
        product.discountStartOn, product.discountEndOn, product.discountReason,
        product.categoryId, product.imageUrl || null, product.imageAlt, product.active, product.sortOrder],
    );
    await replaceImages(connection, id, product.images);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }

  const [rows] = await getPool().execute(`SELECT ${selectFields} FROM sodfa_products WHERE id = ? LIMIT 1`, [id]);
  const [savedProduct] = await withImages(rows);
  return response.status(201).json({ product: savedProduct });
});

router.put("/admin/products/:id", requireAdmin, requireCsrf, async (request, response) => {
  const parsed = parseProduct(request.body);
  if (parsed.errors) return response.status(422).json({ error: "راجع البيانات المدخلة.", fields: parsed.errors });

  const product = parsed.value;
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute(
      "SELECT id FROM sodfa_products WHERE id = ? AND deleted_at IS NULL FOR UPDATE",
      [request.params.id],
    );
    if (!existing.length) {
      await connection.rollback();
      return response.status(404).json({ error: "الساعة غير موجودة أو حُذفت." });
    }
    if (product.categoryId) {
      const [categories] = await connection.execute(
        "SELECT id FROM sodfa_categories WHERE id = ? FOR UPDATE",
        [product.categoryId],
      );
      if (!categories.length) {
        await connection.rollback();
        return response.status(422).json({ error: "التصنيف المحدد غير موجود. حدّث قائمة التصنيفات.", fields: { categoryId: "اختر تصنيفًا موجودًا." } });
      }
    }
    await connection.execute(
      `UPDATE sodfa_products SET
        name = ?, description = ?, base_price = ?, discount_percent = ?, discount_start_on = ?, discount_end_on = ?,
        discount_reason = ?, category_id = ?, image_url = ?, image_alt = ?,
        is_active = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND deleted_at IS NULL`,
      [product.name, product.description, product.basePrice, product.discountPercent,
        product.discountStartOn, product.discountEndOn, product.discountReason,
        product.categoryId, product.imageUrl || null, product.imageAlt, product.active, product.sortOrder, request.params.id],
    );
    await replaceImages(connection, request.params.id, product.images);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }

  const [rows] = await getPool().execute(`SELECT ${selectFields} FROM sodfa_products WHERE id = ? LIMIT 1`, [request.params.id]);
  const [savedProduct] = await withImages(rows);
  return response.json({ product: savedProduct });
});

router.patch("/admin/products/:id/visibility", requireAdmin, requireCsrf, async (request, response) => {
  if (typeof request.body?.active !== "boolean") {
    return response.status(422).json({ error: "حالة النشر غير صالحة." });
  }
  const [products] = await getPool().execute(
    "SELECT image_url FROM sodfa_products WHERE id = ? AND deleted_at IS NULL LIMIT 1",
    [request.params.id],
  );
  if (!products[0]) return response.status(404).json({ error: "الساعة غير موجودة أو حُذفت." });
  if (request.body.active && !products[0].image_url) {
    return response.status(422).json({ error: "أضف صورة للساعة قبل عرضها للزوار." });
  }
  const [result] = await getPool().execute(
    "UPDATE sodfa_products SET is_active = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND deleted_at IS NULL",
    [request.body.active, request.params.id],
  );
  if (!result.affectedRows) return response.status(404).json({ error: "الساعة غير موجودة أو حُذفت." });
  return response.json({ ok: true, active: request.body.active });
});

router.delete("/admin/products/:id", requireAdmin, requireCsrf, async (request, response) => {
  const [result] = await getPool().execute(
    "UPDATE sodfa_products SET deleted_at = CURRENT_TIMESTAMP(3), is_active = FALSE, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND deleted_at IS NULL",
    [request.params.id],
  );
  if (!result.affectedRows) return response.status(404).json({ error: "الساعة غير موجودة أو حُذفت." });
  return response.json({ ok: true });
});

export default router;
