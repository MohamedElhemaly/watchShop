import "./admin.css";
import "./mediaUploader.css";
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
  deleteProducts,
  deleteProduct,
  deleteOrders,
  deleteOrder,
  deleteCategories,
  deleteTickerItems,
  ensureStoreSeeded,
  getAdminSession,
  setAdminSession,
  clearAdminSession,
  hasPermission,
  verifyAdminCredentials,
  recoverPasswordWithKey,
  changeUserPassword,
  getAdminUsers,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  resetUserPassword,
  getMasterRecoveryKey,
  regenerateMasterRecoveryKey,
  formatDeliveryTimeline,
  formatWhatsAppPhone,
  isValidWhatsAppPhone,
  buildWhatsAppUrl,
  ADMIN_PERMISSIONS,
} from "./data.js";
import {
  calculateDiscountedPrice,
  calculateFlexibleDiscount,
  formatDiscountLabel,
  formatEgpNumber,
} from "./pricing.js";
import { createMediaUploader } from "./mediaUploader.js";
import { resolveMediaUrl, resolveProductsMedia, getCachedMediaUrl } from "./mediaStorage.js";

// DOM Selector Helpers
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// Central State
ensureStoreSeeded();
let products = getStoredProducts();
let categories = getStoredCategories();
let storeSettings = getStoreSettings();
let orders = getOrders();
let tickerItems = getTickerItems();
let editingProductId = null;
let currentListFilter = "all";
let currentOrderFilter = "all";
let toastTimer = null;

// Multi-Select & Bulk Actions State
const selectedProductIds = new Set();
const selectedOrderIds = new Set();
const selectedCategoryIds = new Set();
const selectedTickerIndices = new Set();
let pendingBulkDelete = null;

// Media Uploaders State
let productImageUploader = null;
let heroVideoUploader = null;
let heroPosterUploader = null;
let visualVariants = [];

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

// Universal Bulk Delete Confirmation Modal Helpers
function openBulkDeleteModal({ title, message, previewItems = [], onConfirm }) {
  const modal = $("#modal-bulk-delete");
  const titleEl = $("#modal-bulk-delete-title");
  const msgEl = $("#bulk-delete-message");
  const listEl = $("#bulk-delete-preview-list");
  if (!modal) return;

  if (titleEl) titleEl.textContent = title || "تأكيد الحذف الجماعي";
  if (msgEl) msgEl.textContent = message || "هل أنت متأكد من حذف العناصر المحددة نهائياً؟";

  if (listEl) {
    if (previewItems.length > 0) {
      listEl.innerHTML = previewItems
        .slice(0, 10)
        .map((item) => {
          const itemTitle = typeof item === "object" ? item.title : String(item);
          const itemBadge = typeof item === "object" ? item.badge : "";
          return `
            <div class="bulk-preview-item">
              <span>${safeText(itemTitle)}</span>
              ${itemBadge ? `<small style="color:var(--ink-subtle);">${safeText(itemBadge)}</small>` : ""}
            </div>
          `;
        })
        .join("") + (previewItems.length > 10 ? `<div style="padding: 6px 10px; font-size: 12px; color: var(--ink-subtle); text-align: center;">...و ${previewItems.length - 10} عنصر إضافي</div>` : "");
      listEl.hidden = false;
    } else {
      listEl.innerHTML = "";
      listEl.hidden = true;
    }
  }

  pendingBulkDelete = onConfirm;
  modal.hidden = false;
}

function closeBulkDeleteModal() {
  const modal = $("#modal-bulk-delete");
  if (modal) modal.hidden = true;
  pendingBulkDelete = null;
}

// ----------------------------------------------------
// 1. AUTHENTICATION CONTROLS & RBAC SESSIONS
// ----------------------------------------------------
function getCurrentSession() {
  return getAdminSession();
}

function updateAuthViews() {
  const session = getCurrentSession();
  const isAuth = Boolean(session);
  const loginView = $("#admin-login-view");
  const dashboardView = $("#admin-dashboard-view");
  const headerActions = $("#admin-header-actions");
  const headerUserRole = $("#header-user-role-badge");
  const headerUserName = $("#header-user-name");
  const signedInUserEl = $("#admin-signed-in-user");

  if (isAuth) {
    if (loginView) loginView.hidden = true;
    if (dashboardView) dashboardView.hidden = false;
    if (headerActions) headerActions.hidden = false;

    // Display user identity in top bar
    const isSuper = session.role === "super_admin";
    if (headerUserName) headerUserName.textContent = session.fullName || session.username;
    if (headerUserRole) {
      headerUserRole.textContent = isSuper ? "المدير العام" : "مشرف";
      headerUserRole.className = `user-role-badge ${isSuper ? "" : "is-regular"}`;
    }
    if (signedInUserEl) {
      signedInUserEl.textContent = `مسجّل الدخول: ${session.fullName || session.username} (${isSuper ? "المدير العام" : "مشرف النظام"})`;
    }

    // Apply granular permissions across tabs and actions
    applyPermissionVisibility(session);

    renderDashboard();
  } else {
    if (loginView) loginView.hidden = false;
    if (dashboardView) dashboardView.hidden = true;
    if (headerActions) headerActions.hidden = true;
  }
}

function handleLoginSubmit(e) {
  e.preventDefault();
  const username = $("#login-username")?.value.trim();
  const password = $("#login-password")?.value.trim();
  const rememberMe = $("#login-remember-me")?.checked ?? true;
  const errBox = $("#login-error");

  if (errBox) errBox.hidden = true;

  if (!username || !password) {
    if (errBox) {
      errBox.textContent = "يرجى إدخال اسم المستخدم وكلمة المرور.";
      errBox.hidden = false;
    }
    return;
  }

  const result = verifyAdminCredentials(username, password);
  if (!result) {
    if (errBox) {
      errBox.textContent = "بيانات الدخول غير صحيحة. يرجى التأكد من اسم المستخدم وكلمة المرور.";
      errBox.hidden = false;
    }
    return;
  }

  if (result.error) {
    if (errBox) {
      errBox.textContent = result.error;
      errBox.hidden = false;
    }
    return;
  }

  const sessionData = {
    userId: result.id,
    username: result.username,
    fullName: result.fullName,
    role: result.role,
    loggedInAt: new Date().toISOString(),
  };

  setAdminSession(sessionData, rememberMe);
  updateAuthViews();
  showToast(`أهلاً بك يا ${result.fullName || result.username} في لوحة تحكم صُدْفَة ✓`);
}

function handleLogout() {
  clearAdminSession();
  updateAuthViews();
  showToast("تم تسجيل الخروج بنجاح.");
}

function initPasswordToggle() {
  const toggleBtn = $("#login-password-toggle");
  const passInput = $("#login-password");
  if (!toggleBtn || !passInput) return;

  toggleBtn.addEventListener("click", () => {
    const isPassword = passInput.type === "password";
    passInput.type = isPassword ? "text" : "password";
    toggleBtn.textContent = isPassword ? "🔒" : "👁️";
    toggleBtn.setAttribute("aria-label", isPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور");
  });
}

function initPasswordRecoveryFlow() {
  const mainCard = $("#login-card-main");
  const recoveryCard = $("#login-card-recovery");
  const openRecoveryBtn = $("#btn-open-recovery");
  const backToLoginBtn = $("#btn-back-to-login");
  const recoveryForm = $("#admin-recovery-form");
  const errBox = $("#recovery-error");
  const successBox = $("#recovery-success");

  openRecoveryBtn?.addEventListener("click", () => {
    if (mainCard) mainCard.hidden = true;
    if (recoveryCard) recoveryCard.hidden = false;
    if (errBox) errBox.hidden = true;
    if (successBox) successBox.hidden = true;
    recoveryForm?.reset();
  });

  backToLoginBtn?.addEventListener("click", () => {
    if (recoveryCard) recoveryCard.hidden = true;
    if (mainCard) mainCard.hidden = false;
  });

  recoveryForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (errBox) errBox.hidden = true;
    if (successBox) successBox.hidden = true;

    const username = $("#recovery-username")?.value.trim();
    const key = $("#recovery-key")?.value.trim();
    const newPass = $("#recovery-new-password")?.value.trim();
    const confirmPass = $("#recovery-confirm-password")?.value.trim();

    if (newPass !== confirmPass) {
      if (errBox) {
        errBox.textContent = "كلمتا المرور غير متطابقتين.";
        errBox.hidden = false;
      }
      return;
    }

    try {
      const updatedUser = recoverPasswordWithKey(username, key, newPass);
      if (successBox) {
        successBox.textContent = "تم استعادة الحساب وتعيين كلمة المرور بنجاح! يتم تسجيل الدخول الآن...";
        successBox.hidden = false;
      }

      const sessionData = {
        userId: updatedUser.id,
        username: updatedUser.username,
        fullName: updatedUser.fullName,
        role: updatedUser.role,
        loggedInAt: new Date().toISOString(),
      };

      setTimeout(() => {
        setAdminSession(sessionData, true);
        if (recoveryCard) recoveryCard.hidden = true;
        if (mainCard) mainCard.hidden = false;
        updateAuthViews();
        showToast("تم الدخول بنجاح بكلمة المرور الجديدة ✓");
      }, 800);
    } catch (err) {
      if (errBox) {
        errBox.textContent = err.message || "حدث خطأ أثناء استعادة كلمة المرور.";
        errBox.hidden = false;
      }
    }
  });
}

