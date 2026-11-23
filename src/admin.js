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
  saveAdminUsers,
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
import { resolveMediaUrl, resolveProductsMedia, getCachedMediaUrl, processMediaUpload } from "./mediaStorage.js";
import { initCloudSync, syncAllCloudData, getCloudSyncConfig, pushCloudState } from "./cloudSync.js";
import {
  getGitHubConfig,
  saveGitHubConfig,
  testGitHubConnection,
  publishStoreToGitHub,
  downloadStoreBackup,
  restoreStoreFromData,
} from "./githubSync.js";
import "./brandLogo.css";
import "./brandLogo.js";
import {
  saveSettingsDirectToTurso,
  saveTickerItemsDirectToTurso,
  saveCategoriesDirectToTurso,
  saveProductDirectToTurso,
  deleteProductsDirectFromTurso,
  fetchStoreDirectFromTurso,
  fetchOrdersDirectFromTurso,
  updateOrderStatusDirectInTurso,
  deleteOrdersDirectFromTurso,
} from "./tursoDirect.js";

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
let isCloudConnected = true;

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

function getEffectiveCloudinarySettings() {
  const envCloudName = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_CLOUDINARY_CLOUD_NAME) || "";
  const envPreset = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET) || "";
  const inputCloudName = $("#setting-cloudinary-name")?.value?.trim() || "";
  const inputPreset = $("#setting-cloudinary-preset")?.value?.trim() || "";

  return {
    cloudName: inputCloudName || storeSettings?.cloudinaryCloudName || envCloudName || "v3macb6a",
    uploadPreset: inputPreset || storeSettings?.cloudinaryUploadPreset || envPreset || "SodfaShop",
  };
}

function getAdminAuthHeaders() {
  const headers = { "Content-Type": "application/json" };
  try {
    const raw = sessionStorage.getItem("daffa_admin_session") || localStorage.getItem("daffa_admin_session");
    if (raw) {
      headers["x-admin-session"] = raw;
      const parsed = JSON.parse(raw);
      if (parsed.token) {
        headers["Authorization"] = `Bearer ${parsed.token}`;
        headers["x-admin-token"] = parsed.token;
      } else {
        headers["Authorization"] = `Bearer ${raw}`;
        headers["x-admin-token"] = raw;
      }
    }
  } catch {}
  return headers;
}

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

async function handleLoginSubmit(e) {
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

  // Obtain cloud session token from /api/auth before continuing
  try {
    const authRes = await fetch("/api/auth?action=login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, rememberMe }),
    });
    if (authRes.ok) {
      const data = await authRes.json();
      if (data && data.token) {
        sessionData.token = data.token;
      }
    }
  } catch (err) {
    console.warn("Could not obtain online auth token, falling back to local session:", err);
  }

  setAdminSession(sessionData, rememberMe);
  updateAuthViews();
  checkCloudHealth();
  if (result.role === "super_admin") {
    fetchAdminUsersFromCloud();
  }
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
  const socialSubmit = $("#social-links-settings-form button[type='submit']");
  if (socialSubmit) socialSubmit.disabled = !canManageDelivery;

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
    onConfirm: async () => {
      const idsToDelete = Array.from(selectedProductIds);
      const prevProducts = [...products];
      deleteProducts(idsToDelete);
      selectedProductIds.clear();
      products = getStoredProducts();
      if (editingProductId && idsToDelete.includes(editingProductId)) {
        resetProductEditor();
      }
      updateKpiStats();
      renderProductsList();

      let deleteSuccess = false;
      try {
        const directRes = await deleteProductsDirectFromTurso(idsToDelete);
        if (directRes) deleteSuccess = true;
      } catch {}

      try {
        const res = await fetch("/api/products", {
          method: "DELETE",
          headers: getAdminAuthHeaders(),
          body: JSON.stringify({ ids: idsToDelete }),
        });
        if (res.ok) deleteSuccess = true;
      } catch {}

      if (!deleteSuccess) {
        products = prevProducts;
        saveStoredProducts(products);
        updateKpiStats();
        renderProductsList();
        showToast("تعذر حذف الساعات من السحابة. تم استرجاع البيانات.", true);
        updateCloudDbBadge(false);
        return;
      }

      showToast(`تم حذف ${idsToDelete.length} ساعة نهائياً وتحديث المتجر والسحابة ✓`);
      updateCloudDbBadge(true);
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
    getCloudSettings: getEffectiveCloudinarySettings,
    onChange: (url) => {
      variantObj.imageUrl = url;
      syncVisualVariantsToTextarea();
      updateFramingPreview();
    },
  });

  // Bind delete button
  const delBtn = card.querySelector('[data-action="delete-variant-row"]');
  delBtn?.addEventListener("click", () => {
    visualVariants = visualVariants.filter((v) => v.id !== rowId);
    card.remove();
    syncVisualVariantsToTextarea();
    updateFramingPreview();
  });

  syncVisualVariantsToTextarea();
  updateFramingPreview();
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

function updateCloudSyncBanner() {
  const banner = $("#admin-cloud-sync-banner");
  if (!banner) return;

  const { isConfigured, githubOwner, githubRepo } = getCloudSyncConfig();
  if (isConfigured) {
    banner.className = "cloud-sync-banner is-connected";
    banner.innerHTML = `
      <div class="cloud-sync-main">
        <span class="cloud-sync-icon" aria-hidden="true">🚀</span>
        <div class="cloud-sync-info">
          <div class="cloud-sync-title">وضع النشر المباشر على GitHub Pages نشط</div>
          <div class="cloud-sync-desc">أي ساعة جديدة أو تعديل يتم نشره مباشرة إلى مستودع ${safeText(githubOwner)}/${safeText(githubRepo)} ويظهر فوراً لجميع الزوار.</div>
        </div>
      </div>
      <span class="cloud-sync-badge is-active">سحابي نشط ✓</span>
    `;
  } else {
    banner.className = "cloud-sync-banner is-local";
    banner.innerHTML = `
      <div class="cloud-sync-main">
        <span class="cloud-sync-icon" aria-hidden="true">📁</span>
        <div class="cloud-sync-info">
          <div class="cloud-sync-title">وضع التخزين المحلي (على هذا الجهاز فقط)</div>
          <div class="cloud-sync-desc">لظهور الساعات على الموبايل وجميع الزوار، قم بإدخال بيانات مستودع GitHub في الإعدادات لنشرها مجاناً.</div>
        </div>
      </div>
      <button type="button" class="admin-button admin-button-small admin-button-quiet" id="btn-goto-cloud-settings">
        إعدادات النشر على GitHub ⚙️
      </button>
    `;

    $("#btn-goto-cloud-settings")?.addEventListener("click", () => {
      const settingsTabBtn = document.querySelector('[data-tab="settings"]');
      if (settingsTabBtn) {
        settingsTabBtn.click();
        setTimeout(() => {
          $("#setting-github-owner")?.scrollIntoView({ behavior: "smooth", block: "center" });
          $("#setting-github-owner")?.focus();
        }, 200);
      }
    });
  }
}

function updateFramingPreview() {
  const aspect = $("#edit-frame-aspect")?.value || "4/5";
  const fit = $("#edit-frame-fit")?.value || "contain";
  const scale = Number($("#edit-frame-scale")?.value) || 100;
  const alignment = $("#edit-frame-alignment")?.value || "center";

  const scaleDisplay = $("#scale-value-display");
  if (scaleDisplay) scaleDisplay.textContent = `${scale}%`;

  const previewBox = $("#preview-visual-box");
  const previewImg = $("#preview-framing-img");
  const captionName = $("#preview-caption-name");
  const captionPrice = $("#preview-caption-price");

  if (previewBox) {
    previewBox.style.aspectRatio = aspect === "auto" ? "auto" : aspect.replace("/", " / ");
  }

  if (previewImg) {
    let imgSrc = productImageUploader?.getUrl() || $("#edit-image-url")?.value || "";
    if (!imgSrc && visualVariants.length > 0 && visualVariants[0]?.imageUrl) {
      imgSrc = visualVariants[0].imageUrl;
    }
    if (!imgSrc) imgSrc = "/sodfa-promo-poster.jpg";

    previewImg.src = getCachedMediaUrl(imgSrc);
    previewImg.style.objectFit = fit;
    previewImg.style.objectPosition = alignment;
    previewImg.style.transform = `scale(${scale / 100})`;
  }

  if (captionName) {
    const typedName = $("#edit-name")?.value.trim();
    captionName.textContent = typedName || "اسم الموديل";
  }

  if (captionPrice) {
    const finalPriceText = $("#admin-preview-final")?.textContent;
    captionPrice.textContent = (finalPriceText && finalPriceText !== "—") ? finalPriceText : "0 ج.م";
  }
}

// ----------------------------------------------------
// BATCH MULTI-IMAGE UPLOADER & PRODUCT GALLERY MANAGER
// ----------------------------------------------------
let productGalleryImages = [];

