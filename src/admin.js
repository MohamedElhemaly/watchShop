import "./admin.css";
import { calculateDiscountedPrice, formatEgpNumber } from "./pricing.js";

const $ = (selector) => document.querySelector(selector);
const loginPanel = $("#login-panel");
const loadingPanel = $("#loading-panel");
const workspace = $("#workspace");
const list = $("#product-list");
const form = $("#product-form");
const formError = $("#form-error");
const fileInput = $("#product-images");
const galleryEditor = $("#image-gallery-editor");
let csrfToken = "";
let products = [];
let categories = [];
let editingId = "";
let activeFilter = "all";
let toastTimer;
let galleryImages = [];
let isSaving = false;
let isSavingSettings = false;
let isSavingCategory = false;

const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character]));

function formatPrice(value) {
  return `${formatEgpNumber(value)} ج.م`;
}

function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return "—";
  const [, year, month, day] = match;
  return new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3400);
}

function showLogin(message = "") {
  loadingPanel.hidden = true;
  workspace.hidden = true;
  loginPanel.hidden = false;
  if (message) showToast(message, true);
}

async function requestJson(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body && !(options.body instanceof Blob)) headers.set("Content-Type", "application/json");
  if (csrfToken && options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    showLogin("انتهت جلسة الدخول؛ سجّل الدخول مرة أخرى.");
    throw new Error(data.error || "سجّل الدخول للمتابعة.");
  }
  if (!response.ok) {
    const details = Object.values(data.fields || {}).filter(Boolean).join(" ");
    throw new Error([data.error, details].filter(Boolean).join(" ") || "تعذر إكمال الطلب.");
  }
  return data;
}

function discountedPrice(product) {
  const base = Number(product.basePrice);
  const discount = Number(product.discountPercent) || 0;
  return calculateDiscountedPrice(base, discount);
}

function renderPricePreview() {
  const base = Number($("#base-price").value);
  const discount = Number($("#discount-percent").value) || 0;
  const startOn = $("#discount-start-on").value;
  const endOn = $("#discount-end-on").value;
  const reason = $("#discount-reason").value.trim();
  const price = $("#preview-price");
  const note = $("#preview-note");
  const box = $("#price-preview");
  box.classList.toggle("has-discount", discount > 0);
  if (!Number.isInteger(base) || base <= 0) {
    price.textContent = "—";
    note.textContent = "أدخل السعر لمعاينة السعر النهائي";
    return;
  }
  if (!Number.isInteger(discount) || discount < 0 || discount > 99) {
    price.textContent = "—";
    note.textContent = "نسبة الخصم من 0% إلى 99%";
    return;
  }
  if (discount > 0 && discount <= 99) {
    const finalPrice = calculateDiscountedPrice(base, discount);
    price.innerHTML = `<del>${formatPrice(base)}</del><strong>${formatPrice(finalPrice)}</strong>`;
    const schedule = startOn && endOn
      ? `من ${formatDate(startOn)} إلى ${formatDate(endOn)} شاملين`
      : "حدّد تاريخ البداية والنهاية";
    note.textContent = reason
      ? `عرض ${reason} — ${schedule} — بتوقيت القاهرة`
      : `خصم ${new Intl.NumberFormat("ar-EG").format(discount)}% — ${schedule} واكتب سبب العرض`;
  } else {
    price.textContent = formatPrice(base);
    note.textContent = "السعر الظاهر للزائر بدون خصم";
  }
}

function updateStats() {
  $("#total-count").textContent = new Intl.NumberFormat("ar-EG").format(products.length);
  $("#active-count").textContent = new Intl.NumberFormat("ar-EG").format(products.filter((item) => item.active).length);
  $("#discount-count").textContent = new Intl.NumberFormat("ar-EG").format(products.filter((item) => Number(item.discountPercent) > 0 && item.discountActive).length);
}

