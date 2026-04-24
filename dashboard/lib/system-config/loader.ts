/**
 * Unified configuration loader for the Dashboard App.
 *
 * Precedence (highest → lowest):
 *   1. Real environment variables (process.env)
 *   2. config.yaml — path from CONFIG_FILE env var or /config/config.yaml
 *      (the /config directory is bind-mounted from ~/.config/powershop-analytics)
 *   3. Hardcoded defaults from config/schema.yaml
 *
 * In Docker the config dir is mounted at /config.
 * In local dev without Docker it falls back to ~/.config/powershop-analytics.
 *
 * Public API:
 *   getSystemConfig()         — cached; returns the merged config map
 *   resetConfigCache()        — invalidate in-process cache (tests + PUT handler)
 *   writeConfig(updates)      — write a partial update to config.yaml atomically
 *   importEnvToConfig()       — copy all env-sourced keys into config.yaml
 *   bootstrapConfigIfMissing()— create config.yaml from env+defaults on first start
 */

import fs from "fs";
import os from "os";
import path from "path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfigSource = "env" | "file" | "default";

export interface SchemaEntry {
  key: string;
  env: string;
  type: "string" | "int" | "bool" | "enum";
  enum_values?: string[];
  sensitive: boolean;
  default: string | number | boolean | null;
  section: string;
  description: string;
  requires_restart: string[];
  components?: string[];
}

export interface ConfigValue {
  value: string | number | boolean | null;
  source: ConfigSource;
  sensitive: boolean;
  key: string;
  env: string;
  section: string;
  description: string;
  requires_restart: string[];
  type: SchemaEntry["type"];
  enum_values?: string[];
  default: SchemaEntry["default"];
}

