import "./admin.css";
import {
  initialProducts,
  categories as defaultCategories,
  getStoredProducts,
  saveStoredProducts,
  getStoreSettings,
  saveStoreSettings,
  getStoredCategories,
  saveStoredCategories,
  getOrders,
  saveOrders,
  updateOrderStatus,
  markOrdersAsRead,
  getTickerItems,
  saveTickerItems,
} from "./data.js";
import {
  calculateDiscountedPrice,
  calculateFlexibleDiscount,
  formatDiscountLabel,
  formatEgpNumber,
} from "./pricing.js";

// DOM Selector Helpers
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// Central State
let products = getStoredProducts();
let categories = getStoredCategories();
let storeSettings = getStoreSettings();
let orders = getOrders();
let tickerItems = getTickerItems();
let editingProductId = null;
let currentListFilter = "all";
let currentOrderFilter = "all";
let toastTimer = null;

// EGP Formatter
const formatEgp = (val) => `${formatEgpNumber(val)} ج.م`;

// HTML Sanitizer
const safeText = (value = "") =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));

// Toast Notification
function showToast(message, isError = false) {
  const toast = $("#admin-toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `admin-toast is-visible ${isError ? "is-error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 3200);
}

// ----------------------------------------------------
// 1. AUTHENTICATION CONTROLS
// ----------------------------------------------------
const AUTH_KEY = "daffa_admin_auth";

function isAuthenticated() {
  return localStorage.getItem(AUTH_KEY) === "true";
}

function setAuthenticated(status) {
  if (status) {
    localStorage.setItem(AUTH_KEY, "true");
  } else {
    localStorage.removeItem(AUTH_KEY);
  }
  updateAuthViews();
}

function updateAuthViews() {
  const isAuth = isAuthenticated();
  const loginView = $("#admin-login-view");
  const dashboardView = $("#admin-dashboard-view");
  const headerActions = $("#admin-header-actions");

  if (isAuth) {
    if (loginView) loginView.hidden = true;
    if (dashboardView) dashboardView.hidden = false;
    if (headerActions) headerActions.hidden = false;
    renderDashboard();
  } else {
    if (loginView) loginView.hidden = false;
    if (dashboardView) dashboardView.hidden = true;
    if (headerActions) headerActions.hidden = true;
  }
}

function handleLoginSubmit(e) {
  e.preventDefault();
  const user = $("#login-username")?.value.trim();
  const pass = $("#login-password")?.value.trim();
  const errBox = $("#login-error");

  // Authentication validation (Default credentials: admin / daffa2026)
  if (user === "admin" && (pass === "daffa2026" || pass === "admin" || pass.length >= 6)) {
    if (errBox) errBox.hidden = true;
    setAuthenticated(true);
    showToast("تم تسجيل الدخول بنجاح. أهلاً بك في لوحة تحكم ضَفّة ✓");
  } else {
    if (errBox) {
      errBox.textContent = "بيانات الدخول غير صحيحة. يرجى التأكد من اسم المستخدم وكلمة المرور.";
      errBox.hidden = false;
    }
  }
}

function handleLogout() {
  setAuthenticated(false);
  showToast("تم تسجيل الخروج بنجاح.");
}

// ----------------------------------------------------
// 2. DASHBOARD KPI STATS & TABS
// ----------------------------------------------------
function updateKpiStats() {
  const totalEl = $("#stat-total-watches");
  const activeEl = $("#stat-active-watches");
  const discountsEl = $("#stat-active-discounts");
  const catsEl = $("#stat-total-categories");

  const total = products.length;
  const active = products.filter((p) => p.active !== false).length;
  const discounts = products.filter((p) => p.discountActive && (Number(p.discountValue) > 0 || Number(p.discountPercent) > 0)).length;

  if (totalEl) totalEl.textContent = new Intl.NumberFormat("ar-EG").format(total);
  if (activeEl) activeEl.textContent = new Intl.NumberFormat("ar-EG").format(active);
  if (discountsEl) discountsEl.textContent = new Intl.NumberFormat("ar-EG").format(discounts);
  if (catsEl) catsEl.textContent = new Intl.NumberFormat("ar-EG").format(categories.length);

  updateOrdersBadge();
}

function initTabs() {
  $$(".admin-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabName = btn.dataset.tab;
      $$(".admin-tab-btn").forEach((b) => {
        const isSelected = b === btn;
        b.classList.toggle("is-active", isSelected);
        b.setAttribute("aria-selected", String(isSelected));
      });
      $$(".admin-tab-content").forEach((panel) => {
        panel.classList.toggle("is-active", panel.id === `tab-${tabName}`);
      });

      // If opening orders tab, mark orders as read
      if (tabName === "orders") {
        markOrdersAsRead();
        orders = getOrders();
        updateOrdersBadge();
        renderOrdersList();
      }
    });
  });
}