function renderProductGalleryGrid() {
  const grid = $("#product-gallery-grid");
  const countBadge = $("#gallery-count-badge");
  const editImageUrlInput = $("#edit-image-url");
  if (!grid) return;

  if (countBadge) {
    countBadge.textContent = `${productGalleryImages.length} صور`;
  }

  // Ensure at least one image is primary if images exist
  if (productGalleryImages.length > 0 && !productGalleryImages.some((img) => img.isPrimary)) {
    productGalleryImages[0].isPrimary = true;
  }

  const primaryItem = productGalleryImages.find((img) => img.isPrimary);
  if (editImageUrlInput) {
    editImageUrlInput.value = primaryItem?.imageUrl || "";
  }

  if (productGalleryImages.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 22px 16px; color: var(--ink-muted); font-size: 13px; background: rgba(0,0,0,0.02); border-radius: 8px; border: 1px dashed var(--line);">
        لا توجد صور مضافة لهذه الساعة حتى الآن. اسحب صوراً بالأعلى أو اضغط لتحديد عدة صور دفعة واحدة.
      </div>
    `;
    updateFramingPreview();
    return;
  }

  grid.innerHTML = productGalleryImages.map((img, idx) => `
    <div class="gallery-card-item ${img.isPrimary ? "is-primary-card" : ""}" data-index="${idx}">
      <div class="gallery-thumb-stage">
        <img src="${safeText(img.imageUrl)}" alt="${safeText(img.colorLabel || `صورة ${idx + 1}`)}" style="object-fit: contain;" />
        ${img.isPrimary ? '<span class="gallery-primary-badge">الصورة الرئيسية ★</span>' : ''}
      </div>
      <div class="gallery-card-meta">
        <input 
          type="text" 
          class="gallery-color-input" 
          data-index="${idx}" 
          value="${safeText(img.colorLabel || '')}" 
          placeholder="اسم اللون / الموديل" 
          title="اسم اللون أو الخيار الخاص بهذه الصورة"
        />
        <div class="gallery-card-actions">
          ${!img.isPrimary ? `
            <button type="button" class="gallery-set-primary-btn" data-action="set-primary" data-index="${idx}">
              ★ تعيين كرئيسية
            </button>
          ` : `
            <span class="gallery-active-label">✓ الرئيسية</span>
          `}
          <button type="button" class="gallery-delete-btn" data-action="delete-image" data-index="${idx}" title="حذف الصورة من المعرض">
            ✕ حذف
          </button>
        </div>
      </div>
    </div>
  `).join("");

  updateFramingPreview();
}

async function handleBatchFilesUpload(files) {
  if (!files || files.length === 0) return;

  const validFiles = Array.from(files).filter((f) => f.type && f.type.startsWith("image/"));
  if (validFiles.length === 0) {
    showToast("يرجى تحديد ملفات صور صالحة (PNG, JPG, WebP).", true);
    return;
  }

  const progressEl = $("#gallery-upload-progress");
  const progressFill = $("#gallery-progress-fill");
  const progressText = $("#gallery-progress-text");

  if (progressEl) progressEl.hidden = false;
  if (progressFill) progressFill.style.width = "10%";
  if (progressText) progressText.textContent = `جاري رفع ${validFiles.length} صورة إلى السحابة...`;

  let completed = 0;
  try {
    const uploadPromises = validFiles.map(async (file, idx) => {
      const res = await processMediaUpload(file, {
        onProgress: (p) => {
          const pct = typeof p === "object" ? p.percent || 0 : 0;
          const overall = Math.round(((completed + pct / 100) / validFiles.length) * 100);
          if (progressFill) progressFill.style.width = `${Math.min(95, overall)}%`;
        },
      });
      completed++;
      const overall = Math.round((completed / validFiles.length) * 100);
      if (progressFill) progressFill.style.width = `${overall}%`;
      if (progressText) progressText.textContent = `تم رفع ${completed} من ${validFiles.length} صور...`;
      return {
        id: `img_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
        imageUrl: res.url || res.previewUrl,
        colorLabel: "",
        isPrimary: false,
      };
    });

    const newImages = await Promise.all(uploadPromises);
    const validImages = newImages.filter((img) => img.imageUrl);

    if (validImages.length > 0) {
      if (productGalleryImages.length === 0) {
        validImages[0].isPrimary = true;
      }
      productGalleryImages.push(...validImages);
      renderProductGalleryGrid();
      showToast(`تم رفع ${validImages.length} صورة للساعة بنجاح ✓`);
    }
  } catch (err) {
    console.error("Batch upload error:", err);
    showToast("حدث خطأ أثناء رفع بعض الصور. يرجى المحاولة مجدداً.", true);
  } finally {
    if (progressFill) progressFill.style.width = "100%";
    setTimeout(() => {
      if (progressEl) progressEl.hidden = true;
      if (progressFill) progressFill.style.width = "0%";
    }, 600);
  }
}

function handleAddDirectGalleryUrl() {
  const input = $("#gallery-direct-url-input");
  const url = input?.value.trim();
  if (!url || !url.startsWith("http")) {
    showToast("يرجى إدخال رابط صورة صالح يبدأ بـ http:// أو https://", true);
    return;
  }
  const isFirst = productGalleryImages.length === 0;
  productGalleryImages.push({
    id: `img_url_${Date.now()}`,
    imageUrl: url,
    colorLabel: "",
    isPrimary: isFirst,
  });
  if (input) input.value = "";
  renderProductGalleryGrid();
  showToast("تمت إضافة رابط الصورة للمعرض بنجاح ✓");
}

function resetProductEditor() {
  editingProductId = null;
  const form = $("#admin-product-form");
  if (!form) return;
  form.reset();

  $("#edit-product-id").value = "";
  $("#editor-title").textContent = "إضافة ساعة جديدة";
  $("#editor-action-label").textContent = "موديل جديد";

  const saveBtnText = $("#product-submit-btn-text");
  if (saveBtnText) saveBtnText.textContent = "إضافة الساعة للكتالوج ✓";
  else $("#product-save-btn").innerHTML = 'إضافة الساعة للكتالوج <span aria-hidden="true">✓</span>';

  $("#product-delete-btn").hidden = true;
  $("#product-form-error").hidden = true;
  $("#edit-active").checked = true;
  $("#edit-flagship").checked = false;
  $("#edit-sort-order").value = 0;
  $("#edit-stock-count").value = 10;
  $("#edit-discount-type").value = "none";
  $("#edit-discount-value").value = 0;
  $("#edit-image-url").value = "";

  if ($("#edit-frame-aspect")) $("#edit-frame-aspect").value = "4/5";
  if ($("#edit-frame-fit")) $("#edit-frame-fit").value = "contain";
  if ($("#edit-frame-scale")) $("#edit-frame-scale").value = 100;
  if ($("#scale-value-display")) $("#scale-value-display").textContent = "100%";
  if ($("#edit-frame-alignment")) $("#edit-frame-alignment").value = "center";

  productImageUploader?.setUrl("");
  clearVisualVariants();
  productGalleryImages = [];
  renderProductGalleryGrid();

  updatePricePreview();
  updateFramingPreview();
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

  // Image framing settings
  const framing = product.imageFraming || {
    aspectRatio: "4/5",
    fitMode: "contain",
    scale: 100,
    alignment: "center",
  };
  if ($("#edit-frame-aspect")) $("#edit-frame-aspect").value = framing.aspectRatio || "4/5";
  if ($("#edit-frame-fit")) $("#edit-frame-fit").value = framing.fitMode || "contain";
  if ($("#edit-frame-scale")) $("#edit-frame-scale").value = framing.scale !== undefined ? framing.scale : 100;
  if ($("#scale-value-display")) $("#scale-value-display").textContent = `${framing.scale !== undefined ? framing.scale : 100}%`;
  if ($("#edit-frame-alignment")) $("#edit-frame-alignment").value = framing.alignment || "center";

  productImageUploader?.setUrl(product.imageUrl || "");
  loadVariantsIntoVisualManager(product.images || product.imageUrl || "");

  // Load product gallery images
  if (Array.isArray(product.images) && product.images.length > 0) {
    productGalleryImages = product.images.map((img, idx) => {
      const u = typeof img === "string" ? img : img.imageUrl;
      const lbl = typeof img === "object" ? (img.colorLabel || "") : "";
      return {
        id: `img_${idx}_${Date.now()}`,
        imageUrl: u,
        colorLabel: lbl,
        isPrimary: u === product.imageUrl || idx === 0,
      };
    });
  } else if (product.imageUrl) {
    productGalleryImages = [{
      id: `img_0_${Date.now()}`,
      imageUrl: product.imageUrl,
      colorLabel: "الأصلي",
      isPrimary: true,
    }];
  } else {
    productGalleryImages = [];
  }
  if (productGalleryImages.length > 0 && !productGalleryImages.some((img) => img.isPrimary)) {
    productGalleryImages[0].isPrimary = true;
  }
  renderProductGalleryGrid();

  $("#edit-sort-order").value = product.sortOrder || 0;
  $("#edit-stock-count").value = product.stockCount !== undefined ? product.stockCount : 10;
  $("#edit-active").checked = product.active !== false;
  $("#edit-flagship").checked = Boolean(product.isFlagship);

  $("#editor-title").textContent = `تعديل: ${product.name}`;
  $("#editor-action-label").textContent = "تعديل الموديل";

  const saveBtnText = $("#product-submit-btn-text");
  if (saveBtnText) saveBtnText.textContent = "حفظ التعديلات ✓";
  else $("#product-save-btn").innerHTML = 'حفظ التعديلات <span aria-hidden="true">✓</span>';

  $("#product-delete-btn").hidden = false;
  $("#product-form-error").hidden = true;

  updatePricePreview();
  updateFramingPreview();
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
    updateFramingPreview();
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

  updateFramingPreview();
}

