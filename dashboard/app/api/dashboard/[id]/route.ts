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
import { sql } from "@/lib/db-write";
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

  const { spec, prompt } = body;

  if (spec === undefined || spec === null) {
    return NextResponse.json(
      { error: "Missing 'spec' field" },
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

  try {
    // Fetch existing dashboard to save old spec as version
    const existing = await sql(
      `SELECT id, spec FROM dashboards WHERE id = $1`,
      [id],
    );

    if (existing.length === 0) {
      return NextResponse.json(
        { error: "Dashboard not found" },
        { status: 404 },
      );
    }

    // Save old spec as a version
    await sql(
      `INSERT INTO dashboard_versions (dashboard_id, spec, prompt)
       VALUES ($1, $2, $3)`,
      [id, JSON.stringify(existing[0].spec), prompt?.trim() || null],
    );

    // Update the dashboard
    const updated = await sql(
      `UPDATE dashboards
       SET spec = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, description, spec, created_at, updated_at`,
      [JSON.stringify(spec), id],
    );

    return NextResponse.json(updated[0]);
  } catch {
    return NextResponse.json(
      { error: "Failed to update dashboard" },
      { status: 500 },
    );
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
