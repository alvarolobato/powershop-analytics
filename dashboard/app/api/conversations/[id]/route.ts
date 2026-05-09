/**
 * GET  /api/conversations/:id  — fetch a single conversation (no messages)
 * PATCH /api/conversations/:id — update title or archived status
 *
 * PATCH body: { title?: string, archived?: boolean }
 *
 * DELETE is intentionally absent — conversations are archive-only per #503.
 */

import { NextResponse } from "next/server";
import {
  getConversation,
  updateConversationTitle,
  setConversationArchived,
} from "@/lib/conversations";
import { generateRequestId } from "@/lib/errors";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const { id } = params;
  try {
    const conv = await getConversation(id);
    if (!conv) {
      return NextResponse.json(
        { error: "Conversation not found", code: "NOT_FOUND" },
        { status: 404 },
      );
    }
    return NextResponse.json(conv);
  } catch (err) {
    console.error("[GET /api/conversations/:id] error:", err);
    return NextResponse.json(
      { error: "Failed to fetch conversation", code: "DB_ERROR" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const requestId = generateRequestId();
  const { id } = params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "INVALID_BODY", requestId },
      { status: 400 },
    );
  }

  try {
    const conv = await getConversation(id);
    if (!conv) {
      return NextResponse.json(
        { error: "Conversation not found", code: "NOT_FOUND", requestId },
        { status: 404 },
      );
    }

    if (typeof body.title === "string" && body.title.trim()) {
      await updateConversationTitle(id, body.title.trim());
    }

    if (typeof body.archived === "boolean") {
      await setConversationArchived(id, body.archived);
    }

    const updated = await getConversation(id);
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[PATCH /api/conversations/:id] error:", err);
    return NextResponse.json(
      { error: "Failed to update conversation", code: "DB_ERROR", requestId },
      { status: 500 },
    );
  }
}

// DELETE is intentionally absent — conversations can only be archived.
// Attempts to DELETE will return 405 Method Not Allowed (Next.js default).
