import "./style.css";
import { initialProducts, categories, getCart, saveCart, getStoredProducts } from "./data.js";
import { schedulePromotionRefresh, startPromotionCountdowns } from "./promotions.js";

// DOM Selectors
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// State
let allProducts = getStoredProducts();
let activeCategory = "all";
let searchQuery = "";
let activeSort = "featured";
let activeFilters = new Set(); // "sale", "leather", "steel"
let cart = getCart();
let publicContacts = { phoneNumber: "", whatsappNumber: "" };
let modalSelectedProduct = null;
let modalSelectedImageIndex = 0;
let modalQuantity = 1;
let toastTimeout = null;

// Helpers
const safeText = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[char]));

function formatEgp(amount) {
  return new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(Number(amount) || 0);
}

function showToast(message, isSuccess = true) {
  const toast = $("#site-toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `site-toast is-visible ${isSuccess ? "is-success" : "is-error"}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 3200);
}

// ----------------------------------------------------
// 1. FILTERING & SORTING LOGIC
// ----------------------------------------------------
function matchesCategory(product, catId) {
  if (catId === "all") return true;
  if (catId === "men") return product.gender === "men" || product.gender === "unisex";
  if (catId === "women") return product.gender === "women" || product.gender === "unisex";
  if (catId === "classic-dress") return product.categoryId === "classic-dress" || product.style === "classic";
  if (catId === "sport-chrono") return product.categoryId === "sport-chrono" || product.style === "chronograph" || product.style === "sport";
  if (catId === "smart-hybrid") return product.categoryId === "smart-hybrid" || product.style === "smart";
  return product.categoryId === catId;
}

function getFilteredProducts() {
  let list = allProducts.filter((product) => {
    // 1. Category
    if (!matchesCategory(product, activeCategory)) return false;

    // 2. Search query (name, description, brand, category)
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      const name = (product.name || "").toLowerCase();
      const desc = (product.description || "").toLowerCase();
      const cat = (product.category || "").toLowerCase();
      const style = (product.style || "").toLowerCase();
      if (!name.includes(q) && !desc.includes(q) && !cat.includes(q) && !style.includes(q)) {
        return false;
      }
    }

    // 3. Quick filters
    if (activeFilters.has("sale") && (!product.discountActive || !product.discountPercent)) {
      return false;
    }
    if (activeFilters.has("leather")) {
      const desc = (product.description || "").toLowerCase();
      const specs = (product.specifications || []).map(s => s.value).join(" ").toLowerCase();
      if (!desc.includes("جلد") && !specs.includes("جلد")) return false;
    }
    if (activeFilters.has("steel")) {
      const desc = (product.description || "").toLowerCase();
      const specs = (product.specifications || []).map(s => s.value).join(" ").toLowerCase();
      if (!desc.includes("ستيل") && !desc.includes("فولاذ") && !specs.includes("ستيل") && !specs.includes("فولاذ")) return false;
    }

    return true;
  });

  // Sorting
  if (activeSort === "price-asc") {
    list.sort((a, b) => (a.salePrice || a.basePrice) - (b.salePrice || b.basePrice));
  } else if (activeSort === "price-desc") {
    list.sort((a, b) => (b.salePrice || b.basePrice) - (a.salePrice || a.basePrice));
  } else if (activeSort === "discount") {
    list.sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0));
  }

  return list;
}

// ----------------------------------------------------
// 2. CATEGORY TABS RENDERING
// ----------------------------------------------------
function renderCategoryTabs() {
  const container = $("#catalog-category-tabs");
  if (!container) return;

  container.innerHTML = categories.map((cat) => {
    const count = allProducts.filter((p) => matchesCategory(p, cat.id)).length;
    const isSelected = activeCategory === cat.id;
    return `
      <button 
        class="category-tab ${isSelected ? "is-active" : ""}" 
        type="button" 
        role="tab" 
        aria-selected="${isSelected}"
        data-category="${cat.id}">
        <span class="tab-icon" aria-hidden="true">${cat.icon}</span>
        <span class="tab-name">${cat.name}</span>
        <span class="tab-count">${new Intl.NumberFormat("ar-EG").format(count)}</span>
      </button>
    `;
  }).join("");
}

