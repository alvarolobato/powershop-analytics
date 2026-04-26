/**
 * Streaming-path tests for POST /api/dashboard/modify.
 *
 * The deferred-stream design opens an NDJSON response only when the agentic
 * runner emits at least one progress event before finishing. These tests
 * exercise that path explicitly.
 *
 * See dashboard/app/api/dashboard/modify/route.ts for the contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockModifyDashboard } = vi.hoisted(() => ({
  mockModifyDashboard: vi.fn(),
}));

vi.mock("@/lib/llm", async () => {
  const actual = await vi.importActual<typeof import("@/lib/llm")>("@/lib/llm");
  return {
    ...actual,
    modifyDashboard: mockModifyDashboard,
  };
});

vi.mock("@/lib/db-write", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-write")>("@/lib/db-write");
  return {
    ...actual,
    createInteraction: vi.fn().mockResolvedValue("mock-interaction-id"),
    finishInteraction: vi.fn().mockResolvedValue(undefined),
  };
});

import { POST } from "../route";

const validSpec = {
  title: "Ventas Marzo",
  widgets: [
    {
      type: "kpi_row" as const,
      items: [
        {
          label: "Total Ventas",
          sql: "SELECT SUM(total_si) FROM ps_ventas",
          format: "currency" as const,
        },
      ],
    },
  ],
};

const updatedSpec = {
  title: "Ventas Marzo Actualizado",
  widgets: [
    {
      type: "kpi_row" as const,
      items: [
        {
          label: "Total Ventas",
          sql: "SELECT SUM(total_si) FROM ps_ventas",
          format: "currency" as const,
        },
      ],
    },
  ],
};

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/dashboard/modify", {
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

describe("POST /api/dashboard/modify (streaming)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens an NDJSON stream when the agentic runner emits at least one progress event", async () => {
    // Simulate an agentic runner that emits a `tool_done` event then resolves.
    mockModifyDashboard.mockImplementation(async (_spec, _prompt, opts) => {
      opts?.onAgenticProgress?.({ type: "tool_done", name: "validate_query", ok: true, ms: 42 });
      // Allow a microtask so the route observes the event before completion.
      await new Promise((r) => setTimeout(r, 0));
      return JSON.stringify(updatedSpec);
    });

    const res = await POST(
      makeRequest({ spec: validSpec, prompt: "añade ventas por tienda" }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(res.headers.get("x-request-id")).toMatch(/^req_/);

    const frames = await readNdjson(res.body!);
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames[0]).toMatchObject({ type: "progress", logLine: { kind: "tool" } });
    const last = frames[frames.length - 1];
    expect(last).toMatchObject({ type: "result", spec: { title: "Ventas Marzo Actualizado" } });
  });

  it("emits a terminal error frame with httpStatus when the LLM fails after streaming starts", async () => {
    mockModifyDashboard.mockImplementation(async (_spec, _prompt, opts) => {
      opts?.onAgenticProgress?.({ type: "tool_done", name: "execute_query", ok: true, ms: 10 });
      await new Promise((r) => setTimeout(r, 0));
      throw new Error("upstream rate limit 429 exceeded");
    });

    const res = await POST(makeRequest({ spec: validSpec, prompt: "test" }));

    // HTTP status must remain 200 here because headers were already
    // committed when the first progress frame was sent. Clients must
    // observe the terminal error frame's `httpStatus` field.
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
    mockModifyDashboard.mockRejectedValue(new Error("boom"));

    const res = await POST(makeRequest({ spec: validSpec, prompt: "test" }));
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.code).toBe("LLM_ERROR");
  });
});
