import test from "node:test";
import assert from "node:assert/strict";

import storeHandler from "../api/store.js";
import productsHandler from "../api/products.js";
import ordersHandler from "../api/orders.js";
import settingsHandler from "../api/settings.js";
import authHandler from "../api/auth.js";
import { signAdminToken, getDb } from "../api/_db.js";

function createMockReqRes({ method = "GET", query = {}, body = {}, headers = {} } = {}) {
  const req = {
    method,
    query,
    body,
    headers: { ...headers },
  };

  let statusCode = 200;
  let headersSent = {};
  let responseData = null;

  const res = {
    statusCode,
    setHeader(key, val) {
      headersSent[key.toLowerCase()] = val;
    },
    status(code) {
      statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(payload) {
      responseData = payload;
      return this;
    },
    send(payload) {
      responseData = payload;
      return this;
    },
    get headers() {
      return headersSent;
    },
    get data() {
      return responseData;
    },
  };

  return { req, res };
}

test("API: GET /api/store returns complete storefront state with Cache-Control no-store", async () => {
  const { req, res } = createMockReqRes({ method: "GET" });
  await storeHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.data.ok, true);
  assert.ok(res.data.brandName.includes("صُدْفَة"));
  assert.ok(Array.isArray(res.data.products));
  assert.ok(Array.isArray(res.data.categories));
  assert.ok(Array.isArray(res.data.tickerItems));
  assert.ok(res.data.delivery);
  assert.ok(res.data.delivery.formatted);
  assert.ok(res.data.heroSettings);
  assert.ok(res.headers["cache-control"].includes("no-store"));
});

test("API: Admin authentication and RBAC via /api/auth", async () => {
  // Ensure default seeded passwords
  const db = getDb();
  await db.execute({
    sql: "UPDATE admins SET password_hash = ? WHERE username = 'hager';",
    args: [signAdminToken ? (await import("../api/_db.js")).hashPassword("hager2026") : ""],
  });

  // 1. Super Admin login
  const loginMock = createMockReqRes({
    method: "POST",
    query: { action: "login" },
    body: { username: "admin", password: "Daffa@2026#Super" },
  });
  await authHandler(loginMock.req, loginMock.res);

  assert.equal(loginMock.res.statusCode, 200);
  assert.equal(loginMock.res.data.ok, true);
  assert.ok(loginMock.res.data.token);
  assert.equal(loginMock.res.data.user.role, "super_admin");

  const superToken = loginMock.res.data.token;

  // 2. Hager Samir login
  const hagerLogin = createMockReqRes({
    method: "POST",
    query: { action: "login" },
    body: { username: "hager", password: "hager2026" },
  });
  await authHandler(hagerLogin.req, hagerLogin.res);
  assert.equal(hagerLogin.res.statusCode, 200);
  assert.equal(hagerLogin.res.data.user.fullName, "Hager Samir");

  // 3. GET /api/auth?action=me with valid Bearer token
  const meMock = createMockReqRes({
    method: "GET",
    query: { action: "me" },
    headers: { authorization: `Bearer ${superToken}` },
  });
  await authHandler(meMock.req, meMock.res);
  assert.equal(meMock.res.statusCode, 200);
  assert.equal(meMock.res.data.user.username, "admin");

  // 4. Password Recovery via Master Recovery Key on test user
  const tempUser = `user_${Date.now()}`;
  await db.execute({
    sql: `INSERT INTO admins (id, username, email, full_name, role, password_hash, permissions_json, status, created_at)
          VALUES (?, ?, ?, ?, 'regular_admin', ?, '{}', 'active', ?);`,
    args: [tempUser, tempUser, `${tempUser}@test.com`, "Test Admin", "hash123", new Date().toISOString()],
  });

  const recoverMock = createMockReqRes({
    method: "POST",
    query: { action: "recover" },
    body: {
      username: tempUser,
      recoveryKey: "DAFFA-RCV-9941-K7M3-SEC",
      newPassword: "newTempPassword2026",
    },
  });
  await authHandler(recoverMock.req, recoverMock.res);
  assert.equal(recoverMock.res.statusCode, 200);
  assert.equal(recoverMock.res.data.ok, true);
});

