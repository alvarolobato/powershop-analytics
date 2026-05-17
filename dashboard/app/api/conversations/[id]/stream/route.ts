/**
 * GET /api/conversations/:id/stream — SSE event stream for a conversation.
 *
 * On connect:
 *   1. Validate the conversation exists.
 *   2. Replay all turn_events with id > Last-Event-ID (default 0) in seq order.
 *   3. Subscribe to the in-process pub/sub for live events.
 *   4. Send a keepalive ping every 15 s.
 *   5. On client disconnect: unsubscribe and close the stream.
 *
 * SSE format:
 *   id: <turn_event.id>
 *   data: <JSON with turnId, seq, eventType, payload>
 *
 * Clients reconnect by sending `Last-Event-ID: N` — they will only receive
 * events with turn_event.id > N.
 */

import { NextRequest, NextResponse } from "next/server";
import { getConversation } from "@/lib/conversations";
import { getConversationEvents } from "@/lib/turn-events";
import { subscribe, type SseEvent } from "@/lib/sse-pubsub";
import { formatApiError, generateRequestId } from "@/lib/errors";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

const ID_PATTERN = /^[a-f0-9]{12}$/;
const KEEPALIVE_MS = 15_000;

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse | Response> {
  const requestId = generateRequestId();
  const { id } = await context.params;

  if (!ID_PATTERN.test(id)) {
    return NextResponse.json(
      formatApiError("ID de conversación no válido.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  // Verify conversation exists before opening the stream.
  let conversation;
  try {
    conversation = await getConversation(id);
  } catch (err) {
    console.error(`[${requestId}] GET /api/conversations/${id}/stream DB error:`, err);
    return NextResponse.json(
      formatApiError("Error al acceder a la conversación.", "DB_ERROR", undefined, requestId),
      { status: 500 },
    );
  }
  if (!conversation) {
    return NextResponse.json(
      formatApiError(
        "Conversación no encontrada.",
        "NOT_FOUND",
        `No existe ninguna conversación con ID ${id}.`,
        requestId,
      ),
      { status: 404 },
    );
  }

  // Parse Last-Event-ID header for resumption (default: replay everything).
  const lastEventIdHeader = request.headers.get("Last-Event-ID");
  const rawSinceId = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) : 0;
  const sinceIdParam = Number.isFinite(rawSinceId) && rawSinceId > 0 ? rawSinceId : undefined;

  const encoder = new TextEncoder();

  function formatEvent(eventId: number, data: Record<string, unknown>): Uint8Array {
    return encoder.encode(`id: ${eventId}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function formatPing(): Uint8Array {
    return encoder.encode(`event: ping\ndata: {}\n\n`);
  }

  // Closure-captured cleanup refs so cancel() can reach them.
  let unsubscribeFn: (() => void) | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  function cleanup() {
    if (keepaliveTimer !== null) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
    if (unsubscribeFn !== null) {
      unsubscribeFn();
      unsubscribeFn = null;
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      // Replay historical events.
      let historicalEvents;
      try {
        historicalEvents = await getConversationEvents(id, sinceIdParam);
      } catch (err) {
        console.error(`[${requestId}] stream replay error for ${id}:`, err);
        controller.close();
        return;
      }

      for (const ev of historicalEvents) {
        try {
          controller.enqueue(
            formatEvent(ev.id, {
              turnId: ev.turn_id,
              seq: ev.seq,
              eventType: ev.event_type,
              payload: ev.payload,
            }),
          );
        } catch {
          // Controller already closed (client disconnected during replay).
          cleanup();
          return;
        }
      }

      // Subscribe to live events published by the background turn job.
      unsubscribeFn = subscribe(id, (event: SseEvent) => {
        try {
          controller.enqueue(
            formatEvent(event.dbEventId, {
              turnId: event.turnId,
              seq: event.seq,
              eventType: event.eventType,
              payload: event.payload,
            }),
          );
        } catch {
          // Stream closed; cancel() will clean up.
        }
      });

      // Keepalive timer — prevents proxy/load-balancer idle timeouts.
      keepaliveTimer = setInterval(() => {
        try {
          controller.enqueue(formatPing());
        } catch {
          cleanup();
        }
      }, KEEPALIVE_MS);
    },

    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
