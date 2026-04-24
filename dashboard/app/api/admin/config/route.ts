/**
 * GET  /api/admin/config  — return all config keys with source/sensitivity metadata.
 *   Sensitive values are masked as "••••<last4>" (or "••••" if too short).
 *
 * PUT  /api/admin/config  — accept { updates: { key: value, … } } and write to config.yaml.
 *   ADMIN_API_KEY is not editable via this endpoint (controlled access guard).
 *
 * Both endpoints require a valid admin API key.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { adminApiKeyValid, adminUnauthorized } from "@/lib/admin-api-auth";
import { getSystemConfig, writeConfig } from "@/lib/system-config/loader";

// Keys that must NEVER be updated via the API (controlled by env/file only)
const READONLY_KEYS = new Set(["dashboard.admin_api_key"]);

// ---------------------------------------------------------------------------
// Masking helper
// ---------------------------------------------------------------------------

function maskValue(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.length === 0) return "";
  if (s.length <= 4) return "••••";
  return "••••" + s.slice(-4);
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!adminApiKeyValid(request)) {
    return adminUnauthorized();
  }

  const config = getSystemConfig();

  const values = Object.values(config).map((cv) => ({
    key: cv.key,
    env: cv.env,
    section: cv.section,
    description: cv.description,
    type: cv.type,
    sensitive: cv.sensitive,
    source: cv.source,
    requires_restart: cv.requires_restart,
    editable: !READONLY_KEYS.has(cv.key),
    // Sensitive keys: return masked value only; real value via /reveal
    value_display: cv.sensitive
      ? maskValue(cv.value)
      : cv.value !== null && cv.value !== undefined
        ? String(cv.value)
        : "",
    has_value: cv.value !== null && cv.value !== undefined && String(cv.value) !== "",
  }));

  // Group by section for UI rendering
  const sectionOrder: string[] = [];
  const sectionMap: Record<string, typeof values> = {};
  for (const v of values) {
    if (!sectionMap[v.section]) {
      sectionMap[v.section] = [];
      sectionOrder.push(v.section);
    }
    sectionMap[v.section].push(v);
  }
  const sections = sectionOrder.map((s) => ({ name: s, keys: sectionMap[s] }));

  return NextResponse.json({ sections, values });
}

// ---------------------------------------------------------------------------
// PUT
// ---------------------------------------------------------------------------

const PutSchema = z.object({
  updates: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

export async function PUT(request: NextRequest): Promise<NextResponse> {
  if (!adminApiKeyValid(request)) {
    return adminUnauthorized();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { updates } = parsed.data;

  // Reject attempts to update read-only keys
  const forbidden = Object.keys(updates).filter((k) => READONLY_KEYS.has(k));
  if (forbidden.length > 0) {
    return NextResponse.json(
      { error: `Keys are not editable via API: ${forbidden.join(", ")}` },
      { status: 403 },
    );
  }

  // Validate that all keys exist in schema and coerce/validate types
  const config = getSystemConfig();
  const unknown = Object.keys(updates).filter((k) => !config[k]);
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Unknown config keys: ${unknown.join(", ")}` },
      { status: 400 },
    );
  }

  // Type validation: coerce each value according to schema entry
  const validationErrors: string[] = [];
  for (const [key, value] of Object.entries(updates)) {
    const cv = config[key];
    if (!cv || value === null) continue;
    if (cv.type === "int") {
      // Use Number() + isInteger: same strictness as coerce() and Python int().
      const asNum = Number(String(value).trim());
      if (!Number.isInteger(asNum)) {
        validationErrors.push(`Key '${key}': expected int, got ${JSON.stringify(value)}`);
      }
    } else if (cv.type === "enum" && cv.enum_values && cv.enum_values.length > 0) {
      const v = String(value).trim();
      if (!cv.enum_values.includes(v)) {
        validationErrors.push(
          `Key '${key}': value ${JSON.stringify(v)} is not one of ${JSON.stringify(cv.enum_values)}`,
        );
      }
    }
  }
  if (validationErrors.length > 0) {
    return NextResponse.json(
      { error: "Type validation failed", details: validationErrors },
      { status: 400 },
    );
  }

  try {
    writeConfig(updates);
  } catch (err) {
    console.error("[config PUT] Failed to write config:", err);
    return NextResponse.json({ error: "Failed to write config file" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: Object.keys(updates) });
}
