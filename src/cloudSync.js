// Sodfa Watch Store - Cross-Device Cloud Sync Engine (2026)
// Provides seamless real-time persistence between PC & Mobile across:
// Store Settings, Admin Accounts (e.g. Hager Samir), Products, Categories, Ticker Items, and Customer Orders.

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

// In-memory sync state
let syncInProgress = false;
let lastSyncTimestamp = 0;
let syncBroadcastChannel = null;

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
 * Returns current cloud connection status and config
 */
export function getCloudSyncConfig() {
  const settings = getStoreSettings();
  let supabaseUrl = (settings.supabaseUrl || "").trim();
  let supabaseAnonKey = (settings.supabaseAnonKey || "").trim();

  // Also check Vite environment variables if defined
  if (typeof import.meta !== "undefined" && import.meta.env) {
    if (!supabaseUrl && import.meta.env.VITE_SUPABASE_URL) {
      supabaseUrl = import.meta.env.VITE_SUPABASE_URL.trim();
    }
    if (!supabaseAnonKey && import.meta.env.VITE_SUPABASE_ANON_KEY) {
      supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY.trim();
    }
  }

  const isConfigured = Boolean(supabaseUrl && supabaseAnonKey);
  return {
    supabaseUrl: supabaseUrl.replace(/\/$/, ""),
    supabaseAnonKey,
    isConfigured,
  };
}

/**
 * Tests connection to a Supabase project by performing a lightweight query
 */
export async function testSupabaseConnection(url, anonKey) {
  const cleanUrl = String(url || "").trim().replace(/\/$/, "");
  const cleanKey = String(anonKey || "").trim();
  if (!cleanUrl || !cleanKey) {
    return { ok: false, message: "يرجى إدخال رابط المشروع (Project URL) ومفتاح الوصول (Anon Key)." };
  }

  try {
    const res = await fetch(`${cleanUrl}/rest/v1/sodfa_sync?select=key&limit=1`, {
      method: "GET",
      headers: {
        apikey: cleanKey,
        Authorization: `Bearer ${cleanKey}`,
        Accept: "application/json",
      },
    });

    if (res.ok) {
      return { ok: true, message: "تم الاتصال بـ Supabase بنجاح! جدول sodfa_sync متاح ومتصل." };
    }

    if (res.status === 404 || res.status === 400) {
      // Table might not exist yet, but credentials are valid
      const authCheck = await fetch(`${cleanUrl}/rest/v1/`, {
        headers: { apikey: cleanKey, Authorization: `Bearer ${cleanKey}` },
      });
      if (authCheck.ok) {
        return {
          ok: true,
          tableMissing: true,
          message: "بيانات الاعتماد صحيحة! ولكن جدول 'sodfa_sync' يحتاج إلى إنشاء في Supabase SQL Editor.",
        };
      }
    }

    return { ok: false, message: `فشل الاتصال: رمز الاستجابة ${res.status}` };
  } catch (err) {
    return { ok: false, message: `تعذر الوصول إلى الرابط: ${err.message}` };
  }
}

/**
 * Pushes a single data key to the cloud (Supabase and local server API)
 */
export async function pushCloudState(key, data) {
  if (typeof window === "undefined" || !key || data === undefined) return;

  // Broadcast to other tabs on same device immediately
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

  const { supabaseUrl, supabaseAnonKey, isConfigured } = getCloudSyncConfig();

  // 1. Try Supabase if configured
  if (isConfigured) {
    try {
      await fetch(`${supabaseUrl}/rest/v1/sodfa_sync`, {
        method: "POST",
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.warn("Supabase push failed for key:", key, err);
    }
  }

  // 2. Try Local Server API (when running in local dev / on network)
  try {
    await fetch(`/api/sync/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Server offline or static deployment
  }
}

/**
 * Pulls a specific key from cloud (Supabase or local server API)
 */
export async function pullCloudState(key) {
  if (typeof window === "undefined" || !key) return null;

  const { supabaseUrl, supabaseAnonKey, isConfigured } = getCloudSyncConfig();

  // 1. Try Supabase
  if (isConfigured) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/sodfa_sync?key=eq.${encodeURIComponent(key)}&select=*`, {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          Accept: "application/json",
        },
      });
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].value !== undefined) {
          return rows[0].value;
        }
      }
    } catch (err) {
      console.warn("Supabase pull failed for key:", key, err);
    }
  }

  // 2. Try Local Server API
  try {
    const res = await fetch(`/api/sync/${encodeURIComponent(key)}`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.value !== undefined) {
        return data.value;
      }
    }
  } catch {
    // Offline
  }

  return null;
}

