import test from "node:test";
import assert from "node:assert/strict";

// Setup in-memory mock for localStorage and sessionStorage in Node environment
const createStorageMock = () => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
  };
};

globalThis.localStorage = createStorageMock();
globalThis.sessionStorage = createStorageMock();
globalThis.window = {
  dispatchEvent: () => {},
};

const {
  normalizeCartItem,
  sanitizeCart,
  formatDeliveryTimeline,
  getTickerDuration,
  hashPassword,
  verifyAdminCredentials,
  getAdminUsers,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  resetUserPassword,
  changeUserPassword,
  getMasterRecoveryKey,
  recoverPasswordWithKey,
  setAdminSession,
  getAdminSession,
  clearAdminSession,
  hasPermission,
} = await import("../src/data.js");

// ----------------------------------------------------
// 1. Cart Normalization & Ghost Item Elimination Tests
// ----------------------------------------------------
test("normalizeCartItem validates and preserves valid cart items with integer unitPrice", () => {
  const rawItem = {
    id: "sodfa-001",
    name: "صُدْفَة هيريتدج كرونوغراف",
    price: 2450,
    unitPrice: 2450,
    basePrice: 2800,
    quantity: 2,
    color: "أسود ملكي",
    image: "/watch1.jpg",
  };

  const normalized = normalizeCartItem(rawItem);
  assert.ok(normalized);
  assert.equal(normalized.id, "sodfa-001");
  assert.equal(normalized.name, "صُدْفَة هيريتدج كرونوغراف");
  assert.equal(normalized.unitPrice, 2450);
  assert.equal(normalized.price, 2450);
  assert.equal(normalized.quantity, 2);
  assert.equal(normalized.color, "أسود ملكي");
});

test("normalizeCartItem rejects corrupted and ghost items", () => {
  // Empty id
  assert.equal(normalizeCartItem({ id: "", name: "ساعة", price: 500, quantity: 1 }), null);
  // Missing name
  assert.equal(normalizeCartItem({ id: "123", name: "   ", price: 500, quantity: 1 }), null);
  // Zero or negative unit price
  assert.equal(normalizeCartItem({ id: "123", name: "ساعة", price: 0, quantity: 1 }), null);
  assert.equal(normalizeCartItem({ id: "123", name: "ساعة", price: -100, quantity: 1 }), null);
  // Invalid or zero quantity
  assert.equal(normalizeCartItem({ id: "123", name: "ساعة", price: 500, quantity: 0 }), null);
  assert.equal(normalizeCartItem({ id: "123", name: "ساعة", price: 500, quantity: -2 }), null);
  // Null or undefined
  assert.equal(normalizeCartItem(null), null);
  assert.equal(normalizeCartItem({}), null);
});

test("sanitizeCart purges ghost cart entries and computes correct subtotal without 0 EGP bug", () => {
  const dirtyCart = [
    { id: "sodfa-001", name: "ساعة أولى", price: 1500, quantity: 1 },
    {}, // ghost item
    { id: "", name: "", price: 0, quantity: 1 }, // corrupted legacy item
    null,
    { id: "sodfa-002", name: "ساعة ثانية", price: 800, quantity: 2 },
  ];

  const clean = sanitizeCart(dirtyCart);
  assert.equal(clean.length, 2);
  assert.equal(clean[0].id, "sodfa-001");
  assert.equal(clean[1].id, "sodfa-002");

  const total = clean.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
  assert.equal(total, 1500 * 1 + 800 * 2); // 3100 EGP, strictly non-zero
});