// ----------------------------------------------------
// 3. PRODUCT CARDS RENDERING
// ----------------------------------------------------
function renderPriceMarkup(product) {
  const basePrice = Number(product.basePrice);
  const discountPercent = Number(product.discountPercent) || 0;
  const salePrice = Number(product.salePrice);
  const discountActive = Boolean(product.discountActive) && discountPercent > 0;

  if (discountActive && Number.isFinite(salePrice)) {
    const countdown = product.discountEndOn
      ? `<small class="discount-countdown" data-promotion-countdown data-discount-end="${safeText(product.discountEndOn)}" aria-label="الوقت المتبقي"></small>`
      : "";
    return `
      <div class="product-price product-price-discounted">
        <span class="price-before"><del>${formatEgp(basePrice)} <small>ج.م</small></del></span>
        <span class="sale-badge">خصم ${formatEgp(discountPercent)}%</span>
        <div class="sale-price-bubble">
          <small>السعر بعد الخصم</small>
          <strong class="price-after">${formatEgp(salePrice)} <small>ج.م</small></strong>
        </div>
        ${countdown}
      </div>
    `;
  }

  return `<p class="product-price">${formatEgp(basePrice)} <small>ج.م</small></p>`;
}

function renderProductCard(product, index) {
  const hasImages = Array.isArray(product.images) && product.images.length > 0;
  const coverImage = product.imageUrl || (hasImages ? product.images[0].imageUrl : "/sodfa-promo-poster.jpg");
  const badgeMarkup = product.badge ? `<span class="product-card-badge">${safeText(product.badge)}</span>` : "";

  // Color Swatch preview dots
  let swatchesHtml = "";
  if (hasImages && product.images.length > 1) {
    swatchesHtml = `
      <div class="card-swatches" role="group" aria-label="ألوان الساعة المتاحة">
        ${product.images.map((img, i) => `
          <button 
            type="button" 
            class="swatch-dot ${i === 0 ? "is-selected" : ""}" 
            title="${safeText(img.colorLabel || `لون ${i+1}`)}" 
            data-swatch-index="${i}" 
            data-product-id="${safeText(product.id)}"
            aria-label="${safeText(img.colorLabel || `لون ${i+1}`)}">
          </button>
        `).join("")}
      </div>
    `;
  }

  const specSnippet = (product.specifications && product.specifications[0]) 
    ? `${product.specifications[0].value} • ${product.specifications[2]?.value || "دقة عالية"}`
    : "ساعة أصلية فاخرة";

  return `
    <article class="product-card" data-product-id="${safeText(product.id)}">
      <div class="product-visual">
        ${badgeMarkup}
        <button type="button" class="product-visual-btn" data-action="quick-view" data-product-id="${safeText(product.id)}" aria-label="عرض تفاصيل ومواصفات ${safeText(product.name)}">
          <img class="product-image" src="${safeText(coverImage)}" alt="${safeText(product.imageAlt || product.name)}" loading="lazy" />
        </button>
        <span class="product-index">${String(index + 1).padStart(2, "0")}</span>
      </div>

      <div class="product-details">
        <div class="product-header-group">
          <span class="product-category-tag">${safeText(product.category || "ساعة صُدْفَة")}</span>
          <h3 class="product-title">
            <button type="button" class="product-title-btn" data-action="quick-view" data-product-id="${safeText(product.id)}">
              ${safeText(product.name)}
            </button>
          </h3>
          <p class="product-spec-snippet">${safeText(specSnippet)}</p>
          ${swatchesHtml}
        </div>

        <div class="product-price-section">
          ${renderPriceMarkup(product)}
        </div>

        <div class="card-actions-row">
          <button type="button" class="card-details-btn" data-action="quick-view" data-product-id="${safeText(product.id)}">
            المواصفات <span aria-hidden="true">←</span>
          </button>
          <button type="button" class="card-add-cart-btn button button-primary" data-action="add-to-cart" data-product-id="${safeText(product.id)}">
            أضف للحقيبة 👜
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderCatalog() {
  const grid = $("#catalog-grid");
  const countBar = $("#catalog-results-count");
  const resetBtn = $("#catalog-reset-filters");
  if (!grid) return;

  const filtered = getFilteredProducts();

  // Status Bar update
  if (countBar) {
    if (searchQuery) {
      countBar.textContent = `نتائج البحث عن «${searchQuery}»: ${new Intl.NumberFormat("ar-EG").format(filtered.length)} ساعة`;
    } else {
      countBar.textContent = `يعرض ${new Intl.NumberFormat("ar-EG").format(filtered.length)} من أصل ${new Intl.NumberFormat("ar-EG").format(allProducts.length)} ساعة مختارة`;
    }
  }

  const hasActiveFilters = searchQuery !== "" || activeCategory !== "all" || activeFilters.size > 0 || activeSort !== "featured";
  if (resetBtn) resetBtn.hidden = !hasActiveFilters;

  // Empty state if 0 results
  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <span class="empty-orbit" aria-hidden="true"><i></i></span>
        <p class="empty-kicker">لم نجد نتائج مطابقة</p>
        <h3>لا توجد ساعات تطابق بحثك</h3>
        <p>جرّب تعديل كلمات البحث، أو اختر تصنيفًا آخر من القائمة في الأعلى.</p>
        <button id="empty-state-reset-btn" class="button button-primary" type="button" style="margin-top: 14px;">إلغاء التصفية وعرض كل الساعات</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map((product, index) => renderProductCard(product, index)).join("");
  startPromotionCountdowns(grid);
}

// ----------------------------------------------------
// 4. SHOPPING CART FUNCTIONALITY
// ----------------------------------------------------
function updateCartBadge() {
  const badge = $("#cart-badge");
  const countText = $("#cart-items-count-text");
  const totalCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  if (badge) {
    badge.textContent = String(totalCount);
    badge.classList.toggle("has-items", totalCount > 0);
  }
  if (countText) {
    countText.textContent = `${new Intl.NumberFormat("ar-EG").format(totalCount)} قطع`;
  }
}

function calculateCartTotals() {
  const subtotal = cart.reduce((sum, item) => {
    const price = Number(item.product.salePrice || item.product.basePrice);
    return sum + price * item.quantity;
  }, 0);
  return { subtotal, total: subtotal };
}

function renderCartDrawer() {
  const list = $("#cart-items-list");
  const emptyView = $("#cart-empty-view");
  const footer = $("#cart-footer");
  const subtotalEl = $("#cart-subtotal-amount");
  const totalEl = $("#cart-total-amount");

  updateCartBadge();

  if (cart.length === 0) {
    if (list) list.innerHTML = "";
    if (emptyView) emptyView.hidden = false;
    if (footer) footer.hidden = true;
    return;
  }

  if (emptyView) emptyView.hidden = true;
  if (footer) footer.hidden = false;

  const { subtotal, total } = calculateCartTotals();
  if (subtotalEl) subtotalEl.textContent = `${formatEgp(subtotal)} ج.م`;
  if (totalEl) totalEl.textContent = `${formatEgp(total)} ج.م`;

  if (list) {
    list.innerHTML = cart.map((item, index) => {
      const price = Number(item.product.salePrice || item.product.basePrice);
      const image = item.selectedImage || item.product.imageUrl || "/sodfa-promo-poster.jpg";
      const variantText = item.selectedColor ? `<span class="cart-item-variant">${safeText(item.selectedColor)}</span>` : "";

      return `
        <div class="cart-item-card" data-cart-index="${index}">
          <div class="cart-item-thumb">
            <img src="${safeText(image)}" alt="${safeText(item.product.name)}" />
          </div>
          <div class="cart-item-info">
            <h4>${safeText(item.product.name)}</h4>
            ${variantText}
            <div class="cart-item-price">${formatEgp(price)} ج.م</div>
            <div class="cart-item-qty-row">
              <div class="quantity-control quantity-control-sm">
                <button type="button" data-action="cart-minus" data-cart-index="${index}" aria-label="تقليل الكمية">−</button>
                <span>${new Intl.NumberFormat("ar-EG").format(item.quantity)}</span>
                <button type="button" data-action="cart-plus" data-cart-index="${index}" aria-label="زيادة الكمية">+</button>
              </div>
              <button type="button" class="cart-item-remove-btn" data-action="cart-remove" data-cart-index="${index}" aria-label="حذف الساعة من الحقيبة">
                إزالة
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }
}

