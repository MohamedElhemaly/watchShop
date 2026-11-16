import test from "node:test";
import assert from "node:assert/strict";
import { parseCategory } from "../server/routes/categories.js";

test("trims and accepts a non-empty category name", () => {
  assert.deepEqual(parseCategory({ name: "  كلاسيكية  " }), { value: { name: "كلاسيكية" } });
});

test("rejects an empty category name and names longer than 80 characters", () => {
  assert.ok(parseCategory({ name: "   " }).errors.name);
  assert.ok(parseCategory({ name: "س".repeat(81) }).errors.name);
});
