/**
 * POST /api/conversations
 *
 * Creates a conversation row and returns the conversation id plus both
 * viewer URLs: `/c/<id>` (chat-only) and `/k/<id>` (in-context).
 *
 * Body: {
 *   mode: string,
 *   context_kind?: string,
 *   context_ref?: string,
 *   context_url?: string,
 *   seed_prompt?: string,
 *   first_user_prompt?: string,
 * }
 *
 * Response: { id, c_url, k_url }
 */

import { NextResponse } from "next/server";
import { createConversation } from "@/lib/conversations";
import { generateRequestId } from "@/lib/errors";

export async function POST(req: Request) {
  const requestId = generateRequestId();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "INVALID_BODY", requestId },
      { status: 400 },
    );
  }

  const mode = body.mode;
  if (typeof mode !== "string" || !mode) {
    return NextResponse.json(
      { error: "`mode` is required", code: "MISSING_MODE", requestId },
      { status: 400 },
    );
  }

  try {
    const result = await createConversation({
      mode,
      context_kind:
        typeof body.context_kind === "string" ? body.context_kind : null,
      context_ref:
        typeof body.context_ref === "string" ? body.context_ref : null,
      context_url:
        typeof body.context_url === "string" ? body.context_url : null,
      seed_prompt:
        typeof body.seed_prompt === "string" ? body.seed_prompt : null,
      first_user_prompt:
        typeof body.first_user_prompt === "string"
          ? body.first_user_prompt
          : null,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[POST /api/conversations] error:", err);
    return NextResponse.json(
      {
        error: "Failed to create conversation",
        code: "DB_ERROR",
        requestId,
      },
      { status: 500 },
    );
  }
}