export type SystemConfig = Record<string, ConfigValue>;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function resolveSchemaPath(): string {
  // In Docker the app lives at /app (Next.js); schema is at /app/../config/schema.yaml
  // via COPY in Dockerfile. In dev it's relative to the dashboard dir.
  const candidates = [
    process.env.CONFIG_SCHEMA_PATH,
    path.resolve(process.cwd(), "..", "config", "schema.yaml"),
    path.resolve(process.cwd(), "config", "schema.yaml"),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Fallback: repo root relative to this file (for tests running in dashboard/)
  return path.resolve(__dirname, "..", "..", "..", "config", "schema.yaml");
}

function resolveConfigPath(): string {
  const fromEnv = process.env.CONFIG_FILE?.trim();
  if (fromEnv) return fromEnv;
  // Docker: /config is the bind-mounted directory
  if (fs.existsSync("/config")) return "/config/config.yaml";
  // Local dev fallback
  return path.join(os.homedir(), ".config", "powershop-analytics", "config.yaml");
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

let _schema: SchemaEntry[] | null = null;
let _schemaPath: string | null = null;

/**
 * Load schema from the given path (or the auto-resolved path if omitted).
 * The schema is cached; if a different path is requested the cache is reset.
 */
function loadSchema(schemaPath?: string): SchemaEntry[] {
  const resolvedPath = schemaPath ?? resolveSchemaPath();
  // Invalidate schema cache when a different path is requested (e.g., in tests)
  if (_schemaPath !== null && _schemaPath !== resolvedPath) {
    _schema = null;
  }
  if (_schema) return _schema;
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config schema not found: ${resolvedPath}`);
  }
  const raw = fs.readFileSync(resolvedPath, "utf-8");
  const parsed = parseYaml(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Config schema must be a YAML list");
  }
  _schema = parsed as SchemaEntry[];
  _schemaPath = resolvedPath;
  return _schema;
}

/** Reset schema cache as well as config cache (used in tests that provide a custom schema). */
export function resetSchemaCache(): void {
  _schema = null;
  _schemaPath = null;
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

function coerce(
  value: string | number | boolean | null | undefined,
  type: SchemaEntry["type"],
  key?: string,
  enumValues?: string[],
): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (type === "int") {
    const n = parseInt(String(value), 10);
    if (isNaN(n)) {
      throw new Error(
        `Config key${key ? ` '${key}'` : ""}: expected int, got ${JSON.stringify(value)}`,
      );
    }
    return n;
  }
  if (type === "bool") {
    if (typeof value === "boolean") return value;
    return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
  }
  if (type === "enum") {
    const coerced = String(value).trim();
    if (enumValues && enumValues.length > 0 && !enumValues.includes(coerced)) {
      throw new Error(
        `Config key${key ? ` '${key}'` : ""}: value ${JSON.stringify(coerced)} is not one of ${JSON.stringify(enumValues)}`,
      );
    }
    return coerced;
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

function loadFileData(configPath: string): Record<string, unknown> {
  if (!fs.existsSync(configPath)) return {};
  const content = fs.readFileSync(configPath, "utf-8");
  const parsed = parseYaml(content);
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("config.yaml must be a YAML mapping, not a list or scalar");
  }
  return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

let _cache: SystemConfig | null = null;

/** Reset the in-process cache (used after PUT /api/admin/config or in tests). */
export function resetConfigCache(): void {
  _cache = null;
}

/**
 * Load and return the merged system configuration.
 * Result is memoized; call resetConfigCache() to force a reload.
 *
 * @param opts.schemaPath Override the schema file path (useful in tests).
 * @param opts.configPath Override the config.yaml file path.
 * @param opts.noCache    Bypass and do not populate the in-process cache.
 */
export function getSystemConfig(opts?: {
  schemaPath?: string;
  configPath?: string;
  noCache?: boolean;
}): SystemConfig {
  if (_cache && !opts?.noCache) return _cache;

  const schema = loadSchema(opts?.schemaPath);
  const configPath = opts?.configPath ?? resolveConfigPath();
  const fileData = loadFileData(configPath);

  const result: SystemConfig = {};

  for (const entry of schema) {
    const envRaw = process.env[entry.env];
    const fileRaw = fileData[entry.key] as string | number | boolean | null | undefined;

    let source: ConfigSource;
    let raw: string | number | boolean | null;

    if (envRaw !== undefined && envRaw !== "") {
      source = "env";
      raw = envRaw;
    } else if (fileRaw !== undefined && fileRaw !== null) {
      source = "file";
      raw = fileRaw as string | number | boolean | null;
    } else if (entry.default !== null && entry.default !== undefined) {
      source = "default";
      raw = entry.default;
    } else {
      source = "default";
      raw = null;
    }

    result[entry.key] = {
      value: coerce(raw, entry.type, entry.key, entry.enum_values),
      source,
      sensitive: entry.sensitive,
      key: entry.key,
      env: entry.env,
      section: entry.section,
      description: entry.description,
      requires_restart: entry.requires_restart ?? [],
      type: entry.type,
      enum_values: entry.enum_values,
      default: entry.default,
    };
  }

  if (!opts?.noCache) {
    _cache = result;
  }
  return result;
}

/** Get a single config value. Returns null if key not found. */
export function getConfigValue(key: string): ConfigValue | null {
  return getSystemConfig()[key] ?? null;
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

/**
 * Write a partial update to config.yaml atomically (merge with existing).
 * File is written with mode 0o600.
 */
export function writeConfig(
  updates: Record<string, string | number | boolean | null>,
  opts?: { configPath?: string; comment?: string },
): void {
  const configPath = opts?.configPath ?? resolveConfigPath();

  // Ensure parent directory exists
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Merge with existing
  const existing = loadFileData(configPath);
  const merged = { ...existing, ...updates };

  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const comment = opts?.comment ? `# ${opts.comment}\n` : "";
  const header = [
    "# PowerShop Analytics — config.yaml",
    `# Last updated: ${timestamp}`,
    comment.trim(),
    "# Precedence: env vars > this file > hardcoded defaults.",
    "# Secrets in this file — keep permissions 0600; never commit.",
    "",
  ]
    .filter((l) => l !== undefined)
    .join("\n")
    .replace(/\n\n+/, "\n\n");

  const body = stringifyYaml(merged, { sortMapEntries: true });
  const content = header + "\n" + body;

  // Atomic write: write to temp file then rename.
  // Use a random suffix (not just pid) to avoid collisions with concurrent requests.
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  const tmpPath = configPath + ".tmp." + process.pid + "." + randomSuffix;
  try {
    fs.writeFileSync(tmpPath, content, { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmpPath, configPath);
    // Ensure permissions (renameSync preserves the mode we set above on most systems)
    fs.chmodSync(configPath, 0o600);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }
    throw err;
  }

  // Invalidate cache after write
  resetConfigCache();
}

/**
 * Copy all env-sourced keys into config.yaml.
 * Returns the list of keys that were imported.
 */
export function importEnvToConfig(opts?: { configPath?: string }): string[] {
  const config = getSystemConfig({ noCache: true, configPath: opts?.configPath });
  const toImport: Record<string, string | number | boolean | null> = {};
  const imported: string[] = [];

  for (const [key, cv] of Object.entries(config)) {
    if (cv.source === "env" && cv.value !== null) {
      toImport[key] = cv.value;
      imported.push(key);
    }
  }

  if (imported.length > 0) {
    writeConfig(toImport, {
      configPath: opts?.configPath,
      comment: "imported from environment variables",
    });
  }

  return imported;
}

/**
 * If config.yaml does not exist, create it from env + defaults.
 * Returns true if the file was created.
 */
export function bootstrapConfigIfMissing(opts?: { configPath?: string }): boolean {
  const configPath = opts?.configPath ?? resolveConfigPath();
  if (fs.existsSync(configPath)) return false;

  const config = getSystemConfig({ noCache: true, configPath });
  const values: Record<string, string | number | boolean | null> = {};

  for (const [key, cv] of Object.entries(config)) {
    if (cv.value !== null) {
      values[key] = cv.value;
    }
  }

  writeConfig(values, {
    configPath,
    comment: "auto-generated on first start",
  });
  return true;
}