// ----------------------------------------------------
// 2. PERMISSIONS ENFORCEMENT & TAB GATING
// ----------------------------------------------------
function applyPermissionVisibility(session) {
  if (!session) return;
  const isSuper = session.role === "super_admin";
  const permissions = session.permissions || {};

  let firstVisibleTab = null;
  let activeTabIsVisible = false;

  $$(".admin-tab-btn").forEach((btn) => {
    const perm = btn.dataset.permission;
    const superOnly = btn.dataset.superOnly === "true";

    let allowed = true;
    if (superOnly && !isSuper) {
      allowed = false;
    } else if (perm && !isSuper) {
      allowed = Boolean(permissions[perm]);
    }

    btn.hidden = !allowed;
    btn.style.display = allowed ? "" : "none";

    if (allowed) {
      if (!firstVisibleTab) firstVisibleTab = btn.dataset.tab;
      if (btn.classList.contains("is-active")) activeTabIsVisible = true;
    }
  });

  // If current active tab is inaccessible, switch to first allowed tab
  if (!activeTabIsVisible && firstVisibleTab) {
    switchTab(firstVisibleTab);
  }

  // Orders: disable action dropdowns if not manage_orders
  const canManageOrders = isSuper || Boolean(permissions.manage_orders);
  $$(".admin-order-status-select").forEach((sel) => {
    sel.disabled = !canManageOrders;
  });

  // Products: hide add/save/delete buttons if not manage_products
  const canManageProducts = isSuper || Boolean(permissions.manage_products);
  const newProductBtn = $("#admin-new-product-btn");
  if (newProductBtn) newProductBtn.style.display = canManageProducts ? "" : "none";
  const productSaveBtn = $("#product-save-btn");
  if (productSaveBtn) productSaveBtn.disabled = !canManageProducts;
  const productDeleteBtn = $("#product-delete-btn");
  if (productDeleteBtn && !canManageProducts) productDeleteBtn.style.display = "none";
  $$(".admin-edit-btn").forEach((b) => {
    if (!canManageProducts) b.style.display = "none";
  });
  productImageUploader?.setDisabled(!canManageProducts);

  // Categories: hide add form and delete buttons if not manage_categories
  const canManageCategories = isSuper || Boolean(permissions.manage_categories);
  const addCatForm = $("#add-category-form");
  if (addCatForm) addCatForm.style.display = canManageCategories ? "" : "none";
  $$('[data-action="delete-category"]').forEach((b) => {
    if (!canManageCategories) b.style.display = "none";
  });

  // Storefront & News Ticker: disable submit if not manage_storefront
  const canManageStorefront = isSuper || Boolean(permissions.manage_storefront);
  const heroFormSubmit = $("#hero-settings-form button[type='submit']");
  if (heroFormSubmit) heroFormSubmit.disabled = !canManageStorefront;
  const tickerFormSubmit = $("#ticker-settings-form button[type='submit']");
  if (tickerFormSubmit) tickerFormSubmit.disabled = !canManageStorefront;
  heroVideoUploader?.setDisabled(!canManageStorefront);
  heroPosterUploader?.setDisabled(!canManageStorefront);

  // Delivery & Notifications: disable submit if not manage_delivery_settings
  const canManageDelivery = isSuper || Boolean(permissions.manage_delivery_settings);
  const deliverySubmit = $("#delivery-settings-form button[type='submit']");
  if (deliverySubmit) deliverySubmit.disabled = !canManageDelivery;
  const notifSubmit = $("#notifications-settings-form button[type='submit']");
  if (notifSubmit) notifSubmit.disabled = !canManageDelivery;

  // Multi-select Bulk Toolbars permissions
  const pToolbar = $("#products-selection-toolbar");
  if (pToolbar) pToolbar.style.display = canManageProducts ? "" : "none";

  const oToolbar = $("#orders-selection-toolbar");
  if (oToolbar) oToolbar.style.display = canManageOrders ? "" : "none";

  const cToolbar = $("#categories-selection-toolbar");
  if (cToolbar) cToolbar.style.display = canManageCategories ? "" : "none";

  const tToolbar = $("#ticker-selection-toolbar");
  if (tToolbar) tToolbar.style.display = canManageStorefront ? "" : "none";

  $$(".admin-order-delete-btn").forEach((b) => {
    b.disabled = !canManageOrders;
    b.style.display = canManageOrders ? "" : "none";
  });

  // Master recovery key card (Super Admin only)
  const masterRecoveryCard = $("#card-master-recovery");
  if (masterRecoveryCard) {
    masterRecoveryCard.hidden = !isSuper;
    masterRecoveryCard.style.display = isSuper ? "" : "none";
  }
}

function switchTab(tabName) {
  // Clear other tabs' selections on tab switch to prevent stale selection state
  if (tabName !== "products") selectedProductIds.clear();
  if (tabName !== "orders") selectedOrderIds.clear();
  if (tabName !== "categories") selectedCategoryIds.clear();
  if (tabName !== "ticker") selectedTickerIndices.clear();

  $$(".admin-tab-btn").forEach((b) => {
    const isSelected = b.dataset.tab === tabName;
    b.classList.toggle("is-active", isSelected);
    b.setAttribute("aria-selected", String(isSelected));
  });
  $$(".admin-tab-content").forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === `tab-${tabName}`);
  });

  if (tabName === "products") {
    renderProductsList();
  } else if (tabName === "orders") {
    markOrdersAsRead();
    orders = getOrders();
    updateOrdersBadge();
    renderOrdersList();
  } else if (tabName === "ticker") {
    renderTickerItemsList();
  } else if (tabName === "categories") {
    renderCategoriesTable();
  } else if (tabName === "admin-users") {
    renderAdminUsersTable();
  } else if (tabName === "delivery") {
    populateDeliverySettings();
  } else if (tabName === "account-security") {
    populateAccountSecurity();
  }
}

// ----------------------------------------------------
// 3. DASHBOARD KPI STATS & TABS
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
      switchTab(tabName);
    });
  });
}

// ----------------------------------------------------
// 4. PRODUCTS MANAGEMENT & FLEXIBLE DISCOUNTS (CRUD)
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

  const session = getCurrentSession();
  const canManage = session && (session.role === "super_admin" || (session.permissions && session.permissions.manage_products));

  // Update master checkbox and bulk toolbar for products
  const masterCheck = $("#select-all-products");
  const bulkBar = $("#bulk-actions-products");
  const bulkCountBadge = $("#bulk-count-products");
  const selectedVisible = filtered.filter((p) => selectedProductIds.has(p.id)).length;

  if (masterCheck) {
    masterCheck.disabled = !canManage || filtered.length === 0;
    masterCheck.checked = filtered.length > 0 && selectedVisible === filtered.length;
    masterCheck.indeterminate = selectedVisible > 0 && selectedVisible < filtered.length;
  }

  const selectedCount = selectedProductIds.size;
  if (bulkBar) {
    bulkBar.hidden = selectedCount === 0 || !canManage;
  }
  if (bulkCountBadge) {
    bulkCountBadge.textContent = `تم تحديد ${new Intl.NumberFormat("ar-EG").format(selectedCount)} ساعة`;
  }

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="admin-empty-state"><p>لا توجد ساعات في هذا العرض.</p></div>`;
    return;
  }

  listEl.innerHTML = filtered.map((product) => {
    const isSelected = editingProductId === product.id;
    const isBulkChecked = selectedProductIds.has(product.id);
    const base = Number(product.basePrice) || 0;
    const sale = Number(product.salePrice) || base;
    const hasDiscount = Boolean(product.discountActive && sale < base);

    let discLabel = "";
    if (hasDiscount) {
      if (product.discountType === "fixed") {
        discLabel = `خصم ${formatEgp(product.discountValue)}`;
      } else {
        discLabel = `خصم ${product.discountValue || product.discountPercent}%`;
      }
    }

    const rawImg = product.imageUrl || (product.images && product.images[0]?.imageUrl) || "/sodfa-promo-poster.jpg";
    const imgUrl = getCachedMediaUrl(rawImg);

    return `
      <article class="admin-product-item ${isSelected ? "is-selected" : ""} ${isBulkChecked ? "is-bulk-selected" : ""} ${product.active === false ? "is-hidden" : ""}" data-product-id="${product.id}">
        <div class="item-checkbox-wrap">
          <input
            type="checkbox"
            class="product-select-checkbox item-select-checkbox"
            data-product-id="${product.id}"
            ${isBulkChecked ? "checked" : ""}
            ${canManage ? "" : "disabled"}
            aria-label="تحديد ${safeText(product.name)}"
          />
        </div>
        <img class="admin-item-thumb" src="${imgUrl}" alt="${safeText(product.name)}" />
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
          ${canManage ? `
            <button type="button" class="admin-button admin-button-small admin-edit-btn" data-action="edit-product" data-product-id="${product.id}">
              تعديل ✎
            </button>
          ` : ""}
        </div>
      </article>
    `;
  }).join("");
}

function handleBulkDeleteProducts() {
  if (!hasPermission("manage_products")) {
    showToast("ليس لديك صلاحية لحذف الساعات.", true);
    return;
  }
  if (selectedProductIds.size === 0) return;

  const targetProducts = products.filter((p) => selectedProductIds.has(p.id));
  const preview = targetProducts.map((p) => ({
    title: p.name,
    badge: formatEgp(p.salePrice || p.basePrice),
  }));

  openBulkDeleteModal({
    title: "تأكيد حذف الساعات المحددة",
    message: `هل أنت متأكد من حذف ${selectedProductIds.size} ساعة نهائياً من الكتالوج والمتجر؟`,
    previewItems: preview,
    onConfirm: () => {
      const idsToDelete = Array.from(selectedProductIds);
      deleteProducts(idsToDelete);
      selectedProductIds.clear();
      products = getStoredProducts();
      if (editingProductId && idsToDelete.includes(editingProductId)) {
        resetProductEditor();
      }
      updateKpiStats();
      renderProductsList();
      showToast(`تم حذف ${idsToDelete.length} ساعة نهائياً وتحديث المتجر ✓`);
    },
  });
}

// ----------------------------------------------------
// Visual Variants Manager (Direct Device Upload for each color variant)
// ----------------------------------------------------
function clearVisualVariants() {
  visualVariants = [];
  const container = $("#product-variants-container");
  if (container) container.innerHTML = "";
  syncVisualVariantsToTextarea();
}

function syncVisualVariantsToTextarea() {
  const textarea = $("#edit-variants");
  if (!textarea) return;
  const valid = visualVariants
    .filter((v) => v.imageUrl && v.colorLabel)
    .map((v) => `${v.colorLabel}: ${v.imageUrl}`);
  textarea.value = valid.join(", ");
}

function addVisualVariantRow(colorLabel = "", imageUrl = "") {
  const container = $("#product-variants-container");
  if (!container) return;

  const rowId = `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const variantObj = {
    id: rowId,
    colorLabel: colorLabel || `خيار ${visualVariants.length + 1}`,
    imageUrl: imageUrl || "",
    uploader: null,
  };
  visualVariants.push(variantObj);

  const card = document.createElement("div");
  card.className = "variant-card-item";
  card.id = `variant-card-${rowId}`;
  card.innerHTML = `
    <div class="variant-card-details">
      <label class="form-field">
        <span style="font-size:12px; font-weight:700;">اسم اللون أو الخيار</span>
        <input type="text" class="variant-color-input" value="${safeText(variantObj.colorLabel)}" placeholder="مثال: أسود ملكي / فضي ستيل" />
      </label>
      <div id="uploader-slot-${rowId}"></div>
    </div>
    <div>
      <button type="button" class="admin-button admin-button-small admin-button-danger" data-action="delete-variant-row" data-row-id="${rowId}" title="حذف خيار اللون">
        ✕
      </button>
    </div>
  `;

  container.appendChild(card);

  // Bind color input change
  const colorInput = card.querySelector(".variant-color-input");
  colorInput?.addEventListener("input", (e) => {
    variantObj.colorLabel = e.target.value.trim();
    syncVisualVariantsToTextarea();
  });

  // Bind compact media uploader for this variant
  const uploaderSlot = card.querySelector(`#uploader-slot-${rowId}`);
  variantObj.uploader = createMediaUploader({
    container: uploaderSlot,
    id: rowId,
    type: "image",
    initialUrl: variantObj.imageUrl,
    compact: true,
    getCloudSettings: () => ({
      cloudName: storeSettings.cloudinaryCloudName,
      uploadPreset: storeSettings.cloudinaryUploadPreset,
    }),
    onChange: (url) => {
      variantObj.imageUrl = url;
      syncVisualVariantsToTextarea();
    },
  });

  // Bind delete button
  const delBtn = card.querySelector('[data-action="delete-variant-row"]');
  delBtn?.addEventListener("click", () => {
    visualVariants = visualVariants.filter((v) => v.id !== rowId);
    card.remove();
    syncVisualVariantsToTextarea();
  });

  syncVisualVariantsToTextarea();
}

