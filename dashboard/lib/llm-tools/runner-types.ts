/**
 * Provider-agnostic agentic step contract (OpenRouter native tools vs CLI JSON protocol).
 */

import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

export interface AgenticStepToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type AgenticStepResult =
  | {
      kind: "final";
      content: string;
      usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
    }
  | {
      kind: "tools";
      tool_calls: AgenticStepToolCall[];
      usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
    }
  | {
      kind: "error";
      code: string;
      message: string;
      usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
    };

export interface AgenticRunStepInput {
  messages: ChatCompletionMessageParam[];
  tools: ChatCompletionTool[];
  model: string;
  temperature: number;
  maxTokens: number;
  /** Optional callback invoked as the model streams text chunks. `chars` is the
   *  incremental count for this chunk; `totalChars` is the running total. */
  onTextDelta?: (chars: number, totalChars: number) => void;
}

export interface AgenticModelAdapter {
  runStep(input: AgenticRunStepInput): Promise<AgenticStepResult>;
}
