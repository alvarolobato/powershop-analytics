import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock the LLM module ---
vi.mock("@/lib/llm", () => ({
  generateDashboard: vi.fn(),
}));

// --- Mock the schema module (pass-through by default) ---
vi.mock("@/lib/schema", async () => {
  const actual = await vi.importActual<typeof import("@/lib/schema")>(
    "@/lib/schema",
  );
  return { ...actual };
});

import { POST } from "../route";
import { generateDashboard } from "@/lib/llm";

const mockGenerate = vi.mocked(generateDashboard);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/dashboard/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_SPEC = {
  title: "Ventas Marzo 2026",
  widgets: [
    {
      type: "kpi_row" as const,
      items: [
        {
          label: "Ventas Netas",
          sql: "SELECT SUM(total_si) FROM ps_ventas",
          format: "currency" as const,
          prefix: "€",
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/dashboard/generate", () => {
  beforeEach(() => {
    mockGenerate.mockReset();
  });

  // --- Happy path ---

  it("returns a valid dashboard spec on success", async () => {
    mockGenerate.mockResolvedValue(JSON.stringify(VALID_SPEC));

    const res = await POST(makeRequest({ prompt: "Ventas del mes" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.title).toBe("Ventas Marzo 2026");
    expect(json.widgets).toHaveLength(1);
    expect(json.widgets[0].type).toBe("kpi_row");
  });

  it("strips markdown code fences from LLM response", async () => {
    const wrapped = "```json\n" + JSON.stringify(VALID_SPEC) + "\n```";
    mockGenerate.mockResolvedValue(wrapped);

    const res = await POST(makeRequest({ prompt: "Ventas del mes" }));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.title).toBe("Ventas Marzo 2026");
  });

  it("strips bare code fences (no json tag) from LLM response", async () => {
    const wrapped = "```\n" + JSON.stringify(VALID_SPEC) + "\n```";
    mockGenerate.mockResolvedValue(wrapped);

    const res = await POST(makeRequest({ prompt: "Ventas del mes" }));
    expect(res.status).toBe(200);
  });

  // --- Input validation ---

  it("returns 400 for empty prompt", async () => {
    const res = await POST(makeRequest({ prompt: "" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("vacío");
  });

  it("returns 400 for whitespace-only prompt", async () => {
    const res = await POST(makeRequest({ prompt: "   " }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing prompt field", async () => {
    const res = await POST(makeRequest({ query: "test" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("prompt");
  });

  it("returns 400 for non-string prompt", async () => {
    const res = await POST(makeRequest({ prompt: 123 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/api/dashboard/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("JSON no válido");
  });

  // --- LLM errors ---

  it("returns 500 when LLM throws a generic error", async () => {
    mockGenerate.mockRejectedValue(new Error("Connection timeout"));

    const res = await POST(makeRequest({ prompt: "Ventas del mes" }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain("Inténtalo de nuevo");
  });

  it("returns 429 when LLM throws a rate limit error", async () => {
    mockGenerate.mockRejectedValue(new Error("rate limit exceeded (429)"));

    const res = await POST(makeRequest({ prompt: "Ventas del mes" }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain("Límite de uso");
  });

  it("returns 500 when LLM throws a non-Error value", async () => {
    mockGenerate.mockRejectedValue("unexpected string error");

    const res = await POST(makeRequest({ prompt: "Ventas del mes" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Inténtalo de nuevo");
  });

  // --- Invalid LLM output ---

  it("returns 400 when LLM returns non-JSON text", async () => {
    mockGenerate.mockResolvedValue(
      "I'm sorry, I cannot generate that dashboard.",
    );

    const res = await POST(makeRequest({ prompt: "Ventas del mes" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("invalid JSON");
  });

  it("returns 400 when LLM returns JSON that fails schema validation", async () => {
    const invalidSpec = { title: "Test" }; // missing widgets
    mockGenerate.mockResolvedValue(JSON.stringify(invalidSpec));

    const res = await POST(makeRequest({ prompt: "Ventas del mes" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("invalid dashboard spec");
    expect(json.details).toBeDefined();
  });

  it("returns 400 when LLM returns JSON with invalid widget types", async () => {
    const badWidgets = {
      title: "Test",
      widgets: [{ type: "pie_chart", title: "Bad", sql: "SELECT 1" }],
    };
    mockGenerate.mockResolvedValue(JSON.stringify(badWidgets));

    const res = await POST(makeRequest({ prompt: "Ventas del mes" }));
    expect(res.status).toBe(400);
  });
});
