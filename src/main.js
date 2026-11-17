import "./style.css";
import {
  initialProducts,
  categories as defaultCategories,
  getCart,
  saveCart,
  getStoredProducts,
  getStoreSettings,
  getStoredCategories,
  getTickerItems,
  addOrder,
} from "./data.js";
import {
  calculateDiscountedPrice,
  calculateFlexibleDiscount,
  formatDiscountLabel,
  formatEgpNumber,
} from "./pricing.js";
import { schedulePromotionRefresh, startPromotionCountdowns } from "./promotions.js";

// DOM Selector Helpers
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// Central State
let allProducts = getStoredProducts();
let allCategories = getStoredCategories();
let currentSettings = getStoreSettings();
let activeCategory = "all";
let searchQuery = "";
let activeSort = "featured";
let activeFilters = new Set(); // "sale", "leather", "steel"
let cart = getCart();
let modalProduct = null;
let modalSelectedImageIndex = 0;
let modalQuantity = 1;
let toastTimeout = null;

// Safe HTML Escape
const safeText = (value = "") =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));

// EGP Currency Formatter
function formatEgp(amount) {
  return new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(Number(amount) || 0);
}

// Toast Feedback
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
// 0. PRICE & DISCOUNT CALCULATION HELPERS
// ----------------------------------------------------
function getEffectiveProductPrice(product) {
  if (!product) return 0;
  const basePrice = Number(product.basePrice) || 0;
  if (!product.discountActive) return basePrice;

  if (product.discountType === "fixed") {
    const val = Number(product.discountValue || 0);
    return val > 0 ? Math.max(0, basePrice - val) : basePrice;
  }
  if (product.discountType === "percent") {
    const pct = Number(product.discountValue || product.discountPercent || 0);
    return pct > 0 ? calculateFlexibleDiscount(basePrice, "percent", pct) : basePrice;
  }
  if (Number(product.discountPercent) > 0) {
    return Number(product.salePrice) || calculateFlexibleDiscount(basePrice, "percent", Number(product.discountPercent));
  }
  return basePrice;
}

function getDiscountBadgeLabel(product) {
  if (!product || !product.discountActive) return "";
  if (product.discountType === "fixed") {
    return formatDiscountLabel("fixed", product.discountValue);
  }
  if (product.discountType === "percent") {
    return formatDiscountLabel("percent", product.discountValue || product.discountPercent);
  }
  if (Number(product.discountPercent) > 0) {
    return `خصم ${formatEgp(product.discountPercent)}%`;
  }
  return "";
}

// ----------------------------------------------------
// SCROLLING NEWS TICKER RENDERING
// ----------------------------------------------------
function renderNewsTicker() {
  const tickerBar = $("#news-ticker-bar");
  const track = $("#ticker-track");
  if (!tickerBar || !track) return;

  const isEnabled = currentSettings.tickerEnabled !== false;
  if (!isEnabled) {
    tickerBar.hidden = true;
    return;
  }

  tickerBar.hidden = false;

  const speed = currentSettings.tickerSpeed || "medium";
  const duration = speed === "slow" ? "38s" : speed === "fast" ? "16s" : "26s";
  track.style.setProperty("--ticker-duration", duration);

  const items = getTickerItems();
  if (!items || items.length === 0) {
    tickerBar.hidden = true;
    return;
  }

  const segmentHtml = `
    <div class="ticker-segment" aria-hidden="true">
      ${items.map((item) => `
        <span class="ticker-item">
          <span>${safeText(item)}</span>
          <span class="ticker-divider">✦</span>
        </span>
      `).join("")}
    </div>
  `;

  track.innerHTML = segmentHtml + segmentHtml;
}