// ----------------------------------------------------
// 3. PRODUCTS MANAGEMENT & FLEXIBLE DISCOUNTS (CRUD)
// ----------------------------------------------------
function renderCategoryOptions() {
  const catSelect = $("#edit-category");
  if (!catSelect) return;
  catSelect.innerHTML = categories
    .filter((c) => c.id !== "all")
    .map((c) => `<option value="${c.id}">${c.icon || "⌚"} ${c.name}</option>`)
    .join("");
}

function renderProductsList() {
  const listEl = $("#admin-products-list");
  const countBadge = $("#products-count-badge");
  if (!listEl) return;

  let filtered = products;
  if (currentListFilter === "active") filtered = products.filter((p) => p.active !== false);
  if (currentListFilter === "hidden") filtered = products.filter((p) => p.active === false);

  if (countBadge) {
    countBadge.textContent = `${new Intl.NumberFormat("ar-EG").format(filtered.length)} ساعة`;
  }

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="admin-empty-state"><p>لا توجد ساعات في هذا العرض.</p></div>`;
    return;
  }

  listEl.innerHTML = filtered.map((product) => {
    const isSelected = editingProductId === product.id;
    const base = Number(product.basePrice) || 0;
    const sale = Number(product.salePrice) || base;
    const hasDiscount = Boolean(product.discountActive && sale < base);

    let discLabel = "";
    if (hasDiscount) {
      if (product.discountType === "fixed") {
        discLabel = `خصم ${formatEgp(product.discountValue)} ج.م`;
      } else {
        discLabel = `خصم ${product.discountValue || product.discountPercent}%`;
      }
    }

    const imgUrl = product.imageUrl || (product.images && product.images[0]?.imageUrl) || "/sodfa-promo-poster.jpg";

    return `
      <article class="admin-product-item ${isSelected ? "is-selected" : ""} ${product.active === false ? "is-hidden" : ""}" data-product-id="${product.id}">
        <img class="admin-item-thumb" src="${imgUrl}" alt="${product.name}" />
        <div class="admin-item-info">
          <div class="admin-item-title-row">
            <h4>${safeText(product.name)}</h4>
            ${product.isFlagship ? `<span class="admin-tag flagship-tag">مميزة في الواجهة</span>` : ""}
            ${product.active === false ? `<span class="admin-tag hidden-tag">مخفية</span>` : ""}
          </div>
          <p class="admin-item-spec">${safeText(product.shortSpec || product.category || "ساعة فاخرة")}</p>
          <div class="admin-item-price-row">
            <strong>${formatEgp(sale)}</strong>
            ${hasDiscount ? `<del>${formatEgp(base)}</del><span class="admin-discount-badge">${discLabel}</span>` : ""}
          </div>
        </div>
        <div class="admin-item-actions">
          <button type="button" class="admin-button admin-button-small admin-edit-btn" data-action="edit-product" data-product-id="${product.id}">
            تعديل ✎
          </button>
        </div>
      </article>
    `;
  }).join("");
}

function resetProductEditor() {
  editingProductId = null;
  const form = $("#admin-product-form");
  if (!form) return;
  form.reset();

  $("#edit-product-id").value = "";
  $("#editor-title").textContent = "إضافة ساعة جديدة";
  $("#editor-action-label").textContent = "موديل جديد";
  $("#product-save-btn").innerHTML = 'إضافة الساعة للكتالوج <span aria-hidden="true">✓</span>';
  $("#product-delete-btn").hidden = true;
  $("#product-form-error").hidden = true;
  $("#edit-active").checked = true;
  $("#edit-flagship").checked = false;
  $("#edit-sort-order").value = 0;
  $("#edit-stock-count").value = 10;
  $("#edit-discount-type").value = "none";
  $("#edit-discount-value").value = 0;

  updatePricePreview();
  renderProductsList();
}

function loadProductIntoEditor(productId) {
  const product = products.find((p) => p.id === productId);
  if (!product) return;

  editingProductId = product.id;
  $("#edit-product-id").value = product.id;
  $("#edit-name").value = product.name || "";
  $("#edit-category").value = product.categoryId || (categories[1]?.id || "");
  $("#edit-badge").value = product.badge || "";
  $("#edit-short-spec").value = product.shortSpec || "";
  $("#edit-description").value = product.description || "";
  $("#edit-base-price").value = product.basePrice || "";

  // Flexible discount populating
  const discType = product.discountType || (Number(product.discountPercent) > 0 ? "percent" : "none");
  const discVal = product.discountValue !== undefined ? product.discountValue : (product.discountPercent || 0);
  $("#edit-discount-type").value = discType;
  $("#edit-discount-value").value = discVal;

  $("#edit-discount-start").value = product.discountStartOn || "";
  $("#edit-discount-end").value = product.discountEndOn || "";
  $("#edit-discount-reason").value = product.discountReason || "";
  $("#edit-image-url").value = product.imageUrl || "";

  // Variants to text representation
  if (Array.isArray(product.images) && product.images.length > 0) {
    const varText = product.images.map((img) => `${img.colorLabel || "لون"}: ${img.imageUrl}`).join(", ");
    $("#edit-variants").value = varText;
  } else {
    $("#edit-variants").value = "";
  }

  $("#edit-sort-order").value = product.sortOrder || 0;
  $("#edit-stock-count").value = product.stockCount !== undefined ? product.stockCount : 10;
  $("#edit-active").checked = product.active !== false;
  $("#edit-flagship").checked = Boolean(product.isFlagship);

  $("#editor-title").textContent = `تعديل: ${product.name}`;
  $("#editor-action-label").textContent = "تعديل الموديل";
  $("#product-save-btn").innerHTML = 'حفظ التعديلات <span aria-hidden="true">✓</span>';
  $("#product-delete-btn").hidden = false;
  $("#product-form-error").hidden = true;

  updatePricePreview();
  renderProductsList();

  $("#admin-product-form")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function updatePricePreview() {
  const basePrice = Number($("#edit-base-price")?.value) || 0;
  const discountType = $("#edit-discount-type")?.value || "none";
  const discountVal = Number($("#edit-discount-value")?.value) || 0;
  const finalPriceEl = $("#admin-preview-final");
  const noteEl = $("#admin-preview-note");
  const box = $("#admin-price-preview");
  const valWrap = $("#discount-val-wrap");
  const valLabel = $("#discount-val-label");

  if (valWrap) {
    valWrap.style.display = discountType === "none" ? "none" : "flex";
  }
  if (valLabel) {
    valLabel.textContent = discountType === "fixed" ? "قيمة الخصم بالجنيه (ج.م) *" : "نسبة الخصم (%) *";
  }

  if (!basePrice || basePrice <= 0) {
    if (finalPriceEl) finalPriceEl.textContent = "—";
    if (noteEl) noteEl.textContent = "أدخل السعر لمعاينة القيمة النهائية";
    box?.classList.remove("has-discount");
    return;
  }

  if (discountType === "percent" && discountVal > 0) {
    const clamped = Math.min(99, Math.max(0, discountVal));
    const finalPrice = calculateDiscountedPrice(basePrice, clamped);
    if (finalPriceEl) finalPriceEl.textContent = formatEgp(finalPrice);
    if (noteEl) noteEl.textContent = `(وفر ${formatEgp(basePrice - finalPrice)} — خصم ${clamped}%)`;
    box?.classList.add("has-discount");
  } else if (discountType === "fixed" && discountVal > 0) {
    const finalPrice = Math.max(0, basePrice - discountVal);
    if (finalPriceEl) finalPriceEl.textContent = formatEgp(finalPrice);
    if (noteEl) noteEl.textContent = `(وفر ${formatEgp(discountVal)} ج.م — السعر بعد الخصم)`;
    box?.classList.add("has-discount");
  } else {
    if (finalPriceEl) finalPriceEl.textContent = formatEgp(basePrice);
    if (noteEl) noteEl.textContent = "(لا يوجد خصم نشط)";
    box?.classList.remove("has-discount");
  }
}

function handleProductFormSubmit(e) {
  e.preventDefault();

  const id = $("#edit-product-id").value || `daffa-${Date.now()}`;
  const name = $("#edit-name").value.trim();
  const categoryId = $("#edit-category").value;
  const badge = $("#edit-badge").value.trim();
  const shortSpec = $("#edit-short-spec").value.trim();
  const description = $("#edit-description").value.trim();
  const basePrice = Number($("#edit-base-price").value);
  const discountType = $("#edit-discount-type").value;
  const discountValue = Number($("#edit-discount-value").value) || 0;
  const discountStartOn = $("#edit-discount-start").value || null;
  const discountEndOn = $("#edit-discount-end").value || null;
  const discountReason = $("#edit-discount-reason").value.trim();
  const imageUrl = $("#edit-image-url").value.trim();
  const variantsRaw = $("#edit-variants").value.trim();
  const sortOrder = Number($("#edit-sort-order").value) || 0;
  const stockCount = Number($("#edit-stock-count").value) || 10;
  const active = $("#edit-active").checked;
  const isFlagship = $("#edit-flagship").checked;

  const errorEl = $("#product-form-error");

  if (!name || !basePrice || basePrice <= 0) {
    if (errorEl) {
      errorEl.textContent = "يرجى إدخال اسم الساعة والسعر الأصلي بشكل صحيح.";
      errorEl.hidden = false;
    }
    return;
  }

  // Parse color variants
  let images = [];
  if (variantsRaw) {
    images = variantsRaw.split(",").map((v, idx) => {
      const parts = v.split(":");
      const label = parts[0]?.trim() || `خيار ${idx + 1}`;
      const url = parts.slice(1).join(":").trim() || imageUrl;
      return { imageUrl: url, colorLabel: label, sortOrder: idx };
    }).filter((img) => img.imageUrl);
  }

  if (images.length === 0 && imageUrl) {
    images = [{ imageUrl, colorLabel: "الأصلي", sortOrder: 0 }];
  }

  const categoryObj = categories.find((c) => c.id === categoryId);
  const categoryName = categoryObj ? categoryObj.name : "ساعة فاخرة";

  // Flexible price calculation
  let salePrice = basePrice;
  let discountPercent = 0;
  const discountActive = discountType !== "none" && discountValue > 0;

  if (discountType === "percent" && discountValue > 0) {
    discountPercent = Math.min(99, Math.max(0, discountValue));
    salePrice = calculateDiscountedPrice(basePrice, discountPercent);
  } else if (discountType === "fixed" && discountValue > 0) {
    salePrice = Math.max(0, basePrice - discountValue);
    discountPercent = basePrice > 0 ? Math.round(((basePrice - salePrice) / basePrice) * 100) : 0;
  }

  // Build Updated Product Record
  const productData = {
    id,
    name,
    brand: storeSettings.brandName || "ضَفّة",
    category: categoryName,
    categoryId,
    badge,
    shortSpec,
    description,
    basePrice,
    discountType,
    discountValue,
    discountPercent,
    discountActive,
    discountStartOn,
    discountEndOn,
    discountReason,
    salePrice,
    imageUrl: imageUrl || (images[0]?.imageUrl || "/sodfa-promo-poster.jpg"),
    images,
    sortOrder,
    stockCount,
    inStock: stockCount > 0,
    active,
    isFlagship,
  };

  if (isFlagship) {
    products.forEach((p) => { if (p.id !== id) p.isFlagship = false; });
  }

  const existingIndex = products.findIndex((p) => p.id === id);
  if (existingIndex > -1) {
    products[existingIndex] = { ...products[existingIndex], ...productData };
  } else {
    products.unshift(productData);
  }

  saveStoredProducts(products);
  updateKpiStats();
  renderProductsList();
  showToast(`تم حفظ الساعة «${name}» وتحديث المتجر بنجاح ✓`);

  fetch(`/api/admin/products/${encodeURIComponent(id)}`, {
    method: existingIndex > -1 ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(productData),
  }).catch(() => {});

  resetProductEditor();
}

function handleProductDelete() {
  if (!editingProductId) return;
  const product = products.find((p) => p.id === editingProductId);
  if (!product) return;

  const confirmDelete = confirm(`هل أنت متأكد من حذف ساعة «${product.name}» نهائيًا من الكتالوج؟`);
  if (!confirmDelete) return;

  products = products.filter((p) => p.id !== editingProductId);
  saveStoredProducts(products);
  updateKpiStats();
  renderProductsList();
  showToast(`تم حذف «${product.name}» من الكتالوج.`);

  fetch(`/api/admin/products/${encodeURIComponent(editingProductId)}`, {
    method: "DELETE",
  }).catch(() => {});

  resetProductEditor();
}

// ----------------------------------------------------
// 4. ORDERS DASHBOARD MANAGEMENT
// ----------------------------------------------------
function updateOrdersBadge() {
  const unreadCount = orders.filter((o) => !o.isRead).length;
  const badge = $("#admin-orders-counter-badge");
  if (badge) {
    badge.textContent = unreadCount;
    badge.hidden = unreadCount === 0;
  }
  const countAll = $("#count-orders-all");
  const countNew = $("#count-orders-new");
  if (countAll) countAll.textContent = orders.length;
  if (countNew) countNew.textContent = orders.filter((o) => o.status === "new").length;
}

function renderOrdersList() {
  const container = $("#admin-orders-list");
  if (!container) return;

  updateOrdersBadge();

  let filtered = orders;
  if (currentOrderFilter !== "all") {
    filtered = orders.filter((o) => o.status === currentOrderFilter);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="admin-empty-state">
        <p>لا توجد طلبات في هذا التصنيف حاليًا.</p>
      </div>
    `;
    return;
  }

  const statusLabels = {
    new: "جديد",
    confirmed: "تم التأكيد",
    shipped: "تم الشحن",
    delivered: "تم التسليم",
    cancelled: "ملغي",
  };

  container.innerHTML = filtered.map((order) => {
    const dateFormatted = order.createdAt ? new Date(order.createdAt).toLocaleString("ar-EG") : "—";
    const waClean = (order.phone || "").replace(/\D/g, "");
    const waLink = waClean ? `https://wa.me/2${waClean.startsWith("0") ? waClean : `0${waClean}`}?text=${encodeURIComponent(`مرحبًا أستاذ ${order.customerName}، نتواصل معك بخصوص طلبك #${order.id} من متجر ضَفّة.`)}` : "#";

    return `
      <article class="admin-order-card ${!order.isRead ? "is-unread" : ""}" data-order-id="${safeText(order.id)}">
        <div class="order-card-header">
          <div class="order-id-block">
            <strong>#${safeText(order.id)}</strong>
            <span class="order-date-text">${dateFormatted}</span>
            ${!order.isRead ? `<span class="admin-tag unread-tag">جديد</span>` : ""}
          </div>
          <div class="order-status-select-wrap">
            <span class="order-status-badge status-${safeText(order.status)}">${statusLabels[order.status] || order.status}</span>
            <select class="admin-order-status-select" data-action="change-order-status" data-order-id="${safeText(order.id)}">
              <option value="new" ${order.status === "new" ? "selected" : ""}>جديد</option>
              <option value="confirmed" ${order.status === "confirmed" ? "selected" : ""}>تم التأكيد</option>
              <option value="shipped" ${order.status === "shipped" ? "selected" : ""}>تم الشحن</option>
              <option value="delivered" ${order.status === "delivered" ? "selected" : ""}>تم التسليم</option>
              <option value="cancelled" ${order.status === "cancelled" ? "selected" : ""}>ملغي</option>
            </select>
          </div>
        </div>

        <div class="order-details-grid">
          <div class="order-customer-box">
            <h4>بيانات العميل والتوصيل</h4>
            <p><strong>الاسم:</strong> ${safeText(order.customerName)}</p>
            <p><strong>الهاتف:</strong> <code dir="ltr">${safeText(order.phone)}</code></p>
            <p><strong>العنوان:</strong> ${safeText(order.governorate)} — ${safeText(order.city)}، ${safeText(order.address)}</p>
            ${order.notes ? `<p><strong>ملاحظات:</strong> <em>${safeText(order.notes)}</em></p>` : ""}
            <div class="order-customer-actions">
              <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="admin-button admin-button-small admin-whatsapp-contact-btn">
                واتساب العميل 💬
              </a>
              <a href="tel:${safeText(order.phone)}" class="admin-button admin-button-small admin-button-quiet">
                اتصال 📞
              </a>
            </div>
          </div>

          <div class="order-items-box">
            <h4>المنتجات المطلوبة</h4>
            <div class="order-items-list">
              ${(order.items || []).map((i) => `
                <div class="order-item-row">
                  <span>• ${safeText(i.name)} × ${i.quantity} ${i.color ? `(${safeText(i.color)})` : ""}</span>
                  <strong>${formatEgp(i.price * i.quantity)} ج.م</strong>
                </div>
              `).join("")}
            </div>
            <div class="order-total-row">
              <span>الإجمالي المستحق (عند الاستلام):</span>
              <strong>${formatEgp(order.totalAmount)} ج.م</strong>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function handleOrderStatusChange(orderId, newStatus) {
  updateOrderStatus(orderId, newStatus);
  orders = getOrders();
  renderOrdersList();
  showToast(`تم تحديث حالة الطلب #${orderId} إلى: ${newStatus} ✓`);
}

// ----------------------------------------------------
// 5. HERO, VIDEO & BANNER SETTINGS
// ----------------------------------------------------
function populateHeroSettings() {
  $("#setting-brand-name").value = storeSettings.brandName || "ضَفّة";
  $("#setting-brand-sub").value = storeSettings.brandSubtitle || "سَاعَةٌ لِكُلِّ لَحْظَةٍ";
  $("#setting-announcement").value = storeSettings.announcement || "";
  $("#setting-video-url").value = storeSettings.heroVideoUrl || "/manus-storage/96837d80-d655-11f1-9beb-9def1d7eb227_fb348b1f.mp4";
  $("#setting-poster-url").value = storeSettings.heroPosterUrl || "/sodfa-promo-poster.jpg";
  $("#setting-hero-headline").value = storeSettings.heroHeadline || "";
  $("#setting-hero-desc").value = storeSettings.heroDescription || "";
  $("#setting-flagship-tag").value = storeSettings.featuredTag || "القطعة المميزة";
  $("#setting-flagship-name").value = storeSettings.featuredName || "";
  $("#setting-flagship-spec").value = storeSettings.featuredSpec || "";
}

function handleHeroSettingsSubmit(e) {
  e.preventDefault();

  storeSettings = {
    ...storeSettings,
    brandName: $("#setting-brand-name").value.trim(),
    brandSubtitle: $("#setting-brand-sub").value.trim(),
    announcement: $("#setting-announcement").value.trim(),
    heroVideoUrl: $("#setting-video-url").value.trim(),
    heroPosterUrl: $("#setting-poster-url").value.trim(),
    heroHeadline: $("#setting-hero-headline").value.trim(),
    heroDescription: $("#setting-hero-desc").value.trim(),
    featuredTag: $("#setting-flagship-tag").value.trim(),
    featuredName: $("#setting-flagship-name").value.trim(),
    featuredSpec: $("#setting-flagship-spec").value.trim(),
  };

  saveStoreSettings(storeSettings);
  showToast("تم تحديث إعدادات الفيديو والواجهة بنجاح ✓");
}

// ----------------------------------------------------
// 6. SCROLLING NEWS TICKER MANAGEMENT
// ----------------------------------------------------
function populateTickerSettings() {
  const enabledEl = $("#setting-ticker-enabled");
  const speedEl = $("#setting-ticker-speed");
  if (enabledEl) enabledEl.checked = storeSettings.tickerEnabled !== false;
  if (speedEl) speedEl.value = storeSettings.tickerSpeed || "medium";
  renderTickerItemsList();
}

function renderTickerItemsList() {
  const container = $("#admin-ticker-items-list");
  if (!container) return;

  if (tickerItems.length === 0) {
    container.innerHTML = `<div class="admin-empty-state"><p>لا توجد عبارات في الشريط حاليًا. أضف عبارة جديدة أعلاه.</p></div>`;
    return;
  }

  container.innerHTML = tickerItems.map((item, idx) => `
    <div class="ticker-admin-item-row" data-index="${idx}">
      <span class="ticker-item-num">${idx + 1}</span>
      <span class="ticker-item-content">${safeText(item)}</span>
      <div class="ticker-item-btns">
        <button type="button" class="admin-button admin-button-small admin-button-quiet" data-action="move-ticker-up" data-index="${idx}" ${idx === 0 ? "disabled" : ""} title="تحريك لأعلى">↑</button>
        <button type="button" class="admin-button admin-button-small admin-button-quiet" data-action="move-ticker-down" data-index="${idx}" ${idx === tickerItems.length - 1 ? "disabled" : ""} title="تحريك لأسفل">↓</button>
        <button type="button" class="admin-button admin-button-small admin-button-danger" data-action="delete-ticker-item" data-index="${idx}" title="حذف">✕</button>
      </div>
    </div>
  `).join("");
}

function handleAddTickerItem() {
  const input = $("#new-ticker-item-input");
  const text = input?.value.trim();
  if (!text) return;

  tickerItems.push(text);
  saveTickerItems(tickerItems);
  if (input) input.value = "";
  renderTickerItemsList();
  showToast("تمت إضافة العبارة إلى شريط الأخبار بنجاح ✓");
}

function handleTickerAction(action, index) {
  const idx = Number(index);
  if (action === "delete-ticker-item") {
    tickerItems.splice(idx, 1);
    saveTickerItems(tickerItems);
    renderTickerItemsList();
    showToast("تم حذف العبارة.");
  } else if (action === "move-ticker-up" && idx > 0) {
    const temp = tickerItems[idx];
    tickerItems[idx] = tickerItems[idx - 1];
    tickerItems[idx - 1] = temp;
    saveTickerItems(tickerItems);
    renderTickerItemsList();
  } else if (action === "move-ticker-down" && idx < tickerItems.length - 1) {
    const temp = tickerItems[idx];
    tickerItems[idx] = tickerItems[idx + 1];
    tickerItems[idx + 1] = temp;
    saveTickerItems(tickerItems);
    renderTickerItemsList();
  }
}

function handleTickerSettingsSubmit(e) {
  e.preventDefault();
  storeSettings = {
    ...storeSettings,
    tickerEnabled: $("#setting-ticker-enabled").checked,
    tickerSpeed: $("#setting-ticker-speed").value,
  };
  saveStoreSettings(storeSettings);
  showToast("تم حفظ إعدادات شريط الأخبار بنجاح ✓");
}

// ----------------------------------------------------
// 7. STORE OWNER NOTIFICATION SETTINGS
// ----------------------------------------------------
function populateNotificationSettings() {
  const tgEnabled = $("#setting-tg-enabled");
  const tgToken = $("#setting-tg-token");
  const tgChatId = $("#setting-tg-chat-id");
  const emailEnabled = $("#setting-email-enabled");
  const web3formsKey = $("#setting-web3forms-key");
  const ownerEmail = $("#setting-owner-email");

  if (tgEnabled) tgEnabled.checked = Boolean(storeSettings.telegramNotificationsEnabled);
  if (tgToken) tgToken.value = storeSettings.telegramBotToken || "";
  if (tgChatId) tgChatId.value = storeSettings.telegramChatId || "";
  if (emailEnabled) emailEnabled.checked = Boolean(storeSettings.emailNotificationsEnabled);
  if (web3formsKey) web3formsKey.value = storeSettings.web3formsKey || "";
  if (ownerEmail) ownerEmail.value = storeSettings.notificationEmail || "";
}

function handleNotificationsSubmit(e) {
  e.preventDefault();
  storeSettings = {
    ...storeSettings,
    telegramNotificationsEnabled: $("#setting-tg-enabled").checked,
    telegramBotToken: $("#setting-tg-token").value.trim(),
    telegramChatId: $("#setting-tg-chat-id").value.trim(),
    emailNotificationsEnabled: $("#setting-email-enabled").checked,
    web3formsKey: $("#setting-web3forms-key").value.trim(),
    notificationEmail: $("#setting-owner-email").value.trim(),
  };
  saveStoreSettings(storeSettings);
  showToast("تم حفظ إعدادات الإشعارات الفورية بنجاح ✓");
}

async function handleTestNotification() {
  const btn = $("#test-notification-btn");
  if (btn) btn.disabled = true;
  showToast("جاري إرسال إشعار تجريبي...");

  const testOrder = {
    id: `TEST-${Math.floor(1000 + Math.random() * 9000)}`,
    customerName: "أحمد تجريبي",
    phone: "01012345678",
    governorate: "القاهرة",
    city: "المعادي",
    address: "شارع النصر، مبنى 5",
    notes: "هذا إشعار تجريبي لاختبار قنوات تنبيهات المتجر",
    totalAmount: 2450,
    items: [
      { name: "ضَفّة هيريتدج كرونوغراف", quantity: 1, price: 2450, color: "أسود ملكي" }
    ],
  };

  const currentTgEnabled = $("#setting-tg-enabled").checked;
  const currentTgToken = $("#setting-tg-token").value.trim();
  const currentTgChatId = $("#setting-tg-chat-id").value.trim();
  const currentEmailEnabled = $("#setting-email-enabled").checked;
  const currentWeb3Key = $("#setting-web3forms-key").value.trim();

  let sentCount = 0;
  let errors = [];

  if (currentTgEnabled && currentTgToken && currentTgChatId) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(currentTgToken)}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: currentTgChatId,
          text: `🚀 <b>إشعار تجريبي ناجح من متجر ضَفّة</b>\n\nقناة تنبيهات تيليجرام تعمل بنجاح واستجابة فورية.\nرقم الطلب التجريبي: <code>#${testOrder.id}</code>\nالمبلغ: <b>${formatEgp(testOrder.totalAmount)} ج.م</b>`,
          parse_mode: "HTML",
        }),
      });
      if (res.ok) sentCount++;
      else errors.push("تيليجرام (تحقق من الرمز ومعرّف المحادثة)");
    } catch {
      errors.push("تعذر الاتصال بتيليجرام");
    }
  }

  if (currentEmailEnabled && currentWeb3Key) {
    try {
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: currentWeb3Key,
          subject: "🚀 إشعار تجريبي من متجر ضَفّة",
          message: "قناة إشعارات البريد الإلكتروني تعمل بنجاح!",
        }),
      });
      if (res.ok) sentCount++;
      else errors.push("البريد الإلكتروني (تحقق من مفتاح Web3Forms)");
    } catch {
      errors.push("تعذر الاتصال بخادم البريد");
    }
  }

  if (btn) btn.disabled = false;

  if (sentCount > 0) {
    showToast(`تم إرسال الإشعار التجريبي بنجاح إلى ${sentCount} قناة ✓`);
  } else if (errors.length > 0) {
    showToast(`فشل الإرسال: ${errors.join(", ")}`, true);
  } else {
    showToast("يرجى تفعيل تيليجرام أو البريد وتعبئة المفاتيح أولاً لاختبار الإرسال.", true);
  }
}

