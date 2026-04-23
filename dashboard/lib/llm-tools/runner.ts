/**
 * Agentic chat.completions loop: tools, tool results, hard limits, telemetry.
 */

import type OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { logLlmToolCall } from "./logging";
import { DASHBOARD_AGENTIC_TOOLS } from "./catalog";
import { getAgenticConfig } from "./config";
import {
  emptyUsage,
  addUsage,
  type AgenticUsageTotals,
  type LlmAgenticContext,
} from "./types";
import { stringifyToolPayload, toolError, type ToolResponseBody } from "./tool-payload";
import {
  handleValidateQuery,
  handleExecuteQuery,
  handleExplainQuery,
  handleListPsTables,
  handleDescribePsTable,
} from "./handlers/sql";
import {
  handleListDashboards,
  handleGetDashboardSpec,
  handleGetDashboardQueries,
  handleGetDashboardWidgetRawValues,
  handleGetDashboardAllWidgetStatus,
} from "./handlers/dashboards";

export class AgenticRunnerError extends Error {
  readonly code: string;
  readonly requestId: string;

  constructor(code: string, message: string, requestId: string) {
    super(message);
    this.name = "AgenticRunnerError";
    this.code = code;
    this.requestId = requestId;
  }
}

export interface AgenticRunParams {
  client: OpenAI;
  model: string;
  systemPrompt: string;
  userContent: string;
  ctx: LlmAgenticContext;
  temperature: number;
  maxTokens: number;
}

export interface AgenticRunResult {
  content: string;
  usage: AgenticUsageTotals;
}

/**
 * JavaScript-side deadline so the model receives `TOOL_TIMEOUT` promptly.
 * SQL tools also use PostgreSQL `SET LOCAL statement_timeout` on the mirror
 * connection (`queryReadOnlyWithStatementTimeout`) so the server can cancel
 * expensive statements. Non-SQL tools may still finish shortly after this
 * promise rejects if their backing I/O ignores cancellation.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("TOOL_TIMEOUT")), ms);
    promise.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

async function dispatchTool(
  name: string,
  rawArgs: string,
  ctx: LlmAgenticContext,
): Promise<ToolResponseBody> {
  switch (name) {
    case "validate_query":
      return handleValidateQuery(rawArgs, ctx);
    case "execute_query":
      return handleExecuteQuery(rawArgs, ctx);
    case "explain_query":
      return handleExplainQuery(rawArgs, ctx);
    case "list_ps_tables":
      return handleListPsTables(rawArgs, ctx);
    case "describe_ps_table":
      return handleDescribePsTable(rawArgs, ctx);
    case "list_dashboards":
      return handleListDashboards(rawArgs, ctx);
    case "get_dashboard_spec":
      return handleGetDashboardSpec(rawArgs, ctx);
    case "get_dashboard_queries":
      return handleGetDashboardQueries(rawArgs, ctx);
    case "get_dashboard_widget_raw_values":
      return handleGetDashboardWidgetRawValues(rawArgs, ctx);
    case "get_dashboard_all_widget_status":
      return handleGetDashboardAllWidgetStatus(rawArgs, ctx);
    default:
      return toolError("UNKNOWN_TOOL", `Unknown tool: ${name}`, ctx);
  }
}

/**
 * Run a tool-augmented chat loop until the assistant returns plain text or limits hit.
 */
export async function runAgenticChat(
  params: AgenticRunParams,
): Promise<AgenticRunResult> {
  const { client, model, systemPrompt, userContent, ctx, temperature, maxTokens } =
    params;

  const cfg = getAgenticConfig();
  const tools: ChatCompletionTool[] = DASHBOARD_AGENTIC_TOOLS;
  const usage = emptyUsage();

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  let toolCallsTotal = 0;

  for (let round = 0; round < cfg.maxToolRounds; round++) {
    const completion = await client.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: "auto",
      temperature,
      max_tokens: maxTokens,
    });

    addUsage(usage, completion.usage);

    const choice = completion.choices[0]?.message;
    if (!choice) {
      throw new AgenticRunnerError(
        "LLM_EMPTY",
        "The model returned no message.",
        ctx.requestId,
      );
    }

    const toolCalls = choice.tool_calls;
    if (!toolCalls?.length) {
      const text = choice.content?.trim();
      if (!text) {
        throw new AgenticRunnerError(
          "LLM_EMPTY",
          "The model returned empty content.",
          ctx.requestId,
        );
      }
      return { content: text, usage };
    }

    messages.push(choice as ChatCompletionMessageParam);

    for (const tc of toolCalls) {
      toolCallsTotal += 1;
      if (toolCallsTotal > cfg.maxToolCalls) {
        throw new AgenticRunnerError(
          "AGENTIC_MAX_TOOL_CALLS",
          `Exceeded maximum tool calls (${cfg.maxToolCalls}).`,
          ctx.requestId,
        );
      }

      const fn = tc.type === "function" ? tc.function : null;
      const name = fn?.name ?? "";
      const rawArgs = fn?.arguments ?? "{}";
      const t0 = Date.now();
      let body: ToolResponseBody;
      let telemetryStatus: "ok" | "error" = "ok";
      let errorCode: string | null = null;

      try {
        body = await withTimeout(
          dispatchTool(name, rawArgs, ctx),
          cfg.toolTimeoutMs,
        );
        telemetryStatus = body.ok ? "ok" : "error";
        if (!body.ok) {
          errorCode = body.code;
        }
      } catch (e) {
        telemetryStatus = "error";
        if (e instanceof Error && e.message === "TOOL_TIMEOUT") {
          errorCode = "TOOL_TIMEOUT";
          body = toolError("TOOL_TIMEOUT", "Tool exceeded time limit.", ctx);
        } else {
          errorCode = "TOOL_EXCEPTION";
          body = toolError("TOOL_EXCEPTION", "Tool execution failed.", ctx);
        }
      }

      const payload = stringifyToolPayload(body, cfg.maxResultChars, ctx);
      const latency = Date.now() - t0;

      void logLlmToolCall({
        toolName: name || "(missing)",
        endpoint: ctx.endpoint,
        requestId: ctx.requestId,
        status: telemetryStatus,
        latencyMs: latency,
        payloadInBytes: Buffer.byteLength(rawArgs, "utf8"),
        payloadOutBytes: Buffer.byteLength(payload, "utf8"),
        errorCode,
      });

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: payload,
      });
    }
  }

  throw new AgenticRunnerError(
    "AGENTIC_MAX_ROUNDS",
    `Exceeded maximum tool rounds (${cfg.maxToolRounds}).`,
    ctx.requestId,
  );
}
