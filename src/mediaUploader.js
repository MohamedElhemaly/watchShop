import "./mediaUploader.css";
import { resolveMediaUrl, processMediaUpload, deleteMediaBlob } from "./mediaStorage.js";

const safeText = (value = "") =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));

/**
 * Creates an interactive Drag-and-Drop Media Uploader component
 * Supports Cloudinary video/image uploads with real live percentage progress bars
 * and prominent zero-silent-failure error handling.
 */
export function createMediaUploader({
  container,
  id,
  type = "image", // "image" | "video"
  initialUrl = "",
  label = "",
  hint = "",
  compact = false,
  getCloudSettings = null,
  onChange = null,
  disabled = false,
}) {
  if (!container) return null;

  const isVideo = type === "video";
  const acceptTypes = isVideo
    ? "video/mp4,video/webm,video/quicktime,video/ogg"
    : "image/png,image/jpeg,image/webp,image/svg+xml";

  let currentUrl = initialUrl || "";
  let resolvedPreviewUrl = "";
  let isUploading = false;
  let uploadPercent = 0;
  let uploadStatusText = "";
  let uploadError = "";
  let lastSelectedFile = null;
  let showManualUrl = false;
  let isDisabled = Boolean(disabled);

  // Render Component Shell
  function render() {
    container.innerHTML = `
      <div class="media-uploader-wrap ${compact ? "variant-uploader-compact" : ""}" id="uploader-${id}">
        ${label ? `<label class="form-field-label" style="font-weight:700; margin-bottom:4px; display:block;">${label}</label>` : ""}

        ${uploadError ? renderErrorBanner() : ""}

        ${isUploading ? renderUploadingState() : (currentUrl ? renderPreviewState() : renderDropzoneState())}

        ${hint && !isUploading && !currentUrl ? `<small class="media-dropzone-hint" style="margin-top:2px;">${hint}</small>` : ""}
      </div>
    `;

    bindEvents();
  }

  function renderErrorBanner() {
    return `
      <div class="media-error-banner" role="alert">
        <div class="media-error-header">
          <span class="media-error-icon" aria-hidden="true">⚠️</span>
          <strong>فشل رفع ${isVideo ? "فيديو الواجهة" : "الملف"} إلى Cloudinary:</strong>
        </div>
        <p class="media-error-desc">${safeText(uploadError)}</p>
        <div class="media-error-actions">
          ${lastSelectedFile ? `
            <button type="button" class="admin-button admin-button-small admin-button-primary" data-action="retry-upload">
              إعادة المحاولة ↺
            </button>
          ` : ""}
          <button type="button" class="admin-button admin-button-small admin-button-quiet" data-action="dismiss-error">
            إغلاق التنبيه ✕
          </button>
        </div>
      </div>
    `;
  }

  function renderUploadingState() {
    return `
      <div class="media-uploading-bar is-progress">
        <div class="media-progress-info">
          <span class="uploading-spinner" aria-hidden="true">⏳</span>
          <span class="media-progress-text">${uploadStatusText || `جاري رفع ${isVideo ? "الفيديو" : "الملف"}... ${uploadPercent}%`}</span>
        </div>
        <div class="media-progress-track" aria-hidden="true">
          <div class="media-progress-fill" style="width: ${uploadPercent}%;"></div>
        </div>
      </div>
    `;
  }

  function renderDropzoneState() {
    return `
      <div class="media-dropzone ${isDisabled ? "is-disabled" : ""}" role="button" tabindex="0" aria-label="رفع ملف من الجهاز">
        <input 
          type="file" 
          class="media-file-input" 
          accept="${acceptTypes}" 
          ${isDisabled ? "disabled" : ""} 
          title="اضغط للاختيار من جهازك"
        />
        <div class="media-dropzone-icon">${isVideo ? "🎬" : "📸"}</div>
        <p class="media-dropzone-title">اسحب ${isVideo ? "فيديو البطل" : "الصورة"} هنا أو اضغط للاختيار من جهازك</p>
        <p class="media-dropzone-hint">
          ${isVideo ? "يدعم صيغ MP4, WebM, MOV مع رفع سحابي مباشر على شبكة Cloudinary" : "يدعم PNG, JPG, WebP مع ضغط ذكي تلقائي"}
        </p>
      </div>

      <div class="media-url-toggle-row">
        <button type="button" class="media-url-toggle-btn" data-action="toggle-url">
          ${showManualUrl ? "إخفاء إدخال الرابط ✕" : "أو أدخل رابطاً مباشراً 🔗"}
        </button>
      </div>

      ${showManualUrl ? `
        <div class="media-url-input-box">
          <input 
            type="text" 
            placeholder="${isVideo ? 'https://res.cloudinary.com/.../video.mp4' : 'https://example.com/watch.jpg'}" 
            dir="ltr"
            class="manual-url-input"
          />
          <button type="button" class="admin-button admin-button-small admin-button-primary" data-action="apply-manual-url">
            تطبيق ✓
          </button>
        </div>
      ` : ""}
    `;
  }

  function renderPreviewState() {
    const isCloud = currentUrl.startsWith("http://") || currentUrl.startsWith("https://") || currentUrl.includes("cloudinary");
    const isIndexedDb = currentUrl.startsWith("media://");
    const displayUrl = resolvedPreviewUrl || currentUrl;

    return `
      <div class="media-preview-box">
        <div class="media-preview-stage ${isVideo ? "is-video-stage" : ""}">
          ${isVideo ? `
            <video 
              id="preview-video-${id}"
              src="${displayUrl}" 
              controls 
              playsinline 
              webkit-playsinline
              preload="metadata"
              class="media-preview-video" 
              poster="/sodfa-promo-poster.jpg"
            ></video>
          ` : `
            <img src="${displayUrl}" alt="معاينة" class="media-preview-img" loading="lazy" />
          `}
        </div>

        <div class="media-preview-meta">
          <span class="media-meta-badge ${isCloud ? "is-cloud" : ""}">
            ${isCloud ? "☁️ سحابي دائم (Cloudinary CDN)" : (isIndexedDb ? "💾 مرفوع محلياً" : "📁 ملف خارجي")}
          </span>

          <div class="media-preview-actions">
            ${!isDisabled ? `
              <label class="admin-button admin-button-small admin-button-quiet" style="position:relative; cursor:pointer;">
                تغيير الملف ↺
                <input type="file" accept="${acceptTypes}" class="media-replace-input" style="position:absolute; inset:0; opacity:0; cursor:pointer;" />
              </label>
              <button type="button" class="admin-button admin-button-small admin-button-danger" data-action="remove-media">
                حذف ✕
              </button>
            ` : ""}
          </div>
        </div>
      </div>
    `;
  }

  async function updatePreview(url) {
    currentUrl = url || "";
    if (currentUrl) {
      resolvedPreviewUrl = await resolveMediaUrl(currentUrl);
    } else {
      resolvedPreviewUrl = "";
    }
    render();
  }

  // Handle File Upload from Drop or Picker with Live Progress and Error Banner
  async function handleFileUpload(file) {
    if (!file || isDisabled) return;

    lastSelectedFile = file;
    uploadError = "";
    isUploading = true;
    uploadPercent = 5;
    uploadStatusText = "جاري فحص الملف...";
    render();

    try {
      const cloudSettings = typeof getCloudSettings === "function" ? getCloudSettings() : null;

      const result = await processMediaUpload(file, {
        isVideo,
        cloudSettings,
        onProgress: (progress) => {
          if (typeof progress === "object" && progress !== null) {
            uploadPercent = progress.percent !== undefined ? progress.percent : uploadPercent;
            uploadStatusText = progress.text || uploadStatusText;
          } else {
            uploadStatusText = String(progress);
          }

          // Live visual update without full HTML destruction
          const fillEl = container.querySelector(".media-progress-fill");
          const textEl = container.querySelector(".media-progress-text");
          if (fillEl) fillEl.style.width = `${uploadPercent}%`;
          if (textEl) textEl.textContent = uploadStatusText;
        },
      });

      currentUrl = result.url;
      resolvedPreviewUrl = result.previewUrl || result.url;
      isUploading = false;
      uploadError = "";
      render();

      if (typeof onChange === "function") {
        onChange(currentUrl, result);
      }
    } catch (err) {
      console.error("Media upload error:", err);
      isUploading = false;
      uploadError = err?.message || "حدث خطأ أثناء رفع الملف إلى الخادم السحابي.";
      render();
    }
  }

  function bindEvents() {
    // 1. File Input in Dropzone
    const fileInput = container.querySelector(".media-file-input");
    fileInput?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) handleFileUpload(file);
    });

    // 2. Drag & Drop on Dropzone
    const dropzone = container.querySelector(".media-dropzone");
    if (dropzone) {
      ["dragenter", "dragover"].forEach((eventName) => {
        dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!isDisabled) dropzone.classList.add("is-dragover");
        });
      });

      ["dragleave", "dragend"].forEach((eventName) => {
        dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.remove("is-dragover");
        });
      });

      dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove("is-dragover");
        if (isDisabled) return;
        const file = e.dataTransfer?.files?.[0];
        if (file) handleFileUpload(file);
      });
    }

    // 3. Manual URL Toggle & Apply
    const toggleBtn = container.querySelector('[data-action="toggle-url"]');
    toggleBtn?.addEventListener("click", () => {
      showManualUrl = !showManualUrl;
      render();
    });

    const applyManualBtn = container.querySelector('[data-action="apply-manual-url"]');
    applyManualBtn?.addEventListener("click", () => {
      const urlInput = container.querySelector(".manual-url-input");
      const val = urlInput?.value.trim();
      if (!val) return;
      currentUrl = val;
      resolvedPreviewUrl = val;
      showManualUrl = false;
      uploadError = "";
      render();
      if (typeof onChange === "function") onChange(currentUrl, { isManual: true });
    });

    // 4. Replace File in Preview
    const replaceInput = container.querySelector(".media-replace-input");
    replaceInput?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) handleFileUpload(file);
    });

    // 5. Remove File in Preview
    const removeBtn = container.querySelector('[data-action="remove-media"]');
    removeBtn?.addEventListener("click", () => {
      if (currentUrl && currentUrl.startsWith("media://")) {
        deleteMediaBlob(currentUrl).catch(() => {});
      }
      currentUrl = "";
      resolvedPreviewUrl = "";
      uploadError = "";
      render();
      if (typeof onChange === "function") onChange("", null);
    });

    // 6. Retry upload action
    const retryBtn = container.querySelector('[data-action="retry-upload"]');
    retryBtn?.addEventListener("click", () => {
      if (lastSelectedFile) {
        handleFileUpload(lastSelectedFile);
      }
    });

    // 7. Dismiss error action
    const dismissBtn = container.querySelector('[data-action="dismiss-error"]');
    dismissBtn?.addEventListener("click", () => {
      uploadError = "";
      render();
    });
  }

  // Initial render with resolution
  updatePreview(initialUrl);

  return {
    setUrl(url) {
      updatePreview(url);
    },
    getUrl() {
      return currentUrl;
    },
    setDisabled(bool) {
      isDisabled = Boolean(bool);
      render();
    },
  };
}