// ----------------------------------------------------
// 2. Dynamic Delivery Timeframe Formatter Tests
// ----------------------------------------------------
test("formatDeliveryTimeline outputs formatted Arabic strings dynamically", () => {
  // Default range 2 to 4 business days
  assert.equal(formatDeliveryTimeline({ deliveryMinDays: 2, deliveryMaxDays: 4, deliveryUnitText: "أيام عمل" }), "خلال 2 إلى 4 أيام عمل");

  // Single day (min == max)
  assert.equal(formatDeliveryTimeline({ deliveryMinDays: 1, deliveryMaxDays: 1, deliveryUnitText: "أيام عمل" }), "خلال 1 يوم عمل");
  assert.equal(formatDeliveryTimeline({ deliveryMinDays: 2, deliveryMaxDays: 2, deliveryUnitText: "أيام عمل" }), "خلال يومين عمل");

  // Custom unit (e.g. hours or days)
  assert.equal(formatDeliveryTimeline({ deliveryMinDays: 24, deliveryMaxDays: 48, deliveryUnitText: "ساعة" }), "خلال 24 إلى 48 ساعة");

  // Extended delivery range set by admin (e.g., 10 to 15 business days)
  assert.equal(formatDeliveryTimeline({ deliveryMinDays: 10, deliveryMaxDays: 15, deliveryUnitText: "أيام عمل" }), "خلال 10 إلى 15 أيام عمل");

  // Positional arguments support: (min, max, unit)
  assert.equal(formatDeliveryTimeline(10, 15, "أيام عمل"), "خلال 10 إلى 15 أيام عمل");
  assert.equal(formatDeliveryTimeline("10", "15", "أيام عمل"), "خلال 10 إلى 15 أيام عمل");
  assert.equal(formatDeliveryTimeline(1, 1, "أيام عمل"), "خلال 1 يوم عمل");

  // Missing or fallback settings
  assert.equal(formatDeliveryTimeline(null), "خلال 2 إلى 4 أيام عمل");
  assert.equal(formatDeliveryTimeline({}), "خلال 2 إلى 4 أيام عمل");
});

test("getTickerDuration maps speed presets and custom durations correctly", () => {
  assert.equal(getTickerDuration({ tickerSpeed: "ultra-slow" }), "150s");
  assert.equal(getTickerDuration({ tickerSpeed: "very-slow" }), "120s");
  assert.equal(getTickerDuration({ tickerSpeed: "slow" }), "90s");
  assert.equal(getTickerDuration({ tickerSpeed: "relaxed" }), "60s");
  assert.equal(getTickerDuration({ tickerSpeed: "medium" }), "40s");
  assert.equal(getTickerDuration({ tickerSpeed: "fast" }), "25s");

  // Custom duration
  assert.equal(getTickerDuration({ tickerSpeed: "custom", tickerDurationSeconds: 75 }), "75s");
  assert.equal(getTickerDuration({ tickerSpeed: "custom", tickerDurationSeconds: "100" }), "100s");

  // Fallback to medium (40s) on invalid or missing speed
  assert.equal(getTickerDuration({}), "40s");
  assert.equal(getTickerDuration(null), "40s");
  assert.equal(getTickerDuration({ tickerSpeed: "custom", tickerDurationSeconds: 2 }), "40s");
});

// ----------------------------------------------------
// 3. Admin Authentication & Recovery Key Tests
// ----------------------------------------------------
test("hashPassword produces deterministic SHA-256 equivalent hash", () => {
  const h1 = hashPassword("Daffa@2026#Super");
  const h2 = hashPassword("Daffa@2026#Super");
  const h3 = hashPassword("DifferentPass");

  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.ok(h1.startsWith("sha256_"));
});

test("verifyAdminCredentials handles Super Admin and invalid logins", () => {
  globalThis.localStorage.clear();

  // Super Admin login with official credentials
  const superAdmin = verifyAdminCredentials("admin", "Daffa@2026#Super");
  assert.ok(superAdmin);
  assert.equal(superAdmin.role, "super_admin");
  assert.equal(superAdmin.username, "admin");

  // Case insensitive username
  const caseTest = verifyAdminCredentials("ADMIN", "Daffa@2026#Super");
  assert.ok(caseTest);

  // Invalid password returns null
  assert.equal(verifyAdminCredentials("admin", "WrongPassword123"), null);
  // Unknown username returns null
  assert.equal(verifyAdminCredentials("nonexistent", "Daffa@2026#Super"), null);
});