function renderProducts() {
  updateStats();
  const filtered = products.filter((product) => activeFilter === "all"
    || (activeFilter === "active" && product.active)
    || (activeFilter === "hidden" && !product.active));

  if (!filtered.length) {
    const hasAny = products.length > 0;
    list.innerHTML = `<div class="manager-empty"><span aria-hidden="true">✳</span><strong>${hasAny ? "مفيش ساعات في التصفية دي" : "لسه مفيش ساعات في الكتالوج"}</strong><p>${hasAny ? "غيّر التصفية لعرض موديلاتك." : "ابدأ بإضافة أول موديل، وبعدها قرر إمتى يظهر للزوار."}</p></div>`;
    return;
  }

  list.innerHTML = filtered.map((product) => {
    const categoryName = categories.find((category) => category.id === product.categoryId)?.name || "";
    const image = product.imageUrl
      ? `<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.imageAlt || product.name)}" loading="lazy" />`
      : `<span class="manager-placeholder" aria-hidden="true">صُدْفَة</span>`;
    const hasDiscount = Number(product.discountPercent) > 0;
    const discountActive = hasDiscount && Boolean(product.discountActive);
    const price = discountActive
      ? `<div class="manager-price"><del>${formatPrice(product.basePrice)}</del><strong>${formatPrice(discountedPrice(product))}</strong><span class="manager-discount">خصم ${new Intl.NumberFormat("ar-EG").format(product.discountPercent)}%</span></div>`
      : `<div class="manager-price"><strong>${formatPrice(product.basePrice)}</strong>${hasDiscount ? `<span class="manager-discount">خصم ${new Intl.NumberFormat("ar-EG").format(product.discountPercent)}% — غير نشط</span>` : ""}</div>`;
    const offerMeta = hasDiscount
      ? `<small class="manager-offer-meta">${escapeHtml(product.discountReason || "خصم قديم")} · ${formatDate(product.discountStartOn)} — ${formatDate(product.discountEndOn)}</small>`
      : "";
    return `<article class="manager-card" data-id="${escapeHtml(product.id)}">
      <div class="manager-image">${image}</div>
      <div class="manager-info"><div class="manager-meta"><span class="status-pill ${product.active ? "is-published" : "is-hidden"}">${product.active ? "معروضة" : "مخفية"}</span>${hasDiscount ? `<span class="status-pill is-sale">${discountActive ? "عرض نشط" : "عرض غير نشط"}</span>` : ""}</div>
        <h3>${escapeHtml(product.name)}</h3>${categoryName ? `<span class="manager-category">${escapeHtml(categoryName)}</span>` : ""}<p>${escapeHtml(product.description || "لا يوجد وصف بعد")}</p>${price}${offerMeta}
        <div class="manager-actions"><button type="button" class="mini-button" data-action="edit">تعديل</button><button type="button" class="mini-button" data-action="toggle">${product.active ? "إخفاء" : "عرض"}</button><button type="button" class="mini-button mini-button-danger" data-action="delete">حذف</button></div>
      </div>
    </article>`;
  }).join("");
}

async function loadProducts() {
  const data = await requestJson("/api/admin/products");
  products = data.products || [];
  renderProducts();
}

