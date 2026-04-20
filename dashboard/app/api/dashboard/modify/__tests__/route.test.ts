import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock the LLM module before importing the route -------------------------

const { mockModifyDashboard } = vi.hoisted(() => {
  return { mockModifyDashboard: vi.fn() };
});

vi.mock("@/lib/llm", async () => {
  const actual = await vi.importActual<typeof import("@/lib/llm")>("@/lib/llm");
  return {
    BudgetExceededError: actual.BudgetExceededError,
    modifyDashboard: mockModifyDashboard,
  };
});

import { POST } from "../route";

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

// --- Tests ------------------------------------------------------------------

describe("POST /api/dashboard/modify", () => {
  beforeEach(() => {
    mockModifyDashboard.mockReset();
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

  it("returns 429 when LLM throws a rate limit error", async () => {
    mockModifyDashboard.mockRejectedValue(new Error("rate limit exceeded (429)"));

    const res = await POST(makeRequest({ spec: validSpec, prompt: "Añade algo" }));

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.code).toBe("LLM_RATE_LIMIT");
    expect(json.requestId).toBeDefined();
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
});