// ----------------------------------------------------
// STORE OWNER BACKGROUND NOTIFICATIONS
// ----------------------------------------------------
async function notifyStoreOwner(order, settings = currentSettings) {
  const tasks = [];

  // 1. Email notification via Web3Forms
  if (settings.emailNotificationsEnabled && settings.web3formsKey) {
    const emailPayload = {
      access_key: settings.web3formsKey,
      subject: `طلب شراء جديد #${order.id} من متجر ضَفّة`,
      from_name: "متجر ضَفّة للساعات",
      order_id: order.id,
      customer_name: order.customerName,
      phone: order.phone,
      governorate: order.governorate,
      city: order.city,
      address: order.address,
      notes: order.notes,
      total: `${formatEgp(order.totalAmount)} ج.م`,
      items: order.items.map((i) => `${i.name} (عدد: ${i.quantity}, سعر: ${i.price} ج.م)`).join(" | "),
    };

    tasks.push(
      fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(emailPayload),
      }).catch((err) => console.warn("Email dispatch error:", err))
    );
  }

  // 2. Telegram Bot notification
  if (settings.telegramNotificationsEnabled && settings.telegramBotToken && settings.telegramChatId) {
    const itemsLines = order.items
      .map((i) => `• <b>${safeText(i.name)}</b> × ${i.quantity} ${i.color ? `(${safeText(i.color)})` : ""} — ${formatEgp(i.price * i.quantity)} ج.م`)
      .join("\n");

    const tgMessage = `🔔 <b>طلب شراء جديد في متجر ضَفّة</b>\n\n` +
      `<b>رقم الطلب:</b> <code>#${order.id}</code>\n` +
      `<b>العميل:</b> ${safeText(order.customerName)}\n` +
      `<b>الهاتف:</b> <code>${safeText(order.phone)}</code>\n` +
      `<b>المحافظة:</b> ${safeText(order.governorate)} — ${safeText(order.city)}\n` +
      `<b>العنوان:</b> ${safeText(order.address)}\n\n` +
      `<b>المنتجات:</b>\n${itemsLines}\n\n` +
      `<b>الإجمالي:</b> <b>${formatEgp(order.totalAmount)} ج.م</b> (الدفع عند الاستلام)\n` +
      `<b>الملاحظات:</b> ${safeText(order.notes || "لا توجد")}`;

    tasks.push(
      fetch(`https://api.telegram.org/bot${encodeURIComponent(settings.telegramBotToken)}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: settings.telegramChatId,
          text: tgMessage,
          parse_mode: "HTML",
        }),
      }).catch((err) => console.warn("Telegram dispatch error:", err))
    );
  }

  Promise.allSettled(tasks);
}
function applyStoreSettings(settings = currentSettings) {
  currentSettings = settings;

  // Announcement Bar
  const announcementEl = $("#site-announcement-text");
  if (announcementEl && settings.announcement) {
    announcementEl.textContent = settings.announcement;
  }

  // Brand Name & Subtitle
  const brandTitle = $("#site-brand-title");
  const brandSub = $("#site-brand-sub");
  if (brandTitle && settings.brandName) brandTitle.textContent = settings.brandName;
  if (brandSub && settings.brandSubtitle) brandSub.textContent = settings.brandSubtitle;

  // Hero Headline & Description
  const heroTitle = $("#hero-title");
  const heroDesc = $("#hero-description");
  if (heroTitle && settings.heroHeadline) {
    heroTitle.innerHTML = settings.heroHeadline.replace(/\n/g, "<br />");
  }
  if (heroDesc && settings.heroDescription) {
    heroDesc.textContent = settings.heroDescription;
  }

  // Hero Flagship Timepiece
  const flagshipTag = $("#hero-flagship-tag");
  const flagshipName = $("#hero-flagship-name");
  const flagshipSpec = $("#hero-flagship-spec");
  if (flagshipTag && settings.featuredTag) flagshipTag.textContent = settings.featuredTag;
  if (flagshipName && settings.featuredName) flagshipName.textContent = settings.featuredName;
  if (flagshipSpec && settings.featuredSpec) flagshipSpec.textContent = settings.featuredSpec;

  // Hero Video & Poster
  const videoPlayer = $("#hero-video-player");
  const videoSource = $("#hero-video-source");
  if (videoPlayer && videoSource) {
    const targetVideo = settings.heroVideoUrl || "/manus-storage/96837d80-d655-11f1-9beb-9def1d7eb227_fb348b1f.mp4";
    const targetPoster = settings.heroPosterUrl || "/sodfa-promo-poster.jpg";
    if (videoSource.getAttribute("src") !== targetVideo) {
      videoSource.setAttribute("src", targetVideo);
      videoPlayer.load();
      videoPlayer.play().catch(() => {});
    }
    if (videoPlayer.getAttribute("poster") !== targetPoster) {
      videoPlayer.setAttribute("poster", targetPoster);
    }
  }

  // Ordering & Contact Links
  const orderWhatsApp = $("#order-whatsapp-link");
  const orderPhone = $("#order-phone-link");
  const footerWhatsApp = $("#footer-whatsapp-link");
  const footerPhone = $("#footer-phone-link");
  const contactLinksWrap = $("#ordering-contact-links");
  const footerContactWrap = $("#footer-contact-links");

  const wa = settings.defaultWhatsapp ? settings.defaultWhatsapp.replace(/\D/g, "") : "";
  const ph = settings.defaultPhone || "";

  if (wa) {
    const waUrl = `https://wa.me/${wa}?text=${encodeURIComponent(`مرحبًا ${settings.brandName || "ضَفّة"}، أود الاستفسار عن الساعات المتوفرة.`)}`;
    if (orderWhatsApp) { orderWhatsApp.href = waUrl; orderWhatsApp.hidden = false; }
    if (footerWhatsApp) { footerWhatsApp.href = waUrl; footerWhatsApp.hidden = false; }
  } else {
    if (orderWhatsApp) orderWhatsApp.hidden = true;
    if (footerWhatsApp) footerWhatsApp.hidden = true;
  }

  if (ph) {
    if (orderPhone) { orderPhone.href = `tel:${ph}`; orderPhone.hidden = false; }
    if (footerPhone) { footerPhone.href = `tel:${ph}`; footerPhone.hidden = false; }
  } else {
    if (orderPhone) orderPhone.hidden = true;
    if (footerPhone) footerPhone.hidden = true;
  }

  const hasContacts = Boolean(wa || ph);
  if (contactLinksWrap) contactLinksWrap.hidden = !hasContacts;
  if (footerContactWrap) footerContactWrap.hidden = !hasContacts;

  // News Ticker
  renderNewsTicker();
}

// ----------------------------------------------------
// 2. FILTERING & SORTING LOGIC
// ----------------------------------------------------
function matchesCategory(product, catId) {
  if (catId === "all") return true;
  if (catId === "men") return product.gender === "men" || product.gender === "unisex";
  if (catId === "women") return product.gender === "women" || product.gender === "unisex";
  if (catId === "classic-dress") return product.categoryId === "classic-dress" || product.style === "classic";
  if (catId === "sport-chrono") return product.categoryId === "sport-chrono" || product.style === "chronograph" || product.style === "sport";
  if (catId === "smart-hybrid") return product.categoryId === "smart-hybrid" || product.style === "smart";
  return product.categoryId === catId || (product.category && product.category.includes(catId));
}

function getFilteredProducts() {
  let list = allProducts.filter((product) => {
    // 1. Category Filter
    if (!matchesCategory(product, activeCategory)) return false;

    // 2. Search Query Filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      const name = (product.name || "").toLowerCase();
      const desc = (product.description || "").toLowerCase();
      const cat = (product.category || "").toLowerCase();
      const spec = (product.shortSpec || "").toLowerCase();
      if (!name.includes(q) && !desc.includes(q) && !cat.includes(q) && !spec.includes(q)) {
        return false;
      }
    }

    // 3. Quick Filter Chips
    if (activeFilters.has("sale") && (!product.discountActive || !product.discountPercent)) {
      return false;
    }
    if (activeFilters.has("leather")) {
      const desc = (product.description || "").toLowerCase();
      const spec = (product.shortSpec || "").toLowerCase();
      if (!desc.includes("جلد") && !spec.includes("جلد")) return false;
    }
    if (activeFilters.has("steel")) {
      const desc = (product.description || "").toLowerCase();
      const spec = (product.shortSpec || "").toLowerCase();
      if (!desc.includes("ستيل") && !desc.includes("فولاذ") && !spec.includes("ستيل") && !spec.includes("فولاذ")) return false;
    }

    return true;
  });

  // Sorting
  if (activeSort === "price-asc") {
    list.sort((a, b) => getEffectiveProductPrice(a) - getEffectiveProductPrice(b));
  } else if (activeSort === "price-desc") {
    list.sort((a, b) => getEffectiveProductPrice(b) - getEffectiveProductPrice(a));
  } else if (activeSort === "discount") {
    list.sort((a, b) => {
      const discA = a.discountActive ? (Number(a.basePrice) - getEffectiveProductPrice(a)) : 0;
      const discB = b.discountActive ? (Number(b.basePrice) - getEffectiveProductPrice(b)) : 0;
      return discB - discA;
    });
  }

  return list;
}

