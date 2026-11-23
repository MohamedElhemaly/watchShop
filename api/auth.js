// Sodfa (صُدْفَة) - Admin Authentication & RBAC Management Endpoint (Vercel Serverless / Node)
// Handles Admin Login, JWT Token generation, Master Key Recovery, Password Changes,
// and Granular Super Admin permissions management.

import {
  ensureInitialized,
  getDb,
  authenticateAdmin,
  hashPassword,
  verifyPassword,
  signAdminToken,
  mapAdminRow,
  safeParseJson,
} from "./_db.js";

const MASTER_RECOVERY_KEY = "DAFFA-RCV-9941-K7M3-SEC";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  await ensureInitialized();
  const db = getDb();
  const method = req.method;
  const action = String(req.query?.action || req.body?.action || "").toLowerCase().trim();

  // 1. GET Actions: /api/auth?action=me | admins | recovery-key
  if (method === "GET") {
    if (action === "me") {
      const admin = await authenticateAdmin(req);
      if (!admin) {
        return res.status(401).json({ ok: false, authenticated: false, error: "غير مصرح أو الجلسة منتهية." });
      }
      return res.status(200).json({ ok: true, authenticated: true, user: admin });
    }

    if (action === "admins" || action === "users") {
      const admin = await authenticateAdmin(req);
      if (!admin || admin.role !== "super_admin") {
        return res.status(403).json({ ok: false, error: "هذه الصلاحية مخصصة للمدير العام (Super Admin) فقط." });
      }

      let rowsRes;
      try {
        rowsRes = await db.execute("SELECT * FROM admin_users ORDER BY created_at ASC;");
      } catch {
        rowsRes = await db.execute("SELECT * FROM admins ORDER BY created_at ASC;");
      }
      if (!rowsRes.rows || rowsRes.rows.length === 0) {
        rowsRes = await db.execute("SELECT * FROM admins ORDER BY created_at ASC;");
      }
      const users = rowsRes.rows.map((r) => mapAdminRow(r, false));
      return res.status(200).json({ ok: true, users, admins: users });
    }

    if (action === "recovery-key") {
      const admin = await authenticateAdmin(req);
      if (!admin || admin.role !== "super_admin") {
        return res.status(403).json({ ok: false, error: "هذه الصلاحية مخصصة للمدير العام فقط." });
      }
      return res.status(200).json({ ok: true, recoveryKey: MASTER_RECOVERY_KEY });
    }

    return res.status(400).json({ ok: false, error: "إجراء غير معروف." });
  }

  // 2. POST Actions: login | recover | change-password | create-admin | update-admin | delete-admin
  if (method === "POST" || method === "PUT" || method === "DELETE") {
    // A. Admin Login
    if (action === "login") {
      const b = req.body || {};
      const identifier = String(b.username || b.email || "").trim().toLowerCase();
      const password = String(b.password || "").trim();

      if (!identifier || !password) {
        return res.status(400).json({ ok: false, error: "يرجى إدخال اسم المستخدم وكلمة المرور." });
      }

      let allRows = [];
      try {
        const r1 = await db.execute("SELECT * FROM admin_users;");
        if (r1 && r1.rows) allRows.push(...r1.rows);
      } catch {}
      try {
        const r2 = await db.execute("SELECT * FROM admins;");
        if (r2 && r2.rows) allRows.push(...r2.rows);
      } catch {}

      const targetRow = allRows.find((r) => {
        const u = String(r.username || "").toLowerCase();
        const e = String(r.email || "").toLowerCase();
        const f = String(r.full_name || "").toLowerCase();
        return u === identifier || e === identifier || f === identifier;
      });

      if (!targetRow) {
        return res.status(401).json({ ok: false, error: "اسم المستخدم أو كلمة المرور غير صحيحة." });
      }

      if (targetRow.status === "suspended") {
        return res.status(403).json({ ok: false, error: "هذا الحساب موقوف حالياً من قبل الإدارة." });
      }

      const isValid = verifyPassword(password, targetRow.password_hash, targetRow.role);
      if (!isValid) {
        return res.status(401).json({ ok: false, error: "اسم المستخدم أو كلمة المرور غير صحيحة." });
      }

      const user = mapAdminRow(targetRow, false);
      const token = signAdminToken({
        userId: user.id,
        username: user.username,
        role: user.role,
      });

      return res.status(200).json({
        ok: true,
        message: "تم تسجيل الدخول بنجاح.",
        token,
        user,
      });
    }

    // B. Master Recovery Key Password Reset
    if (action === "recover") {
      const b = req.body || {};
      const username = String(b.username || "").trim().toLowerCase();
      const recoveryKey = String(b.recoveryKey || "").trim();
      const newPassword = String(b.newPassword || "").trim();

      if (!username || !recoveryKey || !newPassword) {
        return res.status(400).json({ ok: false, error: "يرجى تعبئة كافة الحقول المطلوبة." });
      }

      if (recoveryKey !== MASTER_RECOVERY_KEY) {
        return res.status(403).json({ ok: false, error: "مفتاح الاسترداد الرئيسي غير صحيح." });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ ok: false, error: "كلمة المرور الجديدة يجب ألا تقل عن 6 خانات." });
      }

      let usersRes;
      try {
        usersRes = await db.execute("SELECT * FROM admin_users;");
      } catch {
        usersRes = await db.execute("SELECT * FROM admins;");
      }
      if (!usersRes.rows || usersRes.rows.length === 0) {
        usersRes = await db.execute("SELECT * FROM admins;");
      }
      const targetRow = usersRes.rows.find((r) => {
        const u = String(r.username || "").toLowerCase();
        const e = String(r.email || "").toLowerCase();
        return u === username || e === username;
      });

      if (!targetRow) {
        return res.status(404).json({ ok: false, error: `لم يتم العثور على حساب باسم: ${username}` });
      }

      const newHash = hashPassword(newPassword);
      await db.execute({
        sql: "UPDATE admins SET password_hash = ?, status = 'active' WHERE id = ?;",
        args: [newHash, targetRow.id],
      });

      return res.status(200).json({ ok: true, message: "تم استرداد كلمة المرور وتعيينها بنجاح." });
    }

    // C. Change Password (Authenticated Admin)
    if (action === "change-password") {
      const admin = await authenticateAdmin(req);
      if (!admin) {
        return res.status(401).json({ ok: false, error: "غير مصرح. يرجى تسجيل الدخول أولاً." });
      }

      const b = req.body || {};
      const currentPassword = String(b.currentPassword || "").trim();
      const newPassword = String(b.newPassword || "").trim();

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ ok: false, error: "يرجى إدخال كلمة المرور الحالية والجديدة." });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ ok: false, error: "كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف." });
      }

      const userRes = await db.execute({ sql: "SELECT * FROM admins WHERE id = ? LIMIT 1;", args: [admin.id] });
      const row = userRes.rows[0];
      if (!row) {
        return res.status(404).json({ ok: false, error: "المستخدم غير موجود." });
      }

      const isCurrentValid = verifyPassword(currentPassword, row.password_hash, row.role);
      if (!isCurrentValid) {
        return res.status(400).json({ ok: false, error: "كلمة المرور الحالية غير صحيحة." });
      }

      const newHash = hashPassword(newPassword);
      await db.execute({
        sql: "UPDATE admins SET password_hash = ? WHERE id = ?;",
        args: [newHash, admin.id],
      });

      return res.status(200).json({ ok: true, message: "تم تغيير كلمة المرور بنجاح." });
    }

    // D. Create Admin User (Super Admin only)
    if (action === "create-admin") {
      const currentAdmin = await authenticateAdmin(req);
      if (!currentAdmin || currentAdmin.role !== "super_admin") {
        return res.status(403).json({ ok: false, error: "إضافة المشرفين متاحة للمدير العام فقط." });
      }

      const b = req.body || {};
      const username = String(b.username || "").trim().toLowerCase();
      const fullName = String(b.fullName || username).trim();
      const email = String(b.email || "").trim().toLowerCase();
      const password = String(b.password || "").trim();
      const permissions = b.permissions && typeof b.permissions === "object" ? b.permissions : {};

      if (!username || username.length < 3) {
        return res.status(400).json({ ok: false, error: "اسم المستخدم يجب أن يتكون من 3 أحرف على الأقل." });
      }
      if (!password || password.length < 6) {
        return res.status(400).json({ ok: false, error: "كلمة المرور يجب أن تتكون من 6 خانات على الأقل." });
      }

      let checkExists;
      try {
        checkExists = await db.execute({ sql: "SELECT id FROM admin_users WHERE username = ? LIMIT 1;", args: [username] });
      } catch {
        checkExists = await db.execute({ sql: "SELECT id FROM admins WHERE username = ? LIMIT 1;", args: [username] });
      }
      if (checkExists.rows.length > 0) {
        return res.status(409).json({ ok: false, error: "اسم المستخدم هذا مسجل مسبقاً." });
      }

      const newId = `usr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const permsJson = JSON.stringify({
        view_orders: Boolean(permissions.view_orders),
        manage_orders: Boolean(permissions.manage_orders),
        manage_products: Boolean(permissions.manage_products),
        manage_categories: Boolean(permissions.manage_categories),
        manage_storefront: Boolean(permissions.manage_storefront),
        manage_delivery_settings: Boolean(permissions.manage_delivery_settings),
      });

      const insertArgs = [newId, username, email, fullName, hashPassword(password), permsJson, new Date().toISOString()];
      try {
        await db.execute({
          sql: `INSERT OR REPLACE INTO admin_users (id, username, email, full_name, role, password_hash, permissions_json, status, created_at)
                VALUES (?, ?, ?, ?, 'regular_admin', ?, ?, 'active', ?);`,
          args: insertArgs,
        });
      } catch {}
      await db.execute({
        sql: `INSERT OR REPLACE INTO admins (id, username, email, full_name, role, password_hash, permissions_json, status, created_at)
              VALUES (?, ?, ?, ?, 'regular_admin', ?, ?, 'active', ?);`,
        args: insertArgs,
      });

      let created;
      try {
        created = await db.execute({ sql: "SELECT * FROM admin_users WHERE id = ? LIMIT 1;", args: [newId] });
      } catch {
        created = await db.execute({ sql: "SELECT * FROM admins WHERE id = ? LIMIT 1;", args: [newId] });
      }
      return res.status(201).json({ ok: true, user: mapAdminRow(created.rows[0]) });
    }

    // E. Update Admin User (Super Admin only)
    if (action === "update-admin") {
      const currentAdmin = await authenticateAdmin(req);
      if (!currentAdmin || currentAdmin.role !== "super_admin") {
        return res.status(403).json({ ok: false, error: "تعديل المشرفين متاح للمدير العام فقط." });
      }

      const b = req.body || {};
      const targetId = String(b.id || req.query?.id || "").trim();
      if (!targetId) {
        return res.status(400).json({ ok: false, error: "معرف المشرف مطلوب." });
      }

      let userRes;
      try {
        userRes = await db.execute({ sql: "SELECT * FROM admin_users WHERE id = ? LIMIT 1;", args: [targetId] });
      } catch {
        userRes = await db.execute({ sql: "SELECT * FROM admins WHERE id = ? LIMIT 1;", args: [targetId] });
      }
      if (!userRes.rows || userRes.rows.length === 0) {
        userRes = await db.execute({ sql: "SELECT * FROM admins WHERE id = ? LIMIT 1;", args: [targetId] });
      }
      const row = userRes.rows[0];
      if (!row) {
        return res.status(404).json({ ok: false, error: "المشرف غير موجود." });
      }

      const fullName = b.fullName !== undefined ? String(b.fullName).trim() : row.full_name;
      const email = b.email !== undefined ? String(b.email).trim() : row.email;
      const status = row.role === "super_admin" ? "active" : (b.status === "suspended" ? "suspended" : "active");

      let permsJson = row.permissions_json;
      if (row.role !== "super_admin" && b.permissions && typeof b.permissions === "object") {
        permsJson = JSON.stringify({
          view_orders: Boolean(b.permissions.view_orders),
          manage_orders: Boolean(b.permissions.manage_orders),
          manage_products: Boolean(b.permissions.manage_products),
          manage_categories: Boolean(b.permissions.manage_categories),
          manage_storefront: Boolean(b.permissions.manage_storefront),
          manage_delivery_settings: Boolean(b.permissions.manage_delivery_settings),
        });
      }

      let passwordClause = "";
      const args = [fullName, email, status, permsJson];
      if (b.password && String(b.password).length >= 6) {
        passwordClause = ", password_hash = ?";
        args.push(hashPassword(b.password));
      }
      args.push(targetId);

      try {
        await db.execute({
          sql: `UPDATE admin_users SET full_name = ?, email = ?, status = ?, permissions_json = ? ${passwordClause} WHERE id = ?;`,
          args,
        });
      } catch {}
      await db.execute({
        sql: `UPDATE admins SET full_name = ?, email = ?, status = ?, permissions_json = ? ${passwordClause} WHERE id = ?;`,
        args,
      });

      let updated;
      try {
        updated = await db.execute({ sql: "SELECT * FROM admin_users WHERE id = ? LIMIT 1;", args: [targetId] });
      } catch {
        updated = await db.execute({ sql: "SELECT * FROM admins WHERE id = ? LIMIT 1;", args: [targetId] });
      }
      return res.status(200).json({ ok: true, user: mapAdminRow(updated.rows[0]) });
    }

    // F. Delete Admin User (Super Admin only)
    if (action === "delete-admin") {
      const currentAdmin = await authenticateAdmin(req);
      if (!currentAdmin || currentAdmin.role !== "super_admin") {
        return res.status(403).json({ ok: false, error: "حذف المشرفين متاح للمدير العام فقط." });
      }

      const targetId = String(req.body?.id || req.query?.id || "").trim();
      if (!targetId) {
        return res.status(400).json({ ok: false, error: "معرف المشرف مطلوب." });
      }

      let userRes;
      try {
        userRes = await db.execute({ sql: "SELECT * FROM admin_users WHERE id = ? LIMIT 1;", args: [targetId] });
      } catch {
        userRes = await db.execute({ sql: "SELECT * FROM admins WHERE id = ? LIMIT 1;", args: [targetId] });
      }
      if (!userRes.rows || userRes.rows.length === 0) {
        userRes = await db.execute({ sql: "SELECT * FROM admins WHERE id = ? LIMIT 1;", args: [targetId] });
      }
      const row = userRes.rows[0];
      if (!row) {
        return res.status(404).json({ ok: false, error: "المشرف غير موجود." });
      }

      if (row.role === "super_admin" || row.id === "usr_super_admin") {
        return res.status(403).json({ ok: false, error: "لا يمكن حذف حساب المدير العام نهائياً." });
      }

      try {
        await db.execute({ sql: "DELETE FROM admin_users WHERE id = ?;", args: [targetId] });
      } catch {}
      await db.execute({ sql: "DELETE FROM admins WHERE id = ?;", args: [targetId] });
      return res.status(200).json({ ok: true, message: "تم حذف المشرف بنجاح." });
    }

    // G. Reset Admin Password by Super Admin
    if (action === "reset-user-password" || action === "reset-password") {
      const currentAdmin = await authenticateAdmin(req);
      if (!currentAdmin || currentAdmin.role !== "super_admin") {
        return res.status(403).json({ ok: false, error: "تعيين كلمة مرور المشرفين متاح للمدير العام فقط." });
      }

      const b = req.body || {};
      const targetId = String(b.id || req.query?.id || "").trim();
      const newPassword = String(b.newPassword || b.password || "").trim();

      if (!targetId || !newPassword || newPassword.length < 6) {
        return res.status(400).json({ ok: false, error: "يرجى تحديد المشرف وكلمة مرور جديدة لا تقل عن 6 خانات." });
      }

      const newHash = hashPassword(newPassword);
      try {
        await db.execute({
          sql: "UPDATE admin_users SET password_hash = ? WHERE id = ?;",
          args: [newHash, targetId],
        });
      } catch {}
      await db.execute({
        sql: "UPDATE admins SET password_hash = ? WHERE id = ?;",
        args: [newHash, targetId],
      });

      return res.status(200).json({ ok: true, message: "تم تعيين كلمة المرور الجديدة للمشرف سحابياً بنجاح." });
    }

    // H. Sync Local Admin to Cloud (Super Admin only)
    if (action === "sync-local-admin" || action === "sync-admin") {
      const currentAdmin = await authenticateAdmin(req);
      if (!currentAdmin || currentAdmin.role !== "super_admin") {
        return res.status(403).json({ ok: false, error: "مزامنة المشرفين متاحة للمدير العام فقط." });
      }

      const b = req.body || {};
      const username = String(b.username || "").trim().toLowerCase();
      if (!username || username.length < 3) {
        return res.status(400).json({ ok: false, error: "اسم المستخدم غير صالح." });
      }

      const fullName = String(b.fullName || username).trim();
      const email = String(b.email || "").trim().toLowerCase();
      const status = b.status === "suspended" ? "suspended" : "active";
      const permissions = b.permissions && typeof b.permissions === "object" ? b.permissions : {};
      const permsJson = JSON.stringify(permissions);
      const id = String(b.id || `usr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`).trim();
      const now = new Date().toISOString();

      let passwordHash = b.passwordHash;
      if (!passwordHash && b.password) {
        passwordHash = hashPassword(b.password);
      }
      if (!passwordHash) {
        passwordHash = hashPassword("123456");
      }

      let existing;
      try {
        existing = await db.execute({
          sql: "SELECT id FROM admin_users WHERE username = ? OR id = ? LIMIT 1;",
          args: [username, id],
        });
      } catch {
        existing = await db.execute({
          sql: "SELECT id FROM admins WHERE username = ? OR id = ? LIMIT 1;",
          args: [username, id],
        });
      }

      if (existing && existing.rows && existing.rows.length > 0) {
        const targetId = existing.rows[0].id;
        try {
          await db.execute({
            sql: "UPDATE admin_users SET full_name = ?, email = ?, status = ?, permissions_json = ? WHERE id = ?;",
            args: [fullName, email, status, permsJson, targetId],
          });
        } catch {}
        await db.execute({
          sql: "UPDATE admins SET full_name = ?, email = ?, status = ?, permissions_json = ? WHERE id = ?;",
          args: [fullName, email, status, permsJson, targetId],
        });
        return res.status(200).json({ ok: true, message: "تم تحديث المشرف في السحابة.", id: targetId });
      } else {
        try {
          await db.execute({
            sql: `INSERT INTO admin_users (id, username, full_name, email, role, password_hash, status, permissions_json, created_at, updated_at)
                  VALUES (?, ?, ?, ?, 'regular_admin', ?, ?, ?, ?, ?);`,
            args: [id, username, fullName, email, passwordHash, status, permsJson, now, now],
          });
        } catch {}
        await db.execute({
          sql: `INSERT OR REPLACE INTO admins (id, username, full_name, email, role, password_hash, status, permissions_json, created_at)
                VALUES (?, ?, ?, ?, 'regular_admin', ?, ?, ?, ?);`,
          args: [id, username, fullName, email, passwordHash, status, permsJson, now],
        });
        return res.status(201).json({ ok: true, message: "تمت مزامنة المشرف في السحابة بنجاح.", id });
      }
    }

    return res.status(400).json({ ok: false, error: "إجراء غير معروف." });
  }

  return res.status(405).json({ ok: false, error: "Method not allowed." });
}
