import { randomUUID } from "node:crypto";
import express, { Router } from "express";
import { requireAdmin, requireCsrf } from "../auth.js";

const router = Router();
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const imageTypes = new Map([
  ["image/jpeg", { extension: "jpg", matches: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff }],
  ["image/png", { extension: "png", matches: (bytes) => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
  ["image/webp", { extension: "webp", matches: (bytes) => bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" }],
]);

router.post("/", requireAdmin, requireCsrf, express.raw({ type: "*/*", limit: "5mb" }), async (request, response) => {
  if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
    return response.status(400).json({ error: "اختر صورة قبل الرفع." });
  }
  if (request.body.length > MAX_IMAGE_BYTES) {
    return response.status(413).json({ error: "حجم الصورة يتجاوز 5 ميجابايت." });
  }

  const contentType = String(request.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const imageType = imageTypes.get(contentType);
  if (!imageType || !imageType.matches(request.body)) {
    return response.status(415).json({ error: "الصيغ المدعومة هي JPG أو PNG أو WebP فقط." });
  }
  if (!process.env.MANUS_API_URL || !process.env.MANUS_API_KEY) {
    return response.status(503).json({ error: "تخزين صور الموقع غير مهيأ بعد." });
  }

  const key = `sodfa/products/${randomUUID()}.${imageType.extension}`;
  const presignEndpoint = new URL("/v1/storage/presign/put", process.env.MANUS_API_URL);
  presignEndpoint.searchParams.set("path", key);

  try {
    const presignResponse = await fetch(presignEndpoint, {
      headers: { authorization: `Bearer ${process.env.MANUS_API_KEY}` },
      signal: AbortSignal.timeout(15_000),
    });
    const presign = await presignResponse.json().catch(() => ({}));
    if (!presignResponse.ok || !presign.url) {
      console.error("Image upload presign failed with status", presignResponse.status);
      return response.status(502).json({ error: "تعذر تجهيز رفع الصورة. حاول مرة أخرى." });
    }

    const uploadResponse = await fetch(presign.url, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: request.body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!uploadResponse.ok) {
      console.error("Image storage upload failed with status", uploadResponse.status);
      return response.status(502).json({ error: "فشل رفع الصورة إلى التخزين. حاول مرة أخرى." });
    }

    return response.status(201).json({ imageUrl: `/manus-storage/${key}` });
  } catch (error) {
    console.error("Image upload failed:", error?.message || "unknown error");
    return response.status(502).json({ error: "تعذر الاتصال بتخزين الصور الآن." });
  }
});

export default router;