function addToCart(product, selectedImage = "", selectedColor = "", qty = 1) {
  const chosenColor = selectedColor || (product.images?.[0]?.colorLabel || "");
  const chosenImage = selectedImage || (product.images?.[0]?.imageUrl || product.imageUrl || "");

  // Check if identical item with same color is already in cart
  const existing = cart.find(
    (item) => item.product.id === product.id && item.selectedColor === chosenColor
  );

  if (existing) {
    existing.quantity += qty;
  } else {
    cart.push({
      product,
      selectedImage: chosenImage,
      selectedColor: chosenColor,
      quantity: qty,
    });
  }

  saveCart(cart);
  renderCartDrawer();
  openCartDrawer();
  showToast(`✓ أضيفت «${product.name}» إلى حقيبة التسوق.`);
}

function openCartDrawer() {
  const drawer = $("#cart-drawer");
  if (!drawer) return;
  drawer.hidden = false;
  setTimeout(() => drawer.classList.add("is-open"), 10);
  document.body.style.overflow = "hidden";
}

function closeCartDrawer() {
  const drawer = $("#cart-drawer");
  if (!drawer) return;
  drawer.classList.remove("is-open");
  setTimeout(() => {
    drawer.hidden = true;
    document.body.style.overflow = "";
  }, 220);
}

