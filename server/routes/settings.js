import { Router } from "express";
import { getPool } from "../db.js";
import { requireAdmin, requireCsrf } from "../auth.js";

const router = Router();

export function normalizePhone(value, field, errors) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.length > 32) {
    errors[field] = "رقم التواصل طويل أكثر من اللازم.";
    return "";
  }

  const latinDigits = raw
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
  const compact = latinDigits.replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(compact)) {
    errors[field] = "اكتب رقمًا صحيحًا؛ يمكنك إدخال رقم مصري محلي أو رقم دولي.";
    return "";
  }

  let digits = compact.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = `20${digits.slice(1)}`;

  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) {
    errors[field] = "تأكد من الرقم ومفتاح الدولة؛ الحد الدولي من 8 إلى 15 رقمًا.";
    return "";
  }
  return `+${digits}`;
}

function parseSettings(body) {
  const input = body && typeof body === "object" ? body : {};
  const errors = {};
  const settings = {
    whatsappNumber: normalizePhone(input.whatsappNumber, "whatsappNumber", errors),
    phoneNumber: normalizePhone(input.phoneNumber, "phoneNumber", errors),
  };
  return Object.keys(errors).length ? { errors } : { value: settings };
}

async function readSettings() {
  const [rows] = await getPool().execute(
    "SELECT phone_number, whatsapp_number FROM sodfa_store_settings WHERE id = 1 LIMIT 1",
  );
  const row = rows[0] || {};
  return {
    phoneNumber: row.phone_number || "",
    whatsappNumber: row.whatsapp_number || "",
  };
}

router.get("/settings", async (_request, response) => {
  return response.json({ settings: await readSettings() });
});

router.get("/admin/settings", requireAdmin, async (_request, response) => {
  return response.json({ settings: await readSettings() });
});

router.put("/admin/settings", requireAdmin, requireCsrf, async (request, response) => {
  const parsed = parseSettings(request.body);
  if (parsed.errors) return response.status(422).json({ error: "راجع أرقام التواصل المدخلة.", fields: parsed.errors });

  const { phoneNumber, whatsappNumber } = parsed.value;
  await getPool().execute(
    `INSERT INTO sodfa_store_settings (id, phone_number, whatsapp_number)
     VALUES (1, ?, ?)
     ON DUPLICATE KEY UPDATE
       phone_number = VALUES(phone_number),
       whatsapp_number = VALUES(whatsapp_number),
       updated_at = CURRENT_TIMESTAMP(3)`,
    [phoneNumber, whatsappNumber],
  );
  return response.json({ ok: true, settings: parsed.value });
});

export default router;