function loadVariantsIntoVisualManager(imagesData) {
  clearVisualVariants();
  let list = [];

  if (Array.isArray(imagesData) && imagesData.length > 0) {
    list = imagesData.map((img) => ({
      colorLabel: img.colorLabel || "لون",
      imageUrl: img.imageUrl || "",
    }));
  } else if (typeof imagesData === "string" && imagesData.trim()) {
    list = imagesData.split(",").map((v, idx) => {
      const parts = v.split(":");
      const label = parts[0]?.trim() || `خيار ${idx + 1}`;
      const url = parts.slice(1).join(":").trim();
      return { colorLabel: label, imageUrl: url };
    }).filter((x) => x.imageUrl);
  }

  list.forEach((item) => {
    addVisualVariantRow(item.colorLabel, item.imageUrl);
  });
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
  $("#edit-image-url").value = "";

  productImageUploader?.setUrl("");
  clearVisualVariants();

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

  const discType = product.discountType || (Number(product.discountPercent) > 0 ? "percent" : "none");
  const discVal = product.discountValue !== undefined ? product.discountValue : (product.discountPercent || 0);
  $("#edit-discount-type").value = discType;
  $("#edit-discount-value").value = discVal;

  $("#edit-discount-start").value = product.discountStartOn || "";
  $("#edit-discount-end").value = product.discountEndOn || "";
  $("#edit-discount-reason").value = product.discountReason || "";
  $("#edit-image-url").value = product.imageUrl || "";

  productImageUploader?.setUrl(product.imageUrl || "");
  loadVariantsIntoVisualManager(product.images || product.imageUrl || "");

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

  if (!hasPermission("manage_products")) {
    showToast("ليس لديك صلاحية لإضافة أو تعديل الساعات.", true);
    return;
  }

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

  let images = [];
  if (visualVariants.length > 0) {
    images = visualVariants
      .filter((v) => v.imageUrl)
      .map((v, idx) => ({
        imageUrl: v.imageUrl,
        colorLabel: v.colorLabel || `خيار ${idx + 1}`,
        sortOrder: idx,
      }));
  } else if (variantsRaw) {
    images = variantsRaw.split(",").map((v, idx) => {
      const parts = v.split(":");
      const label = parts[0]?.trim() || `خيار ${idx + 1}`;
      const url = parts.slice(1).join(":").trim() || imageUrl;
      return { imageUrl: url, colorLabel: label, sortOrder: idx };
    }).filter((img) => img.imageUrl);
  }

  const finalImageUrl = imageUrl || (images[0]?.imageUrl || "/sodfa-promo-poster.jpg");
  if (images.length === 0 && finalImageUrl) {
    images = [{ imageUrl: finalImageUrl, colorLabel: "الأصلي", sortOrder: 0 }];
  }

  const categoryObj = categories.find((c) => c.id === categoryId);
  const categoryName = categoryObj ? categoryObj.name : "ساعة فاخرة";

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

  const productData = {
    id,
    name,
    brand: storeSettings.brandName || "صُدْفَة",
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
    imageUrl: finalImageUrl,
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
  resolveProductsMedia(products).then((res) => {
    products = res;
    renderProductsList();
  });
  showToast(`تم حفظ الساعة «${name}» وتحديث المتجر بنجاح ✓`);

  fetch(`/api/admin/products/${encodeURIComponent(id)}`, {
    method: existingIndex > -1 ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(productData),
  }).catch(() => {});

  resetProductEditor();
}

function handleProductDelete() {
  if (!hasPermission("manage_products")) {
    showToast("ليس لديك صلاحية لحذف الساعات.", true);
    return;
  }

  if (!editingProductId) return;
  const product = products.find((p) => p.id === editingProductId);
  if (!product) return;

  const confirmDelete = confirm(`هل أنت متأكد من حذف ساعة «${product.name}» نهائيًا من الكتالوج؟`);
  if (!confirmDelete) return;

  selectedProductIds.delete(editingProductId);
  deleteProduct(editingProductId);
  products = getStoredProducts();
  updateKpiStats();
  renderProductsList();
  showToast(`تم حذف «${product.name}» من الكتالوج.`);

  fetch(`/api/admin/products/${encodeURIComponent(editingProductId)}`, {
    method: "DELETE",
  }).catch(() => {});

  resetProductEditor();
}

// ----------------------------------------------------
// 5. ORDERS DASHBOARD MANAGEMENT
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

  const session = getCurrentSession();
  const canManage = session && (session.role === "super_admin" || (session.permissions && session.permissions.manage_orders));

  // Update master checkbox and bulk toolbar for orders
  const masterCheck = $("#select-all-orders");
  const bulkBar = $("#bulk-actions-orders");
  const bulkCountBadge = $("#bulk-count-orders");
  const selectedVisible = filtered.filter((o) => selectedOrderIds.has(o.id)).length;

  if (masterCheck) {
    masterCheck.disabled = !canManage || filtered.length === 0;
    masterCheck.checked = filtered.length > 0 && selectedVisible === filtered.length;
    masterCheck.indeterminate = selectedVisible > 0 && selectedVisible < filtered.length;
  }

  const selectedCount = selectedOrderIds.size;
  if (bulkBar) {
    bulkBar.hidden = selectedCount === 0 || !canManage;
  }
  if (bulkCountBadge) {
    bulkCountBadge.textContent = `تم تحديد ${new Intl.NumberFormat("ar-EG").format(selectedCount)} طلب`;
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
    const isBulkChecked = selectedOrderIds.has(order.id);
    const dateFormatted = order.createdAt ? new Date(order.createdAt).toLocaleString("ar-EG") : "—";
    const cleanWa = formatWhatsAppPhone(order.phone || "");
    const waLink = cleanWa ? buildWhatsAppUrl(cleanWa, `مرحبًا أستاذ ${order.customerName}، نتواصل معك بخصوص طلبك #${order.id} من متجر صُدْفَة.`) : "#";

    return `
      <article class="admin-order-card ${!order.isRead ? "is-unread" : ""} ${isBulkChecked ? "is-bulk-selected" : ""}" data-order-id="${safeText(order.id)}">
        <div class="order-card-header">
          <div class="order-id-block">
            <div class="item-checkbox-wrap">
              <input
                type="checkbox"
                class="order-select-checkbox item-select-checkbox"
                data-order-id="${safeText(order.id)}"
                ${isBulkChecked ? "checked" : ""}
                ${canManage ? "" : "disabled"}
                aria-label="تحديد طلب ${safeText(order.id)}"
              />
            </div>
            <strong>#${safeText(order.id)}</strong>
            <span class="order-date-text">${dateFormatted}</span>
            ${!order.isRead ? `<span class="admin-tag unread-tag">جديد</span>` : ""}
          </div>
          <div class="order-actions-wrap">
            <div class="order-status-select-wrap">
              <span class="order-status-badge status-${safeText(order.status)}">${statusLabels[order.status] || order.status}</span>
              <select class="admin-order-status-select" data-action="change-order-status" data-order-id="${safeText(order.id)}" ${canManage ? "" : "disabled"}>
                <option value="new" ${order.status === "new" ? "selected" : ""}>جديد</option>
                <option value="confirmed" ${order.status === "confirmed" ? "selected" : ""}>تم التأكيد</option>
                <option value="shipped" ${order.status === "shipped" ? "selected" : ""}>تم الشحن</option>
                <option value="delivered" ${order.status === "delivered" ? "selected" : ""}>تم التسليم</option>
                <option value="cancelled" ${order.status === "cancelled" ? "selected" : ""}>ملغي</option>
              </select>
            </div>
            ${canManage ? `
              <button
                type="button"
                class="admin-button admin-button-small admin-button-danger admin-order-delete-btn"
                data-action="delete-single-order"
                data-order-id="${safeText(order.id)}"
                title="حذف هذا الطلب"
              >
                حذف ✕
              </button>
            ` : ""}
          </div>
        </div>

        <div class="order-details-grid">
          <div class="order-customer-box">
            <h4>بيانات العميل والتوصيل</h4>
            <p><strong>الاسم:</strong> ${safeText(order.customerName)}</p>
            <p><strong>الهاتف:</strong> <code dir="ltr">${safeText(order.phone)}</code></p>
            <p><strong>العنوان:</strong> ${safeText(order.governorate)} — ${safeText(order.city || "")}، ${safeText(order.address)}</p>
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
                  <strong>${formatEgp((i.unitPrice !== undefined ? i.unitPrice : i.price) * i.quantity)}</strong>
                </div>
              `).join("")}
            </div>
            <div class="order-total-row">
              <span>الإجمالي المستحق (عند الاستلام):</span>
              <strong>${formatEgp(order.totalAmount)}</strong>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function handleBulkDeleteOrders() {
  if (!hasPermission("manage_orders")) {
    showToast("ليس لديك صلاحية لحذف الطلبات.", true);
    return;
  }
  if (selectedOrderIds.size === 0) return;

  const targetOrders = orders.filter((o) => selectedOrderIds.has(o.id));
  const preview = targetOrders.map((o) => ({
    title: `طلب #${o.id} — ${o.customerName || "عميل"}`,
    badge: formatEgp(o.totalAmount),
  }));

  openBulkDeleteModal({
    title: "تأكيد حذف الطلبات المحددة",
    message: `هل أنت متأكد من حذف ${selectedOrderIds.size} طلب نهائياً من سجلات المتجر؟`,
    previewItems: preview,
    onConfirm: () => {
      const idsToDelete = Array.from(selectedOrderIds);
      deleteOrders(idsToDelete);
      selectedOrderIds.clear();
      orders = getOrders();
      updateOrdersBadge();
      renderOrdersList();
      showToast(`تم حذف ${idsToDelete.length} طلب بنجاح ✓`);
    },
  });
}