// ----------------------------------------------------
// 5. RICH PRODUCT DETAIL MODAL
// ----------------------------------------------------
function openProductModal(product) {
  modalSelectedProduct = product;
  modalSelectedImageIndex = 0;
  modalQuantity = 1;

  const modal = $("#product-detail-modal");
  if (!modal) return;

  const mainImg = $("#modal-main-image");
  const swatches = $("#modal-swatches");
  const nameEl = $("#modal-product-name");
  const catEl = $("#modal-product-category");
  const priceWrap = $("#modal-price-wrap");
  const descEl = $("#modal-product-description");
  const specsList = $("#modal-specs-list");
  const qtyDisplay = $("#modal-qty-display");
  const whatsappBtn = $("#modal-whatsapp-btn");

  const images = Array.isArray(product.images) && product.images.length > 0
    ? product.images
    : [{ imageUrl: product.imageUrl || "/sodfa-promo-poster.jpg", colorLabel: "الأساسي", imageAlt: product.name }];

  mainImg.src = images[0].imageUrl;
  mainImg.alt = images[0].imageAlt || product.name;
  nameEl.textContent = product.name;
  catEl.textContent = product.category || "ساعة صُدْفَة";
  descEl.textContent = product.description || "ساعة راقية بتفاصيل عالية الدقة.";
  priceWrap.innerHTML = renderPriceMarkup(product);
  qtyDisplay.textContent = "1";

  // Specs List
  if (product.specifications && product.specifications.length > 0) {
    specsList.innerHTML = product.specifications.map((s) => `
      <div class="spec-row">
        <dt>${safeText(s.label)}</dt>
        <dd>${safeText(s.value)}</dd>
      </div>
    `).join("");
  } else {
    specsList.innerHTML = `
      <div class="spec-row"><dt>الضمان</dt><dd>سنتان شاملتان</dd></div>
      <div class="spec-row"><dt>التوصيل</dt><dd>معاينة مجانية عند الاستلام</dd></div>
    `;
  }

  // Gallery Swatches
  swatches.innerHTML = images.map((img, i) => `
    <button type="button" class="modal-swatch-thumb ${i === 0 ? "is-selected" : ""}" data-image-index="${i}">
      <img src="${safeText(img.imageUrl)}" alt="" />
      <span>${safeText(img.colorLabel || `لون ${i+1}`)}</span>
    </button>
  `).join("");

  // WhatsApp Order Link
  const phone = publicContacts.whatsappNumber.replace(/\D/g, "");
  if (phone) {
    const msg = encodeURIComponent(`مرحبًا صُدْفَة، أرغب بالاستفسار عن طلب ساعة ${product.name}. ممكن تفاصيل الشحن والتوفر؟`);
    whatsappBtn.href = `https://wa.me/${phone}?text=${msg}`;
    whatsappBtn.hidden = false;
  } else {
    whatsappBtn.hidden = true;
  }

  modal.hidden = false;
  setTimeout(() => modal.classList.add("is-open"), 10);
  document.body.style.overflow = "hidden";
}

