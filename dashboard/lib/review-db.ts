/**
 * Database helpers for the weekly_reviews table.
 *
 * Uses the write-capable pool from db-write.ts to persist and retrieve reviews.
 * The weekly_reviews table stores full review JSON in a JSONB column.
 */

import { sql } from "./db-write";
import type { ReviewContent } from "./review-prompts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReviewRow {
  id: number;
  week_start: string;
  content: ReviewContent;
  created_at: string;
}

export interface ReviewSummaryRow {
  id: number;
  week_start: string;
  executive_summary: string;
  created_at: string;
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Save a review to the database and return the new row ID.
 *
 * NOTE: This is a write operation — it bypasses validateReadOnly() by using
 * the write-capable pool directly from db-write.ts.
 * The weekly_reviews table is created via etl/schema/init.sql (not at runtime).
 */
export async function saveReview(
  weekStart: string,
  content: ReviewContent
): Promise<number> {
  const rows = await sql<{ id: number }>(
    `INSERT INTO weekly_reviews (week_start, content)
     VALUES ($1, $2)
     RETURNING id`,
    [weekStart, JSON.stringify(content)]
  );

  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("INSERT into weekly_reviews did not return an id");
  }
  return id;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * List reviews ordered by week_start DESC.
 * Returns summary rows (no full content — for list views).
 */
export async function getReviews(): Promise<ReviewSummaryRow[]> {
  const rows = await sql<{
    id: number;
    week_start: string;
    executive_summary: string;
    created_at: string;
  }>(
    `SELECT
       id,
       week_start::text,
       content->>'executive_summary' AS executive_summary,
       created_at
     FROM weekly_reviews
     ORDER BY week_start DESC, created_at DESC
     LIMIT 50`
  );

  return rows.map((r) => ({
    id: r.id,
    week_start: r.week_start,
    executive_summary: r.executive_summary ?? "",
    created_at: r.created_at,
  }));
}

/**
 * Get a single full review by ID.
 * Returns null if not found.
 */
export async function getReviewById(id: number): Promise<ReviewRow | null> {
  const rows = await sql<{
    id: number;
    week_start: string;
    content: ReviewContent;
    created_at: string;
  }>(
    `SELECT id, week_start::text, content, created_at
     FROM weekly_reviews
     WHERE id = $1`,
    [id]
  );

  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    id: r.id,
    week_start: r.week_start,
    content: r.content,
    created_at: r.created_at,
  };
}
