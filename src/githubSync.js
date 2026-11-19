// Sodfa Watch Store - 100% Free GitHub Pages Database & Media Engine (2026)
// Provides zero-cost, zero-limit persistence and cross-device sync via public/data/store.json & GitHub REST API.

import {
  getStoreSettings,
  saveStoreSettings,
  getStoredProducts,
  saveStoredProducts,
  getStoredCategories,
  saveStoredCategories,
  getTickerItems,
  saveTickerItems,
  getAdminUsers,
  saveAdminUsers,
  getOrders,
  saveOrders,
} from "./data.js";

const GITHUB_CONFIG_KEY = "daffa_github_config";

/**
 * Universal UTF-8 to Base64 encoder (Browser & Node.js)
 */
export function utf8ToBase64(str) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "utf8").toString("base64");
  }
  return btoa(unescape(encodeURIComponent(str)));
}

/**
 * Universal Base64 to UTF-8 decoder
 */
export function base64ToUtf8(base64) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(base64, "base64").toString("utf8");
  }
  return decodeURIComponent(escape(atob(base64)));
}

/**
 * Converts a File or Blob into pure Base64 string (without data:image/... prefix)
 */
export function fileToBase64Raw(file) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === "undefined") {
      return resolve("");
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64Index = result.indexOf(",");
      resolve(base64Index > -1 ? result.slice(base64Index + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Retrieves current GitHub repository sync configuration
 */
export function getGitHubConfig() {
  let config = {
    githubOwner: "",
    githubRepo: "",
    githubBranch: "main",
    githubToken: "",
    isConfigured: false,
  };

  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(GITHUB_CONFIG_KEY);
      if (stored) {
        config = { ...config, ...JSON.parse(stored) };
      }
    }
  } catch {}

  // Fallback to store settings
  if (!config.githubOwner || !config.githubRepo || !config.githubToken) {
    const settings = getStoreSettings();
    if (settings.githubOwner) config.githubOwner = settings.githubOwner;
    if (settings.githubRepo) config.githubRepo = settings.githubRepo;
    if (settings.githubBranch) config.githubBranch = settings.githubBranch;
    if (settings.githubToken) config.githubToken = settings.githubToken;
  }

  config.githubOwner = (config.githubOwner || "").trim();
  config.githubRepo = (config.githubRepo || "").trim();
  config.githubBranch = (config.githubBranch || "main").trim();
  config.githubToken = (config.githubToken || "").trim();
  config.isConfigured = Boolean(config.githubOwner && config.githubRepo && config.githubToken);

  return config;
}

/**
 * Saves GitHub configuration to localStorage and dispatches update event
 */
export function saveGitHubConfig(newConfig = {}) {
  const current = getGitHubConfig();
  const merged = {
    ...current,
    ...newConfig,
    isConfigured: Boolean((newConfig.githubOwner || current.githubOwner) && (newConfig.githubRepo || current.githubRepo) && (newConfig.githubToken || current.githubToken)),
  };

  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(merged));
    }
  } catch {}

  // Also mirror to storeSettings
  const settings = getStoreSettings();
  saveStoreSettings({
    ...settings,
    githubOwner: merged.githubOwner,
    githubRepo: merged.githubRepo,
    githubBranch: merged.githubBranch,
    githubToken: merged.githubToken,
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("daffa:github-config-updated", { detail: merged }));
  }

  return merged;
}

/**
 * Tests connection to GitHub repository via GitHub REST API
 */
export async function testGitHubConnection(config = null) {
  const cfg = config || getGitHubConfig();
  const { githubOwner, githubRepo, githubToken } = cfg;

  if (!githubOwner || !githubRepo || !githubToken) {
    return {
      ok: false,
      message: "يرجى إدخال اسم المالك (Username) واسم المستودع (Repo) ومفتاح الوصول (Token).",
    };
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(githubOwner)}/${encodeURIComponent(githubRepo)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Sodfa-Watch-Store",
      },
    });

    if (res.ok) {
      const data = await res.json();
      return {
        ok: true,
        message: `تم الاتصال بمستودع «${data.full_name}» بنجاح! الفرع الافتراضي: ${data.default_branch}`,
        repoData: data,
      };
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "فشل التحقق: رمز الوصول (Token) غير صالح أو انتهت صلاحيته." };
    }
    if (res.status === 404) {
      return { ok: false, message: `المستودع ${githubOwner}/${githubRepo} غير موجود أو لا يملك هذا الرمز صلاحية الوصول إليه.` };
    }

    return { ok: false, message: `استجاب GitHub بالرمز ${res.status}: ${res.statusText}` };
  } catch (err) {
    return { ok: false, message: `تعذر الاتصال بـ GitHub: ${err.message}` };
  }
}

/**
 * Fetches existing file SHA from GitHub repository (needed for updating files via API)
 */
