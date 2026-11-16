import "./style.css";
import "./product.css";
import { schedulePromotionRefresh, startPromotionCountdowns } from "./promotions.js";
import { getCart, saveCart, getStoredProducts, storeSettings } from "./data.js";

const $ = (selector) => document.querySelector(selector);
const safeText = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character]));

let currentProduct;
let currentImages = [];
let selectedImageIndex = 0;
let publicContacts = { phoneNumber: "", whatsappNumber: "" };

function formatPrice(value) {
  return new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function validStoredNumber(value) {
  const number = String(value || "").trim();
  return /^\+[1-9]\d{7,14}$/.test(number) ? number : "";
}

function renderPrice(product) {
  const basePrice = Number(product.basePrice);
  const discountPercent = Number(product.discountPercent) || 0;
  const salePrice = Number(product.salePrice);
  const discountActive = Boolean(product.discountActive) && discountPercent > 0;
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

function specificationLines(description) {
  return String(description || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:[-*•–—]+\s*)/, ""))
    .filter(Boolean);
}

function visibleImages(product) {
  const images = Array.isArray(product.images)
    ? product.images.filter((image) => image && typeof image.imageUrl === "string" && image.imageUrl)
    : [];
  if (images.length) return images;
  return product.imageUrl ? [{ imageUrl: product.imageUrl, imageAlt: product.imageAlt || product.name, colorLabel: "" }] : [];
}

function imageName(image, index) {
  return String(image.colorLabel || "").trim() || `اللون ${new Intl.NumberFormat("ar-EG").format(index + 1)}`;
}

function selectImage(index) {
  selectedImageIndex = index;
  const image = currentImages[index];
  if (!image) return;
  const mainImage = $("#detail-main-image");
  mainImage.src = image.imageUrl;
  mainImage.alt = image.imageAlt || `${currentProduct.name} — ${imageName(image, index)}`;
  const color = String(image.colorLabel || "").trim();
  const selectedColor = $("#detail-selected-color");
  selectedColor.textContent = color ? `اللون المختار: ${color}` : "";
  selectedColor.hidden = !color;
  document.querySelectorAll(".gallery-choice").forEach((button, buttonIndex) => {
    const selected = buttonIndex === index;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  updateOrderLinks();
}

function renderGallery(product) {
  currentImages = visibleImages(product);
  const gallery = $("#detail-gallery-options");
  gallery.innerHTML = "";
  if (!currentImages.length) {
    $(".detail-gallery-column").hidden = true;
    return;
  }
  $(".detail-gallery-column").hidden = false;
  gallery.innerHTML = currentImages.map((image, index) => {
    const label = imageName(image, index);
    const alt = image.imageAlt || `${product.name} — ${label}`;
    return `<button class="gallery-choice" type="button" data-image-index="${index}" aria-pressed="false" aria-label="عرض ${safeText(label)}">
      <img src="${safeText(image.imageUrl)}" alt="" loading="lazy" decoding="async" />
      <span>${safeText(label)}</span>
    </button>`;
  }).join("");
  gallery.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-image-index]");
    if (!button) return;
    selectImage(Number(button.dataset.imageIndex));
  });
  selectImage(0);
}

function updateOrderLinks() {
  if (!currentProduct) return;
  const image = currentImages[selectedImageIndex];
  const selectedColor = image ? String(image.colorLabel || "").trim() : "";
  const colorPhrase = selectedColor ? ` باللون ${selectedColor}` : "";
  const whatsapp = $("#detail-whatsapp");
  const phone = $("#detail-phone");
  const noContact = $("#detail-no-contact");

  if (publicContacts.whatsappNumber) {
    const digits = publicContacts.whatsappNumber.replace(/\D/g, "");
    const message = encodeURIComponent(`مرحبًا صُدْفَة، أستفسر عن ${currentProduct.name}${colorPhrase}. ممكن أعرف التوفر؟`);
    whatsapp.href = `https://wa.me/${digits}?text=${message}`;
    whatsapp.hidden = false;
  } else {
    whatsapp.hidden = true;
    whatsapp.removeAttribute("href");
  }

  if (publicContacts.phoneNumber) {
    phone.href = `tel:${publicContacts.phoneNumber}`;
    phone.hidden = false;
  } else {
    phone.hidden = true;
    phone.removeAttribute("href");
  }
  noContact.hidden = Boolean(publicContacts.whatsappNumber || publicContacts.phoneNumber);
}

