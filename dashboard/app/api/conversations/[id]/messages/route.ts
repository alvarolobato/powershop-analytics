/**
 * POST /api/conversations/:id/messages
 *
 * Append a user message to a conversation. When `callLlm=true` the handler
 * also invokes the LLM and persists the assistant reply.
 *
 * After the first assistant reply lands, `maybeGenerateTitle` is fired
 * in the background — it is non-blocking and errors are silently swallowed.
 *
 * Body: {
 *   content: string,       // user message text
 *   callLlm?: boolean,     // default false — fire the LLM if true
 * }
 *
 * Response (callLlm=true): { message: string }
 * Response (callLlm=false): { ok: true }
 */

import { NextResponse } from "next/server";
import {
  getConversation,
  appendMessage,
  countMessages,
  loadMessages,
  maybeGenerateTitle,
  touchConversation,
} from "@/lib/conversations";
import { llmComplete } from "@/lib/llm-client";
import type { ChatTurn } from "@/lib/llm-client";
import { generateRequestId } from "@/lib/errors";

const DEFAULT_SYSTEM_PROMPT =
  "Eres un asistente analítico de datos para una empresa de retail y mayoreo. " +
  "Responde en español de manera concisa y orientada a la toma de decisiones. " +
  "Cuando analices datos, identifica patrones, tendencias y puntos de atención.";

export async function POST(
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

  const content = body.content;
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json(
      { error: "`content` is required", code: "MISSING_CONTENT", requestId },
      { status: 400 },
    );
  }

  const callLlm = body.callLlm === true;

  try {
    const conv = await getConversation(id);
    if (!conv) {
      return NextResponse.json(
        { error: "Conversation not found", code: "NOT_FOUND", requestId },
        { status: 404 },
      );
    }

    // Persist user message
    await appendMessage(id, "user", { text: content });

    if (!callLlm) {
      await touchConversation(id);
      return NextResponse.json({ ok: true });
    }

    // Load conversation history for the LLM context
    const allMessages = await loadMessages(id);
    const turns: ChatTurn[] = allMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        const c = m.content as { text?: string } | string;
        const text =
          typeof c === "string" ? c : (c?.text ?? JSON.stringify(c));
        return { role: m.role as "user" | "assistant", content: text };
      });

    // Call the LLM
    const resp = await llmComplete({
      flow: conv.mode as "analyze" | "modify" | "generate" | string,
      systemPrompt: { stable: DEFAULT_SYSTEM_PROMPT },
      messages: turns,
      maxOutputTokens: 4096,
      requestId,
    });

    const assistantText = resp.text;

    // Persist assistant reply
    await appendMessage(id, "assistant", { text: assistantText }, {
      tokens_input: resp.usage.prompt_tokens,
      tokens_output: resp.usage.completion_tokens,
      tokens_cache_read: resp.usage.cache_read_input_tokens ?? undefined,
      tokens_cache_creation: resp.usage.cache_creation_input_tokens ?? undefined,
    });

    await touchConversation(id, "ok");

    // Check if this was the first assistant reply — fire title generation
    // non-blocking (do not await; errors swallowed inside maybeGenerateTitle)
    const msgCount = await countMessages(id);
    if (msgCount <= 3) {
      // First exchange (1 user + 1 assistant, plus the one we just appended ≤ 3)
      void maybeGenerateTitle(id, turns.concat([
        { role: "assistant", content: assistantText },
      ]));
    }

    return NextResponse.json({ message: assistantText, requestId });
  } catch (err) {
    console.error("[POST /api/conversations/:id/messages] error:", err);
    // Mark conversation with error status
    try {
      await touchConversation(id, "error");
    } catch {
      // ignore
    }
    return NextResponse.json(
      {
        error: "Failed to process message",
        code: "LLM_ERROR",
        requestId,
      },
      { status: 500 },
    );
  }
}