export async function getGitHubFileSha(path, config = null) {
  const cfg = config || getGitHubConfig();
  const { githubOwner, githubRepo, githubBranch, githubToken } = cfg;
  if (!cfg.isConfigured) return null;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(githubOwner)}/${encodeURIComponent(githubRepo)}/contents/${path}?ref=${encodeURIComponent(githubBranch || "main")}`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Sodfa-Watch-Store",
        },
      }
    );
    if (res.ok) {
      const data = await res.json();
      return data.sha || null;
    }
  } catch {}
  return null;
}

/**
 * Commits a file (text or binary Base64) to the GitHub repository via Contents API
 */
export async function commitFileToGitHub({ path, content, isBase64 = false, message = "", config = null }) {
  const cfg = config || getGitHubConfig();
  const { githubOwner, githubRepo, githubBranch, githubToken } = cfg;

  if (!cfg.isConfigured) {
    throw new Error("بيانات GitHub غير مكتملة في الإعدادات. يرجى إدخال اسم المستودع ورمز الوصول (Token).");
  }

  const existingSha = await getGitHubFileSha(path, cfg);
  const base64Content = isBase64 ? content : utf8ToBase64(content);

  const payload = {
    message: message || `Update ${path} from Sodfa Store Admin`,
    content: base64Content,
    branch: githubBranch || "main",
  };
  if (existingSha) {
    payload.sha = existingSha;
  }

  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(githubOwner)}/${encodeURIComponent(githubRepo)}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "Sodfa-Watch-Store",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || `GitHub commit failed with status ${res.status}`);
  }

  return await res.json();
}

/**
 * Builds the complete export snapshot of current store data
 */
export function buildStoreSnapshot(reason = "Manual Snapshot") {
  return {
    version: "2026.1",
    updatedAt: new Date().toISOString(),
    reason,
    settings: getStoreSettings(),
    products: getStoredProducts(),
    categories: getStoredCategories(),
    tickerItems: getTickerItems(),
    adminUsers: getAdminUsers(),
    orders: getOrders(),
  };
}

/**
 * Publishes the complete store data to GitHub Pages repository (public/data/store.json)
 */
export async function publishStoreToGitHub({ reason = "تحديث من لوحة التحكم" } = {}) {
  const snapshot = buildStoreSnapshot(reason);
  const jsonContent = JSON.stringify(snapshot, null, 2);

  const result = await commitFileToGitHub({
    path: "public/data/store.json",
    content: jsonContent,
    isBase64: false,
    message: `⚡ نشر المتجر: ${reason} [${new Date().toLocaleString("ar-EG")}]`,
  });

  return { ok: true, result, snapshot };
}

/**
 * Uploads a binary media file (image/video) directly to public/uploads/ on GitHub Pages
 */
export async function uploadMediaToGitHub(file, folder = "public/uploads") {
  if (!file) throw new Error("لم يتم تمرير أي ملف للرفع.");

  const cfg = getGitHubConfig();
  if (!cfg.isConfigured) {
    throw new Error("النشر السحابي غير مفعل. أدخل بيانات GitHub في الإعدادات.");
  }

  const ext = (file.name ? file.name.split(".").pop() : "") || (file.type?.includes("video") ? "mp4" : "webp");
  const fileName = `media_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const filePath = `${folder}/${fileName}`;

  const base64 = await fileToBase64Raw(file);

  await commitFileToGitHub({
    path: filePath,
    content: base64,
    isBase64: true,
    message: `📸 رفع وسائط: ${fileName}`,
    config: cfg,
  });

  // Relative public URL on GitHub Pages
  const pagesUrl = `./uploads/${fileName}`;
  // Direct raw CDN fallback URL
  const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(cfg.githubOwner)}/${encodeURIComponent(cfg.githubRepo)}/${encodeURIComponent(cfg.githubBranch)}/${filePath}`;

  return {
    url: pagesUrl,
    rawUrl,
    fileName,
    size: file.size,
  };
}

/**
 * Triggers a 1-click browser download of the full store backup (store.json)
 */
export function downloadStoreBackup() {
  const snapshot = buildStoreSnapshot("Offline Backup");
  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `sodfa_store_backup_${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Restores store data from an imported store.json file content
 */
export function restoreStoreFromData(data) {
  if (!data || typeof data !== "object") {
    throw new Error("ملف البيانات غير صالح أو فارغ.");
  }

  if (data.settings && typeof data.settings === "object") {
    saveStoreSettings(data.settings);
  }
  if (Array.isArray(data.products)) {
    saveStoredProducts(data.products);
  }
  if (Array.isArray(data.categories)) {
    saveStoredCategories(data.categories);
  }
  if (Array.isArray(data.tickerItems)) {
    saveTickerItems(data.tickerItems);
  }
  if (Array.isArray(data.adminUsers)) {
    saveAdminUsers(data.adminUsers);
  }
  if (Array.isArray(data.orders)) {
    saveOrders(data.orders);
  }

  return true;
}