async function handleProductFormSubmit(e) {
  e.preventDefault();

  if (!hasPermission("manage_products")) {
    showToast("ليس لديك صلاحية لإضافة أو تعديل الساعات.", true);
    return;
  }

  const saveBtn = $("#product-save-btn");
  const saveBtnText = $("#product-submit-btn-text");
  const saveSpinner = $("#product-submit-spinner");
  const errorEl = $("#product-form-error");

  if (errorEl) {
    errorEl.hidden = true;
    errorEl.textContent = "";
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

  if (!name || !basePrice || basePrice <= 0) {
    if (errorEl) {
      errorEl.textContent = "يرجى إدخال اسم الساعة والسعر الأصلي بشكل صحيح (أكبر من 0).";
      errorEl.hidden = false;
      errorEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    return;
  }

  // Set loading state feedback
  if (saveBtn) saveBtn.disabled = true;
  if (saveSpinner) saveSpinner.hidden = false;
  if (saveBtnText) saveBtnText.textContent = "جاري حفظ الساعة ومزامنة السحابة...";

  try {
    let images = [];
    if (productGalleryImages.length > 0) {
      images = productGalleryImages
        .filter((img) => img.imageUrl)
        .map((img, idx) => ({
          imageUrl: img.imageUrl,
          colorLabel: img.colorLabel || (idx === 0 ? "الأصلي" : `خيار ${idx + 1}`),
          sortOrder: idx,
        }));
    } else if (visualVariants.length > 0) {
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

    const primaryGalleryItem = productGalleryImages.find((img) => img.isPrimary);
    const finalImageUrl = primaryGalleryItem?.imageUrl || imageUrl || (images[0]?.imageUrl || "/sodfa-promo-poster.jpg");
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

    // Read image framing values
    const imageFraming = {
      aspectRatio: $("#edit-frame-aspect")?.value || "4/5",
      fitMode: $("#edit-frame-fit")?.value || "contain",
      scale: Number($("#edit-frame-scale")?.value) || 100,
      alignment: $("#edit-frame-alignment")?.value || "center",
    };

    const existingIndex = products.findIndex((p) => p.id === id);

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
      imageFraming,
      sortOrder,
      stockCount,
      inStock: stockCount > 0,
      active,
      isFlagship,
      createdAt: existingIndex > -1 ? (products[existingIndex]?.createdAt || new Date().toISOString()) : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const prevProducts = [...products];

    if (isFlagship) {
      products.forEach((p) => { if (p.id !== id) p.isFlagship = false; });
    }

    if (existingIndex > -1) {
      products[existingIndex] = { ...products[existingIndex], ...productData };
    } else {
      products.unshift(productData);
    }

    saveStoredProducts(products);
    updateKpiStats();
    renderProductsList();

    // Push explicitly to cloud (store.json / GitHub and local server sync)
    await pushCloudState("products", products);

    resolveProductsMedia(products).then((res) => {
      products = res;
      renderProductsList();
    });

    let cloudSuccess = false;
    let cloudErrMsg = "";

    // 1. Save directly to Turso Cloud DB (100% resilient across Mobile & Laptop)
    try {
      const directRes = await saveProductDirectToTurso(productData);
      if (directRes) cloudSuccess = true;
    } catch (err) {
      console.warn("Direct Turso product save error:", err);
    }

    // 2. Serverless API sync
    try {
      const cloudRes = await fetch(`/api/products`, {
        method: existingIndex > -1 ? "PUT" : "POST",
        headers: getAdminAuthHeaders(),
        body: JSON.stringify(productData),
      });
      const cloudJson = await cloudRes.json().catch(() => ({}));
      if (cloudRes.ok && cloudJson.ok) {
        cloudSuccess = true;
      } else if (!cloudSuccess) {
        cloudErrMsg = cloudJson.error || `HTTP ${cloudRes.status}`;
      }
    } catch (err) {
      if (!cloudSuccess) cloudErrMsg = err.message || "خطأ اتصال";
    }

    if (!cloudSuccess) {
      // Rollback optimistic state on failure
      products = prevProducts;
      saveStoredProducts(products);
      updateKpiStats();
      renderProductsList();
      updateCloudDbBadge(false);
      const msg = cloudErrMsg || "تعذر مزامنة الساعة مع قاعدة بيانات Turso السحابية.";
      if (errorEl) {
        errorEl.textContent = `فشل الحفظ السحابي: ${msg}`;
        errorEl.hidden = false;
        errorEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      showToast(`فشل حفظ الساعة في السحابة: ${msg}`, true);
      return;
    }

    updateCloudDbBadge(true);
    showToast(`تم حفظ الساعة «${name}» ومزامنتها سحابياً بنجاح ✓`);
    resetProductEditor();
  } catch (err) {
    console.error("Product save error:", err);
    if (errorEl) {
      errorEl.textContent = `فشل حفظ الساعة: ${err?.message || "حدث خطأ غير متوقع أثناء الحفظ والمزامنة."}`;
      errorEl.hidden = false;
      errorEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    showToast("تعذر حفظ الساعة. تحقق من الخطأ بالأعلى.", true);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
    if (saveSpinner) saveSpinner.hidden = true;
    if (saveBtnText) saveBtnText.textContent = editingProductId ? "حفظ التعديلات ✓" : "إضافة الساعة للكتالوج ✓";
  }
}

async function handleProductDelete() {
  if (!hasPermission("manage_products")) {
    showToast("ليس لديك صلاحية لحذف الساعات.", true);
    return;
  }

  if (!editingProductId) return;
  const product = products.find((p) => p.id === editingProductId);
  if (!product) return;

  const confirmDelete = confirm(`هل أنت متأكد من حذف ساعة «${product.name}» نهائيًا من الكتالوج؟`);
  if (!confirmDelete) return;

  const prevProducts = [...products];
  selectedProductIds.delete(editingProductId);
  deleteProduct(editingProductId);
  products = getStoredProducts();
  updateKpiStats();
  renderProductsList();

  let deleteSuccess = false;
  try {
    const directRes = await deleteProductsDirectFromTurso([editingProductId]);
    if (directRes) deleteSuccess = true;
  } catch {}

  try {
    const res = await fetch(`/api/products?id=${encodeURIComponent(editingProductId)}`, {
      method: "DELETE",
      headers: getAdminAuthHeaders(),
    });
    if (res.ok) deleteSuccess = true;
  } catch {}

  if (!deleteSuccess) {
    products = prevProducts;
    saveStoredProducts(products);
    updateKpiStats();
    renderProductsList();
    showToast(`تعذر حذف الساعة من السحابة. تم استرجاع الحالة.`, true);
    updateCloudDbBadge(false);
    return;
  }

  updateCloudDbBadge(true);
  showToast(`تم حذف «${product.name}» من الكتالوج والسحابة بنجاح ✓`);
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
    received: "تم استلام الطلب",
    new: "تم استلام الطلب",
    confirmed: "تم تأكيد الطلب",
    shipped: "جاري الشحن والتوصيل",
    shipping: "جاري الشحن والتوصيل",
    delivered: "تم التسليم بنجاح",
    cancelled: "تم إلغاء الطلب",
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
                <option value="received" ${order.status === "received" || order.status === "new" ? "selected" : ""}>تم استلام الطلب (Step 1)</option>
                <option value="confirmed" ${order.status === "confirmed" ? "selected" : ""}>تم تأكيد الطلب (Step 2)</option>
                <option value="shipped" ${order.status === "shipped" || order.status === "shipping" ? "selected" : ""}>جاري الشحن والتوصيل (Step 3)</option>
                <option value="delivered" ${order.status === "delivered" ? "selected" : ""}>تم التسليم بنجاح (Step 4)</option>
                <option value="cancelled" ${order.status === "cancelled" ? "selected" : ""}>تم إلغاء الطلب</option>
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
    message: `هل أنت متأكد من حذف ${selectedOrderIds.size} طلب نهائياً من سجلات المتجر والسحابة؟`,
    previewItems: preview,
    onConfirm: async () => {
      const idsToDelete = Array.from(selectedOrderIds);
      const prevOrders = [...orders];
      deleteOrders(idsToDelete);
      selectedOrderIds.clear();
      orders = getOrders();
      updateOrdersBadge();
      renderOrdersList();

      let deleteSuccess = false;
      try {
        const directRes = await deleteOrdersDirectFromTurso(idsToDelete);
        if (directRes) deleteSuccess = true;
      } catch {}

      try {
        const res = await fetch("/api/orders", {
          method: "DELETE",
          headers: getAdminAuthHeaders(),
          body: JSON.stringify({ ids: idsToDelete }),
        });
        if (res.ok) deleteSuccess = true;
      } catch (err) {
        console.warn("Failed to delete orders via serverless API:", err);
      }

      if (!deleteSuccess) {
        orders = prevOrders;
        saveOrders(orders);
        updateOrdersBadge();
        renderOrdersList();
        showToast("تعذر حذف الطلبات من السحابة. تم استرجاع البيانات.", true);
        updateCloudDbBadge(false);
        return;
      }

      showToast(`تم حذف ${idsToDelete.length} طلب بنجاح من السحابة ✓`);
      updateCloudDbBadge(true);
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
    onConfirm: async () => {
      const prevOrders = [...orders];
      deleteOrder(orderId);
      selectedOrderIds.delete(orderId);
      orders = getOrders();
      updateOrdersBadge();
      renderOrdersList();

      let deleteSuccess = false;
      try {
        const directRes = await deleteOrdersDirectFromTurso([orderId]);
        if (directRes) deleteSuccess = true;
      } catch {}

      try {
        const res = await fetch(`/api/orders?id=${encodeURIComponent(orderId)}`, {
          method: "DELETE",
          headers: getAdminAuthHeaders(),
        });
        if (res.ok) deleteSuccess = true;
      } catch (err) {
        console.warn("Failed to delete single order via serverless API:", err);
      }

      if (!deleteSuccess) {
        orders = prevOrders;
        saveOrders(orders);
        updateOrdersBadge();
        renderOrdersList();
        showToast(`تعذر حذف الطلب #${orderId} من السحابة. تم استرجاع البيانات.`, true);
        updateCloudDbBadge(false);
        return;
      }

      showToast(`تم حذف الطلب #${orderId} بنجاح من السحابة ✓`);
      updateCloudDbBadge(true);
    },
  });
}

async function handleOrderStatusChange(orderId, newStatus) {
  if (!hasPermission("manage_orders")) {
    showToast("ليس لديك صلاحية لتحديث حالة الطلبات.", true);
    return;
  }

  const prevOrder = orders.find((o) => String(o.id) === String(orderId));
  const prevStatus = prevOrder ? prevOrder.status : "received";

  // Optimistic UI update
  updateOrderStatus(orderId, newStatus);
  orders = getOrders();
  renderOrdersList();

  let cloudSuccess = false;
  let serverStatus = newStatus;

  // 1. Direct Turso Cloud DB sync (bypasses serverless protection & cold starts)
  try {
    const directRes = await updateOrderStatusDirectInTurso(orderId, newStatus);
    if (directRes) cloudSuccess = true;
  } catch (err) {
    console.warn("Direct Turso order status update error:", err);
  }

  // 2. Serverless API sync with admin credentials
  try {
    const res = await fetch("/api/orders", {
      method: "PATCH",
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ id: orderId, status: newStatus }),
    });

    if (res.ok) {
      cloudSuccess = true;
      const json = await res.json().catch(() => ({}));
      if (json && json.order && json.order.status) {
        serverStatus = json.order.status;
      }
    } else {
      const errJson = await res.json().catch(() => ({}));
      console.warn("API status update failed:", errJson);
    }
  } catch (err) {
    console.warn("Network error during API order status update:", err);
  }

  if (cloudSuccess) {
    updateOrderStatus(orderId, serverStatus);
    orders = getOrders();
    renderOrdersList();
    showToast(`تم تحديث حالة الطلب #${orderId} في السحابة بنجاح ✓`);
    updateCloudDbBadge(true);
  } else {
    // Rollback optimistic state
    updateOrderStatus(orderId, prevStatus);
    orders = getOrders();
    renderOrdersList();
    showToast(`تعذر حفظ حالة الطلب في السحابة. تم استرجاع الحالة السابقة.`, true);
    updateCloudDbBadge(false);
  }
}

// ----------------------------------------------------
// 6. HERO, VIDEO & BANNER SETTINGS
// ----------------------------------------------------
function populateHeroSettings() {
  $("#setting-brand-name").value = storeSettings.brandName || "صُدْفَة";
  $("#setting-brand-sub").value = storeSettings.brandSubtitle || "سَاعَةٌ لِكُلِّ لَحْظَةٍ";
  $("#setting-announcement").value = storeSettings.announcement || "";
  const vUrl = storeSettings.heroVideoUrl || "";
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
  const heroBadgeEl = $("#setting-hero-badge");
  if (heroBadgeEl) {
    heroBadgeEl.value = storeSettings.heroTrustBadge || storeSettings.heroBadge || "دقة متناهية • ضمان سنتين";
  }
}

async function handleHeroSettingsSubmit(e) {
  e.preventDefault();

  if (!hasPermission("manage_storefront")) {
    showToast("ليس لديك صلاحية لتعديل إعدادات الواجهة.", true);
    return;
  }

  const prevSettings = { ...storeSettings };
  const announcementVal = $("#setting-announcement").value.trim();
  const heroBadgeVal = $("#setting-hero-badge")?.value.trim() || "دقة متناهية • ضمان سنتين";

  const updatedFields = {
    brandName: $("#setting-brand-name").value.trim(),
    brandSubtitle: $("#setting-brand-sub").value.trim(),
    announcement: announcementVal,
    heroVideoUrl: $("#setting-video-url").value.trim(),
    heroPosterUrl: $("#setting-poster-url").value.trim(),
    heroHeadline: $("#setting-hero-headline").value.trim(),
    heroDescription: $("#setting-hero-desc").value.trim(),
    featuredTag: $("#setting-flagship-tag").value.trim(),
    featuredName: $("#setting-flagship-name").value.trim(),
    featuredSpec: $("#setting-flagship-spec").value.trim(),
    heroTrustBadge: heroBadgeVal,
    heroBadge: heroBadgeVal,
  };

  storeSettings = {
    ...storeSettings,
    ...updatedFields,
    videoUrl: updatedFields.heroVideoUrl,
    posterUrl: updatedFields.heroPosterUrl,
  };

  saveStoreSettings(storeSettings);

  // Keep ticker items in sync with announcement text
  if (announcementVal && !tickerItems.includes(announcementVal)) {
    tickerItems.unshift(announcementVal);
    saveTickerItems(tickerItems);
    saveTickerItemsDirectToTurso(tickerItems).catch(() => {});
    renderTickerItemsList();
  }

  let cloudSuccess = false;

  // Direct Turso Cloud DB sync (100% resilient across Mobile & Laptop)
  try {
    const directRes = await saveSettingsDirectToTurso(updatedFields);
    if (directRes) cloudSuccess = true;
  } catch {}

  // Sync with Turso /api/settings
  try {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ settings: updatedFields, tickerItems }),
    });

    if (res.ok) {
      cloudSuccess = true;
    }
  } catch (err) {
    console.warn("Failed to sync hero settings to Turso:", err);
  }

  if (cloudSuccess) {
    showToast("تم تحديث إعدادات الفيديو وشارة الضمان والواجهة ومزامنتها سحابياً بنجاح ✓");
    updateCloudDbBadge(true);
  } else {
    storeSettings = prevSettings;
    saveStoreSettings(storeSettings);
    populateHeroSettings();
    showToast("فشلت المزامنة السحابية لإعدادات الواجهة. تم استرجاع الحالة السابقة.", true);
    updateCloudDbBadge(false);
  }
}

