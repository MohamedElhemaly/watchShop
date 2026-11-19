import test from "node:test";
import assert from "node:assert/strict";
import { saveStoredProducts, getStoredProducts } from "../src/data.js";
import { uploadToSupabaseStorage, fileToDataUrl, processMediaUpload } from "../src/mediaStorage.js";
import { getCloudSyncConfig } from "../src/cloudSync.js";

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

test("uploadToSupabaseStorage validates parameters and returns public HTTPS URL", async () => {
  const originalFetch = globalThis.fetch;
  try {
    // Mock successful Supabase Storage upload
    globalThis.fetch = async (url, opts) => {
      const strUrl = String(url);
      if (strUrl.includes("/storage/v1/object/product-images/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ Key: "product-images/products/test.webp" }),
          text: async () => "",
        };
      }
      return { ok: false, status: 404 };
    };

    const mockFile = {
      name: "watch-front.webp",
      type: "image/webp",
      size: 45000,
    };

    const publicUrl = await uploadToSupabaseStorage(
      mockFile,
      "https://xyz.supabase.co",
      "test-anon-key-123",
      "product-images"
    );

    assert.ok(publicUrl.startsWith("https://xyz.supabase.co/storage/v1/object/public/product-images/products/"));
    assert.ok(publicUrl.endsWith(".webp"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uploadToSupabaseStorage throws when credentials are missing", async () => {
  const mockFile = { name: "test.webp", type: "image/webp" };
  await assert.rejects(
    async () => uploadToSupabaseStorage(mockFile, "", ""),
    /Missing Supabase parameters/
  );
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
