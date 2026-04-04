/**
 * GET    /api/dashboard/[id] — Load a single dashboard by ID.
 * PUT    /api/dashboard/[id] — Update dashboard spec (saves old spec as version).
 * DELETE /api/dashboard/[id] — Delete dashboard and its versions (cascade).
 *
 * Error codes:
 *   400 — Invalid ID or body
 *   404 — Dashboard not found
 *   500 — Unexpected error
 */

import { NextRequest, NextResponse } from "next/server";
import { sql, getPool } from "@/lib/db-write";
import { validateSpec } from "@/lib/schema";
import { ZodError } from "zod";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Parse and validate the ID parameter as a positive integer.
 * Returns the numeric ID or null if invalid.
 */
function parseId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

// ─── GET: Load dashboard ──────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id === null) {
    return NextResponse.json(
      { error: "Invalid dashboard ID — must be a positive integer" },
      { status: 400 },
    );
  }

  try {
    const rows = await sql(
      `SELECT id, name, description, spec, created_at, updated_at
       FROM dashboards WHERE id = $1`,
      [id],
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Dashboard not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(rows[0]);
  } catch {
    return NextResponse.json(
      { error: "Failed to load dashboard" },
      { status: 500 },
    );
  }
}

// ─── PUT: Update dashboard ────────────────────────────────────────────────

interface UpdateBody {
  spec?: unknown;
  prompt?: string;
  name?: string;
  skipVersion?: boolean;
}

export async function PUT(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id === null) {
    return NextResponse.json(
      { error: "Invalid dashboard ID — must be a positive integer" },
      { status: 400 },
    );
  }

  let body: UpdateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { error: "JSON body must be an object" },
      { status: 400 },
    );
  }

  const { spec, prompt, name, skipVersion } = body;

  // Validate name type if provided
  if (name !== undefined && name !== null) {
    if (typeof name !== "string" || name.trim() === "") {
      return NextResponse.json(
        { error: "Invalid 'name' — must be a non-empty string" },
        { status: 400 },
      );
    }
  }

  if (spec === undefined || spec === null) {
    return NextResponse.json(
      { error: "Missing 'spec' field" },
      { status: 400 },
    );
  }

  // Validate prompt type
  if (prompt !== undefined && prompt !== null && typeof prompt !== "string") {
    return NextResponse.json(
      { error: "Invalid 'prompt' — must be a string" },
      { status: 400 },
    );
  }

  try {
    validateSpec(spec);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid spec", details: err.issues },
        { status: 400 },
      );
    }
    throw err;
  }

  const normalizedPrompt =
    typeof prompt === "string" ? prompt.trim() || null : null;

  // Use a transaction to ensure version insert + dashboard update are atomic
  let client;
  try {
    client = await getPool().connect();
  } catch {
    return NextResponse.json(
      { error: "Failed to update dashboard" },
      { status: 500 },
    );
  }

  try {
    await client.query("BEGIN");

    // Fetch existing dashboard (lock row for update)
    const existingResult = await client.query(
      `SELECT id, spec FROM dashboards WHERE id = $1 FOR UPDATE`,
      [id],
    );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Dashboard not found" },
        { status: 404 },
      );
    }

    // Save old spec as a version (skip for name-only changes)
    if (!skipVersion) {
      await client.query(
        `INSERT INTO dashboard_versions (dashboard_id, spec, prompt)
         VALUES ($1, $2, $3)`,
        [id, JSON.stringify(existingResult.rows[0].spec), normalizedPrompt],
      );
    }

    // Update the dashboard (include name if provided)
    const trimmedName = typeof name === "string" ? name.trim() : null;
    const updateResult = await client.query(
      `UPDATE dashboards
       SET spec = $1, updated_at = NOW()${trimmedName ? ", name = $3" : ""}
       WHERE id = $2
       RETURNING id, name, description, spec, created_at, updated_at`,
      trimmedName
        ? [JSON.stringify(spec), id, trimmedName]
        : [JSON.stringify(spec), id],
    );

    await client.query("COMMIT");

    if (updateResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Dashboard not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(updateResult.rows[0]);
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json(
      { error: "Failed to update dashboard" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

// ─── DELETE: Delete dashboard ─────────────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id === null) {
    return NextResponse.json(
      { error: "Invalid dashboard ID — must be a positive integer" },
      { status: 400 },
    );
  }

  try {
    const rows = await sql(
      `DELETE FROM dashboards WHERE id = $1 RETURNING id`,
      [id],
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Dashboard not found" },
        { status: 404 },
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json(
      { error: "Failed to delete dashboard" },
      { status: 500 },
    );
  }
}