function closeProductModal() {
  const modal = $("#product-detail-modal");
  if (!modal) return;
  modal.classList.remove("is-open");
  setTimeout(() => {
    modal.hidden = true;
    document.body.style.overflow = "";
  }, 220);
}

// ----------------------------------------------------
// 6. CHECKOUT FLOW & ORDER SUBMISSION
// ----------------------------------------------------
function openCheckoutModal() {
  if (cart.length === 0) {
    showToast("حقيبة التسوق فارغة!", false);
    return;
  }
  closeCartDrawer();

  const modal = $("#checkout-modal");
  const formView = $("#checkout-form-view");
  const successView = $("#checkout-success-view");
  const itemsSummary = $("#checkout-items-summary");
  const finalTotal = $("#checkout-final-total");
  const errorBox = $("#checkout-error");

  if (!modal) return;
  formView.hidden = false;
  successView.hidden = true;
  if (errorBox) errorBox.hidden = true;

  const { total } = calculateCartTotals();
  if (finalTotal) finalTotal.textContent = `${formatEgp(total)} ج.م`;

  if (itemsSummary) {
    itemsSummary.innerHTML = cart.map((item) => `
      <div class="summary-item-line">
        <span class="summary-item-title">${safeText(item.product.name)} × ${new Intl.NumberFormat("ar-EG").format(item.quantity)} ${item.selectedColor ? `(${safeText(item.selectedColor)})` : ""}</span>
        <strong class="summary-item-cost">${formatEgp(Number(item.product.salePrice || item.product.basePrice) * item.quantity)} ج.م</strong>
      </div>
    `).join("");
  }

  modal.hidden = false;
  setTimeout(() => modal.classList.add("is-open"), 10);
  document.body.style.overflow = "hidden";
}

function closeCheckoutModal() {
  const modal = $("#checkout-modal");
  if (!modal) return;
  modal.classList.remove("is-open");
  setTimeout(() => {
    modal.hidden = true;
    document.body.style.overflow = "";
  }, 220);
}

function handleCheckoutSubmit(e) {
  e.preventDefault();
  const name = $("#checkout-name").value.trim();
  const phone = $("#checkout-phone").value.trim();
  const gov = $("#checkout-governorate").value;
  const city = $("#checkout-city").value.trim();
  const address = $("#checkout-address").value.trim();
  const notes = $("#checkout-notes").value.trim();
  const errorBox = $("#checkout-error");

  if (!name || !phone || !gov || !city || !address) {
    errorBox.textContent = "يرجى ملء جميع الحقول المطلوبة (*).";
    errorBox.hidden = false;
    return;
  }

  // Generate unique order ID
  const orderId = `SDF-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const { total } = calculateCartTotals();

  // Populate Success View
  $("#success-order-id").textContent = orderId;
  $("#success-summary-card").innerHTML = `
    <div class="success-card-row"><span>المشتري:</span><strong>${safeText(name)}</strong></div>
    <div class="success-card-row"><span>رقم الهاتف:</span><strong dir="ltr">${safeText(phone)}</strong></div>
    <div class="success-card-row"><span>العنوان:</span><strong>${safeText(gov)} — ${safeText(city)}، ${safeText(address)}</strong></div>
    <div class="success-card-row"><span>إجمالي الفاتورة:</span><strong>${formatEgp(total)} ج.م (شامل الشحن والدفع عند الاستلام)</strong></div>
  `;

  // WhatsApp Immediate Confirmation Link
  const cleanPhone = publicContacts.whatsappNumber.replace(/\D/g, "");
  const orderItemsText = cart.map(i => `• ${i.product.name} (عدد ${i.quantity})`).join("\n");
  const waMsg = encodeURIComponent(
    `مرحبًا صُدْفَة، تم تثبيت طلبي رقم ${orderId}:\n${orderItemsText}\nالإجمالي: ${total} ج.م\nالاسم: ${name}\nالمحافظة: ${gov}\nالعنوان: ${city} - ${address}\nيرجى تأكيد الشحن.`
  );
  const waLink = $("#success-whatsapp-confirm");
  if (waLink) {
    waLink.href = cleanPhone ? `https://wa.me/${cleanPhone}?text=${waMsg}` : `https://wa.me/?text=${waMsg}`;
  }

  // Clear Cart
  cart = [];
  saveCart(cart);
  updateCartBadge();

  // Show Success View
  $("#checkout-form-view").hidden = true;
  $("#checkout-success-view").hidden = false;
}