function handleDeleteSingleOrder(orderId) {
  if (!hasPermission("manage_orders")) {
    showToast("ليس لديك صلاحية لحذف الطلبات.", true);
    return;
  }
  const order = orders.find((o) => o.id === orderId);
  if (!order) return;

  openBulkDeleteModal({
    title: "تأكيد حذف الطلب",
    message: `هل أنت متأكد من حذف الطلب #${order.id} الخاص بالعميل «${order.customerName}» نهائياً؟`,
    previewItems: [{ title: `طلب #${order.id} — ${order.customerName}`, badge: formatEgp(order.totalAmount) }],
    onConfirm: () => {
      deleteOrder(orderId);
      selectedOrderIds.delete(orderId);
      orders = getOrders();
      updateOrdersBadge();
      renderOrdersList();
      showToast(`تم حذف الطلب #${orderId} بنجاح.`);
    },
  });
}

function handleOrderStatusChange(orderId, newStatus) {
  if (!hasPermission("manage_orders")) {
    showToast("ليس لديك صلاحية لتحديث حالة الطلبات.", true);
    return;
  }
  updateOrderStatus(orderId, newStatus);
  orders = getOrders();
  renderOrdersList();
  showToast(`تم تحديث حالة الطلب #${orderId} إلى: ${newStatus} ✓`);
}

// ----------------------------------------------------
// 6. HERO, VIDEO & BANNER SETTINGS
// ----------------------------------------------------
function populateHeroSettings() {
  $("#setting-brand-name").value = storeSettings.brandName || "صُدْفَة";
  $("#setting-brand-sub").value = storeSettings.brandSubtitle || "سَاعَةٌ لِكُلِّ لَحْظَةٍ";
  $("#setting-announcement").value = storeSettings.announcement || "";
  const vUrl = storeSettings.heroVideoUrl || "/manus-storage/96837d80-d655-11f1-9beb-9def1d7eb227_fb348b1f.mp4";
  const pUrl = storeSettings.heroPosterUrl || "/sodfa-promo-poster.jpg";
  $("#setting-video-url").value = vUrl;
  $("#setting-poster-url").value = pUrl;
  heroVideoUploader?.setUrl(vUrl);
  heroPosterUploader?.setUrl(pUrl);
  $("#setting-hero-headline").value = storeSettings.heroHeadline || "";
  $("#setting-hero-desc").value = storeSettings.heroDescription || "";
  $("#setting-flagship-tag").value = storeSettings.featuredTag || "القطعة المميزة";
  $("#setting-flagship-name").value = storeSettings.featuredName || "";
  $("#setting-flagship-spec").value = storeSettings.featuredSpec || "";
}

function handleHeroSettingsSubmit(e) {
  e.preventDefault();

  if (!hasPermission("manage_storefront")) {
    showToast("ليس لديك صلاحية لتعديل إعدادات الواجهة.", true);
    return;
  }

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
// 7. SCROLLING NEWS TICKER MANAGEMENT
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

  const session = getCurrentSession();
  const canManage = session && (session.role === "super_admin" || (session.permissions && session.permissions.manage_storefront));

  // Update master checkbox and bulk toolbar for ticker
  const masterCheck = $("#select-all-ticker");
  const bulkBar = $("#bulk-actions-ticker");
  const bulkCountBadge = $("#bulk-count-ticker");
  const selectedCountAmongAll = tickerItems.filter((_, idx) => selectedTickerIndices.has(idx)).length;

  if (masterCheck) {
    masterCheck.disabled = !canManage || tickerItems.length === 0;
    masterCheck.checked = tickerItems.length > 0 && selectedCountAmongAll === tickerItems.length;
    masterCheck.indeterminate = selectedCountAmongAll > 0 && selectedCountAmongAll < tickerItems.length;
  }

  const selectedCount = selectedTickerIndices.size;
  if (bulkBar) {
    bulkBar.hidden = selectedCount === 0 || !canManage;
  }
  if (bulkCountBadge) {
    bulkCountBadge.textContent = `تم تحديد ${new Intl.NumberFormat("ar-EG").format(selectedCount)} عبارة`;
  }

  if (tickerItems.length === 0) {
    container.innerHTML = `<div class="admin-empty-state"><p>لا توجد عبارات في الشريط حاليًا. أضف عبارة جديدة أعلاه.</p></div>`;
    return;
  }

  container.innerHTML = tickerItems.map((item, idx) => {
    const isBulkChecked = selectedTickerIndices.has(idx);
    return `
      <div class="ticker-admin-item-row ${isBulkChecked ? "is-bulk-selected" : ""}" data-index="${idx}">
        <div class="item-checkbox-wrap">
          <input
            type="checkbox"
            class="ticker-select-checkbox item-select-checkbox"
            data-index="${idx}"
            ${isBulkChecked ? "checked" : ""}
            ${canManage ? "" : "disabled"}
            aria-label="تحديد عبارة ${idx + 1}"
          />
        </div>
        <span class="ticker-item-num">${idx + 1}</span>
        <span class="ticker-item-content">${safeText(item)}</span>
        <div class="ticker-item-btns">
          ${canManage ? `
            <button type="button" class="admin-button admin-button-small admin-button-quiet" data-action="move-ticker-up" data-index="${idx}" ${idx === 0 ? "disabled" : ""} title="تحريك لأعلى">↑</button>
            <button type="button" class="admin-button admin-button-small admin-button-quiet" data-action="move-ticker-down" data-index="${idx}" ${idx === tickerItems.length - 1 ? "disabled" : ""} title="تحريك لأسفل">↓</button>
            <button type="button" class="admin-button admin-button-small admin-button-danger" data-action="delete-ticker-item" data-index="${idx}" title="حذف">✕</button>
          ` : ""}
        </div>
      </div>
    `;
  }).join("");
}

