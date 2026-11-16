import test from "node:test";
import assert from "node:assert/strict";
import { cairoDateString, isDiscountActive, isValidDateOnly } from "../server/discounts.js";

const scheduled = {
  discountPercent: 15,
  discountStartOn: "2025-01-03",
  discountEndOn: "2025-01-05",
  discountReason: "عرض افتتاح",
};

test("validates calendar dates rather than accepting impossible dates", () => {
  assert.equal(isValidDateOnly("2024-02-29"), true);
  assert.equal(isValidDateOnly("2025-02-29"), false);
  assert.equal(isValidDateOnly("2025-13-01"), false);
  assert.equal(isValidDateOnly("2025-1-01"), false);
});

test("uses the Cairo calendar date at midnight boundaries", () => {
  assert.equal(cairoDateString(new Date("2025-01-01T21:59:59.000Z")), "2025-01-01");
  assert.equal(cairoDateString(new Date("2025-01-01T22:00:00.000Z")), "2025-01-02");
});

test("activates on the inclusive start and end dates only", () => {
  assert.equal(isDiscountActive(scheduled, new Date("2025-01-02T22:00:00.000Z")), true);
  assert.equal(isDiscountActive(scheduled, new Date("2025-01-04T12:00:00.000Z")), true);
  assert.equal(isDiscountActive(scheduled, new Date("2025-01-05T21:59:59.000Z")), true);
  assert.equal(isDiscountActive(scheduled, new Date("2025-01-01T22:00:00.000Z")), false);
  assert.equal(isDiscountActive(scheduled, new Date("2025-01-05T22:00:00.000Z")), false);
});

test("keeps legacy discounts without schedule dates active and rejects incomplete schedules", () => {
  assert.equal(isDiscountActive({ discountPercent: 10, discountStartOn: null, discountEndOn: null }), true);
  assert.equal(isDiscountActive({ discountPercent: 10, discountStartOn: "2025-01-01", discountEndOn: null }), false);
  assert.equal(isDiscountActive({ ...scheduled, discountStartOn: "2025-02-01", discountEndOn: "2025-01-01" }), false);
  assert.equal(isDiscountActive({ ...scheduled, discountPercent: 0 }), false);
});
