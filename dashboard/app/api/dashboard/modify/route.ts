/**
 * POST /api/dashboard/modify
 *
 * Accepts a current DashboardSpec and a user prompt, calls the LLM to produce
 * an updated spec, validates it, and returns the result.
 *
 * Request body: { spec: DashboardSpec, prompt: string }
 * Response: 200 with updated DashboardSpec, or 400/500 on error.
 */
import { NextResponse } from "next/server";
import { modifyDashboard } from "@/lib/llm";
import { validateSpec, DashboardSpecSchema } from "@/lib/schema";

/**
 * Extract JSON from a string that may be wrapped in markdown code blocks.
 * LLMs sometimes return ```json ... ``` around their JSON output.
 */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) {
    return fenced[1].trim();
  }
  return raw.trim();
}

export async function POST(request: Request) {
  // --- Parse request body ---------------------------------------------------
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 },
    );
  }

  const { spec, prompt } = body as Record<string, unknown>;

  // --- Validate required fields ---------------------------------------------
  if (!spec) {
    return NextResponse.json(
      { error: "Missing required field: spec" },
      { status: 400 },
    );
  }

  if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
    return NextResponse.json(
      { error: "Missing required field: prompt" },
      { status: 400 },
    );
  }

  // --- Validate incoming spec with Zod --------------------------------------
  const specParse = DashboardSpecSchema.safeParse(spec);
  if (!specParse.success) {
    return NextResponse.json(
      {
        error: "Invalid dashboard spec",
        details: specParse.error.issues.map((i) => i.message),
      },
      { status: 400 },
    );
  }

  // --- Call LLM to modify the dashboard -------------------------------------
  let rawResponse: string;
  try {
    rawResponse = await modifyDashboard(
      JSON.stringify(specParse.data),
      prompt.trim(),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown LLM error";
    return NextResponse.json(
      { error: `LLM error: ${message}` },
      { status: 500 },
    );
  }

  // --- Parse and validate LLM response --------------------------------------
  const jsonStr = extractJson(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return NextResponse.json(
      { error: "LLM returned invalid JSON", raw: rawResponse },
      { status: 400 },
    );
  }

  let updatedSpec;
  try {
    updatedSpec = validateSpec(parsed);
  } catch {
    return NextResponse.json(
      { error: "LLM returned a spec that failed validation", raw: rawResponse },
      { status: 400 },
    );
  }

  return NextResponse.json(updatedSpec);
}
