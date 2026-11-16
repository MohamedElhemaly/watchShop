import "./style.css";
import { schedulePromotionRefresh, startPromotionCountdowns } from "./promotions.js";

const catalogGrid = document.querySelector("#catalog-grid");
let publicContacts = { phoneNumber: "", whatsappNumber: "" };

const safeText = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character]));

function formatPrice(value) {
  return new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function validStoredNumber(value) {
  const number = String(value || "").trim();
  return /^\+[1-9]\d{7,14}$/.test(number) ? number : "";
}

function setContactLink(selector, href, label) {
  const link = document.querySelector(selector);
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
  publicContacts = {
    phoneNumber: validStoredNumber(settings.phoneNumber),
    whatsappNumber: validStoredNumber(settings.whatsappNumber),
  };

  const whatsappDigits = publicContacts.whatsappNumber.replace(/\D/g, "");
  const whatsappUrl = whatsappDigits ? `https://wa.me/${whatsappDigits}` : "";
  const phoneUrl = publicContacts.phoneNumber ? `tel:${publicContacts.phoneNumber}` : "";
  const whatsappLabel = publicContacts.whatsappNumber ? `واتساب: ${publicContacts.whatsappNumber}` : "";
  const phoneLabel = publicContacts.phoneNumber ? `اتصال: ${publicContacts.phoneNumber}` : "";

  setContactLink("#order-whatsapp-link", whatsappUrl, whatsappLabel);
  setContactLink("#order-phone-link", phoneUrl, phoneLabel);
  setContactLink("#footer-whatsapp-link", whatsappUrl, whatsappLabel);
  setContactLink("#footer-phone-link", phoneUrl, phoneLabel);

  const hasContact = Boolean(whatsappUrl || phoneUrl);
  const orderLinks = document.querySelector("#ordering-contact-links");
  const footerLinks = document.querySelector("#footer-contact-links");
  if (orderLinks) orderLinks.hidden = !hasContact;
  if (footerLinks) footerLinks.hidden = !hasContact;
}

function makeOrderUrl(productName) {
  const number = publicContacts.whatsappNumber.replace(/\D/g, "");
  if (!number) return "";
  const message = encodeURIComponent(`مرحبًا صُدْفَة، حابب أستفسر عن ساعة ${productName}. ممكن أعرف التوفر والسعر والشحن؟`);
  return `https://wa.me/${number}?text=${message}`;
}

function renderPrice(product) {
  const basePrice = Number(product.basePrice);
  const discountPercent = Number(product.discountPercent) || 0;
  const salePrice = Number(product.salePrice);
  const discountActive = Boolean(product.discountActive) && discountPercent > 0;
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    return '<p class="product-price pending-price">السعر يُعلن قريبًا</p>';
  }
  if (discountActive && Number.isFinite(salePrice)) {
    const reason = String(product.discountReason || "").trim();
    const reasonMarkup = reason ? `<span class="discount-reason">${safeText(reason)}</span>` : "";
    const countdownMarkup = product.discountEndOn
      ? `<small class="discount-countdown" data-promotion-countdown data-discount-end="${safeText(product.discountEndOn)}" aria-label="الوقت المتبقي حتى انتهاء العرض" aria-live="off"></small>`
      : "";
    return `<div class="product-price product-price-discounted" aria-label="السعر بعد الخصم">
      <span class="price-before"><del aria-label="السعر قبل الخصم">${formatPrice(basePrice)} <small>ج.م</small></del></span>
      <span class="sale-badge">خصم ${formatPrice(discountPercent)}%</span>
      <span class="sale-price-bubble"><small>السعر بعد الخصم</small><strong class="price-after">${formatPrice(salePrice)} <small>ج.م</small></strong></span>
      ${reasonMarkup}
      ${countdownMarkup}
    </div>`;
  }
  return `<p class="product-price">${formatPrice(basePrice)} <small>ج.م</small></p>`;
}

