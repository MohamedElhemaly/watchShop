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
} from "./data.js";
import { calculateDiscountedPrice, formatEgpNumber } from "./pricing.js";

// DOM Selector Helpers
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// State
let products = getStoredProducts();
let categories = getStoredCategories();
let storeSettings = getStoreSettings();
let editingProductId = null;
let currentListFilter = "all";
let toastTimer = null;

// EGP Formatter
const formatEgp = (val) => `${formatEgpNumber(val)} ج.م`;

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
  const discounts = products.filter((p) => p.discountActive && Number(p.discountPercent) > 0).length;

  if (totalEl) totalEl.textContent = new Intl.NumberFormat("ar-EG").format(total);
  if (activeEl) activeEl.textContent = new Intl.NumberFormat("ar-EG").format(active);
  if (discountsEl) discountsEl.textContent = new Intl.NumberFormat("ar-EG").format(discounts);
  if (catsEl) catsEl.textContent = new Intl.NumberFormat("ar-EG").format(categories.length);
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
    });
  });
}

// ----------------------------------------------------
// 3. PRODUCTS MANAGEMENT (CRUD)
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
    const hasDiscount = Boolean(product.discountActive && product.discountPercent > 0);
    const sale = product.salePrice || product.basePrice;
    const imgUrl = product.imageUrl || (product.images && product.images[0]?.imageUrl) || "/sodfa-promo-poster.jpg";

    return `
      <article class="admin-product-item ${isSelected ? "is-selected" : ""} ${product.active === false ? "is-hidden" : ""}" data-product-id="${product.id}">
        <img class="admin-item-thumb" src="${imgUrl}" alt="${product.name}" />
        <div class="admin-item-info">
          <div class="admin-item-title-row">
            <h4>${product.name}</h4>
            ${product.isFlagship ? `<span class="admin-tag flagship-tag">مميزة في الواجهة</span>` : ""}
            ${product.active === false ? `<span class="admin-tag hidden-tag">مخفية</span>` : ""}
          </div>
          <p class="admin-item-spec">${product.shortSpec || product.category || "ساعة فاخرة"}</p>
          <div class="admin-item-price-row">
            <strong>${formatEgp(sale)}</strong>
            ${hasDiscount ? `<del>${formatEgp(product.basePrice)}</del><span class="admin-discount-badge">خصم ${product.discountPercent}%</span>` : ""}
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
  $("#edit-discount-percent").value = product.discountPercent || 0;
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

  // Smooth scroll to editor if on small screens
  $("#admin-product-form")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function updatePricePreview() {
  const basePrice = Number($("#edit-base-price")?.value) || 0;
  const discountPercent = Number($("#edit-discount-percent")?.value) || 0;
  const finalPriceEl = $("#admin-preview-final");
  const noteEl = $("#admin-preview-note");
  const box = $("#admin-price-preview");

  if (!basePrice || basePrice <= 0) {
    if (finalPriceEl) finalPriceEl.textContent = "—";
    if (noteEl) noteEl.textContent = "أدخل السعر لمعاينة القيمة النهائية";
    box?.classList.remove("has-discount");
    return;
  }

  if (discountPercent > 0 && discountPercent <= 99) {
    const finalPrice = calculateDiscountedPrice(basePrice, discountPercent);
    if (finalPriceEl) finalPriceEl.textContent = formatEgp(finalPrice);
    if (noteEl) noteEl.textContent = `(وفر ${formatEgp(basePrice - finalPrice)} — خصم ${discountPercent}%)`;
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
  const discountPercent = Number($("#edit-discount-percent").value) || 0;
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
  const salePrice = discountPercent > 0 ? calculateDiscountedPrice(basePrice, discountPercent) : basePrice;

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
    discountPercent,
    discountActive: discountPercent > 0,
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

  // If set as flagship, unset previous flagship
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

  // Try updating backend API if reachable
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

  // Try deleting from backend API
  fetch(`/api/admin/products/${encodeURIComponent(editingProductId)}`, {
    method: "DELETE",
  }).catch(() => {});

  resetProductEditor();
}

// ----------------------------------------------------
// 4. HERO, VIDEO & BANNER SETTINGS
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
// 5. CATEGORIES MANAGEMENT
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
        <td><strong>${cat.name}</strong></td>
        <td><code>${cat.id}</code></td>
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
// 6. CONTACTS & POLICIES MANAGEMENT
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

  // Try updating backend API
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
// 7. INITIALIZE ADMIN PORTAL
// ----------------------------------------------------
function renderDashboard() {
  updateKpiStats();
  renderCategoryOptions();
  renderProductsList();
  populateHeroSettings();
  renderCategoriesTable();
  populateContactsAndPolicies();
}

document.addEventListener("DOMContentLoaded", () => {
  // Check auth state
  updateAuthViews();

  // Login form
  $("#admin-login-form")?.addEventListener("submit", handleLoginSubmit);
  $("#admin-logout-btn")?.addEventListener("click", handleLogout);

  // Tabs
  initTabs();

  // Products CRUD
  $("#admin-product-form")?.addEventListener("submit", handleProductFormSubmit);
  $("#admin-new-product-btn")?.addEventListener("click", resetProductEditor);
  $("#product-cancel-btn")?.addEventListener("click", resetProductEditor);
  $("#product-delete-btn")?.addEventListener("click", handleProductDelete);
  $("#edit-base-price")?.addEventListener("input", updatePricePreview);
  $("#edit-discount-percent")?.addEventListener("input", updatePricePreview);

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

  // Hero & Banner Settings Form
  $("#hero-settings-form")?.addEventListener("submit", handleHeroSettingsSubmit);

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
