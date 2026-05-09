/**
 * GET  /api/conversations — list conversations with filters and pagination
 * POST /api/conversations — create a new conversation
 */

import { NextRequest, NextResponse } from "next/server";
import {
  listConversations,
  createConversation,
} from "@/lib/conversations";
import { formatApiError, generateRequestId, sanitizeErrorMessage } from "@/lib/errors";

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = generateRequestId();
  const { searchParams } = new URL(request.url);

  const include_archived = searchParams.get("include_archived") === "true";
  const context_kind = searchParams.get("context_kind") ?? undefined;
  const context_ref = searchParams.get("context_ref") ?? undefined;
  const mode = searchParams.get("mode") ?? undefined;
  const since = searchParams.get("since") ?? undefined;
  const q = searchParams.get("q") ?? undefined;
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  try {
    const rows = await listConversations({
      include_archived,
      context_kind,
      context_ref,
      mode,
      since,
      q,
      page: isNaN(page) ? 1 : page,
      limit: isNaN(limit) ? 50 : limit,
    });
    return NextResponse.json(rows);
  } catch (err) {
    console.error(`[${requestId}] GET /api/conversations error:`, err);
    return NextResponse.json(
      formatApiError(
        "No se pudieron cargar las conversaciones.",
        "DB_QUERY",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 500 },
    );
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = generateRequestId();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      formatApiError("El cuerpo de la solicitud no es JSON válido.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      formatApiError("El cuerpo debe ser un objeto JSON.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  const b = body as Record<string, unknown>;
  const mode = b.mode;
  if (typeof mode !== "string" || !mode.trim()) {
    return NextResponse.json(
      formatApiError("El campo 'mode' es obligatorio.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  const context_url = typeof b.context_url === "string" ? b.context_url : undefined;
  const context_kind = typeof b.context_kind === "string" ? b.context_kind : undefined;
  const context_ref = typeof b.context_ref === "string" ? b.context_ref : undefined;
  const first_user_prompt =
    typeof b.first_user_prompt === "string" ? b.first_user_prompt : undefined;
  const llm_provider = typeof b.llm_provider === "string" ? b.llm_provider : undefined;
  const llm_driver = typeof b.llm_driver === "string" ? b.llm_driver : undefined;

  try {
    const result = await createConversation({
      mode,
      context_url,
      context_kind,
      context_ref,
      first_user_prompt,
      llm_provider,
      llm_driver,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error(`[${requestId}] POST /api/conversations error:`, err);
    return NextResponse.json(
      formatApiError(
        "No se pudo crear la conversación.",
        "DB_QUERY",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 500 },
    );
  }
}
