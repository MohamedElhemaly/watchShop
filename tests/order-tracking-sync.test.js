import test from "node:test";
import assert from "node:assert/strict";

// Setup in-memory mock for localStorage and sessionStorage in Node environment
const createStorageMock = () => {
  let store = {};
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, val) => {
      store[key] = String(val);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
};

globalThis.localStorage = createStorageMock();
globalThis.sessionStorage = createStorageMock();
globalThis.window = {
  dispatchEvent: () => {},
  addEventListener: () => {},
};

const {
  normalizeOrderQuery,
  orderMatchesQuery,
  getOrderStepState,
} = await import("../src/orderTracker.js");

const {
  getCloudSyncConfig,
} = await import("../src/cloudSync.js");

const {
  defaultStoreSettings,
  getStoreSettings,
  isValidWhatsAppPhone,
  buildWhatsAppUrl,
  verifyAdminCredentials,
  createAdminUser,
} = await import("../src/data.js");

// ----------------------------------------------------
// 1. Order Query Normalization & Matching Tests
// ----------------------------------------------------
test("normalizeOrderQuery converts Arabic digits and trims query", () => {
  assert.equal(normalizeOrderQuery("  #DAF-1042  "), "#DAF-1042");
  assert.equal(normalizeOrderQuery("٠١٠١٢٣٤٥٦٧٨"), "01012345678");
  assert.equal(normalizeOrderQuery(""), "");
});

test("orderMatchesQuery matches orders by ID with or without prefixes", () => {
  const sampleOrder = {
    id: "DAF-5646",
    customerName: "عمرو حسن",
    phone: "01012345678",
    status: "new",
  };

  // Exact ID
  assert.equal(orderMatchesQuery(sampleOrder, "DAF-5646"), true);
  // With hash #DAF-5646
  assert.equal(orderMatchesQuery(sampleOrder, "#DAF-5646"), true);
  // Pure digits 5646
  assert.equal(orderMatchesQuery(sampleOrder, "5646"), true);
  // Case insensitive
  assert.equal(orderMatchesQuery(sampleOrder, "daf-5646"), true);

  // Phone matching (local and international)
  assert.equal(orderMatchesQuery(sampleOrder, "01012345678"), true);
  assert.equal(orderMatchesQuery(sampleOrder, "+201012345678"), true);
  assert.equal(orderMatchesQuery(sampleOrder, "201012345678"), true);
  assert.equal(orderMatchesQuery(sampleOrder, "٠١٠١٢٣٤٥٦٧٨"), true);

  // Non-matching query
  assert.equal(orderMatchesQuery(sampleOrder, "9999"), false);
  assert.equal(orderMatchesQuery(sampleOrder, "01299999999"), false);
});

// ----------------------------------------------------
// 2. Timeline Step Progression Tests
// ----------------------------------------------------
test("getOrderStepState maps order status to 4 progressive stages or cancelled", () => {
  // Step 1: New / Received
  const step1 = getOrderStepState("new");
  assert.equal(step1.activeStep, 1);
  assert.equal(step1.isCancelled, false);

  // Step 2: Confirmed
  const step2 = getOrderStepState("confirmed");
  assert.equal(step2.activeStep, 2);
  assert.deepEqual(step2.completedSteps, [1]);
  assert.equal(step2.isCancelled, false);

  // Step 3: Out for Delivery / Shipping
  const step3 = getOrderStepState("shipping");
  assert.equal(step3.activeStep, 3);
  assert.deepEqual(step3.completedSteps, [1, 2]);
  assert.equal(step3.isCancelled, false);

  // Step 4: Delivered
  const step4 = getOrderStepState("delivered");
  assert.equal(step4.activeStep, 4);
  assert.deepEqual(step4.completedSteps, [1, 2, 3, 4]);
  assert.equal(step4.isCancelled, false);

  // Cancelled
  const stepCancelled = getOrderStepState("cancelled");
  assert.equal(stepCancelled.isCancelled, true);
  assert.equal(stepCancelled.activeStep, 0);

  const stepCancelledAr = getOrderStepState("ملغي");
  assert.equal(stepCancelledAr.isCancelled, true);
});

// ----------------------------------------------------
// 3. Fake WhatsApp Elimination Tests
// ----------------------------------------------------
test("Fake dummy WhatsApp number +201000000000 is sanitized and rejected", () => {
  // Default settings have empty WhatsApp, not dummy number
  assert.equal(defaultStoreSettings.defaultWhatsapp, "");
  assert.equal(defaultStoreSettings.defaultPhone, "");

  // Legacy localStorage containing dummy number is sanitized
  globalThis.localStorage.setItem(
    "daffa_store_settings",
    JSON.stringify({ defaultWhatsapp: "+201000000000", defaultPhone: "+201000000000" })
  );
  const settings = getStoreSettings();
  assert.equal(settings.defaultWhatsapp, "");
  assert.equal(settings.defaultPhone, "");

  // Dummy numbers return false from validation and empty from URL builder
  assert.equal(isValidWhatsAppPhone("+201000000000"), false);
  assert.equal(isValidWhatsAppPhone("201000000000"), false);
  assert.equal(buildWhatsAppUrl("+201000000000", "test message"), "");
});

// ----------------------------------------------------
// 4. Cross-Device Admin Account Verification Tests
// ----------------------------------------------------
test("Admin authentication supports Hager Samir case-insensitively with trimmed whitespace", () => {
  globalThis.localStorage.clear();

  // Create admin account
  createAdminUser({
    fullName: "Hager Samir",
    username: "hager_admin",
    password: "Password@2026#Secure",
    permissions: { manage_products: true, view_orders: true },
  });

  // Authenticate by username (various casings and spaces)
  const byUser = verifyAdminCredentials("  hager_admin  ", "Password@2026#Secure");
  assert.ok(byUser);
  assert.equal(byUser.username, "hager_admin");

  // Authenticate by Full Name (Hager Samir)
  const byFullName = verifyAdminCredentials("Hager Samir", "Password@2026#Secure");
  assert.ok(byFullName);
  assert.equal(byFullName.fullName, "Hager Samir");

  const byFullNameTrimmed = verifyAdminCredentials("  hager samir  ", "Password@2026#Secure");
  assert.ok(byFullNameTrimmed);
});

// ----------------------------------------------------
// 5. Cloud Sync Configuration Tests (GitHub Pages)
// ----------------------------------------------------
test("getCloudSyncConfig detects configured vs unconfigured GitHub sync credentials", () => {
  globalThis.localStorage.clear();
  const configEmpty = getCloudSyncConfig();
  assert.equal(configEmpty.isConfigured, false);

  globalThis.localStorage.setItem(
    "daffa_github_config",
    JSON.stringify({
      githubOwner: "sodfa-watches",
      githubRepo: "sodfa-catalog",
      githubBranch: "main",
      githubToken: "ghp_mock_token_12345",
    })
  );
  const configFilled = getCloudSyncConfig();
  assert.equal(configFilled.isConfigured, true);
  assert.equal(configFilled.githubOwner, "sodfa-watches");
  assert.equal(configFilled.githubRepo, "sodfa-catalog");
  assert.equal(configFilled.githubBranch, "main");
});
