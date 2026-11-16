import test from "node:test";
import assert from "node:assert/strict";
import {
  cairoDate,
  formatRemainingDuration,
  promotionExpiryUtc,
  schedulePromotionRefresh,
  startPromotionCountdowns,
} from "../src/promotions.js";

test("uses the Cairo calendar date at midnight boundaries", () => {
  assert.equal(cairoDate(new Date("2025-01-01T21:59:59.000Z")), "2025-01-01");
  assert.equal(cairoDate(new Date("2025-01-01T22:00:00.000Z")), "2025-01-02");
});

test("treats the promotion end date as inclusive through the next Cairo midnight", () => {
  assert.equal(promotionExpiryUtc("2025-01-05"), Date.UTC(2025, 0, 5, 22, 0, 0));
  assert.equal(promotionExpiryUtc("2025-02-30"), null);
});

test("formats remaining time as a compact digital counter without Arabic words", () => {
  const remaining = 26 * 60 * 60_000 + 31 * 60_000 + 1_000;
  assert.equal(formatRemainingDuration(remaining), "01d : 02h : 32m");
  assert.equal(formatRemainingDuration(50 * 60_000), "00d : 00h : 50m");
  assert.equal(formatRemainingDuration(0), "00d : 00h : 00m");
});

test("updates a countdown element from the server clock", () => {
  const originalWindow = globalThis.window;
  const scheduled = [];
  const timer = {
    hidden: false,
    textContent: "",
    getAttribute(name) { return name === "data-discount-end" ? "2025-01-05" : null; },
  };
  globalThis.window = {
    clearInterval() {},
    setInterval(callback, delay) { scheduled.push({ callback, delay }); return 7; },
  };
  try {
    startPromotionCountdowns({ querySelectorAll: () => [timer] }, "2025-01-04T22:00:00.000Z");
    assert.equal(timer.textContent, "01d : 00h : 00m");
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay, 15_000);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("schedules a future offer start from server time in Cairo, not the device clock", () => {
  const originalWindow = globalThis.window;
  const timers = [];
  globalThis.window = {
    setTimeout(callback, delay) { timers.push({ callback, delay }); return 1; },
    location: { reload() {} },
  };
  try {
    schedulePromotionRefresh([{
      discountPercent: 20,
      discountStartOn: "2025-01-02",
      discountEndOn: "2025-01-03",
    }], "2025-01-01T21:59:00.000Z");
    assert.equal(timers.length, 1);
    assert.ok(timers[0].delay >= 60_000 && timers[0].delay <= 61_500, `unexpected delay ${timers[0].delay}`);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("does not schedule a refresh when all offer dates have passed", () => {
  const originalWindow = globalThis.window;
  let calls = 0;
  globalThis.window = { setTimeout() { calls += 1; }, location: { reload() {} } };
  try {
    schedulePromotionRefresh([{
      discountPercent: 20,
      discountStartOn: "2025-01-01",
      discountEndOn: "2025-01-02",
    }], "2025-01-03T12:00:00.000Z");
    assert.equal(calls, 0);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