// ----------------------------------------------------
// 3. CATEGORY TABS RENDERING
// ----------------------------------------------------
function renderCategoryTabs() {
  const container = $("#catalog-category-tabs");
  if (!container) return;

  container.innerHTML = allCategories.map((cat) => {
    const count = allProducts.filter((p) => matchesCategory(p, cat.id)).length;
    const isSelected = activeCategory === cat.id;
    return `
      <button 
        class="category-tab ${isSelected ? "is-active" : ""}" 
        type="button" 
        role="tab" 
        aria-selected="${isSelected}"
        data-category="${cat.id}">
        <span class="tab-icon" aria-hidden="true">${cat.icon || "⌚"}</span>
        <span class="tab-name">${safeText(cat.name)}</span>
        <span class="tab-count">${new Intl.NumberFormat("ar-EG").format(count)}</span>
      </button>
    `;
  }).join("");
}

// ----------------------------------------------------
// 4. BESPOKE WATCH PRODUCT CARD RENDERING
// (Clean Horology Aesthetic: No Red Banner, Equal Height, Interactive Swatches)
// ----------------------------------------------------
function renderPriceRow(product) {
  const basePrice = Number(product.basePrice) || 0;
  const currentPrice = getEffectiveProductPrice(product);
  const discountActive = Boolean(product.discountActive) && currentPrice < basePrice;
  const discountLabel = getDiscountBadgeLabel(product);

  const countdownMarkup = (discountActive && product.discountEndOn)
    ? `<span class="timer-pill" data-promotion-countdown data-discount-end="${safeText(product.discountEndOn)}" aria-label="الوقت المتبقي"></span>`
    : "";

  return `
    <div class="card-pricing-row">
      <div class="pricing-main">
        <strong class="price-current">${formatEgp(currentPrice)} <small>ج.م</small></strong>
        ${discountActive ? `<del class="price-original">${formatEgp(basePrice)} <small>ج.م</small></del>` : ""}
      </div>
      ${discountActive && discountLabel ? `
        <div class="pricing-tags">
          <span class="discount-pill">${safeText(discountLabel)}</span>
          ${countdownMarkup}
        </div>
      ` : ""}
    </div>
  `;
}

