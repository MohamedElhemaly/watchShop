import express from "express";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { beginLogin, finishLogin, getAdminStatus, logout, requireAdmin, requireCsrf } from "./auth.js";
import { closeDatabase, getPool, migrate } from "./db.js";
import categoriesRouter from "./routes/categories.js";
import productsRouter from "./routes/products.js";
import settingsRouter from "./routes/settings.js";
import uploadsRouter from "./routes/uploads.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = express();
const httpServer = createServer(app);
const port = Number(process.env.PORT || 3000);

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use("/api", (_request, response, next) => {
  response.set("Cache-Control", "private, no-store, max-age=0");
  response.vary("Cookie");
  next();
});

app.get("/api/health", async (_request, response) => {
  try {
    await getPool().query("SELECT 1");
    return response.status(200).json({ ok: true });
  } catch {
    return response.status(503).json({ ok: false });
  }
});

app.get("/api/auth/me", getAdminStatus);
app.post("/api/auth/start", beginLogin);
app.get("/api/auth/callback", finishLogin);
app.post("/api/auth/logout", requireAdmin, requireCsrf, logout);
app.use("/api", categoriesRouter);
app.use("/api", productsRouter);
app.use("/api", settingsRouter);
app.use("/api/admin/uploads", uploadsRouter);

// Cross-device local network sync endpoint (Zero-config fallback)
const syncFile = path.join(rootDir, "server", "sync_state.json");
async function readSyncData() {
  try {
    const raw = await readFile(syncFile, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
async function writeSyncData(data) {
  try {
    await writeFile(syncFile, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.warn("Could not save sync data to disk:", err?.message || err);
  }
}

app.get("/api/sync", async (_req, res) => {
  const data = await readSyncData();
  res.json(data);
});

app.get("/api/sync/:key", async (req, res) => {
  const data = await readSyncData();
  const val = data[req.params.key];
  if (val !== undefined) {
    res.json({ key: req.params.key, value: val });
  } else {
    res.status(404).json({ error: "Key not found" });
  }
});

app.post("/api/sync/:key", async (req, res) => {
  const data = await readSyncData();
  data[req.params.key] = req.body?.value !== undefined ? req.body.value : req.body;
  await writeSyncData(data);
  res.json({ ok: true, key: req.params.key });
});

if (process.env.NODE_ENV === "production") {
  const distDir = path.join(rootDir, "dist");
  app.get(["/admin", "/admin/"], (_request, response) => response.sendFile(path.join(distDir, "admin.html")));
  app.use(express.static(distDir, { index: false, fallthrough: true }));
  app.get("/", (_request, response) => response.sendFile(path.join(distDir, "index.html")));
} else {
  const vite = await createViteServer({
    configFile: path.join(rootDir, "vite.config.js"),
    root: rootDir,
    appType: "custom",
    server: { middlewareMode: true, hmr: { server: httpServer } },
  });
  app.use(vite.middlewares);
  app.get("/", async (request, response, next) => {
    try {
      const template = await readFile(path.join(rootDir, "index.html"), "utf8");
      response.status(200).type("html").send(await vite.transformIndexHtml(request.originalUrl, template));
    } catch (error) {
      next(error);
    }
  });
  app.get(["/admin", "/admin/"], async (request, response, next) => {
    try {
      const template = await readFile(path.join(rootDir, "admin.html"), "utf8");
      response.status(200).type("html").send(await vite.transformIndexHtml(request.originalUrl, template));
    } catch (error) {
      next(error);
    }
  });
  app.get("/product.html", async (request, response, next) => {
    try {
      const template = await readFile(path.join(rootDir, "product.html"), "utf8");
      response.status(200).type("html").send(await vite.transformIndexHtml(request.originalUrl, template));
    } catch (error) {
      next(error);
    }
  });
}

app.use((_request, response) => response.status(404).send("غير موجود"));
app.use((error, _request, response, _next) => {
  if (response.headersSent) return;
  const status = Number(error?.status || error?.statusCode || 500);
  if (status >= 500) console.error("Application request failed:", error?.message || "unknown error");
  const message = status === 413 ? "حجم الملف أكبر من الحد المسموح." : "حدث خطأ غير متوقع. حاول مرة أخرى.";
  return response.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
});

try {
  await migrate();
  httpServer.listen(port, "0.0.0.0", () => console.log(`صُدْفَة listening on ${port}`));
} catch (error) {
  console.error("Application startup failed:", error?.message || "unknown error");
  await closeDatabase().catch(() => {});
  process.exitCode = 1;
}

async function shutdown() {
  httpServer.close(async () => {
    await closeDatabase().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
