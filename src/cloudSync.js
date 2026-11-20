// Sodfa Watch Store - Cross-Device Sync & GitHub Pages Data Engine (2026)
// Provides seamless real-time persistence across:
// Store Settings, Admin Accounts (e.g. Hager Samir), Products, Categories, Ticker Items, and Customer Orders.
// 100% Free Hosting via GitHub Pages + public/data/store.json + GitHub REST API.

import {
  getStoreSettings,
  saveStoreSettings,
  getAdminUsers,
  saveAdminUsers,
  getStoredProducts,
  saveStoredProducts,
  getStoredCategories,
  saveStoredCategories,
  getTickerItems,
  saveTickerItems,
  getOrders,
  saveOrders,
} from "./data.js";

import {
  getGitHubConfig,
  publishStoreToGitHub,
} from "./githubSync.js";
import { fetchStoreDirectFromTurso } from "./tursoDirect.js";

// In-memory sync state
let syncInProgress = false;
let lastSyncTimestamp = 0;
let syncBroadcastChannel = null;
let githubDebounceTimer = null;

// Initialize BroadcastChannel for instant cross-tab / cross-window sync on the same device
if (typeof window !== "undefined" && "BroadcastChannel" in window) {
  try {
    syncBroadcastChannel = new BroadcastChannel("sodfa_cross_tab_sync");
    syncBroadcastChannel.onmessage = (event) => {
      const { key, data } = event.data || {};
      if (key && data) {
        handleIncomingData(key, data, false);
      }
    };
  } catch {}
}

/**
 * Returns current GitHub sync status and config
 */
export function getCloudSyncConfig() {
  const gh = getGitHubConfig();
  return {
    ...gh,
    mode: gh.isConfigured ? "github" : "local",
  };
}

/**
 * Pushes a data mutation to other tabs, local server, and GitHub Pages (if configured)
 */