function renderProductCard(product, index) {
  const hasImages = Array.isArray(product.images) && product.images.length > 0;
  const coverImage = product.imageUrl || (hasImages ? product.images[0].imageUrl : "/sodfa-promo-poster.jpg");
  const badgeMarkup = product.badge ? `<span class="product-status-tag">${safeText(product.badge)}</span>` : "";

  // Interactive Color Swatches
  let swatchesHtml = "";
  if (hasImages && product.images.length > 1) {
    swatchesHtml = `
      <div class="card-swatches" role="group" aria-label="ألوان الساعة">
        ${product.images.map((img, i) => `
          <button 
            type="button" 
            class="swatch-dot ${i === 0 ? "is-selected" : ""}" 
            title="${safeText(img.colorLabel || `لون ${i+1}`)}" 
            data-action="switch-card-swatch"
            data-image-index="${i}" 
            data-image-url="${safeText(img.imageUrl)}"
            data-color-label="${safeText(img.colorLabel || "")}"
            data-product-id="${safeText(product.id)}"
            aria-label="${safeText(img.colorLabel || `لون ${i+1}`)}">
          </button>
        `).join("")}
      </div>
    `;
  }

  const spec1Line = product.shortSpec 
    || (product.specifications && product.specifications[0] ? `${product.specifications[0].value} • ${product.specifications[2]?.value || "دقة عالية"}` : "ساعة أصلية فاخرة");

  return `
    <article class="product-card" data-product-id="${safeText(product.id)}">
      <!-- Studio Framing with 4:5 Aspect Ratio -->
      <div class="product-visual">
        <div class="visual-corner-badges">
          <span class="category-pill">${safeText(product.category || "ساعة فاخرة")}</span>
          <span class="index-pill">#${String(index + 1).padStart(2, "0")}</span>
        </div>
        ${badgeMarkup}
        <button type="button" class="product-visual-btn" data-action="quick-view" data-product-id="${safeText(product.id)}" aria-label="عرض مواصفات ${safeText(product.name)}">
          <img class="product-image" id="card-img-${safeText(product.id)}" src="${safeText(coverImage)}" alt="${safeText(product.imageAlt || product.name)}" loading="lazy" />
        </button>
      </div>

      <!-- Card Body with Fixed Structure & Equal Height -->
      <div class="product-details">
        <div class="product-header-group">
          <h3 class="product-title">
            <button type="button" class="product-title-btn" data-action="quick-view" data-product-id="${safeText(product.id)}">
              ${safeText(product.name)}
            </button>
          </h3>
          <p class="product-spec-line">${safeText(spec1Line)}</p>
          ${swatchesHtml}
        </div>

        <div class="product-pricing-wrap">
          ${renderPriceRow(product)}
        </div>

        <div class="card-actions-row">
          <button type="button" class="card-add-cart-btn button button-primary" data-action="add-to-cart" data-product-id="${safeText(product.id)}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
            <span>أضف للحقيبة</span>
          </button>
          <button type="button" class="card-details-btn button button-quiet" data-action="quick-view" data-product-id="${safeText(product.id)}">
            <span>المواصفات</span>
            <span aria-hidden="true">←</span>
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

  // Empty State if no matches
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
// 5. SHOPPING CART FUNCTIONALITY
// ----------------------------------------------------
function updateCartBadge() {
  const badge = $("#cart-badge");
  const countText = $("#cart-items-count-text");
  const totalCount = cart.reduce((sum, item) => sum + (item.quantity || 1), 0);

  if (badge) {
    badge.textContent = new Intl.NumberFormat("ar-EG").format(totalCount);
    badge.classList.toggle("is-active", totalCount > 0);
  }
  if (countText) {
    countText.textContent = `${new Intl.NumberFormat("ar-EG").format(totalCount)} قطعة`;
  }
}

function renderCartDrawer() {
  const list = $("#cart-items-list");
  const emptyView = $("#cart-empty-view");
  const footer = $("#cart-footer");
  const subtotalEl = $("#cart-subtotal-amount");
  const totalEl = $("#cart-total-amount");

  if (!list) return;

  updateCartBadge();

  if (cart.length === 0) {
    list.innerHTML = "";
    emptyView?.removeAttribute("hidden");
    footer?.setAttribute("hidden", "");
    return;
  }

  emptyView?.setAttribute("hidden", "");
  footer?.removeAttribute("hidden");

  let subtotal = 0;

  list.innerHTML = cart.map((item, index) => {
    const itemTotal = Number(item.price) * Number(item.quantity);
    subtotal += itemTotal;
    return `
      <div class="cart-item" data-cart-index="${index}">
        <img class="cart-item-img" src="${safeText(item.image)}" alt="${safeText(item.name)}" />
        <div class="cart-item-info">
          <h4 class="cart-item-title">${safeText(item.name)}</h4>
          ${item.color ? `<span class="cart-item-color">اللون: ${safeText(item.color)}</span>` : ""}
          <div class="cart-item-price-row">
            <span class="cart-item-unit-price">${formatEgp(item.price)} ج.م</span>
            <div class="cart-qty-stepper">
              <button type="button" class="cart-qty-btn" data-action="cart-minus" data-cart-index="${index}" aria-label="تقليل">−</button>
              <span class="cart-qty-val">${item.quantity}</span>
              <button type="button" class="cart-qty-btn" data-action="cart-plus" data-cart-index="${index}" aria-label="زيادة">+</button>
            </div>
          </div>
        </div>
        <button type="button" class="cart-remove-btn" data-action="cart-remove" data-cart-index="${index}" aria-label="إزالة الساعة">✕</button>
      </div>
    `;
  }).join("");

  if (subtotalEl) subtotalEl.textContent = `${formatEgp(subtotal)} ج.م`;
  if (totalEl) totalEl.textContent = `${formatEgp(subtotal)} ج.م`;
}

function openCartDrawer() {
  renderCartDrawer();
  const drawer = $("#cart-drawer");
  if (drawer) {
    drawer.hidden = false;
    document.body.classList.add("modal-open");
    setTimeout(() => drawer.classList.add("is-open"), 10);
  }
}

function closeCartDrawer(keepModalOpen = false) {
  const drawer = $("#cart-drawer");
  if (drawer) {
    drawer.classList.remove("is-open");
    setTimeout(() => {
      drawer.hidden = true;
      if (!keepModalOpen && !$(".checkout-modal.is-open") && !$(".product-modal.is-open")) {
        document.body.classList.remove("modal-open");
      }
    }, 280);
  }
}

function addToCart(product, chosenImage = "", chosenColor = "", qty = 1) {
  const hasImages = Array.isArray(product.images) && product.images.length > 0;
  const image = chosenImage || product.imageUrl || (hasImages ? product.images[0].imageUrl : "");
  const color = chosenColor || (hasImages && product.images[0] ? product.images[0].colorLabel : "");

  const effectivePrice = getEffectiveProductPrice(product);

  const existingIndex = cart.findIndex((item) => item.id === product.id && (item.color || "") === color);

  if (existingIndex > -1) {
    cart[existingIndex].quantity += qty;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: effectivePrice,
      basePrice: Number(product.basePrice),
      image: image,
      color: color,
      quantity: qty,
    });
  }

  saveCart(cart);
  updateCartBadge();
  showToast(`تمت إضافة «${product.name}» إلى حقيبة التسوق بنجاح ✓`);
}

// ----------------------------------------------------
// 6. RICH PRODUCT DETAIL MODAL
// ----------------------------------------------------
function openProductModal(productId) {
  const product = allProducts.find((p) => p.id === productId);
  if (!product) return;

  modalProduct = product;
  modalSelectedImageIndex = 0;
  modalQuantity = 1;

  const modal = $("#product-detail-modal");
  const modalName = $("#modal-product-name");
  const modalCategory = $("#modal-product-category");
  const modalPrice = $("#modal-price-wrap");
  const modalDesc = $("#modal-product-description");
  const modalSpecs = $("#modal-specs-list");
  const modalImage = $("#modal-main-image");
  const modalSwatches = $("#modal-swatches");
  const qtyDisplay = $("#modal-qty-display");
  const whatsappBtn = $("#modal-whatsapp-btn");

  if (modalName) modalName.textContent = product.name;
  if (modalCategory) modalCategory.textContent = product.category || "ساعة فاخرة";
  if (modalDesc) modalDesc.textContent = product.description || "";
  if (modalPrice) modalPrice.innerHTML = renderPriceRow(product);
  if (qtyDisplay) qtyDisplay.textContent = "1";

  // Gallery Swatches
  const images = Array.isArray(product.images) && product.images.length > 0
    ? product.images
    : [{ imageUrl: product.imageUrl, colorLabel: "الأصلي" }];

  if (modalImage) {
    modalImage.src = images[0]?.imageUrl || product.imageUrl;
    modalImage.alt = product.name;
  }

  if (modalSwatches) {
    if (images.length > 1) {
      modalSwatches.innerHTML = images.map((img, idx) => `
        <button 
          type="button" 
          class="modal-swatch-thumb ${idx === 0 ? "is-active" : ""}" 
          data-index="${idx}" 
          aria-label="${safeText(img.colorLabel || `لون ${idx+1}`)}">
          <img src="${safeText(img.imageUrl)}" alt="" />
          <span>${safeText(img.colorLabel || `خيار ${idx+1}`)}</span>
        </button>
      `).join("");
      modalSwatches.hidden = false;
    } else {
      modalSwatches.innerHTML = "";
      modalSwatches.hidden = true;
    }
  }

  // Specifications
  if (modalSpecs) {
    const specs = Array.isArray(product.specifications) && product.specifications.length > 0
      ? product.specifications
      : [
          { label: "الموديل", value: product.name },
          { label: "التصنيف", value: product.category || "كلاسيك" },
          { label: "الضمان", value: "سنتان شامل" },
        ];
    modalSpecs.innerHTML = specs.map((s) => `
      <div class="modal-spec-row">
        <dt>${safeText(s.label)}</dt>
        <dd>${safeText(s.value)}</dd>
      </div>
    `).join("");
  }

  // Direct WhatsApp Button inside modal
  if (whatsappBtn) {
    const wa = currentSettings.defaultWhatsapp ? currentSettings.defaultWhatsapp.replace(/\D/g, "") : "";
    if (wa) {
      const msg = encodeURIComponent(`مرحبًا ${currentSettings.brandName || "ضَفّة"}، أود طلب ساعة: ${product.name} (السعر: ${formatEgp(product.salePrice || product.basePrice)} ج.م).`);
      whatsappBtn.href = `https://wa.me/${wa}?text=${msg}`;
      whatsappBtn.hidden = false;
    } else {
      whatsappBtn.hidden = true;
    }
  }

  if (modal) {
    modal.hidden = false;
    document.body.classList.add("modal-open");
    setTimeout(() => modal.classList.add("is-open"), 10);
  }
}