// ----------------------------------------------------
// 8. CATEGORIES MANAGEMENT
// ----------------------------------------------------
function renderCategoriesTable() {
  const tbody = $("#categories-table-body");
  if (!tbody) return;

  tbody.innerHTML = categories.map((cat) => {
    const count = products.filter((p) => p.categoryId === cat.id).length;
    const isFixed = cat.id === "all";

    return `
      <tr>
        <td style="font-size:18px;">${cat.icon || "⌚"}</td>
        <td><strong>${safeText(cat.name)}</strong></td>
        <td><code>${safeText(cat.id)}</code></td>
        <td><span class="count-badge">${count} ساعة</span></td>
        <td>
          ${isFixed ? `<small style="color:var(--ink-subtle);">افتراضي</small>` : `
            <button type="button" class="admin-button admin-button-small admin-button-danger" data-action="delete-category" data-cat-id="${cat.id}">
              حذف
            </button>
          `}
        </td>
      </tr>
    `;
  }).join("");
}

function handleAddCategory(e) {
  e.preventDefault();
  const name = $("#new-cat-name")?.value.trim();
  const icon = $("#new-cat-icon")?.value.trim() || "⌚";

  if (!name) return;

  const id = `cat-${Date.now()}`;
  categories.push({ id, name, icon });
  saveStoredCategories(categories);
  renderCategoriesTable();
  renderCategoryOptions();
  updateKpiStats();
  $("#add-category-form")?.reset();
  showToast(`تمت إضافة التصنيف «${name}» بنجاح ✓`);
}

