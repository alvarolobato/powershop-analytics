/**
 * GET  /api/dashboards — List all dashboards (id, name, description, updated_at).
 * POST /api/dashboards — Create a new dashboard.
 *
 * Error codes:
 *   400 — Invalid body or spec validation failure
 *   500 — Unexpected error
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db-write";
import { validateSpec } from "@/lib/schema";
import { ZodError } from "zod";

// ─── GET: List dashboards ─────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  try {
    const rows = await sql(
      `SELECT id, name, description, updated_at
       FROM dashboards
       ORDER BY updated_at DESC`,
    );
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json(
      { error: "Failed to list dashboards" },
      { status: 500 },
    );
  }
}

// ─── POST: Create dashboard ───────────────────────────────────────────────

interface CreateBody {
  name?: string;
  description?: string;
  spec?: unknown;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: CreateBody;
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

  const { name, description, spec } = body;

  // Validate name
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json(
      { error: "Missing or empty 'name' field" },
      { status: 400 },
    );
  }

  // Validate spec
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

  // Insert
  try {
    const rows = await sql(
      `INSERT INTO dashboards (name, description, spec)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, spec, created_at, updated_at`,
      [name.trim(), description?.trim() || null, JSON.stringify(spec)],
    );
    return NextResponse.json(rows[0], { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to create dashboard" },
      { status: 500 },
    );
  }
}