function renderCategories() {
  const selectedCategoryId = $("#product-category").value;
  const select = $("#product-category");
  select.innerHTML = `<option value="">بدون تصنيف</option>${categories.map((category) =>
    `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join("")}`;
  if (categories.some((category) => category.id === selectedCategoryId)) select.value = selectedCategoryId;

  const categoryList = $("#category-list");
  if (!categories.length) {
    categoryList.innerHTML = '<div class="manager-empty"><strong>لسه مفيش تصنيفات</strong><p>أضف أول فئة، ثم اربط بها الساعات من نموذج المنتج.</p></div>';
    renderProducts();
    return;
  }
  categoryList.innerHTML = categories.map((category) => `<article class="category-admin-item" data-category-id="${escapeHtml(category.id)}">
    <div class="category-admin-info"><strong>${escapeHtml(category.name)}</strong><small>${new Intl.NumberFormat("ar-EG").format(category.activeProductCount)} نشطة من ${new Intl.NumberFormat("ar-EG").format(category.productCount)} ساعة مرتبطة</small></div>
    <div class="category-admin-actions"><button type="button" class="mini-button" data-category-action="rename">إعادة تسمية</button><button type="button" class="mini-button mini-button-danger" data-category-action="delete"${category.productCount ? " disabled title=\"أزل الفئة عن كل الساعات أولًا\"" : ""}>حذف</button></div>
  </article>`).join("");
  renderProducts();
}

async function loadCategories() {
  const data = await requestJson("/api/admin/categories");
  categories = data.categories || [];
  renderCategories();
}

async function loadStoreSettings() {
  const data = await requestJson("/api/admin/settings");
  const settings = data.settings || {};
  $("#settings-whatsapp").value = settings.whatsappNumber || "";
  $("#settings-phone").value = settings.phoneNumber || "";
}

function renderGalleryEditor() {
  if (!galleryImages.length) {
    galleryEditor.hidden = true;
    galleryEditor.innerHTML = "";
    return;
  }

  galleryEditor.hidden = false;
  galleryEditor.innerHTML = galleryImages.map((image, index) => {
    const preview = image.previewUrl || image.imageUrl || "";
    const sourceLabel = image.file?.name || "صورة محفوظة";
    return `<div class="gallery-editor-item" data-gallery-item="${index}">
      <img src="${escapeHtml(preview)}" alt="معاينة ${escapeHtml(image.colorLabel || "لون الساعة")}" />
      <div class="gallery-editor-fields"><label><span>اسم اللون <small>اختياري</small></span><input type="text" maxlength="80" data-gallery-color="${index}" value="${escapeHtml(image.colorLabel || "")}" placeholder="مثل: فضي أو ذهبي" /></label><small>${escapeHtml(sourceLabel)}</small></div>
      <button type="button" class="gallery-remove-button" data-action="remove-gallery-image" data-index="${index}" aria-label="إزالة الصورة ${index + 1}">إزالة</button>
    </div>`;
  }).join("");
}

function clearGallery() {
  galleryImages.forEach((image) => {
    if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
  });
  galleryImages = [];
  renderGalleryEditor();
}

function resetForm() {
  form.reset();
  editingId = "";
  $("#product-category").value = "";
  $("#discount-percent").value = "0";
  $("#sort-order").value = "0";
  $("#product-active").checked = false;
  $("#form-title").textContent = "أضف ساعة";
  $("#save-button").innerHTML = 'حفظ الساعة <span aria-hidden="true">←</span>';
  $("#cancel-edit").hidden = true;
  formError.hidden = true;
  fileInput.value = "";
  clearGallery();
  renderPricePreview();
}

function beginEdit(product) {
  editingId = product.id;
  $("#product-name").value = product.name;
  $("#product-description").value = product.description || "";
  $("#base-price").value = String(product.basePrice);
  $("#discount-percent").value = String(product.discountPercent || 0);
  $("#discount-start-on").value = product.discountStartOn || "";
  $("#discount-end-on").value = product.discountEndOn || "";
  $("#discount-reason").value = product.discountReason || "";
  $("#product-category").value = product.categoryId || "";
  $("#image-alt").value = product.imageAlt || "";
  $("#sort-order").value = String(product.sortOrder || 0);
  $("#product-active").checked = Boolean(product.active);
  fileInput.value = "";
  clearGallery();
  const currentImages = Array.isArray(product.images) && product.images.length
    ? product.images
    : product.imageUrl ? [{ imageUrl: product.imageUrl, imageAlt: product.imageAlt || "", colorLabel: "" }] : [];
  galleryImages = currentImages.map((image) => ({ ...image, file: null, previewUrl: "" }));
  renderGalleryEditor();
  $("#form-title").textContent = "عدّل بيانات الساعة";
  $("#save-button").innerHTML = 'حفظ التعديلات <span aria-hidden="true">←</span>';
  $("#cancel-edit").hidden = false;
  formError.hidden = true;
  renderPricePreview();
  $("#product-name").focus();
  if (window.matchMedia("(max-width: 860px)").matches) $(".editor-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function uploadImage(file) {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) throw new Error("الصيغ المدعومة هي JPG أو PNG أو WebP فقط.");
  if (file.size > 5 * 1024 * 1024) throw new Error("حجم الصورة يتجاوز 5 ميجابايت.");
  const response = await fetch("/api/admin/uploads", {
    method: "POST",
    headers: { "Content-Type": file.type, "X-CSRF-Token": csrfToken, Accept: "application/json" },
    credentials: "same-origin",
    body: file,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "فشل رفع الصورة.");
  return data.imageUrl;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSaving) return;
  formError.hidden = true;
  const basePrice = Number($("#base-price").value);
  const discountPercent = Number($("#discount-percent").value);
  const discountStartOn = $("#discount-start-on").value;
  const discountEndOn = $("#discount-end-on").value;
  const discountReason = $("#discount-reason").value.trim();
  if (!$("#product-name").value.trim()) return showFormError("اكتب اسم الموديل.");
  if (!Number.isInteger(basePrice) || basePrice < 1) return showFormError("اكتب السعر الأصلي بالجنيه المصري كرقم صحيح.");
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 99) return showFormError("نسبة الخصم تكون من 0% إلى 99%.");
  if (discountPercent > 0) {
    if (!discountStartOn || !discountEndOn) return showFormError("حدد تاريخ بداية العرض ونهايته.");
    if (discountStartOn > discountEndOn) return showFormError("تاريخ نهاية العرض يجب ألا يسبق تاريخ بدايته.");
    if (!discountReason || discountReason.length > 120) return showFormError("اكتب سبب العرض في 1 إلى 120 حرفًا.");
  }

  isSaving = true;
  form.querySelectorAll("input, textarea, button").forEach((element) => { element.disabled = true; });
  const targetId = editingId;
  const wasEditing = Boolean(targetId);
  const oldButton = $("#save-button").innerHTML;
  $("#save-button").textContent = "جارٍ رفع الصور والحفظ…";
  try {
    const productName = $("#product-name").value.trim();
    const gallery = [];
    for (const [index, image] of galleryImages.entries()) {
      const imageUrl = image.file ? await uploadImage(image.file) : image.imageUrl;
      if (!imageUrl) continue;
      const colorLabel = String(image.colorLabel || "").trim();
      const altBase = index === 0 ? $("#image-alt").value.trim() : "";
      const imageAlt = (altBase || image.imageAlt || (colorLabel ? `${productName} — ${colorLabel}` : productName)).slice(0, 200);
      gallery.push({ imageUrl, imageAlt, colorLabel, sortOrder: gallery.length });
    }

    const payload = {
      name: productName,
      description: $("#product-description").value.trim(),
      basePrice,
      discountPercent,
      discountStartOn: discountPercent > 0 ? discountStartOn : "",
      discountEndOn: discountPercent > 0 ? discountEndOn : "",
      discountReason: discountPercent > 0 ? discountReason : "",
      categoryId: $("#product-category").value || null,
      imageUrl: gallery[0]?.imageUrl || "",
      imageAlt: gallery[0]?.imageAlt || $("#image-alt").value.trim(),
      images: gallery,
      active: $("#product-active").checked,
      sortOrder: Number($("#sort-order").value) || 0,
    };
    if (payload.active && !payload.imageUrl) throw new Error("أضف صورة واحدة على الأقل قبل عرض الساعة للزوار.");
    if (!payload.name) throw new Error("اكتب اسم الموديل.");

    await requestJson(targetId ? `/api/admin/products/${encodeURIComponent(targetId)}` : "/api/admin/products", {
      method: wasEditing ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    showToast(wasEditing ? "اتحفظت تعديلات الساعة وصورها." : "اتضافت الساعة وصورها للكتالوج.");
    resetForm();
    await Promise.all([loadProducts(), loadCategories()]);
  } catch (error) {
    showFormError(error.message || "تعذر حفظ الساعة.");
  } finally {
    isSaving = false;
    form.querySelectorAll("input, textarea, button").forEach((element) => { element.disabled = false; });
    $("#save-button").innerHTML = editingId ? oldButton : 'حفظ الساعة <span aria-hidden="true">←</span>';
  }
});

function showFormError(message) {
  formError.textContent = message;
  formError.hidden = false;
}

fileInput.addEventListener("change", () => {
  const files = Array.from(fileInput.files || []);
  fileInput.value = "";
  if (!files.length) return;
  if (galleryImages.length + files.length > 8) return showFormError("يمكن إضافة حتى 8 صور للساعة.");
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  const invalidFile = files.find((file) => !allowedTypes.includes(file.type) || file.size > 5 * 1024 * 1024);
  if (invalidFile) return showFormError(invalidFile.size > 5 * 1024 * 1024 ? "حجم كل صورة يجب ألا يتجاوز 5 ميجابايت." : "الصيغ المدعومة هي JPG أو PNG أو WebP فقط.");
  formError.hidden = true;
  for (const file of files) {
    galleryImages.push({ file, previewUrl: URL.createObjectURL(file), imageUrl: "", imageAlt: "", colorLabel: "" });
  }
  renderGalleryEditor();
});

galleryEditor.addEventListener("input", (event) => {
  const field = event.target.closest("input[data-gallery-color]");
  if (!field) return;
  const image = galleryImages[Number(field.dataset.galleryColor)];
  if (image) image.colorLabel = field.value;
});

galleryEditor.addEventListener("click", (event) => {
  const button = event.target.closest('button[data-action="remove-gallery-image"]');
  if (!button) return;
  const index = Number(button.dataset.index);
  const [removed] = galleryImages.splice(index, 1);
  if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
  renderGalleryEditor();
});

$("#base-price").addEventListener("input", renderPricePreview);
$("#discount-percent").addEventListener("input", renderPricePreview);
$("#discount-start-on").addEventListener("input", renderPricePreview);
$("#discount-end-on").addEventListener("input", renderPricePreview);
$("#discount-reason").addEventListener("input", renderPricePreview);
$("#cancel-edit").addEventListener("click", resetForm);

list.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  const card = event.target.closest(".manager-card");
  if (isSaving || !button || !card) return;
  const product = products.find((item) => item.id === card.dataset.id);
  if (!product) return;

  try {
    if (button.dataset.action === "edit") return beginEdit(product);
    if (button.dataset.action === "toggle") {
      await requestJson(`/api/admin/products/${encodeURIComponent(product.id)}/visibility`, {
        method: "PATCH",
        body: JSON.stringify({ active: !product.active }),
      });
      showToast(product.active ? "اتخفت الساعة من المتجر." : "الساعة بقت معروضة للزوار.");
      await Promise.all([loadProducts(), loadCategories()]);
    }
    if (button.dataset.action === "delete") {
      const approved = window.confirm(`تحذف «${product.name}» من قائمة الإدارة؟ هتختفي من المتجر، لكن صورة التخزين لا تُحذف تلقائيًا.`);
      if (!approved) return;
      await requestJson(`/api/admin/products/${encodeURIComponent(product.id)}`, { method: "DELETE" });
      if (editingId === product.id) resetForm();
      showToast("اتشالت الساعة من قائمة المنتجات.");
      await Promise.all([loadProducts(), loadCategories()]);
    }
  } catch (error) {
    showToast(error.message || "حصل خطأ. حاول تاني.", true);
  }
});

$("#category-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSavingCategory) return;
  const categoryError = $("#category-error");
  const categoryForm = $("#category-form");
  const saveButton = $("#category-save-button");
  const oldButton = saveButton.innerHTML;
  categoryError.hidden = true;
  const name = $("#category-name").value.trim();
  if (!name || name.length > 80) {
    categoryError.textContent = "اكتب اسم التصنيف من 1 إلى 80 حرفًا.";
    categoryError.hidden = false;
    return;
  }

  isSavingCategory = true;
  categoryForm.querySelectorAll("input,button").forEach((element) => { element.disabled = true; });
  saveButton.textContent = "جارٍ إضافة التصنيف…";
  try {
    await requestJson("/api/admin/categories", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    categoryForm.reset();
    showToast("اتضاف التصنيف.");
    await loadCategories();
  } catch (error) {
    categoryError.textContent = error.message || "تعذر إضافة التصنيف.";
    categoryError.hidden = false;
  } finally {
    isSavingCategory = false;
    categoryForm.querySelectorAll("input,button").forEach((element) => { element.disabled = false; });
    saveButton.innerHTML = oldButton;
  }
});

$("#category-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-category-action]");
  const item = event.target.closest(".category-admin-item");
  if (!button || !item || button.disabled || isSavingCategory) return;
  const category = categories.find((candidate) => candidate.id === item.dataset.categoryId);
  if (!category) return;
  const action = button.dataset.categoryAction;

  try {
    if (action === "rename") {
      const promptedName = window.prompt("اكتب الاسم الجديد للتصنيف:", category.name);
      if (promptedName === null) return;
      const name = promptedName.trim();
      if (!name || name.length > 80) {
        showToast("اسم التصنيف يجب أن يكون من 1 إلى 80 حرفًا.", true);
        return;
      }
      await requestJson(`/api/admin/categories/${encodeURIComponent(category.id)}`, {
        method: "PUT",
        body: JSON.stringify({ name }),
      });
      showToast("اتحدّث اسم التصنيف.");
      await loadCategories();
    }
    if (action === "delete") {
      if (category.productCount) return showToast("أزل التصنيف عن كل الساعات قبل حذفه.", true);
      if (!window.confirm(`تحذف تصنيف «${category.name}»؟`)) return;
      await requestJson(`/api/admin/categories/${encodeURIComponent(category.id)}`, { method: "DELETE" });
      showToast("اتحذف التصنيف.");
      await loadCategories();
    }
  } catch (error) {
    showToast(error.message || "تعذر تحديث التصنيف.", true);
  }
});

$("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSavingSettings) return;

  const settingsForm = $("#settings-form");
  const errorBox = $("#settings-error");
  const saveButton = $("#settings-save-button");
  const oldButton = saveButton.innerHTML;
  errorBox.hidden = true;
  isSavingSettings = true;
  settingsForm.querySelectorAll("input, button").forEach((element) => { element.disabled = true; });
  saveButton.textContent = "جارٍ حفظ الأرقام…";

  try {
    const result = await requestJson("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({
        whatsappNumber: $("#settings-whatsapp").value.trim(),
        phoneNumber: $("#settings-phone").value.trim(),
      }),
    });
    $("#settings-whatsapp").value = result.settings.whatsappNumber || "";
    $("#settings-phone").value = result.settings.phoneNumber || "";
    showToast("اتحفظت أرقام التواصل وهتظهر للزوار.");
  } catch (error) {
    errorBox.textContent = error.message || "تعذر حفظ أرقام التواصل.";
    errorBox.hidden = false;
  } finally {
    isSavingSettings = false;
    settingsForm.querySelectorAll("input, button").forEach((element) => { element.disabled = false; });
    saveButton.innerHTML = oldButton;
  }
});

$(".filter-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  activeFilter = button.dataset.filter;
  document.querySelectorAll(".filter-tab").forEach((tab) => {
    const selected = tab === button;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-pressed", String(selected));
  });
  renderProducts();
});

$("#login-button").addEventListener("click", async () => {
  const button = $("#login-button");
  button.disabled = true;
  button.textContent = "جارٍ فتح تسجيل الدخول…";
  try {
    const data = await requestJson("/api/auth/start", {
      method: "POST",
      body: JSON.stringify({ origin: window.location.origin }),
    });
    window.location.assign(data.authorizationUrl);
  } catch (error) {
    showToast(error.message || "تعذر بدء تسجيل الدخول.", true);
    button.disabled = false;
    button.innerHTML = 'تسجيل الدخول بحساب Manus <span aria-hidden="true">←</span>';
  }
});

$("#logout-button").addEventListener("click", async () => {
  try {
    await requestJson("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
  } finally {
    csrfToken = "";
    window.location.assign("/admin");
  }
});

async function init() {
  try {
    const response = await fetch("/api/auth/me", { credentials: "same-origin", headers: { Accept: "application/json" } });
    const status = await response.json().catch(() => ({}));
    if (!response.ok || !status.authenticated) {
      showLogin(status.error || "");
      const loginStatus = new URLSearchParams(window.location.search).get("login");
      if (loginStatus === "unauthorized") showToast("الحساب ده مش مصرح له بإدارة المتجر.", true);
      else if (loginStatus === "failed") showToast("ما قدرناش نكمّل تسجيل الدخول. جرّب تاني.", true);
      else if (loginStatus === "ok") showToast("تم تسجيل الخروج.");
      return;
    }
    csrfToken = status.csrfToken || "";
    $("#signed-in-as").textContent = `مسجّل الدخول: ${status.user?.email || "حساب المالك"}`;
    loadingPanel.hidden = true;
    loginPanel.hidden = true;
    workspace.hidden = false;
    const loaded = await Promise.allSettled([loadProducts(), loadCategories(), loadStoreSettings()]);
    if (loaded[0].status === "rejected") throw loaded[0].reason;
    if (loaded[1].status === "rejected") throw loaded[1].reason;
    if (loaded[2].status === "rejected") showToast("تعذر تحميل أرقام التواصل. حدّث الصفحة وحاول مجددًا.", true);
  } catch (error) {
    showLogin(error.message || "تعذر الاتصال بخدمة إدارة المتجر.");
  }
}

renderPricePreview();
init();