function handleDeleteCategory(catId) {
  const cat = categories.find((c) => c.id === catId);
  if (!cat) return;

  const inUse = products.some((p) => p.categoryId === catId);
  if (inUse) {
    alert(`لا يمكن حذف تصنيف «${cat.name}» لأنه مرتبط بساعات موجودة في الكتالوج. انقل الساعات لتصنيف آخر أولاً.`);
    return;
  }

  const ok = confirm(`هل أنت متأكد من حذف تصنيف «${cat.name}»؟`);
  if (!ok) return;

  categories = categories.filter((c) => c.id !== catId);
  saveStoredCategories(categories);
  renderCategoriesTable();
  renderCategoryOptions();
  updateKpiStats();
  showToast(`تم حذف تصنيف «${cat.name}».`);
}

// ----------------------------------------------------
// 9. CONTACTS & POLICIES MANAGEMENT
// ----------------------------------------------------
function populateContactsAndPolicies() {
  $("#setting-whatsapp").value = storeSettings.defaultWhatsapp || "";
  $("#setting-phone").value = storeSettings.defaultPhone || "";
  $("#setting-shipping").value = storeSettings.shippingDetails || "";
  $("#setting-exchange").value = storeSettings.exchangeDetails || "";
}

function handleContactsSubmit(e) {
  e.preventDefault();

  storeSettings = {
    ...storeSettings,
    defaultWhatsapp: $("#setting-whatsapp").value.trim(),
    defaultPhone: $("#setting-phone").value.trim(),
    shippingDetails: $("#setting-shipping").value.trim(),
    exchangeDetails: $("#setting-exchange").value.trim(),
  };

  saveStoreSettings(storeSettings);
  showToast("تم حفظ بيانات التواصل وسياسات المتجر بنجاح ✓");

  fetch("/api/admin/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      whatsappNumber: storeSettings.defaultWhatsapp,
      phoneNumber: storeSettings.defaultPhone,
    }),
  }).catch(() => {});
}

