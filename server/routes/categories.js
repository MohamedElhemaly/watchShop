import { randomUUID } from "node:crypto";
import { Router } from "express";
import { getPool } from "../db.js";
import { requireAdmin, requireCsrf } from "../auth.js";

const router = Router();
const MAX_CATEGORY_NAME = 80;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseCategory(body = {}) {
  const input = body && typeof body === "object" ? body : {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > MAX_CATEGORY_NAME) {
    return { errors: { name: `اكتب اسم التصنيف من 1 إلى ${MAX_CATEGORY_NAME} حرفًا.` } };
  }
  return { value: { name } };
}

function isDuplicateName(error) {
  return error?.code === "ER_DUP_ENTRY";
}

function isCategoryId(value) {
  return UUID_PATTERN.test(String(value || ""));
}

async function readCategories(includeProductCount = false) {
  const productCount = includeProductCount ? "COUNT(p.id)" : "NULL";
  const [rows] = await getPool().execute(
    `SELECT c.id, c.name,
       ${productCount} AS product_count,
       COALESCE(SUM(CASE WHEN p.is_active = TRUE AND p.deleted_at IS NULL THEN 1 ELSE 0 END), 0) AS active_product_count
     FROM sodfa_categories c
     LEFT JOIN sodfa_products p ON p.category_id = c.id
     GROUP BY c.id, c.name, c.created_at
     ORDER BY c.created_at ASC, c.name ASC`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    activeProductCount: Number(row.active_product_count || 0),
    ...(includeProductCount ? { productCount: Number(row.product_count || 0) } : {}),
  }));
}

router.get("/categories", async (_request, response) => {
  return response.json({ categories: await readCategories(false) });
});

router.get("/admin/categories", requireAdmin, async (_request, response) => {
  return response.json({ categories: await readCategories(true) });
});

router.post("/admin/categories", requireAdmin, requireCsrf, async (request, response) => {
  const parsed = parseCategory(request.body);
  if (parsed.errors) return response.status(422).json({ error: "راجع اسم التصنيف.", fields: parsed.errors });

  const category = { id: randomUUID(), ...parsed.value };
  try {
    await getPool().execute("INSERT INTO sodfa_categories (id, name) VALUES (?, ?)", [category.id, category.name]);
  } catch (error) {
    if (isDuplicateName(error)) return response.status(409).json({ error: "اسم التصنيف مستخدم بالفعل." });
    throw error;
  }
  return response.status(201).json({ category: { ...category, activeProductCount: 0, productCount: 0 } });
});

router.put("/admin/categories/:id", requireAdmin, requireCsrf, async (request, response) => {
  if (!isCategoryId(request.params.id)) return response.status(404).json({ error: "التصنيف غير موجود." });
  const parsed = parseCategory(request.body);
  if (parsed.errors) return response.status(422).json({ error: "راجع اسم التصنيف.", fields: parsed.errors });

  try {
    const [result] = await getPool().execute(
      "UPDATE sodfa_categories SET name = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
      [parsed.value.name, request.params.id],
    );
    if (!result.affectedRows) {
      const [rows] = await getPool().execute("SELECT id FROM sodfa_categories WHERE id = ? LIMIT 1", [request.params.id]);
      if (!rows.length) return response.status(404).json({ error: "التصنيف غير موجود." });
    }
  } catch (error) {
    if (isDuplicateName(error)) return response.status(409).json({ error: "اسم التصنيف مستخدم بالفعل." });
    throw error;
  }

  const [rows] = await getPool().execute(
    `SELECT c.id, c.name, COUNT(p.id) AS product_count,
       COALESCE(SUM(CASE WHEN p.is_active = TRUE AND p.deleted_at IS NULL THEN 1 ELSE 0 END), 0) AS active_product_count
     FROM sodfa_categories c LEFT JOIN sodfa_products p ON p.category_id = c.id
     WHERE c.id = ? GROUP BY c.id, c.name`,
    [request.params.id],
  );
  const row = rows[0];
  return response.json({ category: {
    id: row.id,
    name: row.name,
    productCount: Number(row.product_count || 0),
    activeProductCount: Number(row.active_product_count || 0),
  } });
});

router.delete("/admin/categories/:id", requireAdmin, requireCsrf, async (request, response) => {
  if (!isCategoryId(request.params.id)) return response.status(404).json({ error: "التصنيف غير موجود." });

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [categories] = await connection.execute(
      "SELECT id FROM sodfa_categories WHERE id = ? FOR UPDATE",
      [request.params.id],
    );
    if (!categories.length) {
      await connection.rollback();
      return response.status(404).json({ error: "التصنيف غير موجود." });
    }

    const [counts] = await connection.execute(
      "SELECT COUNT(*) AS product_count FROM sodfa_products WHERE category_id = ?",
      [request.params.id],
    );
    const productCount = Number(counts[0]?.product_count || 0);
    if (productCount > 0) {
      await connection.rollback();
      return response.status(409).json({
        error: `لا يمكن حذف التصنيف لأنه مرتبط بـ ${productCount} ساعة، بما فيها المخفية أو المحذوفة. أزل التصنيف عن الساعات أولًا.`,
      });
    }

    await connection.execute("DELETE FROM sodfa_categories WHERE id = ?", [request.params.id]);
    await connection.commit();
    return response.json({ ok: true });
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error?.code === "ER_ROW_IS_REFERENCED_2" || error?.code === "ER_ROW_IS_REFERENCED") {
      return response.status(409).json({ error: "لا يمكن حذف تصنيف مرتبط بساعة. أزل التصنيف عن الساعات أولًا." });
    }
    throw error;
  } finally {
    connection.release();
  }
});

export default router;