function renderProduct(product, index) {
  const detailUrl = `/product.html?id=${encodeURIComponent(product.id)}`;
  const image = product.imageUrl
    ? `<a class="product-visual-link" href="${safeText(detailUrl)}" aria-label="عرض تفاصيل ${safeText(product.name)}"><img class="product-image" src="${safeText(product.imageUrl)}" alt="${safeText(product.imageAlt || product.name)}" loading="lazy" decoding="async" /></a>`
    : `<a class="product-visual-link" href="${safeText(detailUrl)}" aria-label="عرض تفاصيل ${safeText(product.name)}"><span class="product-placeholder" aria-hidden="true"><span>صُدْفَة</span><i>✳</i></span></a>`;
  const title = `<a class="product-title-link" href="${safeText(detailUrl)}">${safeText(product.name)}</a>`;
  const fullDescription = String(product.description || "");
  const descriptionPreview = fullDescription.length > 150 ? `${fullDescription.slice(0, 150).trimEnd()}…` : fullDescription;
  const href = makeOrderUrl(product.name);
  const action = href
    ? `<a class="product-order" href="${href}" target="_blank" rel="noopener noreferrer">اطلب على واتساب <span aria-hidden="true">↖</span></a>`
    : '<span class="product-order product-order-disabled" aria-disabled="true">واتساب الطلبات قريبًا</span>';
  const detailAction = `<a class="product-order product-detail-link" href="${safeText(detailUrl)}">التفاصيل والألوان <span aria-hidden="true">←</span></a>`;
  const productNumber = String(index + 1).padStart(2, "0");
  return `<article class="product-card"><div class="product-visual">${image}<span class="product-index">${productNumber}</span></div><div class="product-details"><div><h3>${title}</h3><p class="product-description">${safeText(descriptionPreview)}</p></div>${renderPrice(product)}${detailAction}${action}</div></article>`;
}

function showCatalogError() {
  catalogGrid.innerHTML = '<div class="empty-state"><span class="empty-orbit" aria-hidden="true"><i></i></span><p class="empty-kicker">لحظة ونرجعلك</p><h3>التشكيلة مش متاحة دلوقتي</h3><p>حصلت مشكلة مؤقتة في تحميل الساعات. جرّب تحدّث الصفحة بعد شوية.</p></div>';
}

function renderCategorySection(title, categoryProducts, indexState, isUnclassified = false) {
  const content = categoryProducts.length
    ? `<div class="category-products">${categoryProducts.map((product) => renderProduct(product, indexState.value++)).join("")}</div>`
    : '<p class="category-coming-soon" lang="en">Coming soon</p>';
  return `<section class="catalog-category${isUnclassified ? " is-unclassified" : ""}"><div class="catalog-category-heading"><h3>${safeText(title)}</h3></div>${content}</section>`;
}

async function readJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Request failed: ${url}`);
  return response.json();
}

async function renderCatalog() {
  const [productsResult, settingsResult, categoriesResult] = await Promise.allSettled([
    readJson("/api/products"),
    readJson("/api/settings"),
    readJson("/api/categories"),
  ]);

  renderContactLinks(settingsResult.status === "fulfilled" ? settingsResult.value.settings : {});
  if (productsResult.status !== "fulfilled" || categoriesResult.status !== "fulfilled") {
    showCatalogError();
    return;
  }

  const products = Array.isArray(productsResult.value.products) ? productsResult.value.products : [];
  const categories = Array.isArray(categoriesResult.value.categories) ? categoriesResult.value.categories : [];
  schedulePromotionRefresh(products, productsResult.value.serverNow);
  if (!products.length && !categories.length) return;
  document.querySelector("#catalog-title").innerHTML = "التشكيلة <em>اختار على مهلك</em>";
  const categoryIds = new Set(categories.map((category) => category.id));
  const indexState = { value: 0 };
  const sections = categories.map((category) => renderCategorySection(
    category.name,
    products.filter((product) => product.categoryId === category.id),
    indexState,
  ));
  const unclassifiedProducts = products.filter((product) => !product.categoryId || !categoryIds.has(product.categoryId));
  if (unclassifiedProducts.length) sections.push(renderCategorySection("غير مصنفة", unclassifiedProducts, indexState, true));
  catalogGrid.innerHTML = sections.join("");
  startPromotionCountdowns(catalogGrid, productsResult.value.serverNow);
}

renderCatalog();
document.querySelector("#year").textContent = new Date().getFullYear();

const menuButton = document.querySelector(".menu-toggle");
const nav = document.querySelector(".site-nav");
menuButton.addEventListener("click", () => {
  const expanded = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!expanded));
  menuButton.setAttribute("aria-label", expanded ? "فتح القائمة" : "إغلاق القائمة");
  nav.classList.toggle("is-open", !expanded);
});
nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
  nav.classList.remove("is-open");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "فتح القائمة");
}));