// ----------------------------------------------------
// 7. CONTACT LINKS & PUBLIC SETTINGS
// ----------------------------------------------------
function setContactLink(selector, href, label) {
  const link = $(selector);
  if (!link) return;
  link.hidden = !href;
  if (href) {
    link.href = href;
    link.textContent = label;
  } else {
    link.removeAttribute("href");
  }
}

function renderContactLinks(settings = {}) {
  const phone = String(settings.phoneNumber || "+201000000000").trim();
  const whatsapp = String(settings.whatsappNumber || "+201000000000").trim();
  publicContacts = { phoneNumber: phone, whatsappNumber: whatsapp };

  const whatsappDigits = whatsapp.replace(/\D/g, "");
  const whatsappUrl = whatsappDigits ? `https://wa.me/${whatsappDigits}` : "";
  const phoneUrl = phone ? `tel:${phone}` : "";

  setContactLink("#order-whatsapp-link", whatsappUrl, `واتساب: ${whatsapp}`);
  setContactLink("#order-phone-link", phoneUrl, `اتصال: ${phone}`);
  setContactLink("#footer-whatsapp-link", whatsappUrl, `واتساب: ${whatsapp}`);
  setContactLink("#footer-phone-link", phoneUrl, `اتصال: ${phone}`);

  const hasContact = Boolean(whatsappUrl || phoneUrl);
  const orderLinks = $("#ordering-contact-links");
  const footerLinks = $("#footer-contact-links");
  if (orderLinks) orderLinks.hidden = !hasContact;
  if (footerLinks) footerLinks.hidden = !hasContact;
}

// ----------------------------------------------------
// 8. INITIALIZATION & EVENT LISTENERS
// ----------------------------------------------------
async function initStorefront() {
  // Try fetching dynamic database products from backend API if available
  try {
    const [productsRes, settingsRes] = await Promise.allSettled([
      fetch("/api/products", { headers: { Accept: "application/json" } }).then(r => r.ok ? r.json() : null),
      fetch("/api/settings", { headers: { Accept: "application/json" } }).then(r => r.ok ? r.json() : null),
    ]);

    if (settingsRes.status === "fulfilled" && settingsRes.value?.settings) {
      renderContactLinks(settingsRes.value.settings);
    } else {
      renderContactLinks({});
    }

    if (productsRes.status === "fulfilled" && productsRes.value?.products?.length > 0) {
      // Merge backend database products with rich inventory
      const dbProducts = productsRes.value.products;
      const dbIds = new Set(dbProducts.map(p => p.id));
      const remainingInitial = initialProducts.filter(p => !dbIds.has(p.id));
      allProducts = [...dbProducts, ...remainingInitial];
      schedulePromotionRefresh(allProducts, productsRes.value.serverNow);
    } else {
      allProducts = initialProducts;
      schedulePromotionRefresh(allProducts, new Date().toISOString());
    }
  } catch {
    allProducts = initialProducts;
    renderContactLinks({});
  }

  // Render Category Tabs & Initial Catalog Grid
  renderCategoryTabs();
  renderCatalog();
  renderCartDrawer();
  updateCartBadge();

  // Flagship Timepiece Feature in Hero
  const flagship = allProducts.find(p => p.isFlagship) || allProducts[0];
  if (flagship) {
    $("#hero-flagship-name").textContent = flagship.name;
    $("#hero-flagship-cta")?.addEventListener("click", () => openProductModal(flagship));
  }
}

