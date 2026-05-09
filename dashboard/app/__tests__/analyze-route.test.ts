import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock LLM module before importing the route
// ---------------------------------------------------------------------------

vi.mock("@/lib/llm", async () => {
  const actual = await vi.importActual<typeof import("@/lib/llm")>("@/lib/llm");
  return {
    ...actual,
    analyzeDashboard: vi.fn(),
    generateSuggestions: vi.fn(),
  };
});

// Import AFTER mock setup
import { POST } from "../api/dashboard/analyze/route";
import * as llm from "@/lib/llm";
import type { LlmAgenticContext } from "@/lib/llm-tools/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * Returns a mock implementation for analyzeDashboard that stages analyzeResult
 * in the ctx (simulating the publish-tool flow) and returns a freeform message.
 * Pass markdown=null to simulate the model NOT calling submit_dashboard_analysis.
 */
function makeAnalyzeMock(
  markdown: string | null,
  message = "He analizado el dashboard y encontré varias tendencias.",
  summary = "Las ventas crecieron un 12%.",
) {
  return async (
    _serializedData: string,
    _prompt: string,
    _action: string | undefined,
    ctx: LlmAgenticContext,
  ) => {
    if (markdown !== null) {
      ctx.analyzeResult = { markdown, summary };
    }
    return message;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/dashboard/analyze", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(llm.generateSuggestions).mockResolvedValue([
      "¿Cuál es la tienda con más ventas?",
      "¿Qué productos tienen mayor margen?",
    ]);
  });

  // -----------------------------------------------------------------------
  // Valid request
  // -----------------------------------------------------------------------

  it("returns 200 with response + message + summary + suggestions on valid request", async () => {
    vi.mocked(llm.analyzeDashboard).mockImplementation(
      makeAnalyzeMock("# Análisis\n\nEl dashboard muestra ventas de 50.000€."),
    );

    const req = makeRequest({
      spec: baseSpec,
      widgetData: {},
      prompt: "Explícame los datos",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    // response = the staged analysis markdown
    expect(body.response).toContain("Análisis");
    // message = freeform chat reply
    expect(body.message).toBe("He analizado el dashboard y encontré varias tendencias.");
    // summary from the staged result
    expect(body.summary).toBe("Las ventas crecieron un 12%.");
    expect(Array.isArray(body.suggestions)).toBe(true);
    expect(body.suggestions.length).toBeGreaterThan(0);
  });

  it("passes action to analyzeDashboard when provided", async () => {
    vi.mocked(llm.analyzeDashboard).mockImplementation(makeAnalyzeMock("Plan de acción: ..."));

    const req = makeRequest({
      spec: baseSpec,
      widgetData: {},
      prompt: "Propón un plan de acción",
      action: "plan_accion",
    });

    await POST(req);

    expect(llm.analyzeDashboard).toHaveBeenCalledWith(
      expect.any(String), // serialized data
      "Propón un plan de acción",
      "plan_accion",
      expect.objectContaining({
        endpoint: "analyzeDashboard",
        requestId: expect.stringMatching(/^req_/),
      }),
      [], // priorTurns: empty because no dashboardId in request
    );
  });

  it("returns suggestions from generateSuggestions", async () => {
    vi.mocked(llm.analyzeDashboard).mockImplementation(makeAnalyzeMock("Respuesta del análisis."));
    vi.mocked(llm.generateSuggestions).mockResolvedValue(["Pregunta 1", "Pregunta 2", "Pregunta 3"]);

    const req = makeRequest({
      spec: baseSpec,
      widgetData: {},
      prompt: "¿Cómo van las ventas?",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(body.suggestions).toEqual(["Pregunta 1", "Pregunta 2", "Pregunta 3"]);
  });

  // -----------------------------------------------------------------------
  // Validation errors
  // -----------------------------------------------------------------------

  it("returns 400 when prompt is missing", async () => {
    const req = makeRequest({ spec: baseSpec, widgetData: {} });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("prompt");
  });

  it("returns 400 when prompt is empty string", async () => {
    const req = makeRequest({ spec: baseSpec, widgetData: {}, prompt: "  " });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when spec is missing", async () => {
    const req = makeRequest({ widgetData: {}, prompt: "Analiza" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("spec");
  });

  it("returns 400 when spec is invalid (fails Zod validation)", async () => {
    const req = makeRequest({
      spec: { title: "No widgets here" }, // missing required `widgets`
      widgetData: {},
      prompt: "Analiza",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION");
  });

  it("returns 400 when action is invalid", async () => {
    const req = makeRequest({
      spec: baseSpec,
      widgetData: {},
      prompt: "Analiza",
      action: "invalid_action",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("action");
  });

  it("accepts all valid action values", async () => {
    vi.mocked(llm.analyzeDashboard).mockImplementation(makeAnalyzeMock("OK"));

    const validActions = [
      "explicar",
      "plan_accion",
      "anomalias",
      "comparar",
      "resumen_ejecutivo",
      "buenas_practicas",
    ];

    for (const action of validActions) {
      const req = makeRequest({ spec: baseSpec, widgetData: {}, prompt: "Test", action });
      const res = await POST(req);
      expect(res.status).toBe(200);
    }
  });

  it("returns 400 when body is not an object", async () => {
    const req = new Request("http://localhost/api/dashboard/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify("not an object"),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // -----------------------------------------------------------------------
  // LLM errors
  // -----------------------------------------------------------------------

  it("returns 500 when analyzeDashboard throws generic error", async () => {
    vi.mocked(llm.analyzeDashboard).mockRejectedValue(new Error("Something went wrong"));

    const req = makeRequest({
      spec: baseSpec,
      widgetData: {},
      prompt: "Analiza",
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("LLM_ERROR");
  });

  it("returns 429 when analyzeDashboard throws rate limit error", async () => {
    vi.mocked(llm.analyzeDashboard).mockRejectedValue(new Error("rate limit exceeded 429"));

    const req = makeRequest({
      spec: baseSpec,
      widgetData: {},
      prompt: "Analiza",
    });

    const res = await POST(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("LLM_RATE_LIMIT");
  });

  it("returns 503 when analyzeDashboard throws circuit breaker open", async () => {
    vi.mocked(llm.analyzeDashboard).mockRejectedValue(new llm.CircuitBreakerOpenError());

    const req = makeRequest({
      spec: baseSpec,
      widgetData: {},
      prompt: "Analiza",
    });

    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("LLM_CIRCUIT_OPEN");
  });

  it("returns 500 when model returns text without calling submit_dashboard_analysis", async () => {
    vi.mocked(llm.analyzeDashboard).mockImplementation(makeAnalyzeMock(null));

    const req = makeRequest({
      spec: baseSpec,
      widgetData: {},
      prompt: "Analiza",
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("AGENTIC_RUNNER");
  });

  it("returns 200 even when generateSuggestions returns empty array", async () => {
    vi.mocked(llm.analyzeDashboard).mockImplementation(makeAnalyzeMock("Análisis correcto."));
    vi.mocked(llm.generateSuggestions).mockResolvedValue([]);

    const req = makeRequest({
      spec: baseSpec,
      widgetData: {},
      prompt: "Analiza",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response).toContain("Análisis");
    expect(body.suggestions).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Invalid JSON body
  // -----------------------------------------------------------------------

  it("returns 400 for malformed JSON", async () => {
    const req = new Request("http://localhost/api/dashboard/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