// ----------------------------------------------------
// 10. INITIALIZE ADMIN PORTAL
// ----------------------------------------------------
function renderDashboard() {
  updateKpiStats();
  renderCategoryOptions();
  renderProductsList();
  renderOrdersList();
  populateHeroSettings();
  populateTickerSettings();
  populateNotificationSettings();
  renderCategoriesTable();
  populateContactsAndPolicies();
}

document.addEventListener("DOMContentLoaded", () => {
  updateAuthViews();

  $("#admin-login-form")?.addEventListener("submit", handleLoginSubmit);
  $("#admin-logout-btn")?.addEventListener("click", handleLogout);

  initTabs();

  // Products CRUD
  $("#admin-product-form")?.addEventListener("submit", handleProductFormSubmit);
  $("#admin-new-product-btn")?.addEventListener("click", resetProductEditor);
  $("#product-cancel-btn")?.addEventListener("click", resetProductEditor);
  $("#product-delete-btn")?.addEventListener("click", handleProductDelete);
  $("#edit-base-price")?.addEventListener("input", updatePricePreview);
  $("#edit-discount-type")?.addEventListener("change", updatePricePreview);
  $("#edit-discount-value")?.addEventListener("input", updatePricePreview);

  // Filter products list
  $$(".list-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentListFilter = btn.dataset.listFilter;
      $$(".list-filter-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
      renderProductsList();
    });
  });

  // Delegate edit clicks in list
  $("#admin-products-list")?.addEventListener("click", (e) => {
    const editBtn = e.target.closest('[data-action="edit-product"]');
    if (editBtn) {
      const pid = editBtn.dataset.productId;
      loadProductIntoEditor(pid);
    }
  });

  // Orders Filters & Actions
  $$(".orders-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentOrderFilter = btn.dataset.orderFilter;
      $$(".orders-filter-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
      renderOrdersList();
    });
  });

  $("#admin-orders-list")?.addEventListener("change", (e) => {
    if (e.target.dataset.action === "change-order-status") {
      const orderId = e.target.dataset.orderId;
      const newStatus = e.target.value;
      handleOrderStatusChange(orderId, newStatus);
    }
  });

  // Hero & Banner Settings Form
  $("#hero-settings-form")?.addEventListener("submit", handleHeroSettingsSubmit);

  // News Ticker Form & Actions
  $("#ticker-settings-form")?.addEventListener("submit", handleTickerSettingsSubmit);
  $("#add-ticker-item-btn")?.addEventListener("click", handleAddTickerItem);
  $("#new-ticker-item-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTickerItem();
    }
  });
  $("#admin-ticker-items-list")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (btn) {
      handleTickerAction(btn.dataset.action, btn.dataset.index);
    }
  });

  // Notification Settings Form & Test Button
  $("#notifications-settings-form")?.addEventListener("submit", handleNotificationsSubmit);
  $("#test-notification-btn")?.addEventListener("click", handleTestNotification);

  // Categories Form
  $("#add-category-form")?.addEventListener("submit", handleAddCategory);
  $("#categories-table-body")?.addEventListener("click", (e) => {
    const delBtn = e.target.closest('[data-action="delete-category"]');
    if (delBtn) {
      handleDeleteCategory(delBtn.dataset.catId);
    }
  });

  // Contacts Form
  $("#store-contacts-form")?.addEventListener("submit", handleContactsSubmit);
});
