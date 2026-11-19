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
 * Uploads media file to Cloudinary Unsigned Upload Preset
 */
export async function uploadToCloudinary(file, cloudName, uploadPreset) {
  if (!file || !cloudName || !uploadPreset) {
    throw new Error("Missing Cloudinary parameters (Cloud Name or Upload Preset).");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/auto/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Cloudinary upload failed: ${res.statusText} ${errText}`);
  }

  const data = await res.json();
  if (!data.secure_url) {
    throw new Error("Cloudinary response missing secure_url.");
  }

  return data.secure_url;
}

/**
 * High-level Processor:
 * Optimizes image, checks GitHub Pages repo upload first for 100% free unlimited hosting,
 * then Cloudinary, and falls back gracefully to compact Data URL / IndexedDB.
 */
export async function processMediaUpload(file, options = {}) {
  const { isVideo = false, cloudSettings = null, onProgress = null } = options;

  if (onProgress) onProgress("جاري فحص الملف...");

  let processedFile = file;
  if (!isVideo && file.type && file.type.startsWith("image/")) {
    if (onProgress) onProgress("جاري تحسين وضغط الصورة...");
    try {
      processedFile = await optimizeImageFile(file, 1200, 0.88);
    } catch {
      processedFile = file;
    }
  }

  // 1. Try GitHub Pages Upload first (100% free unlimited media hosting)
  try {
    const ghConfig = getGitHubConfig();
    if (ghConfig.isConfigured) {
      if (onProgress) onProgress("جاري الرفع المباشر إلى مستودع GitHub Pages...");
      const ghResult = await uploadMediaToGitHub(processedFile, "public/uploads");
      if (onProgress) onProgress("اكتمل الرفع على GitHub Pages بنجاح ✓");
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

  // 2. Try Cloudinary if configured
  if (cloudSettings && cloudSettings.cloudName && cloudSettings.uploadPreset) {
    try {
      if (onProgress) onProgress("جاري الرفع إلى السحابة (Cloudinary)...");
      const cloudUrl = await uploadToCloudinary(
        processedFile,
        cloudSettings.cloudName.trim(),
        cloudSettings.uploadPreset.trim()
      );
      if (onProgress) onProgress("اكتمل الرفع بنجاح ✓");
      return {
        url: cloudUrl,
        previewUrl: cloudUrl,
        isCloud: true,
        size: processedFile.size,
        name: processedFile.name,
        type: processedFile.type,
      };
    } catch (cloudErr) {
      console.warn("Cloudinary failed, falling back to local storage:", cloudErr);
    }
  }

  // 3. Resilient Local / Cross-device fallback
  if (onProgress) onProgress("جاري المعالجة الآمنة...");
  const mediaId = await saveMediaBlob(processedFile, processedFile.name, processedFile.type);
  const previewUrl = await resolveMediaUrl(mediaId);

  // If optimized image is under 250KB, convert to Data URL so it syncs across devices via store.json
  let dataUrl = "";
  if (!isVideo && processedFile.size < 250 * 1024) {
    try {
      dataUrl = await fileToDataUrl(processedFile);
    } catch {}
  }

  if (onProgress) onProgress("تم الحفظ بنجاح ✓");

  return {
    url: dataUrl || mediaId,
    previewUrl,
    isCloud: false,
    size: processedFile.size,
    name: processedFile.name,
    type: processedFile.type,
  };
}