function handleBulkDeleteTicker() {
  if (!hasPermission("manage_storefront")) {
    showToast("ليس لديك صلاحية لتعديل شريط الأخبار.", true);
    return;
  }
  if (selectedTickerIndices.size === 0) return;

  const targetItems = Array.from(selectedTickerIndices)
    .sort((a, b) => a - b)
    .map((idx) => ({
      title: tickerItems[idx],
      badge: `#${idx + 1}`,
    }))
    .filter((item) => Boolean(item.title));

  openBulkDeleteModal({
    title: "تأكيد حذف عبارات شريط الأخبار المحددة",
    message: `هل أنت متأكد من حذف ${selectedTickerIndices.size} عبارة من شريط الأخبار المتحرك؟`,
    previewItems: targetItems,
    onConfirm: () => {
      const indicesToDelete = Array.from(selectedTickerIndices);
      deleteTickerItems(indicesToDelete);
      selectedTickerIndices.clear();
      tickerItems = getTickerItems();
      renderTickerItemsList();
      showToast(`تم حذف ${indicesToDelete.length} عبارة من الشريط المتحرك ✓`);
    },
  });
}

function handleAddTickerItem() {
  if (!hasPermission("manage_storefront")) {
    showToast("ليس لديك صلاحية لتعديل شريط الأخبار.", true);
    return;
  }

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
  if (!hasPermission("manage_storefront")) {
    showToast("ليس لديك صلاحية لتعديل شريط الأخبار.", true);
    return;
  }

  const idx = Number(index);
  if (action === "delete-ticker-item") {
    selectedTickerIndices.delete(idx);
    deleteTickerItems([idx]);
    tickerItems = getTickerItems();
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

  if (!hasPermission("manage_storefront")) {
    showToast("ليس لديك صلاحية لتعديل إعدادات الشريط المتحرك.", true);
    return;
  }

  storeSettings = {
    ...storeSettings,
    tickerEnabled: $("#setting-ticker-enabled").checked,
    tickerSpeed: $("#setting-ticker-speed").value,
  };
  saveStoreSettings(storeSettings);
  showToast("تم حفظ إعدادات شريط الأخبار بنجاح ✓");
}

// ----------------------------------------------------
// 8. STORE OWNER NOTIFICATION SETTINGS
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

  if (!hasPermission("manage_delivery_settings")) {
    showToast("ليس لديك صلاحية لتعديل إعدادات الإشعارات.", true);
    return;
  }

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
      { name: "صُدْفَة هيريتدج كرونوغراف", quantity: 1, price: 2450, color: "أسود ملكي" }
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
          text: `🚀 <b>إشعار تجريبي ناجح من متجر صُدْفَة</b>\n\nقناة تنبيهات تيليجرام تعمل بنجاح واستجابة فورية.\nرقم الطلب التجريبي: <code>#${testOrder.id}</code>\nالمبلغ: <b>${formatEgp(testOrder.totalAmount)}</b>`,
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
          subject: "🚀 إشعار تجريبي من متجر صُدْفَة",
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
// 9. CATEGORIES MANAGEMENT
// ----------------------------------------------------
function renderCategoriesTable() {
  const tbody = $("#categories-table-body");
  if (!tbody) return;

  const session = getCurrentSession();
  const canManage = session && (session.role === "super_admin" || (session.permissions && session.permissions.manage_categories));

  // Update master checkbox and bulk toolbar for categories
  const masterCheck = $("#select-all-categories");
  const bulkBar = $("#bulk-actions-categories");
  const bulkCountBadge = $("#bulk-count-categories");
  const selectableCats = categories.filter((c) => c.id !== "all");
  const selectedCountAmongSelectable = selectableCats.filter((c) => selectedCategoryIds.has(c.id)).length;

  if (masterCheck) {
    masterCheck.disabled = !canManage || selectableCats.length === 0;
    masterCheck.checked = selectableCats.length > 0 && selectedCountAmongSelectable === selectableCats.length;
    masterCheck.indeterminate = selectedCountAmongSelectable > 0 && selectedCountAmongSelectable < selectableCats.length;
  }

  const selectedCount = selectedCategoryIds.size;
  if (bulkBar) {
    bulkBar.hidden = selectedCount === 0 || !canManage;
  }
  if (bulkCountBadge) {
    bulkCountBadge.textContent = `تم تحديد ${new Intl.NumberFormat("ar-EG").format(selectedCount)} تصنيف`;
  }

  tbody.innerHTML = categories.map((cat) => {
    const count = products.filter((p) => p.categoryId === cat.id).length;
    const isFixed = cat.id === "all";
    const isBulkChecked = selectedCategoryIds.has(cat.id);

    return `
      <tr class="${isBulkChecked ? "is-bulk-selected" : ""}">
        <td style="text-align: center;">
          ${isFixed ? `<small style="color:var(--ink-subtle);">—</small>` : `
            <div class="item-checkbox-wrap" style="justify-content:center;">
              <input
                type="checkbox"
                class="category-select-checkbox item-select-checkbox"
                data-cat-id="${cat.id}"
                ${isBulkChecked ? "checked" : ""}
                ${canManage ? "" : "disabled"}
                aria-label="تحديد تصنيف ${safeText(cat.name)}"
              />
            </div>
          `}
        </td>
        <td style="font-size:18px;">${cat.icon || "⌚"}</td>
        <td><strong>${safeText(cat.name)}</strong></td>
        <td><code>${safeText(cat.id)}</code></td>
        <td><span class="count-badge">${count} ساعة</span></td>
        <td>
          ${isFixed ? `<small style="color:var(--ink-subtle);">افتراضي</small>` : (
            canManage ? `
              <button type="button" class="admin-button admin-button-small admin-button-danger" data-action="delete-category" data-cat-id="${cat.id}">
                حذف
              </button>
            ` : `<small style="color:var(--ink-subtle);">للاطلاع فقط</small>`
          )}
        </td>
      </tr>
    `;
  }).join("");
}

function handleBulkDeleteCategories() {
  if (!hasPermission("manage_categories")) {
    showToast("ليس لديك صلاحية لحذف التصنيفات.", true);
    return;
  }
  if (selectedCategoryIds.size === 0) return;

  // Check if any selected category is attached to existing products
  const attachedProducts = products.filter((p) => selectedCategoryIds.has(p.categoryId));
  if (attachedProducts.length > 0) {
    const attachedCatIds = new Set(attachedProducts.map((p) => p.categoryId));
    const attachedCatNames = categories
      .filter((c) => attachedCatIds.has(c.id))
      .map((c) => `«${c.name}»`)
      .join("، ");
    alert(`لا يمكن حذف التصنيفات التالية لأنها مرتبطة بساعات موجودة حالياً في الكتالوج:\n${attachedCatNames}\n\nيرجى إعادة تعيين أو حذف الساعات التابعة لها أولاً.`);
    return;
  }

  const targetCats = categories.filter((c) => selectedCategoryIds.has(c.id));
  const preview = targetCats.map((c) => ({
    title: `${c.icon || "⌚"} ${c.name}`,
    badge: c.id,
  }));

  openBulkDeleteModal({
    title: "تأكيد حذف التصنيفات المحددة",
    message: `هل أنت متأكد من حذف ${selectedCategoryIds.size} تصنيف نهائياً؟`,
    previewItems: preview,
    onConfirm: () => {
      const idsToDelete = Array.from(selectedCategoryIds);
      deleteCategories(idsToDelete);
      selectedCategoryIds.clear();
      categories = getStoredCategories();
      renderCategoriesTable();
      renderCategoryOptions();
      updateKpiStats();
      showToast(`تم حذف ${idsToDelete.length} تصنيف بنجاح ✓`);
    },
  });
}

function handleAddCategory(e) {
  e.preventDefault();

  if (!hasPermission("manage_categories")) {
    showToast("ليس لديك صلاحية لإضافة تصنيفات جديدة.", true);
    return;
  }

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
  if (!hasPermission("manage_categories")) {
    showToast("ليس لديك صلاحية لحذف التصنيفات.", true);
    return;
  }

  const cat = categories.find((c) => c.id === catId);
  if (!cat) return;

  const inUse = products.some((p) => p.categoryId === catId);
  if (inUse) {
    alert(`لا يمكن حذف تصنيف «${cat.name}» لأنه مرتبط بساعات موجودة في الكتالوج. انقل الساعات لتصنيف آخر أولاً.`);
    return;
  }

  const ok = confirm(`هل أنت متأكد من حذف تصنيف «${cat.name}»؟`);
  if (!ok) return;

  selectedCategoryIds.delete(catId);
  deleteCategories([catId]);
  categories = getStoredCategories();
  renderCategoriesTable();
  renderCategoryOptions();
  updateKpiStats();
  showToast(`تم حذف تصنيف «${cat.name}».`);
}

// ----------------------------------------------------
// 10. CONTACTS & POLICIES MANAGEMENT
// ----------------------------------------------------
function updateWhatsAppPreview() {
  const input = $("#setting-whatsapp");
  const hint = $("#whatsapp-preview-hint");
  const testBtn = $("#btn-test-whatsapp");
  if (!input || !hint) return;

  const raw = input.value.trim();
  if (!raw) {
    hint.textContent = "أدخل رقم الهاتف المصري (مثال: 01012345678) أو الرقم الدولي مع مفتاح الدولة.";
    hint.style.color = "var(--ink-muted)";
    if (testBtn) testBtn.style.display = "none";
    return;
  }

  const clean = formatWhatsAppPhone(raw);
  const isValid = isValidWhatsAppPhone(raw);

  if (isValid) {
    hint.innerHTML = `✓ الرقم معتمد للمحادثات الفورية — سيتم التحويل إلى: <code dir="ltr" style="font-weight:700; color:var(--teal-900);">${clean}</code>`;
    hint.style.color = "var(--teal-900)";
    if (testBtn) {
      const testMsg = `تجربة ربط واتساب متجر صُدْفَة — الرابط يعمل بنجاح على هذا الرقم ومباشر دون وسيط ✓`;
      testBtn.href = buildWhatsAppUrl(clean, testMsg);
      testBtn.style.display = "inline-flex";
    }
  } else {
    hint.innerHTML = `⚠️ رقم غير مكتمل أو غير صالح — الرقم الحالي: <code dir="ltr">${clean || raw}</code> (يجب أن يتكون من 11 رقماً ويبدأ بـ 01)`;
    hint.style.color = "#b91c1c";
    if (testBtn) testBtn.style.display = "none";
  }
}

function updateCloudinaryBadge() {
  const badge = $("#cloudinary-status-badge");
  const cloudName = $("#setting-cloudinary-name")?.value.trim() || storeSettings.cloudinaryCloudName || "";
  const uploadPreset = $("#setting-cloudinary-preset")?.value.trim() || storeSettings.cloudinaryUploadPreset || "";
  if (!badge) return;

  if (cloudName && uploadPreset) {
    badge.className = "cloudinary-status-badge is-connected";
    badge.textContent = `☁️ متصل بـ Cloudinary (${cloudName})`;
  } else {
    badge.className = "cloudinary-status-badge is-local";
    badge.textContent = "التخزين المحلي الآمن (IndexedDB) نشط";
  }
}

function populateContactsAndPolicies() {
  $("#setting-whatsapp").value = storeSettings.defaultWhatsapp || "";
  $("#setting-phone").value = storeSettings.defaultPhone || "";
  $("#setting-shipping").value = storeSettings.shippingDetails || "";
  $("#setting-exchange").value = storeSettings.exchangeDetails || "";
  const cloudNameInput = $("#setting-cloudinary-name");
  const cloudPresetInput = $("#setting-cloudinary-preset");
  if (cloudNameInput) cloudNameInput.value = storeSettings.cloudinaryCloudName || "";
  if (cloudPresetInput) cloudPresetInput.value = storeSettings.cloudinaryUploadPreset || "";
  updateWhatsAppPreview();
  updateCloudinaryBadge();
}

function handleContactsSubmit(e) {
  e.preventDefault();

  if (!hasPermission("manage_delivery_settings")) {
    showToast("ليس لديك صلاحية لتعديل بيانات التواصل والسياسات.", true);
    return;
  }

  const rawWa = $("#setting-whatsapp").value.trim();
  if (rawWa && !isValidWhatsAppPhone(rawWa)) {
    showToast("يرجى إدخال رقم واتساب مصري أو دولي صحيح قبل الحفظ.", true);
    return;
  }

  const cleanWa = formatWhatsAppPhone(rawWa);
  const cName = $("#setting-cloudinary-name")?.value.trim() || "";
  const cPreset = $("#setting-cloudinary-preset")?.value.trim() || "";

  storeSettings = {
    ...storeSettings,
    defaultWhatsapp: cleanWa ? `+${cleanWa}` : "",
    defaultPhone: $("#setting-phone").value.trim(),
    shippingDetails: $("#setting-shipping").value.trim(),
    exchangeDetails: $("#setting-exchange").value.trim(),
    cloudinaryCloudName: cName,
    cloudinaryUploadPreset: cPreset,
  };

  saveStoreSettings(storeSettings);
  updateWhatsAppPreview();
  updateCloudinaryBadge();
  showToast("تم حفظ بيانات التواصل وسياسات المتجر وإعدادات الوسائط بنجاح ✓");

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
// 11. DEDICATED DELIVERY TIMEFRAME SETTINGS
// ----------------------------------------------------
function populateDeliverySettings() {
  const minInput = $("#delivery-min-days");
  const maxInput = $("#delivery-max-days");
  const unitInput = $("#delivery-unit-text");

  const min = storeSettings.deliveryMinDays !== undefined ? storeSettings.deliveryMinDays : 2;
  const max = storeSettings.deliveryMaxDays !== undefined ? storeSettings.deliveryMaxDays : 4;
  const unit = storeSettings.deliveryUnitText || "أيام عمل";

  if (minInput) minInput.value = min;
  if (maxInput) maxInput.value = max;
  if (unitInput) unitInput.value = unit;

  updateDeliveryPreview();
}

function updateDeliveryPreview() {
  const minVal = parseInt($("#delivery-min-days")?.value, 10) || 1;
  const maxVal = parseInt($("#delivery-max-days")?.value, 10) || 1;
  const unitVal = $("#delivery-unit-text")?.value.trim() || "أيام عمل";
  const previewEl = $("#delivery-preview-output");

  if (previewEl) {
    previewEl.textContent = formatDeliveryTimeline({
      deliveryMinDays: minVal,
      deliveryMaxDays: maxVal,
      deliveryUnitText: unitVal,
    });
  }
}

function handleDeliverySettingsSubmit(e) {
  e.preventDefault();

  if (!hasPermission("manage_delivery_settings")) {
    showToast("ليس لديك صلاحية لتعديل إعدادات التوصيل.", true);
    return;
  }

  const minVal = Math.max(1, parseInt($("#delivery-min-days")?.value, 10) || 2);
  const maxVal = Math.max(minVal, parseInt($("#delivery-max-days")?.value, 10) || minVal);
  const unitVal = $("#delivery-unit-text")?.value.trim() || "أيام عمل";

  storeSettings = {
    ...storeSettings,
    deliveryMinDays: minVal,
    deliveryMaxDays: maxVal,
    deliveryUnitText: unitVal,
  };

  saveStoreSettings(storeSettings);
  updateDeliveryPreview();
  showToast("تم حفظ إعدادات مدة التوصيل وتحديث واجهة المتجر بنجاح ✓");
}

// ----------------------------------------------------
// 12. ADMIN USERS & RBAC MANAGEMENT (SUPER ADMIN ONLY)
// ----------------------------------------------------
function renderAdminUsersTable() {
  const tbody = $("#admin-users-table-body");
  if (!tbody) return;

  const users = getAdminUsers();
  const currentSession = getCurrentSession();

  tbody.innerHTML = users.map((u) => {
    const isSuper = u.role === "super_admin";
    const isActive = u.status === "active";
    const isSelf = currentSession && (currentSession.userId === u.id || currentSession.username === u.username);
    const dateFormatted = u.createdAt ? new Date(u.createdAt).toLocaleDateString("ar-EG") : "—";

    let permsSummary = "";
    if (isSuper) {
      permsSummary = `<span class="perm-pill" style="background:var(--teal-50); color:var(--teal-900); font-weight:700;">كافة الصلاحيات (غير مقيد)</span>`;
    } else {
      const permKeys = Object.entries(u.permissions || {}).filter(([_, val]) => Boolean(val)).map(([k]) => k);
      if (permKeys.length === 0) {
        permsSummary = `<span class="perm-pill" style="color:var(--ink-subtle);">لا توجد صلاحيات</span>`;
      } else {
        permsSummary = permKeys.map((k) => `<span class="perm-pill">${ADMIN_PERMISSIONS[k] || k}</span>`).join(" ");
      }
    }

    return `
      <tr data-user-id="${safeText(u.id)}">
        <td><strong>${safeText(u.fullName || u.username)}</strong> ${isSelf ? `<small style="color:var(--copper);">(أنت)</small>` : ""}</td>
        <td><code dir="ltr">${safeText(u.username)}</code></td>
        <td>
          <span class="${isSuper ? "role-badge-super" : "role-badge-admin"}">
            ${isSuper ? "المدير العام" : "مشرف"}
          </span>
        </td>
        <td>
          <span class="${isActive ? "status-badge-active" : "status-badge-suspended"}">
            ${isActive ? "نشط ✓" : "موقوف ✕"}
          </span>
        </td>
        <td style="max-width: 320px;">${permsSummary}</td>
        <td><small>${dateFormatted}</small></td>
        <td>
          <div class="table-actions-cell">
            ${!isSuper ? `
              <button type="button" class="admin-button admin-button-small admin-button-quiet" data-action="edit-user" data-user-id="${safeText(u.id)}">
                تعديل ✎
              </button>
              <button type="button" class="admin-button admin-button-small ${isActive ? "admin-button-danger" : "admin-button-quiet"}" data-action="toggle-status" data-user-id="${safeText(u.id)}" data-status="${u.status}">
                ${isActive ? "إيقاف ⏸" : "تفعيل ▶"}
              </button>
              <button type="button" class="admin-button admin-button-small admin-button-quiet" data-action="reset-user-pass" data-user-id="${safeText(u.id)}" data-username="${safeText(u.username)}">
                كلمة المرور 🔑
              </button>
              <button type="button" class="admin-button admin-button-small admin-button-danger" data-action="delete-user" data-user-id="${safeText(u.id)}" data-name="${safeText(u.fullName || u.username)}">
                حذف ✕
              </button>
            ` : `
              <small style="color:var(--ink-subtle);">حساب أساسي محمي</small>
            `}
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function openAddAdminUserModal() {
  const modal = $("#modal-admin-user");
  const title = $("#modal-admin-user-title");
  const form = $("#form-admin-user");
  const passWrap = $("#admin-user-password-wrap");
  const passInput = $("#admin-user-password");
  const editId = $("#admin-user-edit-id");
  const errorBox = $("#modal-admin-user-error");

  if (!modal || !form) return;
  form.reset();
  if (editId) editId.value = "";
  if (title) title.textContent = "إضافة مشرف جديد";
  if (passWrap) passWrap.style.display = "";
  if (passInput) passInput.required = true;
  if (errorBox) errorBox.hidden = true;

  $("#perm-view-orders").checked = true;
  $("#perm-manage-orders").checked = false;
  $("#perm-manage-products").checked = true;
  $("#perm-manage-categories").checked = false;
  $("#perm-manage-storefront").checked = false;
  $("#perm-manage-delivery").checked = false;

  modal.hidden = false;
}

function openEditAdminUserModal(userId) {
  const users = getAdminUsers();
  const target = users.find((u) => u.id === userId);
  if (!target) return;

  const modal = $("#modal-admin-user");
  const title = $("#modal-admin-user-title");
  const form = $("#form-admin-user");
  const passWrap = $("#admin-user-password-wrap");
  const passInput = $("#admin-user-password");
  const editId = $("#admin-user-edit-id");
  const errorBox = $("#modal-admin-user-error");

  if (!modal || !form) return;
  form.reset();
  if (editId) editId.value = target.id;
  if (title) title.textContent = `تعديل المشرف: ${target.fullName || target.username}`;
  if (passWrap) passWrap.style.display = "none";
  if (passInput) passInput.required = false;
  if (errorBox) errorBox.hidden = true;

  $("#admin-user-fullname").value = target.fullName || "";
  $("#admin-user-username").value = target.username || "";
  $("#admin-user-status").value = target.status || "active";

  const perms = target.permissions || {};
  $("#perm-view-orders").checked = Boolean(perms.view_orders);
  $("#perm-manage-orders").checked = Boolean(perms.manage_orders);
  $("#perm-manage-products").checked = Boolean(perms.manage_products);
  $("#perm-manage-categories").checked = Boolean(perms.manage_categories);
  $("#perm-manage-storefront").checked = Boolean(perms.manage_storefront);
  $("#perm-manage-delivery").checked = Boolean(perms.manage_delivery_settings);

  modal.hidden = false;
}

function closeAdminUserModal() {
  const modal = $("#modal-admin-user");
  if (modal) modal.hidden = true;
}

function handleSaveAdminUser(e) {
  e.preventDefault();
  const errorBox = $("#modal-admin-user-error");
  if (errorBox) errorBox.hidden = true;

  const editId = $("#admin-user-edit-id")?.value;
  const fullName = $("#admin-user-fullname")?.value.trim();
  const username = $("#admin-user-username")?.value.trim();
  const password = $("#admin-user-password")?.value.trim();
  const status = $("#admin-user-status")?.value;

  const permissions = {
    view_orders: $("#perm-view-orders")?.checked ?? false,
    manage_orders: $("#perm-manage-orders")?.checked ?? false,
    manage_products: $("#perm-manage-products")?.checked ?? false,
    manage_categories: $("#perm-manage-categories")?.checked ?? false,
    manage_storefront: $("#perm-manage-storefront")?.checked ?? false,
    manage_delivery_settings: $("#perm-manage-delivery")?.checked ?? false,
  };

  try {
    if (editId) {
      updateAdminUser(editId, { fullName, status, permissions });
      showToast("تم تحديث بيانات وصلاحيات المشرف بنجاح ✓");
    } else {
      createAdminUser({ fullName, username, password, permissions });
      showToast("تمت إضافة المشرف الجديد بنجاح ✓");
    }
    closeAdminUserModal();
    renderAdminUsersTable();
  } catch (err) {
    if (errorBox) {
      errorBox.textContent = err.message || "حدث خطأ أثناء حفظ المشرف.";
      errorBox.hidden = false;
    }
  }
}

function openResetPassModal(userId, username) {
  const modal = $("#modal-admin-reset-pass");
  const targetId = $("#reset-target-user-id");
  const targetName = $("#reset-target-user-name");
  const form = $("#form-admin-reset-pass");
  const errBox = $("#modal-reset-pass-error");

  if (!modal || !form) return;
  form.reset();
  if (targetId) targetId.value = userId;
  if (targetName) targetName.textContent = `المشرف المستهدف: ${username}`;
  if (errBox) errBox.hidden = true;

  modal.hidden = false;
}

function closeResetPassModal() {
  const modal = $("#modal-admin-reset-pass");
  if (modal) modal.hidden = true;
}

function handleSaveResetPass(e) {
  e.preventDefault();
  const errBox = $("#modal-reset-pass-error");
  if (errBox) errBox.hidden = true;

  const userId = $("#reset-target-user-id")?.value;
  const newPass = $("#reset-new-password")?.value.trim();

  try {
    resetUserPassword(userId, newPass);
    showToast("تم تعيين كلمة المرور الجديدة للمشرف بنجاح ✓");
    closeResetPassModal();
  } catch (err) {
    if (errBox) {
      errBox.textContent = err.message || "فشل تعيين كلمة المرور.";
      errBox.hidden = false;
    }
  }
}

// ----------------------------------------------------
// 13. ACCOUNT & SECURITY TAB (FOR ALL ADMINS)
// ----------------------------------------------------
function populateAccountSecurity() {
  const masterKeyDisplay = $("#master-recovery-key-display");
  if (masterKeyDisplay) {
    masterKeyDisplay.textContent = getMasterRecoveryKey();
  }
}

function handleChangePasswordSubmit(e) {
  e.preventDefault();
  const errBox = $("#change-pass-error");
  const successBox = $("#change-pass-success");
  if (errBox) errBox.hidden = true;
  if (successBox) successBox.hidden = true;

  const currentPass = $("#change-pass-current")?.value.trim();
  const newPass = $("#change-pass-new")?.value.trim();
  const confirmPass = $("#change-pass-confirm")?.value.trim();

  if (newPass !== confirmPass) {
    if (errBox) {
      errBox.textContent = "كلمة المرور الجديدة وتأكيدها غير متطابقتين.";
      errBox.hidden = false;
    }
    return;
  }

  const session = getCurrentSession();
  if (!session || !session.userId) {
    showToast("انتهت الجلسة. يرجى تسجيل الدخول مجدداً.", true);
    handleLogout();
    return;
  }

  try {
    changeUserPassword(session.userId, currentPass, newPass);
    if (successBox) {
      successBox.textContent = "تم تغيير كلمة المرور بنجاح ✓";
      successBox.hidden = false;
    }
    $("#change-password-form")?.reset();
    showToast("تم تحديث كلمة المرور الخاصة بك بنجاح ✓");
  } catch (err) {
    if (errBox) {
      errBox.textContent = err.message || "فشل تغيير كلمة المرور.";
      errBox.hidden = false;
    }
  }
}

function initRecoveryKeyActions() {
  const copyBtn = $("#btn-copy-recovery-key");
  const regenBtn = $("#btn-regen-recovery-key");
  const keyDisplay = $("#master-recovery-key-display");

  copyBtn?.addEventListener("click", () => {
    const key = keyDisplay?.textContent || getMasterRecoveryKey();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(key).then(() => {
        showToast("تم نسخ مفتاح الاسترداد إلى الحافظة 📋");
      }).catch(() => {
        showToast(`مفتاح الاسترداد: ${key}`);
      });
    } else {
      showToast(`مفتاح الاسترداد: ${key}`);
    }
  });

  regenBtn?.addEventListener("click", () => {
    const ok = confirm("هل أنت متأكد من توليد مفتاح استرداد رئيسي جديد؟ المفتاح القديم لن يعمل بعد الآن.");
    if (!ok) return;
    const newKey = regenerateMasterRecoveryKey();
    if (keyDisplay) keyDisplay.textContent = newKey;
    showToast("تم توليد مفتاح استرداد جديد بنجاح ↺");
  });
}

// ----------------------------------------------------
// 14. INITIALIZE ADMIN PORTAL
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
  populateDeliverySettings();
  populateAccountSecurity();
}

function initAdminApp() {
  updateAuthViews();

  $("#admin-login-form")?.addEventListener("submit", handleLoginSubmit);
  $("#admin-logout-btn")?.addEventListener("click", handleLogout);

  initPasswordToggle();
  initPasswordRecoveryFlow();
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
      selectedProductIds.clear();
      renderProductsList();
    });
  });

  // Products Multi-Select Handlers
  $("#admin-products-list")?.addEventListener("change", (e) => {
    const chk = e.target.closest(".product-select-checkbox");
    if (!chk) return;
    const pid = chk.dataset.productId;
    if (chk.checked) {
      selectedProductIds.add(pid);
    } else {
      selectedProductIds.delete(pid);
    }
    renderProductsList();
  });

  $("#select-all-products")?.addEventListener("change", (e) => {
    let filtered = products;
    if (currentListFilter === "active") filtered = products.filter((p) => p.active !== false);
    if (currentListFilter === "hidden") filtered = products.filter((p) => p.active === false);

    if (e.target.checked) {
      filtered.forEach((p) => selectedProductIds.add(p.id));
    } else {
      filtered.forEach((p) => selectedProductIds.delete(p.id));
    }
    renderProductsList();
  });

  $("#btn-clear-products-selection")?.addEventListener("click", () => {
    selectedProductIds.clear();
    renderProductsList();
  });

  $("#btn-bulk-delete-products")?.addEventListener("click", handleBulkDeleteProducts);

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
      selectedOrderIds.clear();
      renderOrdersList();
    });
  });

  $("#admin-orders-list")?.addEventListener("change", (e) => {
    if (e.target.dataset.action === "change-order-status") {
      const orderId = e.target.dataset.orderId;
      const newStatus = e.target.value;
      handleOrderStatusChange(orderId, newStatus);
    } else if (e.target.classList.contains("order-select-checkbox")) {
      const orderId = e.target.dataset.orderId;
      if (e.target.checked) {
        selectedOrderIds.add(orderId);
      } else {
        selectedOrderIds.delete(orderId);
      }
      renderOrdersList();
    }
  });

  $("#admin-orders-list")?.addEventListener("click", (e) => {
    const delBtn = e.target.closest('[data-action="delete-single-order"]');
    if (delBtn) {
      const orderId = delBtn.dataset.orderId;
      handleDeleteSingleOrder(orderId);
    }
  });

  $("#select-all-orders")?.addEventListener("change", (e) => {
    let filtered = orders;
    if (currentOrderFilter !== "all") {
      filtered = orders.filter((o) => o.status === currentOrderFilter);
    }
    if (e.target.checked) {
      filtered.forEach((o) => selectedOrderIds.add(o.id));
    } else {
      filtered.forEach((o) => selectedOrderIds.delete(o.id));
    }
    renderOrdersList();
  });

  $("#btn-clear-orders-selection")?.addEventListener("click", () => {
    selectedOrderIds.clear();
    renderOrdersList();
  });

  $("#btn-bulk-delete-orders")?.addEventListener("click", handleBulkDeleteOrders);

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
  $("#admin-ticker-items-list")?.addEventListener("change", (e) => {
    const chk = e.target.closest(".ticker-select-checkbox");
    if (!chk) return;
    const idx = Number(chk.dataset.index);
    if (chk.checked) {
      selectedTickerIndices.add(idx);
    } else {
      selectedTickerIndices.delete(idx);
    }
    renderTickerItemsList();
  });
  $("#select-all-ticker")?.addEventListener("change", (e) => {
    if (e.target.checked) {
      tickerItems.forEach((_, idx) => selectedTickerIndices.add(idx));
    } else {
      selectedTickerIndices.clear();
    }
    renderTickerItemsList();
  });
  $("#btn-clear-ticker-selection")?.addEventListener("click", () => {
    selectedTickerIndices.clear();
    renderTickerItemsList();
  });
  $("#btn-bulk-delete-ticker")?.addEventListener("click", handleBulkDeleteTicker);

  // Notification Settings Form & Test Button
  $("#notifications-settings-form")?.addEventListener("submit", handleNotificationsSubmit);
  $("#test-notification-btn")?.addEventListener("click", handleTestNotification);

  // Categories Form & Actions
  $("#add-category-form")?.addEventListener("submit", handleAddCategory);
  $("#categories-table-body")?.addEventListener("click", (e) => {
    const delBtn = e.target.closest('[data-action="delete-category"]');
    if (delBtn) {
      handleDeleteCategory(delBtn.dataset.catId);
    }
  });
  $("#categories-table-body")?.addEventListener("change", (e) => {
    const chk = e.target.closest(".category-select-checkbox");
    if (!chk) return;
    const catId = chk.dataset.catId;
    if (chk.checked) {
      selectedCategoryIds.add(catId);
    } else {
      selectedCategoryIds.delete(catId);
    }
    renderCategoriesTable();
  });
  $("#select-all-categories")?.addEventListener("change", (e) => {
    const selectable = categories.filter((c) => c.id !== "all");
    if (e.target.checked) {
      selectable.forEach((c) => selectedCategoryIds.add(c.id));
    } else {
      selectable.forEach((c) => selectedCategoryIds.delete(c.id));
    }
    renderCategoriesTable();
  });
  $("#btn-clear-categories-selection")?.addEventListener("click", () => {
    selectedCategoryIds.clear();
    renderCategoriesTable();
  });
  $("#btn-bulk-delete-categories")?.addEventListener("click", handleBulkDeleteCategories);

  // Universal Bulk Delete Confirmation Modal Controls
  $("#btn-close-bulk-delete")?.addEventListener("click", closeBulkDeleteModal);
  $("#backdrop-bulk-delete")?.addEventListener("click", closeBulkDeleteModal);
  $("#btn-cancel-bulk-delete")?.addEventListener("click", closeBulkDeleteModal);
  $("#btn-confirm-bulk-delete")?.addEventListener("click", () => {
    if (typeof pendingBulkDelete === "function") {
      pendingBulkDelete();
    }
    closeBulkDeleteModal();
  });

  // Contacts Form
  $("#store-contacts-form")?.addEventListener("submit", handleContactsSubmit);
  $("#setting-whatsapp")?.addEventListener("input", updateWhatsAppPreview);
  $("#setting-cloudinary-name")?.addEventListener("input", updateCloudinaryBadge);
  $("#setting-cloudinary-preset")?.addEventListener("input", updateCloudinaryBadge);
  $("#btn-add-variant-row")?.addEventListener("click", () => addVisualVariantRow());

  // Initialize Direct Device Media Uploaders
  const primaryUploaderContainer = $("#product-primary-image-uploader");
  if (primaryUploaderContainer) {
    productImageUploader = createMediaUploader({
      container: primaryUploaderContainer,
      id: "product-primary",
      type: "image",
      initialUrl: $("#edit-image-url")?.value || "",
      label: "صورة الغلاف الرئيسية للساعة",
      hint: "اسحب صورة الساعة هنا أو اخترها من جهازك (سيتم ضغطها وتخزينها بأعلى جودة)",
      getCloudSettings: () => ({
        cloudName: storeSettings.cloudinaryCloudName,
        uploadPreset: storeSettings.cloudinaryUploadPreset,
      }),
      onChange: (url) => {
        const input = $("#edit-image-url");
        if (input) input.value = url;
      },
    });
  }

  const heroVideoContainer = $("#hero-video-uploader");
  if (heroVideoContainer) {
    heroVideoUploader = createMediaUploader({
      container: heroVideoContainer,
      id: "hero-video",
      type: "video",
      initialUrl: storeSettings.heroVideoUrl || "",
      label: "فيديو البطل الرئيسي (Hero Video)",
      hint: "ارفع فيديو البطل الترويجي مباشرة من جهازك (.mp4, .webm, .mov) بحجم يصل إلى 100MB",
      getCloudSettings: () => ({
        cloudName: storeSettings.cloudinaryCloudName,
        uploadPreset: storeSettings.cloudinaryUploadPreset,
      }),
      onChange: (url) => {
        const input = $("#setting-video-url");
        if (input) input.value = url;
      },
    });
  }

  const heroPosterContainer = $("#hero-poster-uploader");
  if (heroPosterContainer) {
    heroPosterUploader = createMediaUploader({
      container: heroPosterContainer,
      id: "hero-poster",
      type: "image",
      initialUrl: storeSettings.heroPosterUrl || "",
      label: "صورة غلاف الفيديو (Hero Poster)",
      hint: "الصورة المعروضة قبل بدء تشغيل الفيديو أو كغلاف احتياطي",
      getCloudSettings: () => ({
        cloudName: storeSettings.cloudinaryCloudName,
        uploadPreset: storeSettings.cloudinaryUploadPreset,
      }),
      onChange: (url) => {
        const input = $("#setting-poster-url");
        if (input) input.value = url;
      },
    });
  }

  // Resolve any media:// URLs in products catalog for crisp admin thumbnails
  resolveProductsMedia(products).then((res) => {
    products = res;
    renderProductsList();
  });

  // Dedicated Delivery Settings
  $("#delivery-settings-form")?.addEventListener("submit", handleDeliverySettingsSubmit);
  $("#delivery-min-days")?.addEventListener("input", updateDeliveryPreview);
  $("#delivery-max-days")?.addEventListener("input", updateDeliveryPreview);
  $("#delivery-unit-text")?.addEventListener("input", updateDeliveryPreview);

  // Admin Users Management (Super Admin)
  $("#btn-create-admin-user")?.addEventListener("click", openAddAdminUserModal);
  $("#btn-close-admin-user-modal")?.addEventListener("click", closeAdminUserModal);
  $("#backdrop-admin-user")?.addEventListener("click", closeAdminUserModal);
  $("#btn-cancel-admin-user")?.addEventListener("click", closeAdminUserModal);
  $("#form-admin-user")?.addEventListener("submit", handleSaveAdminUser);

  // Reset Password Modal
  $("#btn-close-reset-pass-modal")?.addEventListener("click", closeResetPassModal);
  $("#backdrop-admin-reset-pass")?.addEventListener("click", closeResetPassModal);
  $("#btn-cancel-reset-pass")?.addEventListener("click", closeResetPassModal);
  $("#form-admin-reset-pass")?.addEventListener("submit", handleSaveResetPass);

  // Admin Users Table Actions Delegation
  $("#admin-users-table-body")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const userId = btn.dataset.userId;

    if (action === "edit-user") {
      openEditAdminUserModal(userId);
    } else if (action === "toggle-status") {
      const currentStatus = btn.dataset.status;
      const nextStatus = currentStatus === "active" ? "suspended" : "active";
      try {
        updateAdminUser(userId, { status: nextStatus });
        renderAdminUsersTable();
        showToast(nextStatus === "active" ? "تم تفعيل حساب المشرف بنجاح ▶" : "تم إيقاف حساب المشرف مؤقتاً ⏸");
      } catch (err) {
        showToast(err.message, true);
      }
    } else if (action === "reset-user-pass") {
      const username = btn.dataset.username;
      openResetPassModal(userId, username);
    } else if (action === "delete-user") {
      const name = btn.dataset.name;
      const ok = confirm(`هل أنت متأكد من حذف حساب المشرف «${name}» نهائياً؟`);
      if (!ok) return;
      try {
        deleteAdminUser(userId);
        renderAdminUsersTable();
        showToast(`تم حذف المشرف «${name}» بنجاح.`);
      } catch (err) {
        showToast(err.message, true);
      }
    }
  });

  // Account & Security Form & Recovery Key Actions
  $("#change-password-form")?.addEventListener("submit", handleChangePasswordSubmit);
  initRecoveryKeyActions();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdminApp);
} else {
  initAdminApp();
}