export async function pushCloudState(key, data) {
  if (typeof window === "undefined" || !key || data === undefined) return;

  // 1. Broadcast to other tabs on same device immediately
  if (syncBroadcastChannel) {
    try {
      syncBroadcastChannel.postMessage({ key, data, timestamp: Date.now() });
    } catch {}
  }

  const payload = {
    key,
    value: data,
    updated_at: new Date().toISOString(),
  };

  // 2. Try Vercel Serverless /api endpoints (Turso DB live sync)
  try {
    let sessionRaw = "";
    let token = "";
    try {
      sessionRaw = sessionStorage.getItem("daffa_admin_session") || localStorage.getItem("daffa_admin_session") || "";
      if (sessionRaw) {
        const parsed = JSON.parse(sessionRaw);
        token = parsed.token || "";
      }
    } catch {}

    const authHeaders = { "Content-Type": "application/json" };
    if (token) authHeaders["Authorization"] = `Bearer ${token}`;
    if (token) authHeaders["x-admin-token"] = token;
    if (sessionRaw) authHeaders["x-admin-session"] = sessionRaw;

    if (key === "store_settings") {
      fetch("/api/settings", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ settings: data }),
      }).catch(() => {});
    } else if (key === "ticker_items") {
      fetch("/api/settings", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ tickerItems: data }),
      }).catch(() => {});
    } else if (key === "categories") {
      fetch("/api/settings", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ categories: data }),
      }).catch(() => {});
    } else if (key === "products" && data && !Array.isArray(data)) {
      // Single product push
      fetch("/api/products", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(data),
      }).catch(() => {});
    }
  } catch {}

  // 3. Try Local Server API (when running in local dev / on network)
  try {
    fetch(`/api/sync/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {}

  // 4. Auto-publish to GitHub if admin has configured GitHub token
  const ghConfig = getGitHubConfig();
  if (ghConfig.isConfigured && (key === "products" || key === "orders" || key === "store_settings")) {
    clearTimeout(githubDebounceTimer);
    githubDebounceTimer = setTimeout(() => {
      publishStoreToGitHub({ reason: `تحديث تلقائي: ${key}` }).catch((err) => {
        console.warn("Background GitHub publish skipped:", err?.message || err);
      });
    }, 2500);
  }
}

/**
 * Handles incoming cloud/static data and merges safely into localStorage
 */
export function handleIncomingData(key, cloudData, dispatchEvents = true) {
  if (cloudData === null || cloudData === undefined) return;

  switch (key) {
    case "store_settings": {
      const current = getStoreSettings();
      if (cloudData && typeof cloudData === "object") {
        const merged = { ...current, ...cloudData };
        try {
          localStorage.setItem("daffa_store_settings", JSON.stringify(merged));
          if (dispatchEvents && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("daffa:settings-updated", { detail: merged }));
          }
        } catch {}
      }
      break;
    }

    case "admin_users": {
      const currentUsers = getAdminUsers();
      if (Array.isArray(cloudData) && cloudData.length > 0) {
        const map = new Map();
        cloudData.forEach((u) => { if (u && u.id) map.set(u.id, u); });
        currentUsers.forEach((u) => { if (u && u.id && !map.has(u.id)) map.set(u.id, u); });
        const mergedUsers = Array.from(map.values());
        try {
          localStorage.setItem("daffa_admin_users", JSON.stringify(mergedUsers));
          localStorage.setItem("daffa_admin_users_v2", JSON.stringify(mergedUsers));
        } catch {}
      }
      break;
    }

    case "orders": {
      const currentOrders = getOrders();
      if (Array.isArray(cloudData)) {
        const map = new Map();
        currentOrders.forEach((o) => { if (o && o.id) map.set(String(o.id), o); });
        cloudData.forEach((o) => {
          if (o && o.id) {
            const strId = String(o.id);
            map.set(strId, { ...(map.get(strId) || {}), ...o });
          }
        });
        const mergedOrders = Array.from(map.values()).sort(
          (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
        );
        try {
          localStorage.setItem("daffa_orders", JSON.stringify(mergedOrders));
          if (dispatchEvents && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("daffa:orders-updated", { detail: mergedOrders }));
          }
        } catch {}
      }
      break;
    }

    case "products": {
      if (Array.isArray(cloudData) && cloudData.length > 0) {
        try {
          localStorage.setItem("daffa_custom_products", JSON.stringify(cloudData));
          if (dispatchEvents && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("daffa:products-updated", { detail: cloudData }));
          }
        } catch {}
      }
      break;
    }

    case "categories": {
      if (Array.isArray(cloudData) && cloudData.length > 0) {
        try {
          localStorage.setItem("daffa_custom_categories", JSON.stringify(cloudData));
          if (dispatchEvents && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("daffa:categories-updated", { detail: cloudData }));
          }
        } catch {}
      }
      break;
    }

    case "ticker_items": {
      if (Array.isArray(cloudData) && cloudData.length > 0) {
        try {
          localStorage.setItem("daffa_ticker_items", JSON.stringify(cloudData));
          if (dispatchEvents && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("daffa:ticker-updated", { detail: cloudData }));
          }
        } catch {}
      }
      break;
    }
  }
}

/**
 * Pulls a specific key from GitHub Pages static store.json or local server
 */
export async function pullCloudState(key) {
  // 1. Try Vercel Serverless / Turso endpoint directly
  try {
    if (key === "orders") {
      let token = "";
      try {
        const sessionRaw = sessionStorage.getItem("daffa_admin_session") || localStorage.getItem("daffa_admin_session");
        if (sessionRaw) token = JSON.parse(sessionRaw)?.token || "";
      } catch {}

      const headers = { Accept: "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`/api/orders?t=${Date.now()}`, { headers, cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        if (json.ok && Array.isArray(json.orders)) return json.orders;
      }
    } else {
      const res = await fetch(`/api/store?t=${Date.now()}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.ok) {
          if (key === "products") return data.products || [];
          if (key === "settings" || key === "store_settings") return data.settings || {};
          if (key === "categories") return data.categories || [];
          if (key === "ticker_items") return data.tickerItems || [];
          if (data[key] !== undefined) return data[key];
        }
      }
    }
  } catch {}

  // 2. Fallback to GitHub Pages static store.json
  try {
    const res = await fetch(`./data/store.json?t=${Date.now()}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      if (key === "orders") return data.orders || [];
      if (key === "products") return data.products || [];
      if (key === "settings" || key === "store_settings") return data.settings || {};
      if (key === "categories") return data.categories || [];
      if (key === "ticker_items") return data.tickerItems || [];
      return data[key] || null;
    }
  } catch {}

  try {
    const res = await fetch(`/api/sync/${encodeURIComponent(key)}`);
    if (res.ok) {
      const json = await res.json();
      return json.value;
    }
  } catch {}

  return null;
}

/**
 * Synchronizes store data from Vercel Serverless / Turso (/api/store), GitHub Pages, or local server
 */
export async function syncAllCloudData(options = { dispatchEvents: true }) {
  if (syncInProgress) return false;
  syncInProgress = true;

  try {
    // 0. Fetch live data directly from Turso Cloud DB (100% resilient across Mobile & Laptop)
    try {
      const directData = await fetchStoreDirectFromTurso();
      if (directData && directData.ok) {
        if (directData.settings) handleIncomingData("store_settings", directData.settings, options.dispatchEvents);
        if (directData.products) handleIncomingData("products", directData.products, options.dispatchEvents);
        if (directData.categories) handleIncomingData("categories", directData.categories, options.dispatchEvents);
        if (directData.tickerItems) handleIncomingData("ticker_items", directData.tickerItems, options.dispatchEvents);

        lastSyncTimestamp = Date.now();
        return true;
      }
    } catch {}

    // 1. Fetch live storefront data from Serverless Turso /api/store first
    try {
      const apiRes = await fetch(`/api/store?t=${Date.now()}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      if (apiRes.ok) {
        const storeData = await apiRes.json();
        if (storeData && storeData.ok) {
          if (storeData.settings) handleIncomingData("store_settings", storeData.settings, options.dispatchEvents);
          if (storeData.products) handleIncomingData("products", storeData.products, options.dispatchEvents);
          if (storeData.categories) handleIncomingData("categories", storeData.categories, options.dispatchEvents);
          if (storeData.tickerItems) handleIncomingData("ticker_items", storeData.tickerItems, options.dispatchEvents);

          lastSyncTimestamp = Date.now();
          return true;
        }
      }
    } catch (err) {
      // Serverless API offline or not available
    }

    // 2. Fetch public/data/store.json from GitHub Pages / static host
    try {
      const storeRes = await fetch(`./data/store.json?t=${Date.now()}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      if (storeRes.ok) {
        const storeData = await storeRes.json();
        if (storeData && typeof storeData === "object") {
          if (storeData.settings) handleIncomingData("store_settings", storeData.settings, options.dispatchEvents);
          if (storeData.products) handleIncomingData("products", storeData.products, options.dispatchEvents);
          if (storeData.categories) handleIncomingData("categories", storeData.categories, options.dispatchEvents);
          if (storeData.tickerItems) handleIncomingData("ticker_items", storeData.tickerItems, options.dispatchEvents);
          if (storeData.adminUsers) handleIncomingData("admin_users", storeData.adminUsers, options.dispatchEvents);
          if (storeData.orders) handleIncomingData("orders", storeData.orders, options.dispatchEvents);

          lastSyncTimestamp = Date.now();
          return true;
        }
      }
    } catch (err) {
      // Static file fetch skipped or offline
    }

    // 2. Fallback to Local Express Server API (if developing locally)
    try {
      const res = await fetch("/api/sync", { headers: { Accept: "application/json" } });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === "object") {
          for (const [key, val] of Object.entries(data)) {
            handleIncomingData(key, val, options.dispatchEvents);
          }
          lastSyncTimestamp = Date.now();
          return true;
        }
      }
    } catch {}
  } finally {
    syncInProgress = false;
  }
  return false;
}

/**
 * Initializes continuous data synchronization
 */
export function initCloudSync() {
  if (typeof window === "undefined") return;

  // 1. Immediate pull on startup
  syncAllCloudData({ dispatchEvents: true });

  // 2. Re-sync whenever user returns to tab or mobile screen unlocks
  if (typeof document !== "undefined" && "addEventListener" in document) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        if (Date.now() - lastSyncTimestamp > 4000) {
          syncAllCloudData({ dispatchEvents: true });
        }
      }
    });

    window.addEventListener("focus", () => {
      if (Date.now() - lastSyncTimestamp > 4000) {
        syncAllCloudData({ dispatchEvents: true });
      }
    });
  }

  // 3. Background periodic sync every 15 seconds
  setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      syncAllCloudData({ dispatchEvents: true });
    }
  }, 15000);

  // 4. Auto-push to cloud whenever local mutations occur
  window.addEventListener("daffa:settings-updated", (e) => pushCloudState("store_settings", e.detail));
  window.addEventListener("daffa:products-updated", (e) => pushCloudState("products", e.detail));
  window.addEventListener("daffa:orders-updated", (e) => pushCloudState("orders", e.detail));
  window.addEventListener("daffa:categories-updated", (e) => pushCloudState("categories", e.detail));
  window.addEventListener("daffa:ticker-updated", (e) => pushCloudState("ticker_items", e.detail));
  window.addEventListener("daffa:admin-users-updated", (e) => pushCloudState("admin_users", e.detail));
}
