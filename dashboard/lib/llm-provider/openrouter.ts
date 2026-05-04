/**
 * OpenRouter via OpenAI SDK (chat completions + agentic steps).
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { AgenticModelAdapter, AgenticStepResult } from "@/lib/llm-tools/runner-types";
import { getSystemConfig } from "@/lib/system-config/loader";

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30_000;

function getStatus(err: unknown): number | undefined {
  if (
    err !== null &&
    typeof err === "object" &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  ) {
    return (err as { status: number }).status;
  }
  return undefined;
}

function getHeaderValue(headers: unknown, name: string): string | null | undefined {
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  if (headers !== null && typeof headers === "object" && !Array.isArray(headers)) {
    const targetName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (key.toLowerCase() === targetName && typeof value === "string") {
        return value;
      }
    }
  }
  return undefined;
}

function getRetryAfterMs(err: unknown): number | undefined {
  if (err === null || typeof err !== "object" || !("headers" in err)) return undefined;
  const headers = (err as { headers: unknown }).headers;
  const value = getHeaderValue(headers, "retry-after");
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) || parsed < 0 ? undefined : Math.min(parsed * 1000, MAX_RETRY_DELAY_MS);
}

export async function withOpenRouterRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = getStatus(err);

      if (status === 400) throw err;
      if (attempt === MAX_ATTEMPTS - 1) break;

      const shouldRetry = status === undefined || status === 429 || status >= 500;
      if (!shouldRetry) throw err;

      let delay = BASE_DELAY_MS * Math.pow(2, attempt);
      if (status === 429) {
        const retryAfterMs = getRetryAfterMs(err);
        if (retryAfterMs !== undefined) delay = retryAfterMs;
      }

      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

let _client: OpenAI | null = null;

export function getOpenRouterApiKey(): string {
  // Prefer the value from the central config loader (env > config.yaml > default).
  // Fall back to process.env directly when the loader throws (e.g. schema.yaml is
  // missing or tests that stub env but don't set up the full config loader).
  let cfgKey: string | null | undefined;
  try {
    const cfg = getSystemConfig();
    cfgKey = cfg["openrouter.api_key"]?.value as string | null | undefined;
  } catch {
    cfgKey = undefined;
  }
  const key =
    (cfgKey !== null && cfgKey !== undefined ? String(cfgKey).trim() : "") ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    "";
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Set it in your environment, config.yaml, or .env file.",
    );
  }
  return key;
}

export function getOpenRouterClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: getOpenRouterApiKey(),
    });
  }
  return _client;
}

export function resetOpenRouterClient(): void {
  _client = null;
}

export function createOpenRouterAgenticAdapter(client: OpenAI): AgenticModelAdapter {
  return {
    async runStep(input): Promise<AgenticStepResult> {
      // Use streaming so we can emit model_text_delta events while tokens arrive.
      const stream = await withOpenRouterRetry(() =>
        client.chat.completions.create({
          model: input.model,
          messages: input.messages,
          tools: input.tools,
          tool_choice: "auto",
          temperature: input.temperature,
          max_tokens: input.maxTokens,
          stream: true,
        }),
      );

      // Accumulate content and tool_call deltas.
      let textContent = "";
      let totalCharsEmitted = 0;
      // tool_calls deltas: indexed by delta.index
      const toolCallAccum: Record<
        number,
        { id: string; type: "function"; function: { name: string; arguments: string } }
      > = {};
      let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          textContent += delta.content;
          const deltaChars = delta.content.length;
          totalCharsEmitted += deltaChars;
          if (input.onTextDelta) {
            try {
              input.onTextDelta(deltaChars, totalCharsEmitted, textContent);
            } catch {
              /* ignore callback errors */
            }
          }
        }
        // Accumulate tool_call chunks (OpenAI streaming tool call pattern).
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallAccum[idx]) {
              toolCallAccum[idx] = {
                id: tc.id ?? "",
                type: "function",
                function: { name: tc.function?.name ?? "", arguments: tc.function?.arguments ?? "" },
              };
            } else {
              const acc = toolCallAccum[idx];
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.function.name += tc.function.name;
              if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
            }
          }
        }
        // Usage is typically in the last chunk.
        if (chunk.usage) {
          usage = {
            prompt_tokens: chunk.usage.prompt_tokens,
            completion_tokens: chunk.usage.completion_tokens,
            total_tokens: chunk.usage.total_tokens,
          };
        }
      }

      const toolCalls = Object.values(toolCallAccum);
      if (toolCalls.length > 0) {
        return {
          kind: "tools",
          tool_calls: toolCalls
            .filter((tc) => tc.type === "function" && tc.function.name)
            .map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments || "{}",
              },
            })),
          usage,
        };
      }

      const text = textContent.trim();
      if (!text) {
        return {
          kind: "error",
          code: "LLM_EMPTY",
          message: "The model returned empty content.",
          usage,
        };
      }

      return { kind: "final", content: text, usage };
    },
  };
}

export async function openRouterChatCompletion(params: {
  client: OpenAI;
  model: string;
  messages: ChatCompletionMessageParam[];
  temperature: number;
  maxTokens: number;
}): Promise<{
  content: string;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
}> {
  const response = await withOpenRouterRetry(() =>
    params.client.chat.completions.create({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
    }),
  );
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned an empty response");
  }
  const u = response.usage;
  return {
    content,
    usage:
      u === undefined
        ? null
        : {
            prompt_tokens: u.prompt_tokens,
            completion_tokens: u.completion_tokens,
            total_tokens: u.total_tokens,
          },
  };
}
