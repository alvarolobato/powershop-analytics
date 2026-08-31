import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runAgenticChat, AgenticRunnerError } from "@/lib/llm-tools/runner";

/**
 * Turno 7 del 31/08: la generación murió con `GENERATE_FAILED: terminated`
 * después de 168 s y 20 tool calls correctas. El stream se cortó en la ronda 10
 * y no existía ningún reintento a mitad de stream — `withOpenRouterRetry`
 * envuelve el `create()` inicial, no el `for await` del cuerpo. Se perdieron
 * diez rondas ya pagadas, y encima su gasto no se registró en `llm_usage`.
 */

const ctx = {
  requestId: "req_reintento",
  endpoint: "testEndpoint",
  llmProvider: "openrouter" as const,
  llmDriver: null as null,
};

const USO = { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 };

/** Adaptador falso: se le dicta qué hace cada paso, en orden. */
function adaptadorQueHace(pasos: Array<() => unknown>) {
  let i = 0;
  const runStep = vi.fn(async () => {
    const paso = pasos[Math.min(i, pasos.length - 1)];
    i++;
    const r = paso();
    if (r instanceof Error) throw r;
    return r;
  });
  return { adapter: { runStep } as never, runStep };
}

const corte = () => new TypeError("terminated");
const final = (texto: string) => () => ({ kind: "final", content: texto, usage: USO });

function lanzar(adapter: never) {
  return runAgenticChat({
    adapter,
    model: "deepseek/deepseek-v4-pro",
    systemPrompt: "sys",
    userContent: "hola",
    ctx: { ...ctx },
    temperature: 0.2,
    maxTokens: 32000,
  });
}

describe("reintento del paso ante corte de stream", () => {
  beforeEach(() => {
    vi.stubEnv("DASHBOARD_AGENTIC_MAX_TOOL_ROUNDS", "4");
    vi.stubEnv("DASHBOARD_AGENTIC_MAX_STREAM_RETRIES", "2");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("un corte transitorio no mata el run: reintenta y termina bien", async () => {
    const { adapter, runStep } = adaptadorQueHace([corte, final("recuperado")]);
    const out = await lanzar(adapter);
    expect(out.content).toBe("recuperado");
    expect(runStep).toHaveBeenCalledTimes(2);
  });

  it("aguanta dos cortes seguidos y a la tercera va", async () => {
    const { adapter, runStep } = adaptadorQueHace([corte, corte, final("a la tercera")]);
    const out = await lanzar(adapter);
    expect(out.content).toBe("a la tercera");
    expect(runStep).toHaveBeenCalledTimes(3);
  });

  it("se rinde tras agotar los reintentos, no lo intenta indefinidamente", async () => {
    const { adapter, runStep } = adaptadorQueHace([corte]);
    await expect(lanzar(adapter)).rejects.toThrow();
    expect(runStep).toHaveBeenCalledTimes(3); // 1 + 2 reintentos
  });

  it("un error de aplicación falla a la primera, sin reintentar", async () => {
    const { adapter, runStep } = adaptadorQueHace([
      () => new Error("DB_ERROR: Failed to save the dashboard."),
    ]);
    await expect(lanzar(adapter)).rejects.toThrow();
    expect(runStep).toHaveBeenCalledTimes(1);
  });

  it("respeta el tope configurado a 0 (desactivado)", async () => {
    vi.stubEnv("DASHBOARD_AGENTIC_MAX_STREAM_RETRIES", "0");
    const { adapter, runStep } = adaptadorQueHace([corte]);
    await expect(lanzar(adapter)).rejects.toThrow();
    expect(runStep).toHaveBeenCalledTimes(1);
  });
});

describe("el gasto sobrevive al error", () => {
  beforeEach(() => {
    vi.stubEnv("DASHBOARD_AGENTIC_MAX_TOOL_ROUNDS", "4");
    vi.stubEnv("DASHBOARD_AGENTIC_MAX_STREAM_RETRIES", "0");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("un run que muere tras rondas pagadas lleva el gasto en el error", async () => {
    // ronda 1: el modelo pide una tool (se paga); ronda 2: se corta el stream.
    const { adapter } = adaptadorQueHace([
      () => ({
        kind: "tool_calls",
        tool_calls: [
          { id: "t1", type: "function", function: { name: "no_existe", arguments: "{}" } },
        ],
        usage: USO,
      }),
      corte,
    ]);

    const err = await lanzar(adapter).catch((e) => e);
    expect(err).toBeInstanceOf(AgenticRunnerError);
    // Sin esto, `logUsage` nunca corre y esos tokens quedan invisibles para
    // checkDailyBudget y para /admin/usage.
    expect(err.usage).toBeDefined();
    expect(err.usage.total_tokens).toBeGreaterThan(0);
    expect(err.usage.prompt_tokens).toBe(USO.prompt_tokens);
  });
});