function closeProductModal() {
  const modal = $("#product-detail-modal");
  if (modal) {
    modal.classList.remove("is-open");
    setTimeout(() => {
      modal.hidden = true;
      document.body.classList.remove("modal-open");
    }, 280);
  }
}

// ----------------------------------------------------
// 7. COMPLETE CHECKOUT FLOW MODAL
// ----------------------------------------------------
function openCheckoutModal() {
  if (cart.length === 0) {
    showToast("حقيبة التسوق فارغة حاليًا.", false);
    return;
  }

  closeCartDrawer(true);

  const modal = $("#checkout-modal");
  const formView = $("#checkout-form-view");
  const successView = $("#checkout-success-view");
  const itemsSummary = $("#checkout-items-summary");
  const finalTotal = $("#checkout-final-total");
  const errorEl = $("#checkout-error");

  if (formView) formView.hidden = false;
  if (successView) successView.hidden = true;
  if (errorEl) errorEl.hidden = true;

  let subtotal = 0;
  if (itemsSummary) {
    itemsSummary.innerHTML = cart.map((item) => {
      const itemTot = Number(item.price) * Number(item.quantity);
      subtotal += itemTot;
      return `
        <div class="checkout-item-line">
          <span>${safeText(item.name)} × ${item.quantity} ${item.color ? `(${safeText(item.color)})` : ""}</span>
          <strong>${formatEgp(itemTot)} ج.م</strong>
        </div>
      `;
    }).join("");
  }

  if (finalTotal) finalTotal.textContent = `${formatEgp(subtotal)} ج.م`;

  if (modal) {
    modal.hidden = false;
    document.body.classList.add("modal-open");
    setTimeout(() => modal.classList.add("is-open"), 10);
  }
}

