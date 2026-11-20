// Sodfa (صُدْفَة) - Customer Order Tracking Portal Controller (2026)
// Provides a real-time, reassuring order tracking experience across Mobile & Desktop.

import {
  getOrders,
  getStoreSettings,
  formatDeliveryTimeline,
  formatWhatsAppPhone,
  buildWhatsAppUrl,
  isValidWhatsAppPhone,
} from "./data.js";
import { pullCloudState } from "./cloudSync.js";
import { resolveMediaUrl } from "./mediaStorage.js";

const $ = (selector) => document.querySelector(selector);
const safeText = (value = "") =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));

function formatEgp(amount) {
  return new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(Number(amount) || 0);
}

/**
 * Normalizes input query for order reference or phone number search
 */
export function normalizeOrderQuery(rawQuery) {
  if (!rawQuery) return "";
  return String(rawQuery)
    .trim()
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}

/**
 * Determines whether an order matches a given search query (by Order ID or Phone)
 */
export function orderMatchesQuery(order, query) {
  if (!order || !query) return false;
  const cleanQ = normalizeOrderQuery(query).toLowerCase();
  const orderId = String(order.id || "").toLowerCase();

  // 1. Direct ID match or stripped prefix match (#DAF-1042, DAF-1042, 1042, #SDF-1042)
  const cleanId = orderId.replace(/^[#]?(daf-|sdf-)?/i, "").trim();
  const strippedQ = cleanQ.replace(/^[#]?(daf-|sdf-)?/i, "").trim();

  if (orderId === cleanQ || cleanId === strippedQ) {
    return true;
  }

  // 2. Phone Number match
  const orderPhoneClean = formatWhatsAppPhone(order.phone || "");
  const queryPhoneClean = formatWhatsAppPhone(cleanQ);

  if (queryPhoneClean && orderPhoneClean) {
    if (orderPhoneClean === queryPhoneClean || orderPhoneClean.endsWith(queryPhoneClean)) {
      return true;
    }
  }

  if (order.phone && String(order.phone).includes(cleanQ)) {
    return true;
  }

  return false;
}

/**
 * Computes step timeline progress from order status
 */
export function getOrderStepState(status = "") {
  const norm = String(status).toLowerCase().trim();

  if (norm === "cancelled" || norm === "ملغي" || norm === "ملغى") {
    return { isCancelled: true, activeStep: 0, completedSteps: [] };
  }

  if (norm === "delivered" || norm === "تم التسليم" || norm === "مكتمل") {
    return { isCancelled: false, activeStep: 4, completedSteps: [1, 2, 3, 4] };
  }

  if (norm === "shipping" || norm === "جاري الشحن" || norm === "تم الشحن" || norm === "مع المندوب") {
    return { isCancelled: false, activeStep: 3, completedSteps: [1, 2] };
  }

  if (norm === "confirmed" || norm === "تم التأكيد" || norm === "مؤكد") {
    return { isCancelled: false, activeStep: 2, completedSteps: [1] };
  }

  // Default: "new" / "تم استلام الطلب"
  return { isCancelled: false, activeStep: 1, completedSteps: [] };
}

/**
 * Renders the 4-step progressive timeline HTML
 */
function renderTimelineHtml(status) {
  const { isCancelled, activeStep, completedSteps } = getOrderStepState(status);

  if (isCancelled) {
    return `
      <div class="track-cancelled-notice">
        <span style="font-size: 24px;">⚠️</span>
        <div>
          <strong>حالة الطلب: تم الإلغاء</strong>
          تم إلغاء هذا الطلب. إذا كان لديك أي استفسار أو ترغب في إعادة تأكيد طلبك، يمكنك التواصل مباشرة مع خدمة العملاء.
        </div>
      </div>
    `;
  }

  const steps = [
    { num: 1, title: "تم استلام الطلب", desc: "تم تسجيل طلبك بنجاح في النظام" },
    { num: 2, title: "تم التأكيد", desc: "تمت مراجعة بيانات الشحن والتجهيز" },
    { num: 3, title: "جاري الشحن", desc: "الشحنة مع مندوب التوصيل في طريقها إليك" },
    { num: 4, title: "تم التسليم", desc: "تم استلام الساعة والمعاينة بنجاح" },
  ];

  return `
    <div class="track-stepper-wrap">
      <div class="track-stepper">
        ${steps.map((s) => {
          const isDone = completedSteps.includes(s.num);
          const isActive = activeStep === s.num && !isDone;
          const stateClass = isDone ? "is-completed" : isActive ? "is-active" : "is-pending";
          const icon = isDone ? "✓" : s.num;
          return `
            <div class="track-step ${stateClass}">
              <div class="track-step-dot" aria-hidden="true">${icon}</div>
              <span class="track-step-label">${safeText(s.title)}</span>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

/**
 * Renders a single complete order detail card
 */
async function renderSingleOrderDetail(order, container) {
  if (!order || !container) return;

  const settings = getStoreSettings();
  const deliveryTimeline = formatDeliveryTimeline(settings.deliveryMinDays, settings.deliveryMaxDays, settings.deliveryUnitText);
  const cleanWa = formatWhatsAppPhone(settings.defaultWhatsapp || "");

  const displayId = String(order.id).startsWith("#") ? order.id : `#${order.id}`;
  const dateFormatted = order.createdAt
    ? new Date(order.createdAt).toLocaleDateString("ar-EG", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "طلب حديث";

  // Resolve item images
  const items = Array.isArray(order.items) ? order.items : [];
  const resolvedItems = await Promise.all(
    items.map(async (item) => {
      let resolvedImg = item.image || item.imageUrl || "/sodfa-promo-poster.jpg";
      if (resolvedImg.startsWith("media://")) {
        resolvedImg = await resolveMediaUrl(resolvedImg);
      }
      return { ...item, resolvedImg };
    })
  );

  // Status Badge
  const { isCancelled, activeStep } = getOrderStepState(order.status);
  let statusBadgeClass = "status-badge-new";
  let statusBadgeText = "تم استلام الطلب";

  if (isCancelled) {
    statusBadgeClass = "status-badge-cancelled";
    statusBadgeText = "ملغي";
  } else if (activeStep === 4) {
    statusBadgeClass = "status-badge-delivered";
    statusBadgeText = "تم التسليم بنجاح ✓";
  } else if (activeStep === 3) {
    statusBadgeClass = "status-badge-shipping";
    statusBadgeText = "جاري الشحن مع المندوب 🚚";
  } else if (activeStep === 2) {
    statusBadgeClass = "status-badge-confirmed";
    statusBadgeText = "تم التأكيد وجاري التجهيز";
  }

  // WhatsApp Support URL
  const waMsg = `مرحبًا ${settings.brandName || "صُدْفَة"}، أستفسر عن حالة طلبي رقم ${displayId}.`;
  const waUrl = cleanWa ? buildWhatsAppUrl(cleanWa, waMsg) : "";

  container.innerHTML = `
    <article class="track-order-card">
      <!-- Meta Header -->
      <div class="track-meta-header">
        <div class="track-meta-main">
          <div class="track-meta-id-badge">
            <span class="track-ref-label">رقم الطلب:</span>
            <strong class="track-ref-number">${safeText(displayId)}</strong>
          </div>
          <span class="track-meta-date">${safeText(dateFormatted)}</span>
        </div>
        <span class="track-current-status-badge ${statusBadgeClass}">
          ${safeText(statusBadgeText)}
        </span>
      </div>

      <!-- Stepper Progress Tracker -->
      ${renderTimelineHtml(order.status)}

      <!-- Delivery Estimate Banner -->
      <div class="track-delivery-banner">
        <div class="track-delivery-banner-info">
          <span>🚚 موعد التوصيل المتوقع:</span>
          <strong>${safeText(deliveryTimeline)}</strong>
        </div>
        <span class="track-delivery-dest">${safeText(order.governorate || "كافة المحافظات")}</span>
      </div>

      <!-- Customer & Shipping Address Info -->
      <div class="track-address-card" style="font-size: 13px; color: var(--ink-muted); line-height: 1.6; background: #faf8f5; padding: 12px 16px; border-radius: 8px;">
        <div><strong>المستلم:</strong> ${safeText(order.customerName || order.name || "عميل كريم")} • <strong>الهاتف:</strong> <span dir="ltr">${safeText(order.phone || "")}</span></div>
        <div><strong>عنوان التسليم:</strong> ${safeText([order.governorate, order.city, order.address].filter(Boolean).join("، ") || "العنوان المسجل")}</div>
        ${order.notes ? `<div><strong>ملاحظات التسليم:</strong> ${safeText(order.notes)}</div>` : ""}
      </div>

      <!-- Items in Order -->
      <div class="track-items-list">
        ${resolvedItems.map((item) => `
          <div class="track-item-row">
            <div class="track-item-thumb-title">
              <img class="track-item-img" src="${safeText(item.resolvedImg)}" alt="${safeText(item.name)}" />
              <div class="track-item-info">
                <h5>${safeText(item.name)}</h5>
                ${item.color || item.variant ? `<span class="track-item-variant">اللون: ${safeText(item.color || item.variant)}</span>` : ""}
              </div>
            </div>
            <div class="track-item-price-col">
              <span class="track-item-qty">${item.quantity || 1} قطعة</span>
              <strong class="track-item-total">${formatEgp(item.price || item.unitPrice || 0)} ج.م</strong>
            </div>
          </div>
        `).join("")}
      </div>

      <!-- Financial Total -->
      <div class="track-total-row">
        <div>
          <span class="track-total-label">إجمالي المستحق عند الاستلام:</span>
          <span class="track-cod-tag">شحن مجاني لكافة المحافظات • الدفع بعد المعاينة والفحص</span>
        </div>
        <strong class="track-total-amount">${formatEgp(order.totalAmount || 0)} ج.م</strong>
      </div>

      <!-- WhatsApp Help Button -->
      <a 
        class="track-whatsapp-cta" 
        id="track-whatsapp-help-btn"
        href="${waUrl || "#"}" 
        target="${waUrl ? "_blank" : "_self"}" 
        rel="noopener noreferrer"
        data-has-wa="${Boolean(waUrl)}"
      >
        <span>تواصل مع خدمة العملاء بخصوص هذا الطلب 💬</span>
      </a>
    </article>
  `;

  // Bind click for WhatsApp alerting if unconfigured
  const helpBtn = container.querySelector("#track-whatsapp-help-btn");
  if (helpBtn) {
    helpBtn.addEventListener("click", (e) => {
      if (!helpBtn.dataset.hasWa || helpBtn.dataset.hasWa === "false") {
        e.preventDefault();
        alert("رقم واتساب المتجر غير مضبوط حاليًا. يرجى التواصل عبر الاتصال الهاتفي أو مراجعة إدارة المتجر.");
      }
    });
  }
}

/**
 * Main Controller for Order Tracking Portal
 */
export function initOrderTracker() {
  const modal = $("#order-tracking-modal");
  const closeBtn = $("#track-modal-close-btn");
  const form = $("#track-search-form");
  const input = $("#track-search-input");
  const resultsContainer = $("#track-results-container");

  if (!modal || !form || !input || !resultsContainer) return;

  function closeModal() {
    modal.classList.remove("is-open");
    document.body.classList.remove("modal-open");
    setTimeout(() => {
      modal.hidden = true;
    }, 240);
  }

  function openModal(prefill = "") {
    modal.hidden = false;
    document.body.classList.add("modal-open");
    setTimeout(() => {
      modal.classList.add("is-open");
      input.focus();
    }, 10);

    if (prefill) {
      input.value = prefill;
      executeSearch(prefill);
    }
  }

  async function executeSearch(query) {
    const cleanQ = normalizeOrderQuery(query);
    if (!cleanQ) {
      input.focus();
      return;
    }

    // Show loading spinner
    resultsContainer.innerHTML = `
      <div class="track-loading-state">
        <div class="track-spinner" aria-hidden="true"></div>
        <p>جاري البحث في سجلات الشحن والسحابة...</p>
      </div>
    `;

    // 1. Query Serverless backend /api/orders?query=... directly for real-time cross-device sync
    let matching = [];
    let cloudFound = false;
    try {
      const res = await fetch(`/api/orders?query=${encodeURIComponent(cleanQ)}&t=${Date.now()}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (res.ok) {
        const json = await res.json();
        if (json && json.ok && Array.isArray(json.orders)) {
          matching = json.orders;
          cloudFound = true;
          // Sync found orders into local cache
          if (matching.length > 0) {
            const currentOrders = getOrders();
            const map = new Map(currentOrders.map((o) => [String(o.id), o]));
            matching.forEach((o) => map.set(String(o.id), o));
            saveOrders(Array.from(map.values()));
          }
        }
      }
    } catch {}

    // Fallback to local / cached orders if cloud query was unavailable
    if (!cloudFound) {
      try {
        const cloudOrders = await pullCloudState("orders");
        if (Array.isArray(cloudOrders) && cloudOrders.length > 0) {
          localStorage.setItem("daffa_orders", JSON.stringify(cloudOrders));
        }
      } catch {}

      const allOrders = getOrders();
      matching = allOrders.filter((order) => orderMatchesQuery(order, cleanQ));
    }

    // Handle 0 results
    if (matching.length === 0) {
      const settings = getStoreSettings();
      const cleanWa = formatWhatsAppPhone(settings.defaultWhatsapp || "");
      const helpUrl = cleanWa ? buildWhatsAppUrl(cleanWa, `مرحبًا، أبحث عن طلبي ولم أجده بالبحث: ${cleanQ}`) : "";

      resultsContainer.innerHTML = `
        <div class="track-empty-state">
          <span class="track-empty-icon" aria-hidden="true">🔍</span>
          <h4>لم نتمكن من العثور على طلب مطابق</h4>
          <p>
            تأكد من إدخال رقم الطلب بشكل صحيح كما ظهر في إيصال الشراء (مثال: <code>DAF-1042</code> أو <code>1042</code>)، أو كتابة نفس رقم الهاتف المحمول المسجل عند تأكيد الطلب.
          </p>
          <a class="track-whatsapp-cta" style="margin-top: 12px; width: auto; padding: 10px 20px;" href="${helpUrl || "#"}" target="_blank" rel="noopener noreferrer">
            تواصل مع خدمة العملاء للمساعدة 💬
          </a>
        </div>
      `;
      return;
    }

    // Handle 1 result
    if (matching.length === 1) {
      renderSingleOrderDetail(matching[0], resultsContainer);
      return;
    }

    // Handle multiple results (e.g. customer entered phone with multiple orders)
    resultsContainer.innerHTML = `
      <div class="track-multi-orders">
        <h4 class="track-multi-heading">تم العثور على ${matching.length} طلبات مسجلة لهذا الرقم:</h4>
        ${matching.map((ord, idx) => {
          const displayId = String(ord.id).startsWith("#") ? ord.id : `#${ord.id}`;
          const dateStr = ord.createdAt ? new Date(ord.createdAt).toLocaleDateString("ar-EG") : "";
          const { activeStep, isCancelled } = getOrderStepState(ord.status);
          const statusText = isCancelled ? "ملغي" : activeStep === 4 ? "تم التسليم" : activeStep === 3 ? "جاري الشحن" : activeStep === 2 ? "تم التأكيد" : "تم الاستلام";
          return `
            <button type="button" class="track-order-choice-card" data-order-idx="${idx}">
              <div class="track-choice-info">
                <span class="track-choice-id">${safeText(displayId)}</span>
                <span class="track-choice-date">${safeText(dateStr)} • ${formatEgp(ord.totalAmount)} ج.م</span>
              </div>
              <span class="track-choice-status-pill status-badge-${isCancelled ? "cancelled" : activeStep === 4 ? "delivered" : activeStep === 3 ? "shipping" : "confirmed"}">
                ${safeText(statusText)} ←
              </span>
            </button>
          `;
        }).join("")}
      </div>
    `;

    // Bind choice cards
    resultsContainer.querySelectorAll(".track-order-choice-card").forEach((card) => {
      card.addEventListener("click", () => {
        const idx = Number(card.dataset.orderIdx);
        if (matching[idx]) {
          renderSingleOrderDetail(matching[idx], resultsContainer);
        }
      });
    });
  }

  // Form submit
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    executeSearch(input.value);
  });

  // Modal open triggers
  $("#header-track-order-btn")?.addEventListener("click", () => openModal());
  $("#nav-track-order-btn")?.addEventListener("click", () => openModal());
  $("#footer-track-order-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    openModal();
  });
  $("#success-track-order-btn")?.addEventListener("click", () => {
    const successRef = $("#success-order-id")?.textContent?.trim() || "";
    openModal(successRef);
  });

  // Close triggers
  closeBtn?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("is-open")) {
      closeModal();
    }
  });

  // Expose global open helper
  window.openOrderTracking = openModal;
}