async function syncTickerItemsToBackend(items) {
  saveTickerItemsDirectToTurso(items).catch(() => {});
  try {
    await fetch("/api/settings", {
      method: "PUT",
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ tickerItems: items }),
    });
  } catch (err) {
    console.warn("Failed to sync ticker items to backend:", err);
  }
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
      syncTickerItemsToBackend(tickerItems);
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
  syncTickerItemsToBackend(tickerItems);
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
    syncTickerItemsToBackend(tickerItems);
    showToast("تم حذف العبارة.");
  } else if (action === "move-ticker-up" && idx > 0) {
    const temp = tickerItems[idx];
    tickerItems[idx] = tickerItems[idx - 1];
    tickerItems[idx - 1] = temp;
    saveTickerItems(tickerItems);
    renderTickerItemsList();
    syncTickerItemsToBackend(tickerItems);
  } else if (action === "move-ticker-down" && idx < tickerItems.length - 1) {
    const temp = tickerItems[idx];
    tickerItems[idx] = tickerItems[idx + 1];
    tickerItems[idx + 1] = temp;
    saveTickerItems(tickerItems);
    renderTickerItemsList();
    syncTickerItemsToBackend(tickerItems);
  }
}

async function handleTickerSettingsSubmit(e) {
  e.preventDefault();

  if (!hasPermission("manage_storefront")) {
    showToast("ليس لديك صلاحية لتعديل إعدادات الشريط المتحرك.", true);
    return;
  }

  const tickerSettings = {
    tickerEnabled: $("#setting-ticker-enabled").checked,
    tickerSpeed: $("#setting-ticker-speed").value,
  };

  storeSettings = {
    ...storeSettings,
    ...tickerSettings,
  };
  saveStoreSettings(storeSettings);

  // Sync settings and ticker items to Turso and API
  saveSettingsDirectToTurso(tickerSettings).catch(() => {});
  syncTickerItemsToBackend(tickerItems);

  try {
    await fetch("/api/settings", {
      method: "PUT",
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ settings: tickerSettings, tickerItems }),
    });
  } catch (err) {
    console.warn("Failed to sync ticker settings:", err);
  }

  showToast("تم حفظ إعدادات شريط الأخبار ومزامنتها سحابياً بنجاح ✓");
}

