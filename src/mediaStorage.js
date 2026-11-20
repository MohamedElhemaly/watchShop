// Sodfa Media Storage & Optimization Layer
// Resilient IndexedDB binary storage + Client-Side Canvas Optimization + Cloudinary Sync

const DB_NAME = "daffa_media_db";
const DB_VERSION = 1;
const STORE_NAME = "media";

// In-memory cache for created Object URLs to prevent duplicate memory allocations
const objectUrlCache = new Map();

/**
 * Initializes or retrieves the IndexedDB database instance
 */
export function openMediaDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      return resolve(null); // Node / SSR fallback
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = (e) => {
      resolve(e.target.result);
    };

    request.onerror = (e) => {
      console.warn("IndexedDB open error:", e.target.error);
      resolve(null);
    };
  });
}

// In-memory mock store for Node test environments or when IndexedDB is unavailable
const memoryFallbackStore = new Map();

/**
 * Stores a binary Blob in IndexedDB under a unique media:// ID
 */
export async function saveMediaBlob(blob, filename = "file", mimeType = "") {
  if (!blob) throw new Error("No blob provided for storage.");

  const ext = filename.split(".").pop() || (blob.type.includes("video") ? "mp4" : "webp");
  const id = `media://${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const resolvedMime = mimeType || blob.type || (filename.endsWith(".mp4") ? "video/mp4" : "image/webp");

  const record = {
    id,
    blob,
    filename,
    mimeType: resolvedMime,
    size: blob.size || 0,
    createdAt: new Date().toISOString(),
  };

  const db = await openMediaDatabase();
  if (db) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } else {
    memoryFallbackStore.set(id, record);
  }

  // Pre-cache object URL
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    try {
      const objUrl = URL.createObjectURL(blob);
      objectUrlCache.set(id, objUrl);
    } catch {}
  }

  return id;
}

/**
 * Retrieves a stored record from IndexedDB by media ID
 */
export async function getMediaBlob(id) {
  if (!id || typeof id !== "string") return null;

  if (memoryFallbackStore.has(id)) {
    return memoryFallbackStore.get(id);
  }

  const db = await openMediaDatabase();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Synchronous cache lookup for already resolved or newly uploaded media URLs
 */
export function getCachedMediaUrl(url) {
  if (!url || typeof url !== "string") return "";
  if (!url.startsWith("media://")) return url;
  return objectUrlCache.get(url) || url;
}

/**
 * Resolves any image/video URL:
 * - If it's a standard URL (http, https, /assets), returns as-is.
 * - If it's a media:// ID, retrieves Blob from IndexedDB and creates a fast object URL.
 */
export async function resolveMediaUrl(url) {
  if (!url || typeof url !== "string") return "";

  if (!url.startsWith("media://")) {
    return url;
  }

  if (objectUrlCache.has(url)) {
    return objectUrlCache.get(url);
  }

  const record = await getMediaBlob(url);
  if (record && record.blob && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    try {
      const objUrl = URL.createObjectURL(record.blob);
      objectUrlCache.set(url, objUrl);
      return objUrl;
    } catch {
      return url;
    }
  }

  return url;
}

/**
 * Batch resolves all watch products containing media:// URLs
 */
export async function resolveProductsMedia(products) {
  if (!Array.isArray(products)) return [];

  const resolved = [];
  for (const p of products) {
    const copy = { ...p };
    if (copy.imageUrl && copy.imageUrl.startsWith("media://")) {
      copy.imageUrl = await resolveMediaUrl(copy.imageUrl);
    }
    if (Array.isArray(copy.images) && copy.images.length > 0) {
      copy.images = await Promise.all(
        copy.images.map(async (img) => {
          if (img.imageUrl && img.imageUrl.startsWith("media://")) {
            return { ...img, imageUrl: await resolveMediaUrl(img.imageUrl) };
          }
          return img;
        })
      );
    }
    resolved.push(copy);
  }
  return resolved;
}

/**
 * Deletes a stored media blob from IndexedDB
 */
export async function deleteMediaBlob(id) {
  if (!id || !id.startsWith("media://")) return false;

  if (objectUrlCache.has(id)) {
    if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      try {
        URL.revokeObjectURL(objectUrlCache.get(id));
      } catch {}
    }
    objectUrlCache.delete(id);
  }

  memoryFallbackStore.delete(id);

  const db = await openMediaDatabase();
  if (!db) return true;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Resizes and optimizes an image file via offscreen <canvas>
 * - Max dimension default 1200px
 * - Preserves PNG transparency or encodes high-grade WebP/JPEG
 */
export async function optimizeImageFile(file, maxDimension = 1200, quality = 0.88) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return file; // Node fallback
  }

  if (!file || !file.type.startsWith("image/")) {
    return file;
  }

  // SVG images do not need raster canvas resizing
  if (file.type === "image/svg+xml") {
    return file;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;

      // Check if downscaling is needed
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(file);

      // Better image scaling quality
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, width, height);

      // Determine output format: preserve PNG if transparent, otherwise modern WebP or JPEG
      const isPng = file.type === "image/png";
      const targetMime = isPng ? "image/png" : "image/webp";

      canvas.toBlob(
        (blob) => {
          if (!blob) return resolve(file);
          // Return optimized blob with preserved or enhanced metadata
          const optimizedFile = new File([blob], file.name.replace(/\.[^/.]+$/, isPng ? ".png" : ".webp"), {
            type: targetMime,
            lastModified: Date.now(),
          });
          resolve(optimizedFile);
        },
        targetMime,
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file); // Fallback to original
    };

    img.src = objectUrl;
  });
}

import { getGitHubConfig, uploadMediaToGitHub } from "./githubSync.js";

/**
 * Converts a File / Blob to a Base64 Data URL for compact, self-contained cross-device sync
 */
export function fileToDataUrl(file) {
  return new Promise((resolve) => {
    if (typeof FileReader === "undefined" || !file) {
      return resolve("");
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads media file to Cloudinary Unsigned Upload Preset with real-time XMLHttpRequest progress
 */
export function uploadToCloudinary(file, cloudName, uploadPreset, options = {}) {
  const isProgressFn = typeof options === "function";
  const opts = isProgressFn ? { onProgress: options } : (options || {});
  const isVideo = Boolean(opts.isVideo || (file?.type && file.type.startsWith("video/")));
  const onProgress = opts.onProgress || null;

  if (!file || !cloudName || !uploadPreset) {
    return Promise.reject(
      new Error("بيانات Cloudinary غير مكتملة: اسم السحابة (Cloud Name) أو بريسيت الرفع (Upload Preset) غير محدد.")
    );
  }

  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName.trim())}/${isVideo ? "video" : "auto"}/upload`;

  // Use XMLHttpRequest in browser environments for live upload progress
  if (typeof XMLHttpRequest !== "undefined") {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", uploadPreset.trim());

      if (xhr.upload) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && typeof onProgress === "function") {
            const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
            onProgress({
              percent,
              loaded: event.loaded,
              total: event.total,
              text: `جاري رفع ${isVideo ? "الفيديو" : "الملف"}... ${percent}%`,
            });
          }
        };
      }

      xhr.onload = () => {
        let data = {};
        try {
          data = JSON.parse(xhr.responseText || "{}");
        } catch {
          data = {};
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          const secureUrl = data.secure_url || data.url;
          if (!secureUrl) {
            return reject(new Error("استجابة Cloudinary لم تتضمن رابط secure_url صالحًا."));
          }
          if (typeof onProgress === "function") {
            onProgress({ percent: 100, text: `اكتمل رفع ${isVideo ? "الفيديو" : "الملف"} بنجاح 100% ✓` });
          }
          return resolve(secureUrl);
        }

        const cloudMsg = data?.error?.message || xhr.statusText || `رمز الاستجابة ${xhr.status}`;
        return reject(new Error(`رفض Cloudinary العملية: ${cloudMsg}`));
      };

      xhr.onerror = () => {
        reject(new Error("فشل الاتصال بشبكة Cloudinary. تأكد من اتصال الإنترنت وصحة اسم السحابة."));
      };

      xhr.ontimeout = () => {
        reject(new Error("انتهت مهلة الرفع السحابي. تحقق من سرعة الاتصال أو حجم الملف."));
      };

      xhr.timeout = 240000; // 4 minutes
      xhr.open("POST", endpoint, true);
      xhr.send(formData);
    });
  }

  // Fallback for Node / test environments
  return (async () => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", uploadPreset.trim());

    const res = await fetch(endpoint, {
      method: "POST",
      body: formData,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const cloudMsg = data?.error?.message || res.statusText || `رمز الاستجابة ${res.status}`;
      throw new Error(`رفض Cloudinary العملية: ${cloudMsg}`);
    }

    if (!data.secure_url && !data.url) {
      throw new Error("استجابة Cloudinary لم تتضمن رابط secure_url صالحًا.");
    }

    if (typeof onProgress === "function") {
      onProgress({ percent: 100, text: "اكتمل الرفع بنجاح 100% ✓" });
    }

    return data.secure_url || data.url;
  })();
}

