/**
 * Streaming-path tests for POST /api/dashboard/analyze.
 *
 * The deferred-stream design opens an NDJSON response only when the agentic
 * runner emits at least one progress event before finishing. These tests
 * exercise that path explicitly.
 *
 * See dashboard/app/api/dashboard/analyze/route.ts for the contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/llm", async () => {
  const actual = await vi.importActual<typeof import("@/lib/llm")>("@/lib/llm");
  return {
    ...actual,
    analyzeDashboard: vi.fn(),
    generateSuggestions: vi.fn(),
  };
});

import { POST } from "../api/dashboard/analyze/route";
import * as llm from "@/lib/llm";

const baseSpec = {
  title: "Test Dashboard",
  widgets: [
    {
      type: "number",
      title: "Total",
      sql: "SELECT 1",
      format: "number",
    },
  ],
};

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/dashboard/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readNdjson(stream: ReadableStream<Uint8Array>): Promise<Record<string, unknown>[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const out: Record<string, unknown>[] = [];
  let buf = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      out.push(JSON.parse(t));
    }
  }
  if (buf.trim()) out.push(JSON.parse(buf.trim()));
  return out;
}

describe("POST /api/dashboard/analyze (streaming)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(llm.generateSuggestions).mockResolvedValue(["sugerencia 1"]);
  });

  it("opens NDJSON stream when the agentic runner emits at least one progress event", async () => {
    vi.mocked(llm.analyzeDashboard).mockImplementation(async (_data, _prompt, _action, opts) => {
      opts?.onAgenticProgress?.({ type: "tool_done", name: "execute_query", ok: true, ms: 12 });
      await new Promise((r) => setTimeout(r, 0));
      return "Análisis completo.";
    });

    const res = await POST(makeRequest({ spec: baseSpec, widgetData: {}, prompt: "Analiza" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");

    const frames = await readNdjson(res.body!);
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames[0]).toMatchObject({ type: "progress", logLine: { kind: "tool" } });
    const last = frames[frames.length - 1];
    expect(last).toMatchObject({
      type: "result",
      response: "Análisis completo.",
      suggestions: ["sugerencia 1"],
    });
  });

  it("emits a terminal error frame with httpStatus when the LLM fails after streaming starts", async () => {
    vi.mocked(llm.analyzeDashboard).mockImplementation(async (_d, _p, _a, opts) => {
      opts?.onAgenticProgress?.({ type: "tool_done", name: "validate_query", ok: false, ms: 8, errorCode: "BAD_SQL" });
      await new Promise((r) => setTimeout(r, 0));
      throw new Error("upstream rate limit 429 exceeded");
    });

    const res = await POST(makeRequest({ spec: baseSpec, widgetData: {}, prompt: "Analiza" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");

    const frames = await readNdjson(res.body!);
    const last = frames[frames.length - 1];
    expect(last).toMatchObject({
      type: "error",
      httpStatus: 429,
      code: "LLM_RATE_LIMIT",
    });
  });

  it("falls back to JSON 5xx when the LLM fails BEFORE any progress event", async () => {
    vi.mocked(llm.analyzeDashboard).mockRejectedValue(new Error("boom"));

    const res = await POST(makeRequest({ spec: baseSpec, widgetData: {}, prompt: "Analiza" }));
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.code).toBe("LLM_ERROR");
  });
});