function renderProduct(product, serverNow) {
  currentProduct = product;
  schedulePromotionRefresh([product], serverNow);
  currentImages = visibleImages(product);
  document.title = `${product.name} | صُدْفَة`;
  const descriptionMeta = document.querySelector('meta[name="description"]');
  if (descriptionMeta) descriptionMeta.content = String(product.description || `تفاصيل ساعة ${product.name} من صُدْفَة`).slice(0, 160);
  $("#detail-name").textContent = product.name;
  $("#detail-price").innerHTML = renderPrice(product);
  startPromotionCountdowns($("#detail-price"), serverNow);

  const lines = specificationLines(product.description);
  const specifications = $("#detail-specifications");
  const specificationsSection = $("#detail-specifications-section");
  specifications.innerHTML = lines.map((line) => `<li>${safeText(line)}</li>`).join("");
  specificationsSection.hidden = lines.length === 0;

  $("#product-loading").hidden = true;
  $("#product-error").hidden = true;
  $("#product-detail").hidden = false;
  renderGallery(product);
  updateOrderLinks();
}

async function loadContacts() {
  try {
    const response = await fetch("/api/settings", { headers: { Accept: "application/json" } });
    if (response.ok) {
      const data = await response.json();
      const settings = data.settings || {};
      publicContacts = {
        phoneNumber: validStoredNumber(settings.phoneNumber) || storeSettings.defaultPhone,
        whatsappNumber: validStoredNumber(settings.whatsappNumber) || storeSettings.defaultWhatsapp,
      };
      updateOrderLinks();
      return;
    }
  } catch {
    // API unavailable
  }
  publicContacts = {
    phoneNumber: storeSettings.defaultPhone,
    whatsappNumber: storeSettings.defaultWhatsapp,
  };
  updateOrderLinks();
}

async function loadProduct() {
  const id = new URLSearchParams(window.location.search).get("id") || "";
  if (!id) {
    $("#product-loading").hidden = true;
    $("#product-error").hidden = false;
    return;
  }

  // Check local curated products
  const localProducts = getStoredProducts();
  const localMatch = localProducts.find((p) => p.id === id);

  try {
    const response = await fetch(`/api/products/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } });
    if (response.ok) {
      const data = await response.json();
      if (data.product) {
        renderProduct(data.product, data.serverNow);
        await loadContacts();
        return;
      }
    }
  } catch (err) {
    console.warn("API load failed, falling back to local catalog:", err);
  }

  if (localMatch) {
    renderProduct(localMatch, new Date().toISOString());
    await loadContacts();
    return;
  }

  $("#product-loading").hidden = true;
  $("#product-error").hidden = false;
}

function updateCartBadge() {
  const cart = getCart();
  const count = cart.reduce((sum, item) => sum + (item.quantity || 1), 0);
  const badge = $("#detail-cart-badge");
  if (badge) {
    badge.textContent = count;
    badge.classList.toggle("is-active", count > 0);
  }
}

function initCartActions() {
  updateCartBadge();
  let quantity = 1;
  const qtyVal = $("#detail-qty-val");
  const minusBtn = $("#detail-qty-minus");
  const plusBtn = $("#detail-qty-plus");
  const addBtn = $("#detail-add-cart-btn");
  const feedback = $("#detail-add-feedback");

  minusBtn?.addEventListener("click", () => {
    if (quantity > 1) {
      quantity -= 1;
      if (qtyVal) qtyVal.textContent = quantity;
    }
  });

  plusBtn?.addEventListener("click", () => {
    if (quantity < 10) {
      quantity += 1;
      if (qtyVal) qtyVal.textContent = quantity;
    }
  });

  addBtn?.addEventListener("click", () => {
    if (!currentProduct) return;
    const cart = getCart();
    const image = currentImages[selectedImageIndex];
    const selectedColor = image ? String(image.colorLabel || "").trim() : "";
    const selectedImg = image ? image.imageUrl : currentProduct.imageUrl;
    const effectivePrice = (currentProduct.discountActive && Number(currentProduct.discountPercent) > 0)
      ? Number(currentProduct.salePrice)
      : Number(currentProduct.basePrice);

    const existingIndex = cart.findIndex(
      (item) => item.id === currentProduct.id && (item.color || "") === selectedColor
    );

    if (existingIndex > -1) {
      cart[existingIndex].quantity += quantity;
    } else {
      cart.push({
        id: currentProduct.id,
        name: currentProduct.name,
        price: effectivePrice,
        basePrice: Number(currentProduct.basePrice),
        image: selectedImg,
        color: selectedColor,
        quantity: quantity,
      });
    }

    saveCart(cart);
    updateCartBadge();

    if (feedback) {
      feedback.hidden = false;
      feedback.innerHTML = `تمت إضافة <strong>${quantity}</strong> من <strong>${safeText(currentProduct.name)}</strong> إلى الحقيبة بنجاح. <a class="detail-feedback-link" href="/?openCart=true#catalog">عرض الحقيبة ←</a>`;
      setTimeout(() => {
        feedback.hidden = true;
      }, 5000);
    }
  });
}

initCartActions();
loadProduct();
