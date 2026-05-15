/**
 * Handler for the `start_dashboard_generation` tool.
 *
 * Generates a new dashboard from a natural-language prompt, saves it to the
 * database, and (if a conversation is active) calls the handoff endpoint so
 * the conversation is linked to the new dashboard.
 *
 * Returns { dashboard_id, redirect_url, summary } on success.
 */

import { generateDashboard } from "@/lib/llm";
import { validateSpec } from "@/lib/schema";
import { lintDashboardSpec } from "@/lib/sql-heuristics";
import { ZodError } from "zod";
import { sql } from "@/lib/db-write";
import { toolOk, toolError, type ToolResponseBody } from "@/lib/llm-tools/tool-payload";
import type { LlmAgenticContext } from "@/lib/llm-tools/types";

interface StartDashboardGenerationArgs {
  prompt: string;
  template?: string;
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

export async function handleStartDashboardGeneration(
  rawArgs: string,
  ctx: LlmAgenticContext,
): Promise<ToolResponseBody> {
  let args: StartDashboardGenerationArgs;
  try {
    args = JSON.parse(rawArgs) as StartDashboardGenerationArgs;
  } catch {
    return toolError("INVALID_ARGS", "Invalid JSON arguments.", ctx);
  }

  if (!args.prompt || typeof args.prompt !== "string" || !args.prompt.trim()) {
    return toolError("INVALID_ARGS", "The 'prompt' field is required and must be a non-empty string.", ctx);
  }

  // Generate the dashboard spec via the LLM
  let rawResponse: string;
  try {
    rawResponse = await generateDashboard(args.prompt.trim(), {
      requestId: ctx.requestId,
      endpoint: "start_dashboard_generation",
      llmProvider: ctx.llmProvider,
      llmDriver: ctx.llmDriver,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Dashboard generation failed.";
    console.error(`[${ctx.requestId}] start_dashboard_generation: generateDashboard failed:`, err);
    return toolError("GENERATE_FAILED", msg, ctx);
  }

  // Parse and validate the spec
  const jsonStr = extractJson(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return toolError("INVALID_SPEC", "The LLM returned an invalid JSON spec.", ctx);
  }

  let spec;
  try {
    spec = validateSpec(parsed);
  } catch (err) {
    const details =
      err instanceof ZodError
        ? err.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")
        : "Spec validation failed";
    return toolError("INVALID_SPEC", `Dashboard spec is invalid: ${details}`, ctx);
  }

  const sqlLint = lintDashboardSpec(spec);
  if (sqlLint.length > 0) {
    return toolError(
      "SQL_LINT",
      `Generated dashboard contains invalid SQL patterns: ${sqlLint.join(" | ")}`,
      ctx,
    );
  }

  // Persist to the database
  const title = spec.title ?? "Nuevo panel";
  const description = spec.description ?? null;
  let dashboardId: number;
  try {
    const rows = await sql<{ id: number }>(
      `INSERT INTO dashboards (name, description, spec)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id`,
      [title, description, JSON.stringify(spec)],
    );
    const row = rows[0];
    if (!row?.id) throw new Error("INSERT dashboards did not return an id");
    dashboardId = row.id;
  } catch (err) {
    console.error(`[${ctx.requestId}] start_dashboard_generation: DB insert failed:`, err);
    return toolError("DB_ERROR", "Failed to save the dashboard.", ctx);
  }

  const redirectUrl = ctx.conversationId
    ? `/dashboards/${dashboardId}?tab=modify&continue=${ctx.conversationId}`
    : `/dashboards/${dashboardId}?tab=modify`;

  // Call the handoff endpoint to link the conversation to the new dashboard.
  // This is a best-effort call — if it fails (e.g. Task 3 not yet deployed)
  // we still return success so the dashboard was at least created.
  if (ctx.conversationId) {
    try {
      const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:4000";
      const handoffRes = await fetch(
        `${baseUrl}/api/conversations/${ctx.conversationId}/handoff-to-dashboard`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dashboard_id: dashboardId }),
        },
      );
      if (!handoffRes.ok) {
        console.warn(
          `[${ctx.requestId}] start_dashboard_generation: handoff returned ${handoffRes.status}`,
        );
      }
    } catch (err) {
      console.warn(`[${ctx.requestId}] start_dashboard_generation: handoff call failed:`, err);
    }
  }

  return toolOk({
    dashboard_id: String(dashboardId),
    redirect_url: redirectUrl,
    summary: `Dashboard "${title}" created with ${spec.widgets?.length ?? 0} widget(s). Navigate to ${redirectUrl} to view and modify it.`,
  });
}