// Global Event Listeners
document.addEventListener("DOMContentLoaded", () => {
  initStorefront();
  $("#year").textContent = new Date().getFullYear();

  // 1. Search Input
  const searchInput = $("#header-search-input");
  const searchClear = $("#header-search-clear");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value;
      if (searchClear) searchClear.hidden = !searchQuery;
      renderCatalog();
    });
  }
  if (searchClear) {
    searchClear.addEventListener("click", () => {
      searchQuery = "";
      searchInput.value = "";
      searchClear.hidden = true;
      renderCatalog();
    });
  }

  // 2. Category Tab Selection
  $("#catalog-category-tabs")?.addEventListener("click", (e) => {
    const tab = e.target.closest("button[data-category]");
    if (!tab) return;
    activeCategory = tab.dataset.category;
    $$(".category-tab").forEach(t => t.classList.toggle("is-active", t === tab));
    renderCatalog();
  });

  // 3. Sorting Dropdown
  $("#catalog-sort")?.addEventListener("change", (e) => {
    activeSort = e.target.value;
    renderCatalog();
  });

  // 4. Quick Filter Chips
  $$(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const filterKey = chip.dataset.filter;
      if (activeFilters.has(filterKey)) {
        activeFilters.delete(filterKey);
        chip.classList.remove("is-active");
      } else {
        activeFilters.add(filterKey);
        chip.classList.add("is-active");
      }
      renderCatalog();
    });
  });

  // 5. Reset Filters Buttons
  document.addEventListener("click", (e) => {
    if (e.target.id === "catalog-reset-filters" || e.target.id === "empty-state-reset-btn") {
      searchQuery = "";
      if (searchInput) searchInput.value = "";
      if (searchClear) searchClear.hidden = true;
      activeCategory = "all";
      activeSort = "featured";
      activeFilters.clear();
      $$(".category-tab").forEach(t => t.classList.toggle("is-active", t.dataset.category === "all"));
      $$(".filter-chip").forEach(c => c.classList.remove("is-active"));
      if ($("#catalog-sort")) $("#catalog-sort").value = "featured";
      renderCatalog();
    }
  });

  // 6. Product Card Interactions (Swatches, Quick View, Add to Cart)
  $("#catalog-grid")?.addEventListener("click", (e) => {
    // Color Swatch dot hover/click
    const swatch = e.target.closest(".swatch-dot");
    if (swatch) {
      const card = swatch.closest(".product-card");
      const productId = swatch.dataset.productId;
      const index = Number(swatch.dataset.swatchIndex);
      const product = allProducts.find(p => p.id === productId);
      if (card && product && product.images[index]) {
        card.querySelector(".product-image").src = product.images[index].imageUrl;
        card.querySelectorAll(".swatch-dot").forEach((dot, idx) => dot.classList.toggle("is-selected", idx === index));
      }
      return;
    }

    // Quick View Modal
    const quickViewBtn = e.target.closest('[data-action="quick-view"]');
    if (quickViewBtn) {
      const productId = quickViewBtn.dataset.productId;
      const product = allProducts.find(p => p.id === productId);
      if (product) openProductModal(product);
      return;
    }

    // Direct Add to Cart
    const addCartBtn = e.target.closest('[data-action="add-to-cart"]');
    if (addCartBtn) {
      const productId = addCartBtn.dataset.productId;
      const product = allProducts.find(p => p.id === productId);
      if (product) {
        addToCart(product);
      }
      return;
    }
  });

  // 7. Cart Drawer Open / Close
  $("#cart-drawer-toggle")?.addEventListener("click", openCartDrawer);
  $("#cart-drawer-close")?.addEventListener("click", closeCartDrawer);
  $("#cart-backdrop")?.addEventListener("click", closeCartDrawer);
  $("#cart-explore-button")?.addEventListener("click", () => {
    closeCartDrawer();
    window.location.hash = "#catalog";
  });

  // 8. Cart Items Quantity & Removal
  $("#cart-items-list")?.addEventListener("click", (e) => {
    const minusBtn = e.target.closest('[data-action="cart-minus"]');
    const plusBtn = e.target.closest('[data-action="cart-plus"]');
    const removeBtn = e.target.closest('[data-action="cart-remove"]');

    if (minusBtn) {
      const idx = Number(minusBtn.dataset.cartIndex);
      if (cart[idx]) {
        if (cart[idx].quantity > 1) cart[idx].quantity -= 1;
        else cart.splice(idx, 1);
        saveCart(cart);
        renderCartDrawer();
      }
      return;
    }

    if (plusBtn) {
      const idx = Number(plusBtn.dataset.cartIndex);
      if (cart[idx]) {
        cart[idx].quantity += 1;
        saveCart(cart);
        renderCartDrawer();
      }
      return;
    }

    if (removeBtn) {
      const idx = Number(removeBtn.dataset.cartIndex);
      if (cart[idx]) {
        cart.splice(idx, 1);
        saveCart(cart);
        renderCartDrawer();
      }
      return;
    }
  });

  // 9. Proceed to Checkout Trigger
  $("#cart-checkout-button")?.addEventListener("click", openCheckoutModal);

  // 10. Product Modal Controls
  $("#modal-close")?.addEventListener("click", closeProductModal);
  $("#modal-backdrop")?.addEventListener("click", closeProductModal);

  $("#modal-swatches")?.addEventListener("click", (e) => {
    const swatchThumb = e.target.closest(".modal-swatch-thumb");
    if (!swatchThumb || !modalSelectedProduct) return;
    const index = Number(swatchThumb.dataset.imageIndex);
    modalSelectedImageIndex = index;
    const images = modalSelectedProduct.images || [];
    if (images[index]) {
      $("#modal-main-image").src = images[index].imageUrl;
      $$(".modal-swatch-thumb").forEach((s, idx) => s.classList.toggle("is-selected", idx === index));
    }
  });

  $("#modal-qty-minus")?.addEventListener("click", () => {
    if (modalQuantity > 1) {
      modalQuantity -= 1;
      $("#modal-qty-display").textContent = String(modalQuantity);
    }
  });

  $("#modal-qty-plus")?.addEventListener("click", () => {
    modalQuantity += 1;
    $("#modal-qty-display").textContent = String(modalQuantity);
  });

  $("#modal-add-cart-btn")?.addEventListener("click", () => {
    if (!modalSelectedProduct) return;
    const images = modalSelectedProduct.images || [];
    const selectedImg = images[modalSelectedImageIndex]?.imageUrl || modalSelectedProduct.imageUrl;
    const selectedColor = images[modalSelectedImageIndex]?.colorLabel || "";
    addToCart(modalSelectedProduct, selectedImg, selectedColor, modalQuantity);
    closeProductModal();
  });

  // 11. Checkout Form & Modal Controls
  $("#checkout-close")?.addEventListener("click", closeCheckoutModal);
  $("#checkout-backdrop")?.addEventListener("click", closeCheckoutModal);
  $("#checkout-form")?.addEventListener("submit", handleCheckoutSubmit);
  $("#success-continue-btn")?.addEventListener("click", closeCheckoutModal);

  // 12. ESC key closes open modals
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeCartDrawer();
      closeProductModal();
      closeCheckoutModal();
    }
  });

  // Mobile Menu Toggle
  const menuBtn = $(".menu-toggle");
  const nav = $("#site-nav");
  menuBtn?.addEventListener("click", () => {
    const open = menuBtn.getAttribute("aria-expanded") === "true";
    menuBtn.setAttribute("aria-expanded", String(!open));
    nav.classList.toggle("is-open", !open);
  });
  nav?.querySelectorAll("a").forEach((l) => l.addEventListener("click", () => {
    nav.classList.remove("is-open");
    menuBtn.setAttribute("aria-expanded", "false");
  }));

  // Auto-open cart if requested via query parameter
  if (new URLSearchParams(window.location.search).get("openCart") === "true") {
    setTimeout(openCartDrawer, 150);
  }
});