test("API: Product creation, update, and bulk deletion via /api/products", async () => {
  const superToken = signAdminToken({ userId: "usr_super_admin", username: "admin", role: "super_admin" });

  // 1. Create a new watch
  const testWatchId = `test-watch-${Date.now()}`;
  const createMock = createMockReqRes({
    method: "POST",
    headers: { authorization: `Bearer ${superToken}` },
    body: {
      id: testWatchId,
      name: "ساعة صُدْفَة تجريبية سحابية",
      basePrice: 1500,
      discountActive: true,
      discountPercent: 20,
      category: "رجالية",
      categoryId: "men",
      images: [{ imageUrl: "/test.jpg", colorLabel: "فضي" }],
      imageFraming: { aspectRatio: "1/1", objectFit: "cover", imageScale: 110 },
    },
  });
  await productsHandler(createMock.req, createMock.res);

  assert.equal(createMock.res.statusCode, 201);
  assert.equal(createMock.res.data.ok, true);
  assert.equal(createMock.res.data.product.id, testWatchId);
  assert.equal(createMock.res.data.product.salePrice, 1200);
  assert.equal(createMock.res.data.product.imageFraming.aspectRatio, "1/1");

  // 2. Update watch
  const updateMock = createMockReqRes({
    method: "PUT",
    headers: { authorization: `Bearer ${superToken}` },
    query: { id: testWatchId },
    body: {
      name: "ساعة صُدْفَة تجريبية محدثة",
      basePrice: 2000,
      discountActive: false,
    },
  });
  await productsHandler(updateMock.req, updateMock.res);
  assert.equal(updateMock.res.statusCode, 200);
  assert.equal(updateMock.res.data.product.name, "ساعة صُدْفَة تجريبية محدثة");
  assert.equal(updateMock.res.data.product.salePrice, 2000);

  // 3. Bulk Delete
  const deleteMock = createMockReqRes({
    method: "DELETE",
    headers: { authorization: `Bearer ${superToken}` },
    body: { ids: [testWatchId] },
  });
  await productsHandler(deleteMock.req, deleteMock.res);
  assert.equal(deleteMock.res.statusCode, 200);
  assert.deepEqual(deleteMock.res.data.deletedIds, [testWatchId]);

  // Verify it's gone
  const getMock = createMockReqRes({ method: "GET", query: { id: testWatchId } });
  await productsHandler(getMock.req, getMock.res);
  assert.equal(getMock.res.statusCode, 404);
});

test("API: Order creation, Order Tracking query lookup, and Status update via /api/orders", async () => {
  const superToken = signAdminToken({ userId: "usr_super_admin", username: "admin", role: "super_admin" });
  const testOrderId = `DAF-TEST-${Math.floor(1000 + Math.random() * 9000)}`;
  const testPhone = `010${Math.floor(10000000 + Math.random() * 90000000)}`;

  // 1. Customer places order
  const checkoutMock = createMockReqRes({
    method: "POST",
    body: {
      id: testOrderId,
      customerName: "أحمد محمود",
      phone: testPhone,
      governorate: "القاهرة",
      city: "مدينة نصر",
      address: "شارع عباس العقاد",
      notes: "يرجى الاتصال قبل الوصول",
      items: [
        { id: "sodfa-001", name: "ساعة كرونوغراف", unitPrice: 1500, quantity: 2, color: "بترولي" },
      ],
      totalAmount: 3000,
    },
  });
  await ordersHandler(checkoutMock.req, checkoutMock.res);

  assert.equal(checkoutMock.res.statusCode, 201);
  assert.equal(checkoutMock.res.data.ok, true);
  assert.equal(checkoutMock.res.data.order.id, testOrderId);
  assert.equal(checkoutMock.res.data.order.totalAmount, 3000);

  // 2. Customer tracks order by Order ID without #
  const trackById = createMockReqRes({
    method: "GET",
    query: { query: testOrderId.replace("DAF-", "") },
  });
  await ordersHandler(trackById.req, trackById.res);
  assert.equal(trackById.res.statusCode, 200);
  assert.equal(trackById.res.data.orders.length, 1);
  assert.equal(trackById.res.data.orders[0].id, testOrderId);

  // 3. Customer tracks order by Phone with Egyptian normalization
  const trackByPhone = createMockReqRes({
    method: "GET",
    query: { query: `+20 ${testPhone.slice(1, 4)} ${testPhone.slice(4, 7)} ${testPhone.slice(7)}` },
  });
  await ordersHandler(trackByPhone.req, trackByPhone.res);
  assert.equal(trackByPhone.res.statusCode, 200);
  assert.equal(trackByPhone.res.data.orders.length, 1);
  assert.equal(trackByPhone.res.data.orders[0].customerName, "أحمد محمود");

  // 4. Admin updates status to 'confirmed'
  const patchMock = createMockReqRes({
    method: "PATCH",
    headers: { authorization: `Bearer ${superToken}` },
    body: { id: testOrderId, status: "confirmed" },
  });
  await ordersHandler(patchMock.req, patchMock.res);
  assert.equal(patchMock.res.statusCode, 200);
  assert.equal(patchMock.res.data.order.status, "confirmed");

  // 5. Admin deletes order
  const delMock = createMockReqRes({
    method: "DELETE",
    headers: { authorization: `Bearer ${superToken}` },
    body: { ids: [testOrderId] },
  });
  await ordersHandler(delMock.req, delMock.res);
  assert.equal(delMock.res.statusCode, 200);
  assert.deepEqual(delMock.res.data.deletedIds, [testOrderId]);
});

test("API: Settings update via /api/settings", async () => {
  const superToken = signAdminToken({ userId: "usr_super_admin", username: "admin", role: "super_admin" });

  const putMock = createMockReqRes({
    method: "PUT",
    headers: { authorization: `Bearer ${superToken}` },
    body: {
      settings: {
        defaultWhatsapp: "01099887766",
        deliveryMinDays: 3,
        deliveryMaxDays: 5,
      },
      tickerItems: ["عرض خاص لفترة محدودة"],
    },
  });
  await settingsHandler(putMock.req, putMock.res);

  assert.equal(putMock.res.statusCode, 200);
  assert.equal(putMock.res.data.ok, true);
  assert.equal(putMock.res.data.settings.defaultWhatsapp, "01099887766");
  assert.equal(putMock.res.data.settings.deliveryMinDays, 3);
  assert.deepEqual(putMock.res.data.tickerItems, ["عرض خاص لفترة محدودة"]);
});