// ----------------------------------------------------
// 8. SOCIAL MEDIA & CONTACT LINKS MANAGEMENT
// ----------------------------------------------------
function populateSocialLinksSettings() {
  if ($("#setting-social-facebook")) $("#setting-social-facebook").value = storeSettings.facebookUrl || storeSettings.socialFacebook || "";
  if ($("#setting-social-instagram")) $("#setting-social-instagram").value = storeSettings.instagramUrl || storeSettings.socialInstagram || "";
  if ($("#setting-social-tiktok")) $("#setting-social-tiktok").value = storeSettings.tiktokUrl || storeSettings.socialTiktok || "";
  if ($("#setting-social-youtube")) $("#setting-social-youtube").value = storeSettings.youtubeUrl || storeSettings.socialYoutube || "";
  if ($("#setting-social-snapchat")) $("#setting-social-snapchat").value = storeSettings.snapchatUrl || storeSettings.socialSnapchat || "";
  if ($("#setting-social-phone")) $("#setting-social-phone").value = storeSettings.phone || storeSettings.defaultPhone || storeSettings.socialPhone || "";
  if ($("#setting-social-whatsapp")) $("#setting-social-whatsapp").value = storeSettings.defaultWhatsapp || storeSettings.socialWhatsapp || "";
}

async function handleSocialLinksSubmit(e) {
  e.preventDefault();

  if (!hasPermission("manage_delivery_settings")) {
    showToast("ليس لديك صلاحية لتعديل روابط التواصل.", true);
    return;
  }

  const prevSettings = { ...storeSettings };
  const rawWa = $("#setting-social-whatsapp")?.value.trim() || "";
  let cleanWa = "";
  if (rawWa) {
    if (!isValidWhatsAppPhone(rawWa)) {
      showToast("يرجى إدخال رقم واتساب صحيح (مثلاً: 01012345678 أو 201012345678+).", true);
      return;
    }
    cleanWa = formatWhatsAppPhone(rawWa);
  }

  const socialFields = {
    facebookUrl: $("#setting-social-facebook")?.value.trim() || "",
    instagramUrl: $("#setting-social-instagram")?.value.trim() || "",
    tiktokUrl: $("#setting-social-tiktok")?.value.trim() || "",
    youtubeUrl: $("#setting-social-youtube")?.value.trim() || "",
    snapchatUrl: $("#setting-social-snapchat")?.value.trim() || "",
    phone: $("#setting-social-phone")?.value.trim() || "",
    defaultWhatsapp: cleanWa || storeSettings.defaultWhatsapp || "",
    socialWhatsapp: cleanWa || storeSettings.socialWhatsapp || "",
  };

  storeSettings = {
    ...storeSettings,
    ...socialFields,
  };
  saveStoreSettings(storeSettings);

  let cloudSuccess = false;
  try {
    const directRes = await saveSettingsDirectToTurso(socialFields);
    if (directRes) cloudSuccess = true;
  } catch {}

  try {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ settings: socialFields }),
    });
    if (res.ok) cloudSuccess = true;
  } catch {}

  if (cloudSuccess) {
    showToast("تم حفظ روابط السوشيال ميديا والتواصل ومزامنتها سحابياً بنجاح ✓");
    updateCloudDbBadge(true);
  } else {
    storeSettings = prevSettings;
    saveStoreSettings(storeSettings);
    populateSocialLinksSettings();
    showToast("تعذر مزامنة بيانات التواصل مع السحابة.", true);
    updateCloudDbBadge(false);
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

async function handleAddCategory(e) {
  e.preventDefault();

  if (!hasPermission("manage_categories")) {
    showToast("ليس لديك صلاحية لإضافة تصنيفات جديدة.", true);
    return;
  }

  const name = $("#new-cat-name")?.value.trim();
  const icon = $("#new-cat-icon")?.value.trim() || "⌚";

  if (!name) return;

  const prevCategories = [...categories];
  const id = `cat-${Date.now()}`;
  categories.push({ id, name, icon });
  saveStoredCategories(categories);
  renderCategoriesTable();
  renderCategoryOptions();
  updateKpiStats();
  $("#add-category-form")?.reset();

  let cloudSuccess = false;
  try {
    const directRes = await saveCategoriesDirectToTurso(categories);
    if (directRes) cloudSuccess = true;
  } catch {}

  try {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ categories }),
    });
    if (res.ok) cloudSuccess = true;
  } catch {}

  if (cloudSuccess) {
    showToast(`تمت إضافة التصنيف «${name}» ومزامنته سحابياً بنجاح ✓`);
    updateCloudDbBadge(true);
  } else {
    categories = prevCategories;
    saveStoredCategories(categories);
    renderCategoriesTable();
    renderCategoryOptions();
    updateKpiStats();
    showToast("تعذر مزامنة التصنيف مع السحابة.", true);
    updateCloudDbBadge(false);
  }
}

async function handleDeleteCategory(catId) {
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

  const prevCategories = [...categories];
  selectedCategoryIds.delete(catId);
  deleteCategories([catId]);
  categories = getStoredCategories();
  renderCategoriesTable();
  renderCategoryOptions();
  updateKpiStats();

  let cloudSuccess = false;
  try {
    const directRes = await saveCategoriesDirectToTurso(categories);
    if (directRes) cloudSuccess = true;
  } catch {}

  try {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ categories }),
    });
    if (res.ok) cloudSuccess = true;
  } catch {}

  if (cloudSuccess) {
    showToast(`تم حذف تصنيف «${cat.name}» من السحابة بنجاح ✓`);
    updateCloudDbBadge(true);
  } else {
    categories = prevCategories;
    saveStoredCategories(categories);
    renderCategoriesTable();
    renderCategoryOptions();
    updateKpiStats();
    showToast("تعذر حذف التصنيف من السحابة.", true);
    updateCloudDbBadge(false);
  }
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
  const { cloudName, uploadPreset } = getEffectiveCloudinarySettings();
  if (!badge) return;

  if (cloudName && uploadPreset) {
    badge.className = "cloudinary-status-badge is-connected";
    badge.textContent = `☁️ متصل بـ Cloudinary (${cloudName})`;
  } else {
    badge.className = "cloudinary-status-badge is-local";
    badge.textContent = "التخزين المحلي الآمن (IndexedDB) نشط (يرجى إدخال بيانات Cloudinary لرفع الفيديوهات)";
  }
}

function updateGitHubBadge() {
  const badge = $("#github-status-badge");
  if (!badge) return;

  const cfg = getGitHubConfig();
  const owner = $("#setting-github-owner")?.value.trim() || cfg.githubOwner;
  const repo = $("#setting-github-repo")?.value.trim() || cfg.githubRepo;
  const token = $("#setting-github-token")?.value.trim() || cfg.githubToken;

  if (owner && repo && token) {
    badge.className = "cloudinary-status-badge is-connected";
    badge.textContent = `⚡ متصل بـ GitHub Pages (${owner}/${repo})`;
  } else {
    badge.className = "cloudinary-status-badge is-local";
    badge.textContent = "تخزين محلي (غير مرتبط بـ GitHub)";
  }
}

function populateContactsAndPolicies() {
  $("#setting-whatsapp").value = storeSettings.defaultWhatsapp || "";
  $("#setting-phone").value = storeSettings.defaultPhone || "";
  $("#setting-shipping").value = storeSettings.shippingDetails || "";
  $("#setting-exchange").value = storeSettings.exchangeDetails || "";

  const cloudNameInput = $("#setting-cloudinary-name");
  const cloudPresetInput = $("#setting-cloudinary-preset");
  const envCloudName = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_CLOUDINARY_CLOUD_NAME) || "";
  const envPreset = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET) || "";
  if (cloudNameInput) cloudNameInput.value = storeSettings.cloudinaryCloudName || envCloudName || "v3macb6a";
  if (cloudPresetInput) cloudPresetInput.value = storeSettings.cloudinaryUploadPreset || envPreset || "SodfaShop";

  // GitHub Pages Settings
  const gh = getGitHubConfig();
  const ghOwnerInput = $("#setting-github-owner");
  const ghRepoInput = $("#setting-github-repo");
  const ghBranchInput = $("#setting-github-branch");
  const ghTokenInput = $("#setting-github-token");

  if (ghOwnerInput) ghOwnerInput.value = gh.githubOwner || storeSettings.githubOwner || "";
  if (ghRepoInput) ghRepoInput.value = gh.githubRepo || storeSettings.githubRepo || "";
  if (ghBranchInput) ghBranchInput.value = gh.githubBranch || storeSettings.githubBranch || "main";
  if (ghTokenInput) ghTokenInput.value = gh.githubToken || storeSettings.githubToken || "";

  updateWhatsAppPreview();
  updateCloudinaryBadge();
  updateGitHubBadge();
}