function closeCheckoutModal() {
  const modal = $("#checkout-modal");
  if (modal) {
    modal.classList.remove("is-open");
    setTimeout(() => {
      modal.hidden = true;
      document.body.classList.remove("modal-open");
      $("#checkout-form-view")?.removeAttribute("hidden");
      $("#checkout-success-view")?.setAttribute("hidden", "");
      $("#checkout-form")?.reset();
    }, 280);
  }
}

function handleCheckoutSubmit(e) {
  e.preventDefault();

  const name = $("#checkout-name")?.value.trim();
  const phone = $("#checkout-phone")?.value.trim();
  const gov = $("#checkout-governorate")?.value;
  const city = $("#checkout-city")?.value.trim();
  const address = $("#checkout-address")?.value.trim();
  const notes = $("#checkout-notes")?.value.trim() || "لا توجد ملاحظات";
  const errorEl = $("#checkout-error");

  // Validate Egyptian Mobile
  const normalizedPhone = phone ? phone.replace(/[\s-]/g, "") : "";
  const isValidPhone = /^(\+20|0)?1[0125]\d{8}$/.test(normalizedPhone);

  if (!name || !phone || !gov || !city || !address) {
    if (errorEl) {
      errorEl.textContent = "يرجى استيفاء جميع الحقول المطلوبة للمتابعة.";
      errorEl.hidden = false;
    }
    return;
  }

  if (!isValidPhone) {
    if (errorEl) {
      errorEl.textContent = "يرجى كتابة رقم هاتف مصري صحيح يبدأ بـ 010 أو 011 أو 012 أو 015.";
      errorEl.hidden = false;
    }
    return;
  }

  if (errorEl) errorEl.hidden = true;

  // Order Calculations
  const orderId = `DAF-${Math.floor(1000 + Math.random() * 9000)}`;
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const orderData = {
    id: orderId,
    customerName: name,
    phone: phone,
    governorate: gov,
    city: city,
    address: address,
    notes: notes,
    totalAmount: subtotal,
    items: cart.map((c) => ({
      id: c.id,
      name: c.name,
      price: c.price,
      quantity: c.quantity,
      color: c.color || "",
      image: c.image || "",
    })),
    status: "new",
    createdAt: new Date().toISOString(),
    isRead: false,
  };

  // 1. Save order to persistent store
  addOrder(orderData);

  // 2. Fire background notifications (Telegram / Web3Forms) without blocking UI
  notifyStoreOwner(orderData, currentSettings);

  // 3. Success View Display
  $("#checkout-form-view")?.setAttribute("hidden", "");
  const successView = $("#checkout-success-view");
  const successOrderNum = $("#success-order-id");
  const successSummary = $("#success-summary-card");
  const waConfirmBtn = $("#success-whatsapp-confirm");

  if (successOrderNum) successOrderNum.textContent = `#${orderId}`;

  if (successSummary) {
    successSummary.innerHTML = `
      <div class="success-details-grid">
        <div><strong>العميل:</strong> ${safeText(name)}</div>
        <div><strong>الهاتف:</strong> ${safeText(phone)}</div>
        <div><strong>المحافظة:</strong> ${safeText(gov)} — ${safeText(city)}</div>
        <div><strong>العنوان:</strong> ${safeText(address)}</div>
        <div><strong>طريقة السداد:</strong> الدفع نقدًا عند الاستلام بعد الفحص والمعاينة</div>
        <div><strong>إجمالي المستحق:</strong> <b style="color:var(--copper); font-size:16px;">${formatEgp(subtotal)} ج.م</b></div>
      </div>
      <div class="success-items-list" style="margin-top:14px; border-top:1px solid var(--line); padding-top:12px;">
        <strong style="color:var(--teal-950); display:block; margin-bottom:6px;">القطع المطلوبة:</strong>
        ${orderData.items.map((c) => `<div>• <b>${safeText(c.name)}</b> (${c.quantity} قطعة) ${c.color ? `- لون ${safeText(c.color)}` : ""} — <span style="font-family:var(--font-digits); font-weight:700;">${formatEgp(c.price * c.quantity)} ج.م</span></div>`).join("")}
      </div>
    `;
  }

  // Pre-fill WhatsApp message for instant dispatch
  if (waConfirmBtn) {
    const wa = currentSettings.defaultWhatsapp ? currentSettings.defaultWhatsapp.replace(/\D/g, "") : "";
    const itemsText = orderData.items.map((c) => `• ${c.name} (${c.quantity} قطعة) ${c.color ? `لون ${c.color}` : ""}`).join("\n");
    const waMessage = encodeURIComponent(
      `مرحبًا ${currentSettings.brandName || "ضَفّة"}، أؤكد طلب الشراء:\n` +
      `رقم الطلب: #${orderId}\n` +
      `الاسم: ${name}\n` +
      `الهاتف: ${phone}\n` +
      `العنوان: ${gov}، ${city}، ${address}\n` +
      `المنتجات:\n${itemsText}\n` +
      `الإجمالي: ${formatEgp(subtotal)} ج.م (الدفع عند الاستلام)\n` +
      `ملاحظات: ${notes}`
    );
    waConfirmBtn.href = wa ? `https://wa.me/${wa}?text=${waMessage}` : "#";
  }

  if (successView) successView.hidden = false;

  // Clear Cart after successful order
  cart = [];
  saveCart(cart);
  updateCartBadge();
}

