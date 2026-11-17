import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDiscountedPrice,
  calculateFlexibleDiscount,
  formatDiscountLabel,
} from "../src/pricing.js";

test("calculates integer EGP sale prices using nearest-pound rounding", () => {
  assert.equal(calculateDiscountedPrice(500, 20), 400);
  assert.equal(calculateDiscountedPrice(125, 10), 113);
  assert.equal(calculateDiscountedPrice(250, 1), 248);
  assert.equal(calculateDiscountedPrice(1000, 99), 10);
  assert.equal(calculateDiscountedPrice(500, 0), 500);
});

test("rejects non-integer values and discounts outside 0–99 percent", () => {
  assert.throws(() => calculateDiscountedPrice(100.5, 10), RangeError);
  assert.throws(() => calculateDiscountedPrice(100, -1), RangeError);
  assert.throws(() => calculateDiscountedPrice(100, 100), RangeError);
});

test("calculateFlexibleDiscount handles percent, fixed, and none discount types", () => {
  // Percent discounts
  assert.equal(calculateFlexibleDiscount(1000, "percent", 15), 850);
  assert.equal(calculateFlexibleDiscount(1200, "percent", 10), 1080);
  // Fixed amount discounts
  assert.equal(calculateFlexibleDiscount(1500, "fixed", 300), 1200);
  assert.equal(calculateFlexibleDiscount(500, "fixed", 600), 0); // clamped to >= 0
  // None or zero value
  assert.equal(calculateFlexibleDiscount(1000, "none", 200), 1000);
  assert.equal(calculateFlexibleDiscount(1000, "percent", 0), 1000);
  assert.equal(calculateFlexibleDiscount(1000, "fixed", 0), 1000);
});

test("formatDiscountLabel generates clean Arabic discount badges", () => {
  assert.equal(formatDiscountLabel("percent", 20), "خصم ٢٠%");
  assert.equal(formatDiscountLabel("fixed", 250), "خصم ٢٥٠ ج.م");
  assert.equal(formatDiscountLabel("none", 100), "");
  assert.equal(formatDiscountLabel("percent", 0), "");
});