async function handleContactsSubmit(e) {
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

  const prevSettings = { ...storeSettings };
  const cleanWa = formatWhatsAppPhone(rawWa);
  const cName = $("#setting-cloudinary-name")?.value.trim() || "";
  const cPreset = $("#setting-cloudinary-preset")?.value.trim() || "";
  const ghOwner = $("#setting-github-owner")?.value.trim() || "";
  const ghRepo = $("#setting-github-repo")?.value.trim() || "";
  const ghBranch = $("#setting-github-branch")?.value.trim() || "main";
  const ghToken = $("#setting-github-token")?.value.trim() || "";

  const contactFields = {
    defaultWhatsapp: cleanWa ? `+${cleanWa}` : "",
    defaultPhone: $("#setting-phone").value.trim(),
    shippingDetails: $("#setting-shipping").value.trim(),
    exchangeDetails: $("#setting-exchange").value.trim(),
    cloudinaryCloudName: cName,
    cloudinaryUploadPreset: cPreset,
  };

  storeSettings = {
    ...storeSettings,
    ...contactFields,
    githubOwner: ghOwner,
    githubRepo: ghRepo,
    githubBranch: ghBranch,
    githubToken: ghToken,
  };

  saveStoreSettings(storeSettings);
  saveGitHubConfig({
    githubOwner: ghOwner,
    githubRepo: ghRepo,
    githubBranch: ghBranch,
    githubToken: ghToken,
  });

  updateWhatsAppPreview();
  updateCloudinaryBadge();
  updateGitHubBadge();
  updateCloudSyncBanner();

  let cloudSuccess = false;
  try {
    const directRes = await saveSettingsDirectToTurso(contactFields);
    if (directRes) cloudSuccess = true;
  } catch {}

  try {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ settings: contactFields }),
    });
    if (res.ok) cloudSuccess = true;
  } catch {}

  if (cloudSuccess) {
    showToast("تم حفظ بيانات التواصل ومزامنتها سحابياً بنجاح ✓");
    updateCloudDbBadge(true);
  } else {
    storeSettings = prevSettings;
    saveStoreSettings(storeSettings);
    showToast("تعذر مزامنة بيانات التواصل مع السحابة.", true);
    updateCloudDbBadge(false);
  }
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

async function handleDeliverySettingsSubmit(e) {
  e.preventDefault();

  if (!hasPermission("manage_delivery_settings")) {
    showToast("ليس لديك صلاحية لتعديل إعدادات التوصيل.", true);
    return;
  }

  const prevSettings = { ...storeSettings };
  const minVal = Math.max(1, parseInt($("#delivery-min-days")?.value, 10) || 2);
  const maxVal = Math.max(minVal, parseInt($("#delivery-max-days")?.value, 10) || minVal);
  const unitVal = $("#delivery-unit-text")?.value.trim() || "أيام عمل";

  const deliveryFields = {
    deliveryMinDays: minVal,
    deliveryMaxDays: maxVal,
    deliveryUnitText: unitVal,
  };

  storeSettings = {
    ...storeSettings,
    ...deliveryFields,
  };

  saveStoreSettings(storeSettings);
  updateDeliveryPreview();

  let cloudSuccess = false;
  try {
    const directRes = await saveSettingsDirectToTurso(deliveryFields);
    if (directRes) cloudSuccess = true;
  } catch {}

  try {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ settings: deliveryFields }),
    });
    if (res.ok) cloudSuccess = true;
  } catch {}

  if (cloudSuccess) {
    showToast("تم حفظ إعدادات مدة التوصيل ومزامنتها سحابياً بنجاح ✓");
    updateCloudDbBadge(true);
  } else {
    storeSettings = prevSettings;
    saveStoreSettings(storeSettings);
    populateDeliverySettings();
    showToast("تعذر حفظ إعدادات التوصيل في السحابة.", true);
    updateCloudDbBadge(false);
  }
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