test("recoverPasswordWithKey resets password with master recovery key", () => {
  globalThis.localStorage.clear();
  const masterKey = getMasterRecoveryKey();
  assert.ok(masterKey);

  // Reset admin password via master recovery key
  const recoveredUser = recoverPasswordWithKey("admin", masterKey, "NewPass@2026#Secure");
  assert.ok(recoveredUser);

  // Check login with new password
  const loggedIn = verifyAdminCredentials("admin", "NewPass@2026#Secure");
  assert.ok(loggedIn);

  // Rejection with bad key
  assert.throws(() => {
    recoverPasswordWithKey("admin", "INVALID-KEY-1234", "AnyNewPassword");
  }, /مفتاح الاسترداد غير صحيح/);
});

// ----------------------------------------------------
// 4. Role-Based Access Control (RBAC) & Sessions Tests
// ----------------------------------------------------
test("Super Admin has all permissions unconditionally", () => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();

  const superAdmin = verifyAdminCredentials("admin", "Daffa@2026#Super");
  setAdminSession({
    userId: superAdmin.id,
    username: superAdmin.username,
    role: "super_admin",
  }, true);

  assert.equal(hasPermission("view_orders"), true);
  assert.equal(hasPermission("manage_orders"), true);
  assert.equal(hasPermission("manage_products"), true);
  assert.equal(hasPermission("manage_categories"), true);
  assert.equal(hasPermission("manage_storefront"), true);
  assert.equal(hasPermission("manage_delivery_settings"), true);
});

test("Regular Admin user creation, permission checks, and suspension", () => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();

  // Create limited admin: only view_orders and manage_products
  const limitedAdmin = createAdminUser({
    fullName: "طارق مندوب الطلبات",
    username: "tarek_orders",
    password: "Password@123",
    permissions: {
      view_orders: true,
      manage_orders: false,
      manage_products: true,
      manage_categories: false,
      manage_storefront: false,
      manage_delivery_settings: false,
    },
  });

  assert.ok(limitedAdmin.id);
  assert.equal(limitedAdmin.role, "regular_admin");

  // Create admin Hager Samir and test login by full name, trimmed, and case-insensitive
  const hagerAdmin = createAdminUser({
    fullName: "Hager Samir",
    username: "hager_s",
    password: "HagerPassword@2026",
    permissions: { view_orders: true, manage_orders: true },
  });
  const loginByFullName = verifyAdminCredentials("Hager Samir", "HagerPassword@2026");
  assert.ok(loginByFullName, "Should authenticate by full name 'Hager Samir'");
  assert.equal(loginByFullName.id, hagerAdmin.id);

  const loginTrimmed = verifyAdminCredentials("  hager samir  ", "HagerPassword@2026");
  assert.ok(loginTrimmed, "Should authenticate with trimmed whitespace and lowercasing");

  // Set session for limited admin
  setAdminSession({
    userId: limitedAdmin.id,
    username: limitedAdmin.username,
    role: "regular_admin",
    permissions: limitedAdmin.permissions,
  }, false);

  // Check granted permissions
  assert.equal(hasPermission("view_orders"), true);
  assert.equal(hasPermission("manage_products"), true);

  // Check restricted permissions
  assert.equal(hasPermission("manage_orders"), false);
  assert.equal(hasPermission("manage_categories"), false);
  assert.equal(hasPermission("manage_storefront"), false);
  assert.equal(hasPermission("manage_delivery_settings"), false);

  // Suspend the user
  updateAdminUser(limitedAdmin.id, { status: "suspended" });

  // Suspended user credentials verification returns error notice
  const loginAttempt = verifyAdminCredentials("tarek_orders", "Password@123");
  assert.ok(loginAttempt.error);
  assert.match(loginAttempt.error, /موقوف/);

  // Active session of suspended user is invalidated automatically
  const sessionCheck = getAdminSession();
  assert.equal(sessionCheck, null);
});

test("deleteAdminUser protects Super Admin from being deleted", () => {
  globalThis.localStorage.clear();
  const users = getAdminUsers();
  const superUser = users.find(u => u.role === "super_admin");

  assert.throws(() => {
    deleteAdminUser(superUser.id);
  }, /لا يمكن حذف حساب المدير العام/);
});
