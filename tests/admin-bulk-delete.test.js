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
};

const {
  STORE_SEEDED_KEY,
  ensureStoreSeeded,
  getStoredProducts,
  saveStoredProducts,
  deleteProduct,
  deleteProducts,
  getStoredCategories,
  saveStoredCategories,
  deleteCategories,
  getTickerItems,
  saveTickerItems,
  deleteTickerItems,
  getOrders,
  saveOrders,
  addOrder,
  deleteOrder,
  deleteOrders,
  getCart,
  saveCart,
  cleanupDeletedProducts,
  getStoreSettings,
  saveStoreSettings,
} = await import("../src/data.js");

test("ensureStoreSeeded initializes store on first run only", () => {
  localStorage.clear();
  assert.equal(localStorage.getItem(STORE_SEEDED_KEY), null);

  ensureStoreSeeded();
  assert.equal(localStorage.getItem(STORE_SEEDED_KEY), "true");

  const seededProducts = getStoredProducts();
  assert.ok(seededProducts.length > 0, "Products should be seeded initially");
  const seededCategories = getStoredCategories();
  assert.ok(seededCategories.length > 0, "Categories should be seeded initially");
  const seededTicker = getTickerItems();
  assert.ok(seededTicker.length > 0, "Ticker items should be seeded initially");
});

test("Deleting all products permanently persists an empty list [] without auto-reseeding", () => {
  localStorage.clear();
  ensureStoreSeeded();

  // Initial seeded products exist
  let products = getStoredProducts();
  assert.ok(products.length > 0);

  // Admin deletes all products
  const remaining = deleteProducts(products.map((p) => p.id));
  assert.equal(remaining.length, 0);

  // Subsequent reads must return [] and NOT fall back to initial default items
  const afterDelete = getStoredProducts();
  assert.equal(Array.isArray(afterDelete), true);
  assert.equal(afterDelete.length, 0, "Empty catalog must remain empty across reads");
});

test("Deleting all categories permanently persists an empty list [] without auto-reseeding", () => {
  localStorage.clear();
  ensureStoreSeeded();

  let cats = getStoredCategories();
  assert.ok(cats.length > 0);

  // Admin deletes all categories except 'all' (which is protected)
  const catIds = cats.filter((c) => c.id !== "all").map((c) => c.id);
  deleteCategories(catIds);

  const afterDelete = getStoredCategories();
  assert.equal(afterDelete.length, 1, "Only default 'all' should remain");
  assert.equal(afterDelete[0].id, "all");

  // If directly saved as [], it returns []
  saveStoredCategories([]);
  assert.deepEqual(getStoredCategories(), []);
});

test("Deleting all ticker items permanently persists an empty list [] without auto-reseeding", () => {
  localStorage.clear();
  ensureStoreSeeded();

  let ticker = getTickerItems();
  assert.ok(ticker.length > 0);

  // Admin deletes all ticker items
  const indices = ticker.map((_, i) => i);
  deleteTickerItems(indices);

  const afterDelete = getTickerItems();
  assert.equal(afterDelete.length, 0, "Empty ticker must remain empty");
});

test("deleteProducts automatically purges deleted products from customer cart", () => {
  localStorage.clear();
  ensureStoreSeeded();

  const products = getStoredProducts();
  const productA = products[0];
  const productB = products[1];

  // Customer adds both watches to cart
  saveCart([
    {
      id: productA.id,
      name: productA.name,
      unitPrice: productA.salePrice || productA.basePrice,
      quantity: 1,
      color: "أسود",
    },
    {
      id: productB.id,
      name: productB.name,
      unitPrice: productB.salePrice || productB.basePrice,
      quantity: 2,
      color: "فضي",
    },
  ]);

  let cart = getCart();
  assert.equal(cart.length, 2);

  // Admin deletes productA
  deleteProduct(productA.id);

  // Cart must be automatically cleaned up without orphan items
  cart = getCart();
  assert.equal(cart.length, 1);
  assert.equal(cart[0].id, productB.id);
});

test("deleteProducts automatically resets featured settings if featured watch is deleted", () => {
  localStorage.clear();
  ensureStoreSeeded();

  const products = getStoredProducts();
  const productA = products[0];
  const productB = products[1];

  // Set featured to productA
  saveStoreSettings({
    ...getStoreSettings(),
    featuredName: productA.name,
    featuredSpec: productA.shortSpec,
  });

  // Admin deletes productA
  deleteProduct(productA.id);

  // Featured name should safely shift to remaining product or empty string
  const settings = getStoreSettings();
  assert.notEqual(settings.featuredName, productA.name);
});

test("deleteOrders and deleteOrder permanently remove orders individually and in bulk", () => {
  localStorage.clear();

  // Create sample orders
  const o1 = addOrder({ customerName: "عميل 1", totalAmount: 2500, phone: "01011111111" });
  const o2 = addOrder({ customerName: "عميل 2", totalAmount: 3200, phone: "01022222222" });
  const o3 = addOrder({ customerName: "عميل 3", totalAmount: 4100, phone: "01033333333" });

  let allOrders = getOrders();
  assert.equal(allOrders.length, 3);

  // Delete single order
  deleteOrder(o1.id);
  allOrders = getOrders();
  assert.equal(allOrders.length, 2);
  assert.ok(!allOrders.some((o) => o.id === o1.id));

  // Bulk delete remaining orders
  deleteOrders([o2.id, o3.id]);
  allOrders = getOrders();
  assert.equal(allOrders.length, 0, "All orders should be deleted permanently");
});