// ----------------------------------------------------
// 8. INITIALIZE STOREFRONT & BIND GLOBAL EVENTS
// ----------------------------------------------------
function initStorefront() {
  applyStoreSettings(currentSettings);
  renderCategoryTabs();
  renderCatalog();
  updateCartBadge();

  // Try fetching API if backend is running, otherwise retain curated inventory
  fetch("/api/products", { headers: { Accept: "application/json" } })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && Array.isArray(data.products) && data.products.length > 0) {
        // Merge API products preserving rich curated data
        const apiMap = new Map(data.products.map(p => [p.id, p]));
        allProducts = allProducts.map(p => apiMap.has(p.id) ? { ...p, ...apiMap.get(p.id) } : p);
        schedulePromotionRefresh(allProducts, data.serverNow);
        renderCatalog();
        renderCategoryTabs();
      }
    })
    .catch(() => {
      // Backend offline: flawless local operation
    });
}

// Global Event Handlers
document.addEventListener("DOMContentLoaded", () => {
  initStorefront();
  const yearEl = $("#year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // 1. Live Search Input
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

  // 6. Product Card Interactions: Swatches, Quick-View, Direct Add-to-Cart
  $("#catalog-grid")?.addEventListener("click", (e) => {
    // Interactive Swatch Click on Card
    const swatchBtn = e.target.closest('[data-action="switch-card-swatch"]');
    if (swatchBtn) {
      const productId = swatchBtn.dataset.productId;
      const imgUrl = swatchBtn.dataset.imageUrl;
      const card = swatchBtn.closest(".product-card");
      if (card && imgUrl) {
        const imgEl = card.querySelector(".product-image");
        if (imgEl) imgEl.src = imgUrl;
        card.querySelectorAll(".swatch-dot").forEach(dot => dot.classList.toggle("is-selected", dot === swatchBtn));
      }
      return;
    }

    // Quick-View Details
    const quickViewBtn = e.target.closest('[data-action="quick-view"]');
    if (quickViewBtn) {
      const productId = quickViewBtn.dataset.productId;
      if (productId) openProductModal(productId);
      return;
    }

    // Direct Add-to-Cart from Card
    const addCartBtn = e.target.closest('[data-action="add-to-cart"]');
    if (addCartBtn) {
      const productId = addCartBtn.dataset.productId;
      const product = allProducts.find(p => p.id === productId);
      if (product) {
        const card = addCartBtn.closest(".product-card");
        const activeSwatch = card?.querySelector(".swatch-dot.is-selected");
        const chosenImg = activeSwatch?.dataset.imageUrl || product.imageUrl;
        const chosenColor = activeSwatch?.dataset.colorLabel || "";
        addToCart(product, chosenImg, chosenColor, 1);
      }
      return;
    }
  });

  // Hover on Swatches switches image seamlessly
  $("#catalog-grid")?.addEventListener("mouseover", (e) => {
    const swatchBtn = e.target.closest('[data-action="switch-card-swatch"]');
    if (swatchBtn) {
      const imgUrl = swatchBtn.dataset.imageUrl;
      const card = swatchBtn.closest(".product-card");
      if (card && imgUrl) {
        const imgEl = card.querySelector(".product-image");
        if (imgEl) imgEl.src = imgUrl;
        card.querySelectorAll(".swatch-dot").forEach(dot => dot.classList.toggle("is-selected", dot === swatchBtn));
      }
    }
  });

  // Flagship Hero Timepiece CTA
  $("#hero-flagship-cta")?.addEventListener("click", () => {
    const flagship = allProducts.find(p => p.isFlagship) || allProducts[0];
    if (flagship) openProductModal(flagship.id);
  });

  // 7. Cart Drawer Open / Close
  $("#cart-drawer-toggle")?.addEventListener("click", openCartDrawer);
  $("#cart-drawer-close")?.addEventListener("click", closeCartDrawer);
  $("#cart-backdrop")?.addEventListener("click", closeCartDrawer);
  $("#cart-explore-button")?.addEventListener("click", () => {
    closeCartDrawer();
    window.location.hash = "#catalog";
  });
  $("#cart-checkout-button")?.addEventListener("click", openCheckoutModal);

  // 8. Cart Items Quantity & Removal Steppers
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
        const name = cart[idx].name;
        cart.splice(idx, 1);
        saveCart(cart);
        renderCartDrawer();
        showToast(`تمت إزالة «${name}» من الحقيبة.`);
      }
      return;
    }
  });

  // 9. Product Modal Details & Controls
  $("#modal-close")?.addEventListener("click", closeProductModal);
  $("#modal-backdrop")?.addEventListener("click", closeProductModal);

  // Modal Gallery Swatches
  $("#modal-swatches")?.addEventListener("click", (e) => {
    const thumb = e.target.closest(".modal-swatch-thumb");
    if (!thumb || !modalProduct) return;
    const idx = Number(thumb.dataset.index);
    modalSelectedImageIndex = idx;
    const images = Array.isArray(modalProduct.images) ? modalProduct.images : [];
    if (images[idx]) {
      const mainImg = $("#modal-main-image");
      if (mainImg) mainImg.src = images[idx].imageUrl;
      $$(".modal-swatch-thumb").forEach(t => t.classList.toggle("is-active", t === thumb));
    }
  });

  // Modal Quantity
  $("#modal-qty-minus")?.addEventListener("click", () => {
    if (modalQuantity > 1) {
      modalQuantity -= 1;
      $("#modal-qty-display").textContent = modalQuantity;
    }
  });
  $("#modal-qty-plus")?.addEventListener("click", () => {
    if (modalQuantity < 10) {
      modalQuantity += 1;
      $("#modal-qty-display").textContent = modalQuantity;
    }
  });

  // Modal Add to Cart
  $("#modal-add-cart-btn")?.addEventListener("click", () => {
    if (!modalProduct) return;
    const images = Array.isArray(modalProduct.images) ? modalProduct.images : [];
    const selectedImg = images[modalSelectedImageIndex]?.imageUrl || modalProduct.imageUrl;
    const selectedColor = images[modalSelectedImageIndex]?.colorLabel || "";
    addToCart(modalProduct, selectedImg, selectedColor, modalQuantity);
    closeProductModal();
  });

  // 10. Checkout Form & Modal Controls
  $("#checkout-close")?.addEventListener("click", closeCheckoutModal);
  $("#checkout-backdrop")?.addEventListener("click", closeCheckoutModal);
  $("#checkout-form")?.addEventListener("submit", handleCheckoutSubmit);
  $("#success-continue-btn")?.addEventListener("click", closeCheckoutModal);

  // 11. ESC Key closes open overlays
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeCartDrawer();
      closeProductModal();
      closeCheckoutModal();
    }
  });

  // 12. Mobile Menu Toggle
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

  // 13. Real-Time Settings & Catalog Sync from Admin Portal
  window.addEventListener("daffa:settings-updated", (e) => {
    applyStoreSettings(e.detail);
  });

  window.addEventListener("daffa:products-updated", (e) => {
    allProducts = e.detail;
    renderCatalog();
    renderCategoryTabs();
  });

  window.addEventListener("daffa:ticker-updated", () => {
    renderNewsTicker();
  });
});
