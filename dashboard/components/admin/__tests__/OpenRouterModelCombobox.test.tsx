// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { OpenRouterModelCombobox } from "../OpenRouterModelCombobox";

const SAMPLE = {
  models: [
    {
      id: "anthropic/claude-sonnet-4",
      name: "Anthropic: Claude Sonnet 4",
      description: "Strong reasoning model.",
      context_length: 200_000,
      prompt_price_per_1m: 3,
      completion_price_per_1m: 15,
      modality: "text+image->text",
      supports_tools: true,
      popular: true,
    },
    {
      id: "openai/gpt-4o-mini",
      name: "OpenAI: GPT-4o mini",
      description: "Cheap and fast.",
      context_length: 128_000,
      prompt_price_per_1m: 0.15,
      completion_price_per_1m: 0.6,
      modality: "text+image->text",
      supports_tools: true,
      popular: true,
    },
    {
      id: "obscure/some-model",
      name: "Obscure model",
      description: "Not popular.",
      context_length: 8_000,
      prompt_price_per_1m: 0.1,
      completion_price_per_1m: 0.2,
      modality: "text->text",
      supports_tools: false,
      popular: false,
    },
  ],
  cached_at: "2026-05-03T00:00:00Z",
  source: "cache",
};

describe("OpenRouterModelCombobox", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(SAMPLE), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the current value when closed", () => {
    render(
      <OpenRouterModelCombobox value="anthropic/claude-sonnet-4" onChange={() => {}} />,
    );
    expect(screen.getByText("anthropic/claude-sonnet-4")).toBeInTheDocument();
  });

  it("opens the catalog and shows Populares section first", async () => {
    render(<OpenRouterModelCombobox value="" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("Populares")).toBeInTheDocument();
    });
    // Popular models should be in the list
    expect(screen.getByText("Anthropic: Claude Sonnet 4")).toBeInTheDocument();
    expect(screen.getByText("OpenAI: GPT-4o mini")).toBeInTheDocument();
    // Non-popular under "Todos"
    expect(screen.getByText("Todos")).toBeInTheDocument();
    expect(screen.getByText("Obscure model")).toBeInTheDocument();
  });

  it("filters by query, matching id and name", async () => {
    render(<OpenRouterModelCombobox value="" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button"));

    const search = await screen.findByTestId("or-model-combobox-search");
    fireEvent.change(search, { target: { value: "obscure" } });

    await waitFor(() => {
      expect(screen.getByText("Obscure model")).toBeInTheDocument();
    });
    expect(screen.queryByText("Anthropic: Claude Sonnet 4")).not.toBeInTheDocument();
  });

  it("calls onChange with the model id when a row is picked", async () => {
    const onChange = vi.fn();
    render(<OpenRouterModelCombobox value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));

    const row = await screen.findByTestId("or-model-row-anthropic/claude-sonnet-4");
    fireEvent.click(row);

    expect(onChange).toHaveBeenCalledWith("anthropic/claude-sonnet-4");
  });

  it("falls back to a plain text input when the catalog fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 502 })),
    );
    const onChange = vi.fn();
    render(<OpenRouterModelCombobox value="claude" onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("anthropic/claude-sonnet-4")).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText("anthropic/claude-sonnet-4") as HTMLInputElement;
    expect(input.value).toBe("claude");
  });
});
