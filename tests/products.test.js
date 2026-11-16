import test from "node:test";
import assert from "node:assert/strict";
import { parseProduct } from "../server/routes/products.js";

const validBase = {
  name: "ساعة اختبار",
  description: "الوصف\nمواصفة إضافية",
  basePrice: 500,
  discountPercent: 10,
  discountStartOn: "2026-11-10",
  discountEndOn: "2026-11-20",
  discountReason: "عرض افتتاح",
  categoryId: "123e4567-e89b-42d3-a456-426614174000",
  active: true,
  sortOrder: 0,
};

const storedImage = (colorLabel = "") => ({
  imageUrl: "/manus-storage/sodfa/products/123e4567-e89b-12d3-a456-426614174000.jpg",
  imageAlt: "ساعة صُدْفَة",
  colorLabel,
});

test("accepts a gallery with multiple color images and assigns stable display order", () => {
  const result = parseProduct({ ...validBase, images: [storedImage("فضي"), storedImage("ذهبي")] });
  assert.equal(result.errors, undefined);
  assert.equal(result.value.images.length, 2);
  assert.equal(result.value.images[0].colorLabel, "فضي");
  assert.equal(result.value.images[1].sortOrder, 1);
  assert.equal(result.value.imageUrl, result.value.images[0].imageUrl);
  assert.equal(result.value.discountStartOn, "2026-11-10");
  assert.equal(result.value.discountEndOn, "2026-11-20");
  assert.equal(result.value.discountReason, "عرض افتتاح");
  assert.equal(result.value.categoryId, validBase.categoryId);
});

test("accepts an unclassified product and rejects a malformed category id", () => {
  const unclassified = parseProduct({ ...validBase, categoryId: "", images: [storedImage()] });
  assert.equal(unclassified.errors, undefined);
  assert.equal(unclassified.value.categoryId, null);

  const invalidCategory = parseProduct({ ...validBase, categoryId: "not-a-category", images: [storedImage()] });
  assert.ok(invalidCategory.errors.categoryId);
});

test("requires an image before publishing an active product", () => {
  const result = parseProduct({ ...validBase, images: [] });
  assert.match(result.errors.images, /صورة واحدة على الأقل/);
});

test("rejects more than eight images and URLs outside managed storage", () => {
  const tooMany = parseProduct({ ...validBase, images: Array.from({ length: 9 }, () => storedImage()) });
  assert.match(tooMany.errors.images, /حتى 8 صور/);

  const invalidUrl = parseProduct({ ...validBase, images: [{ ...storedImage(), imageUrl: "https://example.com/watch.jpg" }] });
  assert.match(invalidUrl.errors.images, /تخزين المتجر/);
});

test("keeps compatibility with legacy products that only send one imageUrl", () => {
  const result = parseProduct({ ...validBase, imageUrl: storedImage().imageUrl, imageAlt: "ساعة بلون فضي" });
  assert.equal(result.errors, undefined);
  assert.equal(result.value.images.length, 1);
  assert.equal(result.value.images[0].imageAlt, "ساعة بلون فضي");
});

test("requires valid inclusive start/end dates and a reason for a new discount", () => {
  const missingDates = parseProduct({ ...validBase, discountStartOn: "", discountEndOn: "" });
  assert.ok(missingDates.errors.discountStartOn);
  assert.ok(missingDates.errors.discountEndOn);

  const missingReason = parseProduct({ ...validBase, discountReason: " " });
  assert.ok(missingReason.errors.discountReason);

  const invalidDate = parseProduct({ ...validBase, discountStartOn: "2026-02-30" });
  assert.ok(invalidDate.errors.discountStartOn);

  const reversedRange = parseProduct({ ...validBase, discountStartOn: "2026-11-21", discountEndOn: "2026-11-20" });
  assert.ok(reversedRange.errors.discountEndOn);
});

test("clears schedule values when discount is zero and enforces the reason length", () => {
  const noDiscount = parseProduct({ ...validBase, discountPercent: 0, discountReason: "عرض قديم", images: [storedImage()] });
  assert.equal(noDiscount.errors, undefined);
  assert.equal(noDiscount.value.discountStartOn, null);
  assert.equal(noDiscount.value.discountEndOn, null);
  assert.equal(noDiscount.value.discountReason, "");

  const longReason = parseProduct({ ...validBase, discountReason: "ا".repeat(121) });
  assert.ok(longReason.errors.discountReason);
});
