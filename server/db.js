import mysql from "mysql2/promise";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
let pool;

function connectionOptions(databaseUrl) {
  const url = new URL(databaseUrl);
  if (!["mysql:", "mysql2:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must use a MySQL connection scheme.");
  }

  const sslValue = url.searchParams.get("ssl");
  const sslMode = String(url.searchParams.get("ssl-mode") || url.searchParams.get("sslMode") || "").toLowerCase();
  let ssl;
  if (sslValue !== null) {
    const normalized = sslValue.trim().toLowerCase();
    if (["true", "1", "required", "require"].includes(normalized)) {
      ssl = { rejectUnauthorized: true };
    } else if (["false", "0", "disabled", "disable"].includes(normalized)) {
      ssl = false;
    } else {
      try {
        const parsed = JSON.parse(decodeURIComponent(sslValue));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        ssl = parsed;
      } catch {
        ssl = sslValue;
      }
    }
  } else if (sslMode) {
    if (["disabled", "disable", "off"].includes(sslMode)) ssl = false;
    else if (["required", "require", "preferred", "verify-ca", "verify-identity"].includes(sslMode)) {
      ssl = { rejectUnauthorized: true };
    } else {
      throw new Error("DATABASE_URL contains an unsupported TLS mode.");
    }
  }

  const options = {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    timezone: "Z",
    decimalNumbers: true,
    enableKeepAlive: true,
  };
  if (ssl !== undefined) options.ssl = ssl;

  const charset = url.searchParams.get("charset");
  if (charset) options.charset = charset;
  const connectTimeout = url.searchParams.get("connectTimeout");
  if (connectTimeout && Number.isInteger(Number(connectTimeout)) && Number(connectTimeout) > 0) {
    options.connectTimeout = Number(connectTimeout);
  }
  return options;
}

export function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Managed database is not configured.");
  }
  if (!pool) {
    pool = mysql.createPool(connectionOptions(process.env.DATABASE_URL));
  }
  return pool;
}

export async function migrate() {
  const migrationsDir = path.join(serverDir, "migrations");
  const files = (await readdir(migrationsDir))
    .filter((filename) => /^\d{3}_[a-z0-9_-]+\.sql$/i.test(filename))
    .sort();
  if (!files.length) throw new Error("No database migrations were found.");

  const connection = await getPool().getConnection();
  let migrationLockAcquired = false;
  try {
    const [lockRows] = await connection.execute("SELECT GET_LOCK(?, 30) AS acquired", ["sodfawatch_schema_migrations"]);
    migrationLockAcquired = Number(lockRows[0]?.acquired) === 1;
    if (!migrationLockAcquired) throw new Error("Timed out waiting for the database migration lock.");

    for (const filename of files) {
      const version = filename.slice(0, -4);
      const sql = await readFile(path.join(migrationsDir, filename), "utf8");
      const statements = sql.split(/;\s*(?:\r?\n|$)/).map((statement) => statement.trim()).filter(Boolean);
      if (!statements.length) throw new Error(`Migration ${version} is empty.`);

      // The first statement of the original migration creates this history table.
      if (version === "001_initial") await connection.query(statements.shift());

      const [applied] = await connection.execute(
        "SELECT version FROM sodfa_schema_migrations WHERE version = ? LIMIT 1",
        [version],
      );
      if (applied.length) continue;

      for (const statement of statements) await connection.query(statement);
      await connection.execute(
        "INSERT IGNORE INTO sodfa_schema_migrations (version) VALUES (?)",
        [version],
      );
    }
  } finally {
    if (migrationLockAcquired) {
      await connection.execute("SELECT RELEASE_LOCK(?)", ["sodfawatch_schema_migrations"]).catch(() => {});
    }
    connection.release();
  }
}

export async function closeDatabase() {
  if (pool) {
    const activePool = pool;
    pool = undefined;
    await activePool.end();
  }
}
