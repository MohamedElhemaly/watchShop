// Sodfa (صُدْفَة) - Products API Endpoint (Vercel Serverless / Node)
// Handles CRUD, bulk delete, discount configurations, and image framing persistence.

import {
  ensureInitialized,
  getDb,
  mapProductRow,
  authenticateAdmin,
  safeParseJson,
} from "./_db.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  await ensureInitialized();
  const db = getDb();
  const method = req.method;

  // 1. GET: Public product catalog or specific product by ID
  if (method === "GET") {
    try {
      const id = req.query?.id;
      if (id) {
        const productRes = await db.execute({
          sql: "SELECT * FROM products WHERE id = ? LIMIT 1;",
          args: [String(id)],
        });
        if (productRes.rows.length === 0) {
          return res.status(404).json({ ok: false, error: "المنتج غير موجود." });
        }
        return res.status(200).json({ ok: true, product: mapProductRow(productRes.rows[0]) });
      }

      const showAll = req.query?.all === "1" || req.query?.all === "true";
      const sql = showAll
        ? "SELECT * FROM products ORDER BY is_flagship DESC, created_at DESC;"
        : "SELECT * FROM products WHERE is_active = 1 ORDER BY is_flagship DESC, created_at DESC;";

      const result = await db.execute(sql);
      const products = result.rows.map(mapProductRow);

      return res.status(200).json({ ok: true, products });
    } catch (err) {
      console.error("GET /api/products error:", err);
      return res.status(500).json({ ok: false, error: "فشل استرجاع الساعات." });
    }
  }

  // Admin authentication required for mutations (POST, PUT, DELETE)
  const admin = await authenticateAdmin(req);
  if (!admin) {
    return res.status(401).json({ ok: false, error: "غير مصرح. يرجى تسجيل الدخول بحساب مسؤول للمتابعة." });
  }

  // 2. POST: Create a new watch
  if (method === "POST") {
    try {
      const b = req.body || {};
      const id = String(b.id || `sodfa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`).trim();
      const name = String(b.name || "").trim();

      if (!name) {
        return res.status(400).json({ ok: false, error: "اسم الساعة مطلوب." });
      }

      const basePrice = Math.max(0, Math.round(Number(b.basePrice ?? b.price ?? 0)));
      const discountType = b.discountType || "percent";
      const discountValue = Math.max(0, Number(b.discountValue) || 0);
      const discountPercent = Math.max(0, Math.min(99, Number(b.discountPercent) || 0));
      const discountActive = Boolean(b.discountActive);
      const discountReason = String(b.discountReason || "").trim();
      const discountStartOn = b.discountStartOn || null;
      const discountEndOn = b.discountEndOn || null;

      // Compute sale price
      let salePrice = basePrice;
      if (discountActive) {
        if (discountType === "fixed" && discountValue > 0) {
          salePrice = Math.max(1, basePrice - discountValue);
        } else if (discountPercent > 0) {
          salePrice = Math.max(1, Math.round(basePrice * (1 - discountPercent / 100)));
        }
      }
      if (b.salePrice !== undefined && Number(b.salePrice) > 0) {
        salePrice = Math.max(1, Math.round(Number(b.salePrice)));
      }

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
          : { aspectRatio: "4/5", objectFit: "contain", imageScale: 100 }
      );
      const isActive = b.isActive !== false ? 1 : 0;
      const now = new Date().toISOString();

      await db.execute({
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

      const saved = await db.execute({ sql: "SELECT * FROM products WHERE id = ? LIMIT 1;", args: [id] });
      return res.status(201).json({ ok: true, product: mapProductRow(saved.rows[0]) });
    } catch (err) {
      console.error("POST /api/products error:", err);
      return res.status(500).json({ ok: false, error: "فشل حفظ الساعة الجديدة.", details: err?.message });
    }
  }

  // 3. PUT: Update an existing watch
  if (method === "PUT") {
    try {
      const b = req.body || {};
      const id = String(req.query?.id || b.id || "").trim();
      if (!id) {
        return res.status(400).json({ ok: false, error: "معرف الساعة مطلوب للتحديث." });
      }

      const existingRes = await db.execute({ sql: "SELECT * FROM products WHERE id = ? LIMIT 1;", args: [id] });
      if (existingRes.rows.length === 0) {
        return res.status(404).json({ ok: false, error: "الساعة غير موجودة." });
      }

      const old = mapProductRow(existingRes.rows[0]);
      const name = b.name !== undefined ? String(b.name).trim() : old.name;
      const basePrice = b.basePrice !== undefined ? Math.max(0, Math.round(Number(b.basePrice))) : old.basePrice;
      const discountType = b.discountType !== undefined ? b.discountType : old.discountType;
      const discountValue = b.discountValue !== undefined ? Math.max(0, Number(b.discountValue)) : old.discountValue;
      const discountPercent = b.discountPercent !== undefined ? Math.max(0, Math.min(99, Number(b.discountPercent))) : old.discountPercent;
      const discountActive = b.discountActive !== undefined ? Boolean(b.discountActive) : old.discountActive;
      const discountReason = b.discountReason !== undefined ? String(b.discountReason).trim() : old.discountReason;
      const discountStartOn = b.discountStartOn !== undefined ? b.discountStartOn : old.discountStartOn;
      const discountEndOn = b.discountEndOn !== undefined ? b.discountEndOn : old.discountEndOn;

      let salePrice = basePrice;
      if (discountActive) {
        if (discountType === "fixed" && discountValue > 0) {
          salePrice = Math.max(1, basePrice - discountValue);
        } else if (discountPercent > 0) {
          salePrice = Math.max(1, Math.round(basePrice * (1 - discountPercent / 100)));
        }
      }
      if (b.salePrice !== undefined && Number(b.salePrice) > 0) {
        salePrice = Math.max(1, Math.round(Number(b.salePrice)));
      }

      const shortSpec = b.shortSpec !== undefined ? String(b.shortSpec).trim() : old.shortSpec;
      const brand = b.brand !== undefined ? String(b.brand).trim() : old.brand;
      const category = b.category !== undefined ? String(b.category).trim() : old.category;
      const categoryId = b.categoryId !== undefined ? String(b.categoryId).trim() : old.categoryId;
      const gender = b.gender !== undefined ? String(b.gender).trim() : old.gender;
      const style = b.style !== undefined ? String(b.style).trim() : old.style;
      const badge = b.badge !== undefined ? String(b.badge).trim() : old.badge;
      const isFlagship = b.isFlagship !== undefined ? (b.isFlagship ? 1 : 0) : (old.isFlagship ? 1 : 0);
      const inStock = b.inStock !== undefined ? (b.inStock ? 1 : 0) : (old.inStock ? 1 : 0);
      const stockCount = b.stockCount !== undefined ? Math.max(0, parseInt(b.stockCount, 10)) : old.stockCount;
      const description = b.description !== undefined ? String(b.description).trim() : old.description;
      const imageUrl = b.imageUrl !== undefined ? String(b.imageUrl).trim() : old.imageUrl;
      const imageAlt = b.imageAlt !== undefined ? String(b.imageAlt).trim() : old.imageAlt;
      const specificationsJson = b.specifications !== undefined ? JSON.stringify(b.specifications) : JSON.stringify(old.specifications);
      const imagesJson = b.images !== undefined ? JSON.stringify(b.images) : JSON.stringify(old.images);
      const imageFramingJson = b.imageFraming !== undefined ? JSON.stringify(b.imageFraming) : JSON.stringify(old.imageFraming);
      const isActive = b.isActive !== undefined ? (b.isActive ? 1 : 0) : (old.isActive ? 1 : 0);
      const now = new Date().toISOString();

      await db.execute({
        sql: `UPDATE products SET
          name = ?, short_spec = ?, brand = ?, category = ?, category_id = ?, gender = ?, style = ?,
          base_price = ?, discount_type = ?, discount_value = ?, discount_percent = ?, discount_active = ?,
          discount_reason = ?, discount_start_on = ?, discount_end_on = ?, sale_price = ?, badge = ?,
          is_flagship = ?, in_stock = ?, stock_count = ?, description = ?, specifications_json = ?,
          image_url = ?, image_alt = ?, images_json = ?, image_framing_json = ?, is_active = ?, updated_at = ?
        WHERE id = ?;`,
        args: [
          name, shortSpec, brand, category, categoryId, gender, style,
          basePrice, discountType, discountValue, discountPercent, discountActive ? 1 : 0,
          discountReason, discountStartOn, discountEndOn, salePrice, badge,
          isFlagship, inStock, stockCount, description, specificationsJson,
          imageUrl, imageAlt, imagesJson, imageFramingJson, isActive, now,
          id,
        ],
      });

      const updatedRes = await db.execute({ sql: "SELECT * FROM products WHERE id = ? LIMIT 1;", args: [id] });
      return res.status(200).json({ ok: true, product: mapProductRow(updatedRes.rows[0]) });
    } catch (err) {
      console.error("PUT /api/products error:", err);
      return res.status(500).json({ ok: false, error: "فشل تعديل الساعة.", details: err?.message });
    }
  }

  // 4. DELETE: Single and Bulk Delete
  if (method === "DELETE") {
    try {
      let idsToDelete = [];
      if (Array.isArray(req.body?.ids) && req.body.ids.length > 0) {
        idsToDelete = req.body.ids.map(String);
      } else if (req.body?.id) {
        idsToDelete = [String(req.body.id)];
      } else if (req.query?.ids) {
        idsToDelete = String(req.query.ids).split(",").map((s) => s.trim()).filter(Boolean);
      } else if (req.query?.id) {
        idsToDelete = [String(req.query.id).trim()];
      }

      if (idsToDelete.length === 0) {
        return res.status(400).json({ ok: false, error: "يرجى تحديد معرفات الساعات المراد حذفها." });
      }

      const deleteQueries = idsToDelete.map((id) => ({
        sql: "DELETE FROM products WHERE id = ?;",
        args: [id],
      }));

      await db.batch(deleteQueries);

      return res.status(200).json({
        ok: true,
        deletedIds: idsToDelete,
        message: `تم حذف ${idsToDelete.length} ساعة نهائيًا بنجاح.`,
      });
    } catch (err) {
      console.error("DELETE /api/products error:", err);
      return res.status(500).json({ ok: false, error: "فشل حذف الساعات.", details: err?.message });
    }
  }

  return res.status(405).json({ ok: false, error: "Method not allowed." });
}
