/**
 * Provider-agnostic agentic step contract (OpenRouter native tools vs CLI JSON protocol).
 */

import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

export interface AgenticStepToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** Shared usage shape for all AgenticStepResult variants. */
type AgenticStepUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  /** Tokens written to the Anthropic prompt cache (charged at 25% premium). */
  cache_creation_input_tokens?: number | null;
  /** Tokens read from the Anthropic prompt cache (90% discount). */
  cache_read_input_tokens?: number | null;
} | null;

export type AgenticStepResult =
  | {
      kind: "final";
      content: string;
      usage: AgenticStepUsage;
    }
  | {
      kind: "tools";
      tool_calls: AgenticStepToolCall[];
      usage: AgenticStepUsage;
    }
  | {
      kind: "error";
      code: string;
      message: string;
      usage: AgenticStepUsage;
    };

export interface AgenticRunStepInput {
  messages: ChatCompletionMessageParam[];
  tools: ChatCompletionTool[];
  model: string;
  temperature: number;
  maxTokens: number;
  /** Optional callback invoked as the model streams text chunks. `chars` is the
   *  incremental count for this chunk; `totalChars` is the running total.
   *  `accumulatedText` is the full assistant text emitted so far this step,
   *  so the UI can render Claude's response in real time. */
  onTextDelta?: (chars: number, totalChars: number, accumulatedText: string) => void;
  /** Optional callback invoked while the model is in extended-thinking mode.
   *  Same contract as `onTextDelta` but for the chain-of-thought block. Fires
   *  *before* the final answer text starts streaming (Claude only — OpenRouter
   *  text streaming has no extended-thinking phase, so this is never invoked
   *  for that adapter). */
  onThinkingDelta?: (chars: number, totalChars: number, accumulatedThinking: string) => void;
}

export interface AgenticModelAdapter {
  runStep(input: AgenticRunStepInput): Promise<AgenticStepResult>;
}