async function fetchAdminUsersFromCloud() {
  const session = getAdminSession();
  if (!session || session.role !== "super_admin") return;

  try {
    const res = await fetch(`/api/auth?action=admins&t=${Date.now()}`, {
      headers: getAdminAuthHeaders(),
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      const list = data.users || data.admins;
      if (Array.isArray(list) && list.length > 0) {
        const mapped = list.map((u) => ({
          id: u.id,
          username: u.username,
          fullName: u.fullName || u.full_name || u.username,
          role: u.role,
          status: u.status || "active",
          permissions: typeof u.permissions === "string" ? JSON.parse(u.permissions) : (u.permissions || {}),
          createdAt: u.created_at || u.createdAt || new Date().toISOString(),
        }));
        saveAdminUsers(mapped);
        renderAdminUsersTable();
      }
    }
  } catch (err) {
    console.warn("Could not fetch admin users from cloud:", err);
  }
}

async function handleSaveAdminUser(e) {
  e.preventDefault();
  const errorBox = $("#modal-admin-user-error");
  const submitBtn = $("#btn-save-admin-user") || e.target.querySelector("button[type='submit']");
  if (errorBox) errorBox.hidden = true;

  if (!isCloudConnected) {
    const msg = "⚠️ لا يمكن إضافة أو تعديل المشرفين أثناء انقطاع الاتصال بالسحابة. يرجى فحص إعدادات اتصال Turso وVercel ثم إعادة المحاولة.";
    if (errorBox) {
      errorBox.textContent = msg;
      errorBox.hidden = false;
    }
    showToast(msg, true);
    return;
  }

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

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "جاري الحفظ في السحابة... ⏳";
  }

  try {
    const payload = editId
      ? { action: "update-admin", id: editId, fullName, status, permissions }
      : { action: "create-admin", fullName, username, password, permissions };

    const res = await fetch("/api/auth", {
      method: "POST",
      headers: getAdminAuthHeaders(),
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) {
      throw new Error(data?.error || `فشل الحفظ في السحابة (${res.status})`);
    }

    if (editId) {
      updateAdminUser(editId, { fullName, status, permissions });
      showToast("تم تحديث بيانات وصلاحيات المشرف وحفظها سحابياً بنجاح ✓");
    } else {
      createAdminUser({ fullName, username, password, permissions, id: data.user?.id });
      showToast("تمت إضافة المشرف وحفظه في سحابة Turso بنجاح ✓");
    }

    await fetchAdminUsersFromCloud();
    closeAdminUserModal();
    renderAdminUsersTable();
  } catch (err) {
    if (errorBox) {
      errorBox.textContent = err.message || "حدث خطأ أثناء حفظ المشرف.";
      errorBox.hidden = false;
    }
    showToast(err.message, true);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "حفظ المشرف";
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

async function handleSaveResetPass(e) {
  e.preventDefault();
  const errBox = $("#modal-reset-pass-error");
  const submitBtn = $("#btn-save-reset-pass") || e.target.querySelector("button[type='submit']");
  if (errBox) errBox.hidden = true;

  if (!isCloudConnected) {
    const msg = "⚠️ لا يمكن إعادة تعيين كلمة المرور أثناء انقطاع الاتصال بالسحابة.";
    if (errBox) {
      errBox.textContent = msg;
      errBox.hidden = false;
    }
    showToast(msg, true);
    return;
  }

  const userId = $("#reset-target-user-id")?.value;
  const newPass = $("#reset-new-password")?.value.trim();

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "جاري الحفظ... ⏳";
  }

  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: getAdminAuthHeaders(),
      body: JSON.stringify({ action: "reset-user-password", id: userId, newPassword: newPass }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || "فشل تعيين كلمة المرور في السحابة");
    }

    resetUserPassword(userId, newPass);
    showToast("تم تعيين كلمة المرور الجديدة للمشرف وحفظها سحابياً بنجاح ✓");
    closeResetPassModal();
  } catch (err) {
    if (errBox) {
      errBox.textContent = err.message || "فشل تعيين كلمة المرور.";
      errBox.hidden = false;
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "تعيين كلمة المرور";
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
  populateSocialLinksSettings();
  renderCategoriesTable();
  populateContactsAndPolicies();
  populateDeliverySettings();
  populateAccountSecurity();
}

async function checkCloudHealth() {
  try {
    const res = await fetch(`/api/health?t=${Date.now()}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.ok && data.connected) {
      isCloudConnected = true;
      updateCloudDbBadge(true, data);
      return true;
    } else {
      isCloudConnected = false;
      updateCloudDbBadge(false, data || { ok: false, connected: false, reason: "DB_ERROR" });
      return false;
    }
  } catch (err) {
    isCloudConnected = false;
    updateCloudDbBadge(false, { ok: false, connected: false, reason: "NETWORK_ERROR", error: err.message });
    return false;
  }
}

function updateCloudDbBadge(connected = true, diagnostic = null) {
  isCloudConnected = Boolean(connected);
  let badge = $("#admin-db-status");
  if (!badge) {
    const target = $(".admin-topbar-right") || $(".admin-header-user") || $(".admin-header-actions") || $("header");
    if (target) {
      badge = document.createElement("span");
      badge.id = "admin-db-status";
      badge.className = connected ? "admin-db-badge is-connected" : "admin-db-badge is-disconnected";
      target.prepend(badge);
    }
  }
  if (badge) {
    if (connected) {
      badge.className = "admin-db-badge is-connected";
      badge.innerHTML = `<span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#10b981; margin-left:6px;"></span>متصل بالسحابة • Turso`;
      badge.title = "قاعدة بيانات Turso السحابية متصلة ومزامنة بنجاح";
    } else {
      badge.className = "admin-db-badge is-disconnected";
      badge.innerHTML = `<span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#ef4444; margin-left:6px;"></span>غير متصل بالسحابة`;
      badge.title = "فشل الاتصال بقاعدة البيانات السحابية";
    }
  }

  // Diagnostic Banner Management
  const banner = $("#cloud-diagnostic-banner");
  if (banner) {
    if (connected) {
      banner.hidden = true;
    } else {
      banner.hidden = false;
      const titleEl = $("#diagnostic-title");
      const descEl = $("#diagnostic-desc");
      const hintEl = $("#diagnostic-hint");

      const reason = diagnostic?.reason;
      if (reason === "MISSING_ENV_VARS") {
        if (titleEl) titleEl.textContent = "تنبيه هام: متغيرات اتصال Turso غير معرّفة في إعدادات Vercel";
        if (descEl) descEl.textContent = "لا يمكن الحفظ في قاعدة البيانات السحابية لعدم وجود متغيرات البيئة. يرجى الدخول إلى Vercel Project Settings ثم Environment Variables وإضافة: TURSO_DATABASE_URL و TURSO_AUTH_TOKEN ثم إعادة النشر (Redeploy).";
        if (hintEl) hintEl.textContent = diagnostic?.details || "المتغيرات المفقودة: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN";
      } else if (reason === "AUTH_FAILED") {
        if (titleEl) titleEl.textContent = "خطأ في المصادقة: رمز TURSO_AUTH_TOKEN غير صالح أو منتهي الصلاحية";
        if (descEl) descEl.textContent = "فشل التحقق من صحة التوكن مع خادم Turso السحابي. يرجى إنشاء توكن جديد من لوحة Turso وتحديثه في Vercel.";
        if (hintEl) hintEl.textContent = diagnostic?.error || "";
      } else if (reason === "DB_ERROR") {
        if (titleEl) titleEl.textContent = "تعذر الاتصال بقاعدة بيانات Turso السحابية";
        if (descEl) descEl.textContent = "حدث خطأ أثناء تنفيذ استعلام الفحص في قاعدة البيانات السحابية. يرجى التحقق من حالة قاعدة البيانات في Turso.";
        if (hintEl) hintEl.textContent = diagnostic?.error || "";
      } else {
        if (titleEl) titleEl.textContent = "تنبيه: غير متصل بقاعدة بيانات Turso السحابية";
        if (descEl) descEl.textContent = "لوحة التحكم غير قادرة على الاتصال بـ Turso حالياً. تم حظر إضافة المشرفين محلياً لحماية البيانات.";
        if (hintEl) hintEl.textContent = diagnostic?.error || diagnostic?.details || "تأكد من اتصالك بالإنترنت وصحة إعدادات Vercel Serverless Functions.";
      }
    }
  }
}

function initAdminApp() {
  updateAuthViews();
  initCloudSync();
  checkCloudHealth();
  fetchAdminUsersFromCloud();

  $("#btn-recheck-health")?.addEventListener("click", async () => {
    const btn = $("#btn-recheck-health");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "جاري الفحص... ⏳";
    }
    await checkCloudHealth();
    if (btn) {
      btn.disabled = false;
      btn.textContent = "إعادة فحص الاتصال 🔄";
    }
  });

  // Live Cloud sync on mount: fetch fresh orders, products, and store settings directly from Turso & API
  fetchStoreDirectFromTurso().then((data) => {
    if (data && data.ok) {
      if (Array.isArray(data.products)) {
        products = data.products;
        saveProducts(products);
        renderProductsList();
      }
      if (data.settings) {
        storeSettings = { ...storeSettings, ...data.settings };
        saveStoreSettings(storeSettings);
        populateHeroSettings();
      }
      if (Array.isArray(data.categories)) {
        categories = data.categories;
        saveStoredCategories(categories);
        renderCategoriesTable();
        renderCategoryOptions();
      }
      if (Array.isArray(data.tickerItems)) {
        tickerItems = data.tickerItems;
        saveTickerItems(tickerItems);
        renderTickerItemsList();
      }
      updateCloudDbBadge(true);
    }
  }).catch(() => {
    updateCloudDbBadge(false);
  });

  fetchOrdersDirectFromTurso().then((directOrders) => {
    if (Array.isArray(directOrders)) {
      orders = directOrders;
      saveOrders(orders);
      updateOrdersBadge();
      renderOrdersList();
      updateCloudDbBadge(true);
    }
  }).catch(() => {});

  fetch(`/api/store?t=${Date.now()}`, { headers: { Accept: "application/json" }, cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data && data.ok) {
        if (Array.isArray(data.products)) {
          products = data.products;
          saveProducts(products);
          renderProductsList();
        }
        if (data.settings) {
          storeSettings = { ...storeSettings, ...data.settings };
          saveStoreSettings(storeSettings);
          populateHeroSettings();
        }
        if (Array.isArray(data.categories)) {
          categories = data.categories;
          saveStoredCategories(categories);
          renderCategoriesTable();
          renderCategoryOptions();
        }
        if (Array.isArray(data.tickerItems)) {
          tickerItems = data.tickerItems;
          saveTickerItems(tickerItems);
          renderTickerItemsList();
        }
        updateCloudDbBadge(true);
      }
    })
    .catch(() => {});

  fetch(`/api/orders?t=${Date.now()}`, { headers: getAdminAuthHeaders(), cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data && data.ok && Array.isArray(data.orders)) {
        orders = data.orders;
        saveOrders(orders);
        updateOrdersBadge();
        renderOrdersList();
        updateCloudDbBadge(true);
      }
    })
    .catch(() => {});

  $("#admin-login-form")?.addEventListener("submit", handleLoginSubmit);
  $("#admin-logout-btn")?.addEventListener("click", handleLogout);

  initPasswordToggle();
  initPasswordRecoveryFlow();
  initTabs();
  updateCloudSyncBanner();

  window.addEventListener("daffa:settings-updated", () => updateCloudSyncBanner());

  // Products CRUD
  $("#admin-product-form")?.addEventListener("submit", handleProductFormSubmit);
  $("#admin-new-product-btn")?.addEventListener("click", resetProductEditor);
  $("#product-cancel-btn")?.addEventListener("click", resetProductEditor);
  $("#product-delete-btn")?.addEventListener("click", handleProductDelete);
  $("#edit-base-price")?.addEventListener("input", updatePricePreview);
  $("#edit-discount-type")?.addEventListener("change", updatePricePreview);
  $("#edit-discount-value")?.addEventListener("input", updatePricePreview);

  // Framing controls live update & preview
  $("#edit-frame-aspect")?.addEventListener("change", updateFramingPreview);
  $("#edit-frame-fit")?.addEventListener("change", updateFramingPreview);
  $("#edit-frame-scale")?.addEventListener("input", updateFramingPreview);
  $("#edit-frame-alignment")?.addEventListener("change", updateFramingPreview);
  $("#edit-name")?.addEventListener("input", updateFramingPreview);

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

  // Social Media & Contact Links Settings Form
  $("#social-links-settings-form")?.addEventListener("submit", handleSocialLinksSubmit);

  // Batch Multi-Image Gallery Handlers
  const galleryFileInput = $("#product-gallery-file-input");
  galleryFileInput?.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleBatchFilesUpload(e.target.files);
      e.target.value = "";
    }
  });

  const batchDropzone = $("#product-batch-dropzone");
  if (batchDropzone) {
    batchDropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      batchDropzone.classList.add("is-dragover");
    });
    batchDropzone.addEventListener("dragleave", () => {
      batchDropzone.classList.remove("is-dragover");
    });
    batchDropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      batchDropzone.classList.remove("is-dragover");
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleBatchFilesUpload(e.dataTransfer.files);
      }
    });
  }

  $("#btn-add-gallery-url")?.addEventListener("click", handleAddDirectGalleryUrl);

  const galleryGrid = $("#product-gallery-grid");
  galleryGrid?.addEventListener("click", (e) => {
    const setPrimaryBtn = e.target.closest('[data-action="set-primary"]');
    if (setPrimaryBtn) {
      const idx = parseInt(setPrimaryBtn.dataset.index, 10);
      productGalleryImages.forEach((img, i) => { img.isPrimary = (i === idx); });
      renderProductGalleryGrid();
      return;
    }

    const delBtn = e.target.closest('[data-action="delete-image"]');
    if (delBtn) {
      const idx = parseInt(delBtn.dataset.index, 10);
      const wasPrimary = productGalleryImages[idx]?.isPrimary;
      productGalleryImages.splice(idx, 1);
      if (wasPrimary && productGalleryImages.length > 0) {
        productGalleryImages[0].isPrimary = true;
      }
      renderProductGalleryGrid();
    }
  });

  galleryGrid?.addEventListener("input", (e) => {
    if (e.target.classList.contains("gallery-color-input")) {
      const idx = parseInt(e.target.dataset.index, 10);
      if (productGalleryImages[idx]) {
        productGalleryImages[idx].colorLabel = e.target.value.trim();
      }
    }
  });

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
  // GitHub Pages Live Publish Settings
  $("#setting-github-owner")?.addEventListener("input", updateGitHubBadge);
  $("#setting-github-repo")?.addEventListener("input", updateGitHubBadge);
  $("#setting-github-branch")?.addEventListener("input", updateGitHubBadge);
  $("#setting-github-token")?.addEventListener("input", updateGitHubBadge);

  $("#btn-test-github")?.addEventListener("click", async () => {
    const feedback = $("#github-test-feedback");
    const owner = $("#setting-github-owner")?.value.trim();
    const repo = $("#setting-github-repo")?.value.trim();
    const branch = $("#setting-github-branch")?.value.trim() || "main";
    const token = $("#setting-github-token")?.value.trim();

    if (feedback) {
      feedback.textContent = "جاري اختبار الاتصال بمستودع GitHub...";
      feedback.style.color = "var(--ink-muted)";
    }

    const res = await testGitHubConnection({ githubOwner: owner, githubRepo: repo, githubBranch: branch, githubToken: token });
    if (res.ok) {
      if (feedback) {
        feedback.textContent = res.message;
        feedback.style.color = "var(--success-ink)";
      }
      saveGitHubConfig({ githubOwner: owner, githubRepo: repo, githubBranch: branch, githubToken: token });
      updateGitHubBadge();
      updateCloudSyncBanner();
      showToast("تم التحقق من مستودع GitHub بنجاح ✓");
    } else {
      if (feedback) {
        feedback.textContent = res.message;
        feedback.style.color = "var(--sale-solid)";
      }
      showToast(res.message, true);
    }
  });

  $("#btn-publish-github-now")?.addEventListener("click", async () => {
    const publishBtn = $("#btn-publish-github-now");
    const origText = publishBtn?.innerHTML || "";
    if (publishBtn) {
      publishBtn.disabled = true;
      publishBtn.textContent = "جاري النشر على GitHub Pages... ⏳";
    }
    try {
      await publishStoreToGitHub({ reason: "نشر فوري يدوي من لوحة تحكم صُدْفَة" });
      showToast("تم نشر أحدث بيانات وساعات المتجر على GitHub Pages بنجاح 🚀");
      if ($("#github-test-feedback")) {
        $("#github-test-feedback").textContent = `تم النشر بنجاح على فرع ${getGitHubConfig().githubBranch || "main"} ✓`;
        $("#github-test-feedback").style.color = "var(--success-ink)";
      }
    } catch (err) {
      showToast(`فشل النشر على GitHub: ${err?.message || err}`, true);
      if ($("#github-test-feedback")) {
        $("#github-test-feedback").textContent = `فشل النشر: ${err?.message || err}`;
        $("#github-test-feedback").style.color = "var(--sale-solid)";
      }
    } finally {
      if (publishBtn) {
        publishBtn.disabled = false;
        publishBtn.innerHTML = origText;
      }
    }
  });

  $("#btn-download-backup")?.addEventListener("click", () => {
    downloadStoreBackup();
    showToast("تم تنزيل نسخة احتياطية من store.json بنجاح 📥");
  });

  $("#input-import-backup")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const json = JSON.parse(String(ev.target.result || "{}"));
        restoreStoreFromData(json);
        showToast("تم استيراد النسخة الاحتياطية وتحديث المتجر بنجاح ✓");
        setTimeout(() => window.location.reload(), 1200);
      } catch (err) {
        showToast(`فشل استيراد الملف: ${err.message}`, true);
      }
    };
    reader.readAsText(file);
  });

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
      getCloudSettings: getEffectiveCloudinarySettings,
      onChange: (url) => {
        const input = $("#edit-image-url");
        if (input) input.value = url;
        updateFramingPreview();
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
      getCloudSettings: getEffectiveCloudinarySettings,
      onChange: async (url) => {
        const input = $("#setting-video-url");
        if (input) input.value = url;
        storeSettings = {
          ...storeSettings,
          heroVideoUrl: url,
          videoUrl: url,
        };
        saveStoreSettings(storeSettings);

        // Direct Turso Cloud DB sync
        saveSettingsDirectToTurso({ heroVideoUrl: url, videoUrl: url }).catch(() => {});

        // Also persist immediately to Turso backend if online
        try {
          const res = await fetch("/api/settings", {
            method: "PUT",
            headers: getAdminAuthHeaders(),
            body: JSON.stringify({ settings: { heroVideoUrl: url, videoUrl: url } }),
          });

          if (res.ok) {
            showToast("تم رفع فيديو البطل وحفظه في السحابة بنجاح ✓");
          } else {
            const errJson = await res.json().catch(() => ({}));
            showToast(`تم رفع الفيديو ولكن فشل الحفظ السحابي: ${errJson.error || "خطأ"}`, true);
          }
        } catch (err) {
          console.warn("Failed to auto-sync hero video to Turso:", err);
          showToast("تم رفع الفيديو محلياً. اضغط حفظ التغييرات للمزامنة.");
        }
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
      getCloudSettings: getEffectiveCloudinarySettings,
      onChange: async (url) => {
        const input = $("#setting-poster-url");
        if (input) input.value = url;
        storeSettings = {
          ...storeSettings,
          heroPosterUrl: url,
          posterUrl: url,
        };
        saveStoreSettings(storeSettings);

        // Direct Turso Cloud DB sync
        saveSettingsDirectToTurso({ heroPosterUrl: url, posterUrl: url }).catch(() => {});

        try {
          const res = await fetch("/api/settings", {
            method: "PUT",
            headers: getAdminAuthHeaders(),
            body: JSON.stringify({ settings: { heroPosterUrl: url, posterUrl: url } }),
          });

          if (res.ok) {
            showToast("تم رفع غلاف الفيديو وحفظه في السحابة بنجاح ✓");
          } else {
            const errJson = await res.json().catch(() => ({}));
            showToast(`تم رفع الغلاف ولكن فشل الحفظ السحابي: ${errJson.error || "خطأ"}`, true);
          }
        } catch (err) {
          console.warn("Failed to auto-sync hero poster to Turso:", err);
          showToast("تم رفع الغلاف محلياً. اضغط حفظ التغييرات للمزامنة.");
        }
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
      if (!isCloudConnected) {
        showToast("⚠️ لا يمكن تعديل حالة المشرف أثناء انقطاع الاتصال بالسحابة.", true);
        return;
      }
      const currentStatus = btn.dataset.status;
      const nextStatus = currentStatus === "active" ? "suspended" : "active";
      btn.disabled = true;
      (async () => {
        try {
          const res = await fetch("/api/auth", {
            method: "POST",
            headers: getAdminAuthHeaders(),
            body: JSON.stringify({ action: "update-admin", id: userId, status: nextStatus }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.ok) {
            throw new Error(data?.error || "فشل تحديث حالة المشرف سحابياً");
          }
          updateAdminUser(userId, { status: nextStatus });
          renderAdminUsersTable();
          showToast(nextStatus === "active" ? "تم تفعيل حساب المشرف بنجاح ▶" : "تم إيقاف حساب المشرف مؤقتاً ⏸");
        } catch (err) {
          showToast(err.message, true);
        } finally {
          btn.disabled = false;
        }
      })();
    } else if (action === "reset-user-pass") {
      const username = btn.dataset.username;
      openResetPassModal(userId, username);
    } else if (action === "delete-user") {
      if (!isCloudConnected) {
        showToast("⚠️ لا يمكن حذف المشرف أثناء انقطاع الاتصال بالسحابة.", true);
        return;
      }
      const name = btn.dataset.name;
      const ok = confirm(`هل أنت متأكد من حذف حساب المشرف «${name}» نهائياً من سحابة Turso؟`);
      if (!ok) return;
      btn.disabled = true;
      (async () => {
        try {
          const res = await fetch("/api/auth", {
            method: "POST",
            headers: getAdminAuthHeaders(),
            body: JSON.stringify({ action: "delete-admin", id: userId }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.ok) {
            throw new Error(data?.error || "فشل حذف المشرف من السحابة");
          }
          deleteAdminUser(userId);
          renderAdminUsersTable();
          showToast(`تم حذف المشرف «${name}» نهائياً من السحابة بنجاح.`);
        } catch (err) {
          showToast(err.message, true);
        } finally {
          btn.disabled = false;
        }
      })();
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