/**
 * High-level Processor:
 * For Videos: Mandates Cloudinary with real progress and zero silent failures.
 * For Images: Optimizes image, checks Cloudinary/GitHub first, falls back to IndexedDB.
 */
export async function processMediaUpload(file, options = {}) {
  const isVideoExplicit = options?.isVideo;
  const isVideoFile = Boolean(isVideoExplicit || (file?.type && file.type.startsWith("video/")));
  const isVideo = isVideoFile;
  const { cloudSettings = null, onProgress = null } = options;

  const notify = (msg) => {
    if (typeof onProgress === "function") {
      if (typeof msg === "string") onProgress({ percent: 0, text: msg });
      else onProgress(msg);
    }
  };

  notify("جاري فحص الملف...");

  let processedFile = file;
  if (!isVideo && file.type && file.type.startsWith("image/")) {
    notify("جاري تحسين وضغط الصورة...");
    try {
      processedFile = await optimizeImageFile(file, 1200, 0.88);
    } catch {
      processedFile = file;
    }
  }

  // Resolve Cloudinary settings from runtime storeSettings or environment variables
  const cloudName = (
    options?.cloudName ||
    cloudSettings?.cloudName ||
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_CLOUDINARY_CLOUD_NAME) ||
    (typeof window !== "undefined" && window.__CLOUDINARY_CLOUD_NAME) ||
    "v3macb6a"
  ).trim();

  const uploadPreset = (
    options?.uploadPreset ||
    cloudSettings?.uploadPreset ||
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_CLOUDINARY_UPLOAD_PRESET) ||
    (typeof window !== "undefined" && window.__CLOUDINARY_UPLOAD_PRESET) ||
    "SodfaShop"
  ).trim();

  // For Videos: Cloudinary is mandatory for cross-device live playback. Never fail silently!
  if (isVideo) {
    if (!cloudName || !uploadPreset) {
      throw new Error(
        "لم يتم ضبط بيانات Cloudinary: يرجى إدخال اسم السحابة (Cloud Name) وبريسيت الرفع (Upload Preset) في إعدادات التواصل أسفل الصفحة، أو تعيين متغيرات البيئة (VITE_CLOUDINARY_*)."
      );
    }

    notify({ percent: 5, text: "جاري الاتصال بسحابة Cloudinary..." });
    const cloudUrl = await uploadToCloudinary(processedFile, cloudName, uploadPreset, {
      isVideo: true,
      onProgress: notify,
    });

    return {
      url: cloudUrl,
      previewUrl: cloudUrl,
      isCloud: true,
      size: processedFile.size,
      name: processedFile.name,
      type: processedFile.type,
    };
  }

  // For Images:
  // 1. Try Cloudinary first if configured
  if (cloudName && uploadPreset) {
    try {
      notify({ percent: 10, text: "جاري الرفع إلى سحابة Cloudinary..." });
      const cloudUrl = await uploadToCloudinary(processedFile, cloudName, uploadPreset, {
        isVideo: false,
        onProgress: notify,
      });
      return {
        url: cloudUrl,
        previewUrl: cloudUrl,
        isCloud: true,
        size: processedFile.size,
        name: processedFile.name,
        type: processedFile.type,
      };
    } catch (cloudErr) {
      console.warn("Cloudinary image upload failed, checking fallbacks:", cloudErr);
    }
  }

  // 2. Try GitHub Pages Upload if configured
  try {
    const ghConfig = getGitHubConfig();
    if (ghConfig.isConfigured) {
      notify("جاري الرفع المباشر إلى مستودع GitHub Pages...");
      const ghResult = await uploadMediaToGitHub(processedFile, "public/uploads");
      notify("اكتمل الرفع على GitHub Pages بنجاح ✓");
      return {
        url: ghResult.url,
        previewUrl: ghResult.rawUrl || ghResult.url,
        isCloud: true,
        size: processedFile.size,
        name: processedFile.name,
        type: processedFile.type,
      };
    }
  } catch (ghErr) {
    console.warn("GitHub upload failed, falling back:", ghErr);
  }

  // 3. Resilient Local / IndexedDB fallback for images
  notify("جاري الحفظ المحلي الآمن...");
  const mediaId = await saveMediaBlob(processedFile, processedFile.name, processedFile.type);
  const previewUrl = await resolveMediaUrl(mediaId);

  let dataUrl = "";
  if (processedFile.size < 250 * 1024) {
    try {
      dataUrl = await fileToDataUrl(processedFile);
    } catch {}
  }

  notify("تم الحفظ بنجاح ✓");
  return {
    url: dataUrl || mediaId,
    previewUrl,
    isCloud: false,
    size: processedFile.size,
    name: processedFile.name,
    type: processedFile.type,
  };
}
