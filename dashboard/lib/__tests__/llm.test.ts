import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
        },
      };
    },
  };
});

import { generateDashboard, modifyDashboard, resetClient } from "../llm";

describe("llm", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: "test-key-123",
    };
    resetClient();
    mockCreate.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetClient();
  });

  describe("generateDashboard", () => {
    it("throws if OPENROUTER_API_KEY is not set", async () => {
      delete process.env.OPENROUTER_API_KEY;
      resetClient();
      await expect(generateDashboard("test")).rejects.toThrow(
        "OPENROUTER_API_KEY is not set. Set it in your environment or .env file."
      );
    });

    it("calls the LLM with system and user messages", async () => {
      mockCreate.mockResolvedValue({
        choices: [
          { message: { content: '{"title": "Test", "widgets": []}' } },
        ],
      });

      const result = await generateDashboard("Créame un dashboard de ventas");

      expect(result).toBe('{"title": "Test", "widgets": []}');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system" }),
            expect.objectContaining({
              role: "user",
              content: "Créame un dashboard de ventas",
            }),
          ]),
          temperature: 0.2,
        })
      );
    });

    it("system prompt contains key sections", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "{}" } }],
      });

      await generateDashboard("test");

      const systemContent = mockCreate.mock.calls[0][0].messages.find(
        (m: { role: string }) => m.role === "system"
      )?.content;

      expect(systemContent).toContain("dashboard generator");
      expect(systemContent).toContain("kpi_row");
      expect(systemContent).toContain("ps_ventas");
      expect(systemContent).toContain("total_si");
    });

    it("throws on empty LLM response", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      await expect(generateDashboard("test")).rejects.toThrow(
        "LLM returned an empty response"
      );
    });

    it("uses default model when DASHBOARD_LLM_MODEL is not set", async () => {
      delete process.env.DASHBOARD_LLM_MODEL;
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "{}" } }],
      });

      await generateDashboard("test");

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "anthropic/claude-sonnet-4",
        })
      );
    });

    it("uses custom model from DASHBOARD_LLM_MODEL", async () => {
      process.env.DASHBOARD_LLM_MODEL = "anthropic/claude-opus-4";
      resetClient();
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "{}" } }],
      });

      await generateDashboard("test");

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "anthropic/claude-opus-4",
        })
      );
    });
  });

  describe("modifyDashboard", () => {
    it("includes current spec in the system prompt", async () => {
      const currentSpec = '{"title":"Existing","widgets":[]}';
      mockCreate.mockResolvedValue({
        choices: [
          { message: { content: '{"title":"Updated","widgets":[]}' } },
        ],
      });

      const result = await modifyDashboard(currentSpec, "Añade el margen");

      expect(result).toBe('{"title":"Updated","widgets":[]}');

      const systemContent = mockCreate.mock.calls[0][0].messages.find(
        (m: { role: string }) => m.role === "system"
      )?.content;
      expect(systemContent).toContain("Existing");
      expect(systemContent).toContain("dashboard modifier");
    });

    it("sends user modification prompt", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "{}" } }],
      });

      await modifyDashboard("{}", "Añade gráfico de tendencia");

      const userContent = mockCreate.mock.calls[0][0].messages.find(
        (m: { role: string }) => m.role === "user"
      )?.content;
      expect(userContent).toBe("Añade gráfico de tendencia");
    });
  });
});