/**
 * Handles incoming cloud data and merges safely into localStorage
 */
function handleIncomingData(key, cloudData, dispatchEvents = true) {
  if (cloudData === null || cloudData === undefined) return;

  switch (key) {
    case "store_settings": {
      const current = getStoreSettings();
      // Only merge if cloud has meaningful settings
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
        // Merge users preserving any local unique users
        const map = new Map();
        cloudData.forEach((u) => { if (u && u.id) map.set(u.id, u); });
        currentUsers.forEach((u) => { if (u && u.id && !map.has(u.id)) map.set(u.id, u); });
        const mergedUsers = Array.from(map.values());
        try {
          localStorage.setItem("daffa_admin_users_v2", JSON.stringify(mergedUsers));
        } catch {}
      }
      break;
    }

    case "orders": {
      const currentOrders = getOrders();
      if (Array.isArray(cloudData)) {
        // Merge orders by ID, favoring the most updated status
        const map = new Map();
        currentOrders.forEach((o) => { if (o && o.id) map.set(String(o.id), o); });
        cloudData.forEach((o) => {
          if (o && o.id) {
            const strId = String(o.id);
            // Cloud has priority for status updates made on admin
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
 * Synchronizes all store data from cloud to local cache
 */
export async function syncAllCloudData(options = { dispatchEvents: true }) {
  if (syncInProgress) return;
  syncInProgress = true;

  try {
    const { supabaseUrl, supabaseAnonKey, isConfigured } = getCloudSyncConfig();

    // 1. Pull from Supabase if configured
    if (isConfigured) {
      try {
        const res = await fetch(`${supabaseUrl}/rest/v1/sodfa_sync?select=*`, {
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${supabaseAnonKey}`,
            Accept: "application/json",
          },
        });
        if (res.ok) {
          const rows = await res.json();
          if (Array.isArray(rows) && rows.length > 0) {
            for (const row of rows) {
              if (row && row.key && row.value !== undefined) {
                handleIncomingData(row.key, row.value, options.dispatchEvents);
              }
            }
            lastSyncTimestamp = Date.now();
            return true;
          }
        }
      } catch (err) {
        console.warn("Supabase syncAll failed:", err);
      }
    }

    // 2. Pull from Local Server API
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
    } catch {
      // Local server offline
    }
  } finally {
    syncInProgress = false;
  }
  return false;
}

/**
 * Initializes continuous cloud synchronization
 */
export function initCloudSync() {
  if (typeof window === "undefined") return;

  // 1. Immediate pull on startup
  syncAllCloudData({ dispatchEvents: true });

  // 2. Re-sync whenever user returns to the tab or mobile screen unlocks
  if (typeof document !== "undefined" && "addEventListener" in document) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        // Throttle to once every 4 seconds
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

  // 3. Background periodic sync every 12 seconds
  setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      syncAllCloudData({ dispatchEvents: true });
    }
  }, 12000);

  // 4. Auto-push to cloud whenever local mutations occur
  window.addEventListener("daffa:settings-updated", (e) => pushCloudState("store_settings", e.detail));
  window.addEventListener("daffa:products-updated", (e) => pushCloudState("products", e.detail));
  window.addEventListener("daffa:orders-updated", (e) => pushCloudState("orders", e.detail));
  window.addEventListener("daffa:categories-updated", (e) => pushCloudState("categories", e.detail));
  window.addEventListener("daffa:ticker-updated", (e) => pushCloudState("ticker_items", e.detail));
  window.addEventListener("daffa:admin-users-updated", (e) => pushCloudState("admin_users", e.detail));
}
