import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock the LLM module before importing the route -------------------------

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

// --- Mock the persistence module ---
vi.mock("@/lib/db-write", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-write")>("@/lib/db-write");
  return {
    ...actual,
    createInteraction: vi.fn().mockResolvedValue("mock-interaction-id"),
    finishInteraction: vi.fn().mockResolvedValue(undefined),
  };
});

import { POST } from "../route";
import { BudgetExceededError, CircuitBreakerOpenError } from "@/lib/llm";
import * as dbWrite from "@/lib/db-write";

// --- Helpers ----------------------------------------------------------------

/** A minimal valid DashboardSpec for use in tests. */
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

/** The updated spec the LLM returns in success cases. */
const updatedSpec = {
  title: "Ventas Marzo — Actualizado",
  widgets: [
    {
      type: "kpi_row" as const,
      items: [
        {
          label: "Total Ventas",
          sql: "SELECT SUM(total_si) FROM ps_ventas",
          format: "currency" as const,
        },
        {
          label: "Margen",
          sql: "SELECT SUM(margen) FROM ps_lineas_ventas",
          format: "currency" as const,
        },
      ],
    },
  ],
};

/** Build a Request with the given JSON body. */
function makeRequest(body: unknown): Request {
  return new Request("http://localhost:4000/api/dashboard/modify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Build a Request with a raw string body (for malformed JSON tests). */
function makeRawRequest(rawBody: string): Request {
  return new Request("http://localhost:4000/api/dashboard/modify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody,
  });
}

const mockCreateInteraction = vi.mocked(dbWrite.createInteraction);
const mockFinishInteraction = vi.mocked(dbWrite.finishInteraction);

// --- Tests ------------------------------------------------------------------

describe("POST /api/dashboard/modify", () => {
  beforeEach(() => {
    mockModifyDashboard.mockReset();
    mockCreateInteraction.mockReset();
    mockCreateInteraction.mockResolvedValue("mock-interaction-id");
    mockFinishInteraction.mockReset();
    mockFinishInteraction.mockResolvedValue(undefined);
  });

  it("returns updated spec on valid modification", async () => {
    mockModifyDashboard.mockResolvedValue(JSON.stringify(updatedSpec));

    const res = await POST(makeRequest({ spec: validSpec, prompt: "Añade el margen" }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.title).toBe("Ventas Marzo — Actualizado");
    expect(json.widgets[0].items).toHaveLength(2);
  });

  it("strips markdown code blocks from LLM response", async () => {
    const wrapped = "```json\n" + JSON.stringify(updatedSpec) + "\n```";
    mockModifyDashboard.mockResolvedValue(wrapped);

    const res = await POST(makeRequest({ spec: validSpec, prompt: "Añade el margen" }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.title).toBe("Ventas Marzo — Actualizado");
  });

  it("returns 400 when spec is missing", async () => {
    const res = await POST(makeRequest({ prompt: "Añade el margen" }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/spec/i);
  });

  it("returns 400 when prompt is missing", async () => {
    const res = await POST(makeRequest({ spec: validSpec }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/prompt/i);
  });

  it("returns 400 when prompt is empty string", async () => {
    const res = await POST(makeRequest({ spec: validSpec, prompt: "   " }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/prompt/i);
  });

  it("returns 400 when incoming spec is invalid", async () => {
    const badSpec = { title: "No widgets" };
    const res = await POST(makeRequest({ spec: badSpec, prompt: "Cambiar algo" }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("VALIDATION");
    expect(json.requestId).toBeDefined();
  });

  it("returns 500 when LLM throws an error", async () => {
    mockModifyDashboard.mockRejectedValue(new Error("API timeout"));

    const res = await POST(makeRequest({ spec: validSpec, prompt: "Añade algo" }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe("LLM_ERROR");
    expect(json.requestId).toBeDefined();
  });

  it("returns 429 when LLM throws an error with status 429", async () => {
    const rateLimitError = Object.assign(new Error("Rate limit exceeded"), {
      status: 429,
    });
    mockModifyDashboard.mockRejectedValue(rateLimitError);

    const res = await POST(makeRequest({ spec: validSpec, prompt: "Añade algo" }));

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.code).toBe("LLM_RATE_LIMIT");
    expect(json.requestId).toBeDefined();
  });

  it("returns 429 with LLM_BUDGET_EXCEEDED when budget is exhausted", async () => {
    mockModifyDashboard.mockRejectedValue(
      new BudgetExceededError("Límite diario de generación alcanzado. Reintente mañana."),
    );

    const res = await POST(makeRequest({ spec: validSpec, prompt: "Añade algo" }));

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.code).toBe("LLM_BUDGET_EXCEEDED");
    expect(json.error).toContain("Límite diario");
  });

  it("returns 503 with LLM_CIRCUIT_OPEN when the LLM circuit is open", async () => {
    mockModifyDashboard.mockRejectedValue(new CircuitBreakerOpenError());

    const res = await POST(makeRequest({ spec: validSpec, prompt: "Añade algo" }));

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.code).toBe("LLM_CIRCUIT_OPEN");
    expect(json.error).toMatch(/no disponible|Inténtelo/i);
  });

  it("returns 400 when LLM returns invalid JSON", async () => {
    mockModifyDashboard.mockResolvedValue("not json at all");

    const res = await POST(makeRequest({ spec: validSpec, prompt: "Añade algo" }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("LLM_INVALID_RESPONSE");
    expect(json.requestId).toBeDefined();
  });

  it("returns 400 when LLM returns valid JSON but invalid spec", async () => {
    mockModifyDashboard.mockResolvedValue(JSON.stringify({ title: "No widgets" }));

    const res = await POST(makeRequest({ spec: validSpec, prompt: "Añade algo" }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("LLM_INVALID_RESPONSE");
    expect(json.requestId).toBeDefined();
  });

  it("passes serialized spec and trimmed prompt to LLM", async () => {
    mockModifyDashboard.mockResolvedValue(JSON.stringify(updatedSpec));

    await POST(makeRequest({ spec: validSpec, prompt: "  Añade margen  " }));

    expect(mockModifyDashboard).toHaveBeenCalledWith(
      JSON.stringify(validSpec),
      "Añade margen",
      expect.objectContaining({
        endpoint: "modifyDashboard",
        requestId: expect.stringMatching(/^req_/),
      }),
    );
  });

  it("returns 400 for malformed JSON body", async () => {
    const res = await POST(makeRawRequest("not valid json{{{"));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("VALIDATION");
    expect(json.requestId).toBeDefined();
  });

  it("returns 400 when body is a JSON array", async () => {
    const res = await POST(makeRequest([1, 2, 3]));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("VALIDATION");
    expect(json.requestId).toBeDefined();
  });

  it("returns 400 when body is a JSON string", async () => {
    const res = await POST(makeRawRequest('"just a string"'));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("VALIDATION");
    expect(json.requestId).toBeDefined();
  });

  it("returns 400 with validation error when spec is null", async () => {
    const res = await POST(makeRequest({ spec: null, prompt: "Cambiar algo" }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("VALIDATION");
    expect(json.requestId).toBeDefined();
  });

  it("does not expose raw LLM output in error responses", async () => {
    mockModifyDashboard.mockResolvedValue("secret internal context leaked");

    const res = await POST(makeRequest({ spec: validSpec, prompt: "Añade algo" }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.raw).toBeUndefined();
  });

  // --- Persistence (createInteraction / finishInteraction) ---

  describe("interaction persistence", () => {
    it("creates an interaction and finishes it as completed on success", async () => {
      mockModifyDashboard.mockResolvedValue(JSON.stringify(updatedSpec));

      const res = await POST(makeRequest({ spec: validSpec, prompt: "Añade el margen" }));
      expect(res.status).toBe(200);

      expect(mockCreateInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: "modify", prompt: "Añade el margen" }),
      );
      expect(mockFinishInteraction).toHaveBeenCalledWith(
        "mock-interaction-id",
        "completed",
        expect.any(String),
      );
    });

    it("creates an interaction and finishes it as error when LLM throws", async () => {
      mockModifyDashboard.mockRejectedValue(new Error("LLM down"));

      const res = await POST(makeRequest({ spec: validSpec, prompt: "Añade algo" }));
      expect(res.status).toBe(500);

      expect(mockCreateInteraction).toHaveBeenCalled();
      expect(mockFinishInteraction).toHaveBeenCalledWith(
        "mock-interaction-id",
        "error",
        expect.any(String),
      );
    });

    it("passes dashboardId to createInteraction when provided in request body", async () => {
      mockModifyDashboard.mockResolvedValue(JSON.stringify(updatedSpec));

      await POST(makeRequest({ spec: validSpec, prompt: "Añade el margen", dashboardId: 42 }));

      expect(mockCreateInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: "modify", dashboardId: 42 }),
      );
    });

    it("returns 400 when dashboardId is invalid", async () => {
      const res = await POST(makeRequest({ spec: validSpec, prompt: "Añade algo", dashboardId: -1 }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe("VALIDATION");
    });
  });
});
