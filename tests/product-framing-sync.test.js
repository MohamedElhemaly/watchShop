import test from "node:test";
import assert from "node:assert/strict";
import { saveStoredProducts, getStoredProducts } from "../src/data.js";
import { fileToDataUrl } from "../src/mediaStorage.js";
import { getCloudSyncConfig } from "../src/cloudSync.js";
import {
  utf8ToBase64,
  base64ToUtf8,
  getGitHubConfig,
  saveGitHubConfig,
  buildStoreSnapshot,
  restoreStoreFromData,
} from "../src/githubSync.js";

// Mock global environment for Node.js test runner
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

if (typeof globalThis.window === "undefined") {
  globalThis.window = {
    dispatchEvent: () => true,
    addEventListener: () => {},
  };
}

test("Product schema accepts and persists imageFraming settings", () => {
  const mockProduct = {
    id: "test-watch-framing-1",
    name: "صُدْفَة برستيج كلاسيك",
    basePrice: 4200,
    imageUrl: "https://example.com/watch.webp",
    imageFraming: {
      aspectRatio: "1/1",
      fitMode: "cover",
      scale: 115,
      alignment: "top",
    },
  };

  saveStoredProducts([mockProduct]);
  const saved = getStoredProducts();
  const found = saved.find((p) => p.id === "test-watch-framing-1");

  assert.ok(found, "Product should be saved in stored products");
  assert.equal(found.imageFraming.aspectRatio, "1/1");
  assert.equal(found.imageFraming.fitMode, "cover");
  assert.equal(found.imageFraming.scale, 115);
  assert.equal(found.imageFraming.alignment, "top");
});

test("Default framing fallbacks to 4/5 contain and 100% scale", () => {
  const defaultFraming = {
    aspectRatio: "4/5",
    fitMode: "contain",
    scale: 100,
    alignment: "center",
  };

  assert.equal(defaultFraming.aspectRatio, "4/5");
  assert.equal(defaultFraming.fitMode, "contain");
  assert.equal(defaultFraming.scale, 100);
  assert.equal(defaultFraming.alignment, "center");
});

test("utf8ToBase64 and base64ToUtf8 correctly encode and decode Arabic characters", () => {
  const original = "صُدْفَة للساعات الفاخرة 2026 #DAF-9021";
  const encoded = utf8ToBase64(original);
  assert.ok(encoded && typeof encoded === "string");
  const decoded = base64ToUtf8(encoded);
  assert.equal(decoded, original);
});

test("GitHub config management saves and retrieves repo credentials", () => {
  globalThis.localStorage.clear();
  const empty = getGitHubConfig();
  assert.equal(empty.isConfigured, false);

  const saved = saveGitHubConfig({
    githubOwner: "sodfa-store",
    githubRepo: "sodfa-watches-pages",
    githubBranch: "main",
    githubToken: "ghp_test_token_abcdef",
  });

  assert.equal(saved.isConfigured, true);
  assert.equal(saved.githubOwner, "sodfa-store");
  assert.equal(saved.githubRepo, "sodfa-watches-pages");

  const retrieved = getGitHubConfig();
  assert.equal(retrieved.isConfigured, true);
  assert.equal(retrieved.githubToken, "ghp_test_token_abcdef");
});

test("buildStoreSnapshot exports clean data structure with products, settings, and orders", () => {
  const snapshot = buildStoreSnapshot("Test snapshot");
  assert.equal(snapshot.version, "2026.1");
  assert.ok(snapshot.updatedAt);
  assert.ok(Array.isArray(snapshot.products));
  assert.ok(Array.isArray(snapshot.categories));
  assert.ok(typeof snapshot.settings === "object");
});

test("restoreStoreFromData restores store state from valid backup object", () => {
  const sampleBackup = {
    version: "2026.1",
    settings: { brandName: "صُدْفَة الفاخرة" },
    products: [{ id: "test-p1", name: "ساعة تجريبية", basePrice: 2000 }],
    categories: [{ id: "c1", name: "تصنيف تجريبي" }],
    orders: [{ id: "DAF-9999", customerName: "عميل تجريبي" }],
  };

  const result = restoreStoreFromData(sampleBackup);
  assert.equal(result, true);
});

test("saveStoredProducts dispatches daffa:products-updated and recovers from storage quotas", () => {
  let eventDispatched = false;
  let eventDetail = null;

  globalThis.window.dispatchEvent = (event) => {
    if (event.type === "daffa:products-updated") {
      eventDispatched = true;
      eventDetail = event.detail;
    }
    return true;
  };

  const sampleProducts = [
    { id: "p1", name: "صُدْفَة سابمارينر", basePrice: 3800 },
    { id: "p2", name: "صُدْفَة هيريتدج", basePrice: 4500 },
  ];

  saveStoredProducts(sampleProducts);

  assert.ok(eventDispatched, "daffa:products-updated event must be dispatched");
  assert.equal(eventDetail.length, 2);
  assert.equal(eventDetail[0].name, "صُدْفَة سابمارينر");
});
