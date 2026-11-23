// Sodfa (صُدْفَة) - Orders API Endpoint (Vercel Serverless / Node)
// Public Order Checkout + Order Tracking Lookup + Admin Status Management & Bulk Deletion
// Dual-channel background notifications: Web3Forms Email + Telegram Bot

import {
  ensureInitialized,
  getDb,
  mapOrderRow,
  authenticateAdmin,
  formatWhatsAppPhone,
  safeParseJson,
} from "./_db.js";

/**
 * Normalizes query string for order tracking
 */
function normalizeQuery(raw) {
  if (!raw) return "";
  return String(raw)
    .trim()
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}

/**
 * Sends non-blocking email and Telegram notifications for new orders
 */
async function sendOrderNotifications(order, db) {
  try {
    const settingsRes = await db.execute("SELECT value_json FROM store_settings WHERE key = 'general' LIMIT 1;");
    if (!settingsRes.rows[0]) return;
    const settings = safeParseJson(settingsRes.rows[0].value_json, {});

    const tasks = [];

    // 1. Email notification via Web3Forms
    if (settings.emailNotificationsEnabled && settings.web3formsKey) {
      const emailPayload = {
        access_key: settings.web3formsKey,
        subject: `طلب شراء جديد #${order.id} من متجر صُدْفَة`,
        from_name: "متجر صُدْفَة للساعات",
        order_id: order.id,
        customer_name: order.customerName,
        phone: order.phone,
        governorate: order.governorate,
        city: order.city,
        address: order.address,
        notes: order.notes,
        total: `${order.totalAmount} ج.م`,
        items: Array.isArray(order.items)
          ? order.items.map((i) => `${i.name} (عدد: ${i.quantity}, سعر: ${i.unitPrice || i.price} ج.م)`).join(" | ")
          : "",
      };

      tasks.push(
        fetch("https://api.web3forms.com/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(emailPayload),
        }).catch((err) => console.warn("Email dispatch error:", err?.message || err))
      );
    }

    // 2. Telegram Bot notification
    if (settings.telegramNotificationsEnabled && settings.telegramBotToken && settings.telegramChatId) {
      const itemsLines = Array.isArray(order.items)
        ? order.items
            .map((i) => `• <b>${i.name}</b> × ${i.quantity} ${i.color || i.variant ? `(${i.color || i.variant})` : ""} — ${(i.unitPrice || i.price) * i.quantity} ج.م`)
            .join("\n")
        : "";

      const tgMessage = `🔔 <b>طلب شراء جديد في متجر صُدْفَة</b>\n\n` +
        `<b>رقم الطلب:</b> <code>#${order.id}</code>\n` +
        `<b>العميل:</b> ${order.customerName}\n` +
        `<b>الهاتف:</b> <code>${order.phone}</code>\n` +
        `<b>المحافظة:</b> ${order.governorate} — ${order.city}\n` +
        `<b>العنوان:</b> ${order.address}\n\n` +
        `<b>المنتجات:</b>\n${itemsLines}\n\n` +
        `<b>الإجمالي:</b> <b>${order.totalAmount} ج.م</b> (الدفع عند الاستلام)\n` +
        `<b>الملاحظات:</b> ${order.notes || "لا توجد"}`;

      tasks.push(
        fetch(`https://api.telegram.org/bot${encodeURIComponent(settings.telegramBotToken)}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: settings.telegramChatId,
            text: tgMessage,
            parse_mode: "HTML",
          }),
        }).catch((err) => console.warn("Telegram dispatch error:", err?.message || err))
      );
    }

    Promise.allSettled(tasks);
  } catch (err) {
    console.warn("Background notification trigger error:", err?.message || err);
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  await ensureInitialized();
  const db = getDb();
  const method = req.method;

  // 1. POST: Public customer checkout order placement
  if (method === "POST") {
    try {
      const b = req.body || {};
      const customerName = String(b.customerName || b.name || "").trim();
      const phone = String(b.phone || "").trim();
      const governorate = String(b.governorate || "").trim();
      const city = String(b.city || "").trim();
      const address = String(b.address || "").trim();
      const notes = String(b.notes || "لا توجد ملاحظات").trim();

      if (!customerName || !phone || !governorate || !address) {
        return res.status(400).json({ ok: false, error: "يرجى استيفاء جميع بيانات العميل والشحن المطلوبة." });
      }

      // Sanitize and validate items
      const rawItems = Array.isArray(b.items) ? b.items : [];
      const validatedItems = [];
      let calculatedTotal = 0;

      for (const item of rawItems) {
        if (!item || !item.name) continue;
        const unitPrice = Math.max(0, Math.round(Number(item.unitPrice ?? item.price ?? 0)));
        const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
        calculatedTotal += unitPrice * qty;
        validatedItems.push({
          id: String(item.id || "").trim(),
          name: String(item.name).trim(),
          unitPrice,
          price: unitPrice,
          quantity: qty,
          color: String(item.color || item.variant || "").trim(),
          variant: String(item.variant || item.color || "").trim(),
          image: String(item.image || item.imageUrl || "/sodfa-promo-poster.jpg").trim(),
        });
      }

      if (validatedItems.length === 0) {
        return res.status(400).json({ ok: false, error: "سلة الطلب فارغة أو البيانات غير صالحة." });
      }

      const totalAmount = b.totalAmount !== undefined && Number(b.totalAmount) > 0
        ? Math.round(Number(b.totalAmount))
        : calculatedTotal;

      const orderId = String(b.id || `DAF-${Math.floor(1000 + Math.random() * 9000)}`).replace(/^[#]/, "").trim();
      const deliveryTimeline = String(b.deliveryTimeline || "خلال 2 إلى 4 أيام عمل").trim();
      const now = new Date().toISOString();

      await db.execute({
        sql: `INSERT OR REPLACE INTO orders (
          id, customer_name, phone, governorate, city, address, notes,
          total_amount, items_json, delivery_timeline, status, is_read, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        args: [
          orderId,
          customerName,
          phone,
          governorate,
          city,
          address,
          notes,
          totalAmount,
          JSON.stringify(validatedItems),
          deliveryTimeline,
          "new",
          0,
          now,
          now,
        ],
      });

      const order = {
        id: orderId,
        customerName,
        phone,
        governorate,
        city,
        address,
        notes,
        totalAmount,
        items: validatedItems,
        deliveryTimeline,
        status: "new",
        isRead: false,
        createdAt: now,
        updatedAt: now,
      };

      // Background notifications trigger
      sendOrderNotifications(order, db);

      return res.status(201).json({ ok: true, order });
    } catch (err) {
      console.error("POST /api/orders error:", err);
      return res.status(500).json({ ok: false, error: "تعذر حفظ الطلب في قاعدة البيانات.", details: err?.message });
    }
  }

  // 2. GET: Order tracking lookup OR Admin list of orders
  if (method === "GET") {
    try {
      const rawQuery = req.query?.query || req.query?.search;
      const orderIdParam = req.query?.id;

      // Case A: Customer Order Tracking by Search Query (Order ID or Phone)
      if (rawQuery || orderIdParam) {
        const q = normalizeQuery(rawQuery || orderIdParam).toLowerCase();
        const strippedQ = q.replace(/^[#]?(daf-|sdf-)?/i, "").trim();
        const cleanPhoneQuery = formatWhatsAppPhone(q);

        const allOrdersRes = await db.execute("SELECT * FROM orders ORDER BY created_at DESC;");
        const allOrders = allOrdersRes.rows.map(mapOrderRow);

        const matching = allOrders.filter((order) => {
          const ordId = String(order.id || "").toLowerCase();
          const cleanOrdId = ordId.replace(/^[#]?(daf-|sdf-)?/i, "").trim();

          // 1. Direct ID match
          if (ordId === q || cleanOrdId === strippedQ) return true;

          // 2. Phone match
          const ordPhoneClean = formatWhatsAppPhone(order.phone || "");
          if (cleanPhoneQuery && ordPhoneClean) {
            if (ordPhoneClean === cleanPhoneQuery || ordPhoneClean.endsWith(cleanPhoneQuery)) {
              return true;
            }
          }
          if (order.phone && String(order.phone).includes(q)) return true;

          return false;
        });

        return res.status(200).json({ ok: true, orders: matching });
      }

      // Case B: Admin List of All Orders
      const admin = await authenticateAdmin(req);
      if (!admin) {
        return res.status(401).json({ ok: false, error: "غير مصرح. يرجى توفير استعلام تتبع أو تسجيل الدخول." });
      }

      const ordersRes = await db.execute("SELECT * FROM orders ORDER BY created_at DESC;");
      const orders = ordersRes.rows.map(mapOrderRow);

      return res.status(200).json({ ok: true, orders });
    } catch (err) {
      console.error("GET /api/orders error:", err);
      return res.status(500).json({ ok: false, error: "فشل استرجاع سجلات الطلبات." });
    }
  }

  // Admin authentication required for PATCH and DELETE
  const admin = await authenticateAdmin(req);
  if (!admin) {
    return res.status(401).json({ ok: false, error: "غير مصرح. يرجى تسجيل الدخول بحساب مسؤول." });
  }

  // 3. PATCH: Update order status or mark as read
  if (method === "PATCH") {
    try {
      const b = req.body || {};
      const targetId = String(b.id || b.orderId || b.order_number || b.orderNumber || req.query?.id || "").trim();
      if (!targetId) {
        return res.status(400).json({ ok: false, error: "معرف الطلب مطلوب." });
      }

      // Generate all possible variations of the ID for 100% robust matching
      const cleanId = targetId.replace(/^[#]/, "").trim();
      const hashId = "#" + cleanId;
      const digitsOnly = targetId.replace(/\D/g, "");
      const dafId = cleanId.toUpperCase().startsWith("DAF-") ? cleanId.toUpperCase() : `DAF-${digitsOnly || cleanId}`;
      const hashDafId = "#" + dafId;
      const sdfId = cleanId.toUpperCase().startsWith("SDF-") ? cleanId.toUpperCase() : `SDF-${digitsOnly || cleanId}`;

      const idCandidates = Array.from(new Set([
        targetId,
        cleanId,
        hashId,
        digitsOnly,
        dafId,
        hashDafId,
        sdfId,
      ])).filter(Boolean);

      const updates = [];
      const args = [];

      if (b.status !== undefined) {
        let rawStatus = String(b.status).toLowerCase().trim();
        if (
          rawStatus === "shipping" ||
          rawStatus === "تم الشحن" ||
          rawStatus === "جاري الشحن" ||
          rawStatus === "جاري الشحن والتوصيل" ||
          rawStatus === "مع المندوب"
        ) {
          rawStatus = "shipped";
        } else if (rawStatus === "تم التأكيد" || rawStatus === "مؤكد" || rawStatus === "تم تأكيد الطلب") {
          rawStatus = "confirmed";
        } else if (rawStatus === "تم التسليم" || rawStatus === "مكتمل" || rawStatus === "تم التسليم بنجاح") {
          rawStatus = "delivered";
        } else if (rawStatus === "ملغي" || rawStatus === "ملغى" || rawStatus === "تم إلغاء الطلب" || rawStatus === "تم الالغاء") {
          rawStatus = "cancelled";
        } else if (rawStatus === "received" || rawStatus === "تم استلام الطلب" || rawStatus === "جديد" || rawStatus === "new") {
          rawStatus = "received";
        }
        updates.push("status = ?");
        args.push(rawStatus);
      }
      if (b.isRead !== undefined) {
        updates.push("is_read = ?");
        args.push(b.isRead ? 1 : 0);
      }

      if (updates.length === 0) {
        return res.status(400).json({ ok: false, error: "لم يتم تقديم أي حقول للتحديث." });
      }

      const now = new Date().toISOString();
      updates.push("updated_at = ?");
      args.push(now);

      // Pass ID targets for robust match
      const placeholders = idCandidates.map(() => "?").join(",");
      args.push(...idCandidates);

      await db.execute({
        sql: `UPDATE orders SET ${updates.join(", ")} WHERE id IN (${placeholders});`,
        args,
      });

      const updated = await db.execute({
        sql: `SELECT * FROM orders WHERE id IN (${placeholders}) LIMIT 1;`,
        args: idCandidates,
      });
      if (updated.rows.length === 0) {
        return res.status(404).json({ ok: false, error: "الطلب غير موجود في قاعدة البيانات." });
      }

      return res.status(200).json({ ok: true, order: mapOrderRow(updated.rows[0]) });
    } catch (err) {
      console.error("PATCH /api/orders error:", err);
      return res.status(500).json({ ok: false, error: "فشل تعديل حالة الطلب في قاعدة البيانات.", details: err?.message });
    }
  }

  // 4. DELETE: Single and bulk delete orders
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
        return res.status(400).json({ ok: false, error: "يرجى تحديد أرقام الطلبات المراد حذفها." });
      }

      const allTargets = new Set();
      for (const target of idsToDelete) {
        const raw = String(target).trim();
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

      const targetList = Array.from(allTargets).filter(Boolean);
      const placeholders = targetList.map(() => "?").join(",");

      await db.execute({
        sql: `DELETE FROM orders WHERE id IN (${placeholders});`,
        args: targetList,
      });

      return res.status(200).json({
        ok: true,
        deletedIds: idsToDelete,
        message: `تم حذف ${idsToDelete.length} طلب نهائيًا بنجاح.`,
      });
    } catch (err) {
      console.error("DELETE /api/orders error:", err);
      return res.status(500).json({ ok: false, error: "فشل حذف الطلبات." });
    }
  }

  return res.status(405).json({ ok: false, error: "Method not allowed." });
}
