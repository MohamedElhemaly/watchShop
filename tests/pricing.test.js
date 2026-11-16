import test from "node:test";
import assert from "node:assert/strict";
import { calculateDiscountedPrice } from "../src/pricing.js";

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
