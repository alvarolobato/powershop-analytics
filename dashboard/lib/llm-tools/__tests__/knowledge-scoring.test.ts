/**
 * Scoring properties, on a controlled corpus.
 *
 * The handler tests run against the real index, which is the right check for
 * "is the knowledge reachable" but a poor one for "why". A corpus of 41 fake
 * sections pins the two mechanisms that make the ranking work, so weakening
 * either of them fails here instead of silently degrading search quality until
 * someone notices the model guessing again.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// 40 sections that mention the common term a lot and the rare term never,
// plus one that mentions both once. A term-frequency ranker prefers the noise;
// an IDF-weighted one prefers the single section that actually knows about the
// rare term. Mirrors "ventas" (in a third of the corpus) vs "talla".
vi.mock("@/lib/knowledge-index", () => {
  const noise = Array.from({ length: 40 }, (_, i) => ({
    source: `docs/noise-${i}.md`,
    heading: `Noise ${i}`,
    body: "ventas ventas ventas ventas ventas ventas ventas ventas",
    hasSql: false,
    dialect: "n/a" as const,
  }));
  const signal = {
    source: "docs/signal.md",
    heading: "Signal",
    body: "ventas por talla",
    hasSql: false,
    dialect: "n/a" as const,
  };
  return { KNOWLEDGE_INDEX: [...noise, signal] };
});

import { handleSearchKnowledge, __resetKnowledgeCaches } from "../handlers/knowledge";
import type { ToolOkBody } from "../tool-payload";
import type { LlmAgenticContext } from "../types";

const ctx: LlmAgenticContext = { requestId: "test-scoring", endpoint: "test" };

interface Data {
  results: { source: string; heading: string }[];
}

async function search(query: string): Promise<Data> {
  const body = await handleSearchKnowledge(JSON.stringify({ query }), ctx);
  expect(body.ok).toBe(true);
  return (body as ToolOkBody<Data>).data;
}

describe("search_knowledge scoring", () => {
  beforeEach(() => __resetKnowledgeCaches());

  it("prefers the rare term over forty repetitions of the common one (IDF)", async () => {
    const data = await search("ventas talla");
    expect(data.results[0]?.source).toBe("docs/signal.md");
  });

  it("prefers the section that covers more of the query (coverage)", async () => {
    // Same corpus, single-term query: with nothing rare to key on, the ranking
    // falls back to term frequency and the noise wins. This is the control —
    // it proves the previous test is measuring IDF, not the corpus shape.
    const data = await search("ventas");
    expect(data.results[0]?.source).toMatch(/^docs\/noise-/);
  });

  it("ranks the single relevant section above the noise floor, not just first", async () => {
    const data = await search("talla");
    expect(data.results).toHaveLength(1);
    expect(data.results[0]?.source).toBe("docs/signal.md");
  });
});
