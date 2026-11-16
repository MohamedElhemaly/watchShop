import assert from "node:assert/strict";
import test from "node:test";
import { normalizePhone } from "../server/routes/settings.js";

test("normalizes an Egyptian local mobile to international form", () => {
  const errors = {};
  assert.equal(normalizePhone("010 1234 5678", "phone", errors), "+201012345678");
  assert.deepEqual(errors, {});
});

test("accepts an international number with a plus sign", () => {
  const errors = {};
  assert.equal(normalizePhone("+1 (202) 555-0123", "phone", errors), "+12025550123");
  assert.deepEqual(errors, {});
});

test("normalizes Arabic-Indic digits", () => {
  const errors = {};
  assert.equal(normalizePhone("٠١٠١٢٣٤٥٦٧٨", "phone", errors), "+201012345678");
  assert.deepEqual(errors, {});
});

test("allows an empty optional contact field", () => {
  const errors = {};
  assert.equal(normalizePhone("   ", "phone", errors), "");
  assert.deepEqual(errors, {});
});

test("rejects too-short numbers and reports the field", () => {
  const errors = {};
  assert.equal(normalizePhone("01012", "phone", errors), "");
  assert.match(errors.phone, /8 إلى 15/);
});
