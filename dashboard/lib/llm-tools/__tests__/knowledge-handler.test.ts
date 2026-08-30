/**
 * Tests for the `search_knowledge` tool handler.
 *
 * These run against the REAL generated index (`lib/knowledge-index.ts`), not a
 * fixture, on purpose: the bug that motivated the tool was knowledge that
 * existed in the repo and was unreachable from the model. A test on a synthetic
 * corpus would have stayed green through exactly that failure.
 */

import { describe, it, expect } from "vitest";
import { KNOWLEDGE_INDEX } from "@/lib/knowledge-index";
import {
  handleSearchKnowledge,
  excerpt,
  tokenize,
  byScoreThenDialect,
  FOURD_WARNING,
  MAX_BODY,
  MAX_RESULTS,
} from "../handlers/knowledge";
import type { LlmAgenticContext } from "../types";
import type { ToolOkBody, ToolErrorBody } from "../tool-payload";

const ctx: LlmAgenticContext = { requestId: "test-req", endpoint: "test" };

interface SearchResult {
  source: string;
  heading: string;
  has_sql: boolean;
  dialect: "4d" | "postgres" | "n/a";
  truncated: boolean;
  content: string;
}
interface SearchData {
  query: string;
  terms: string[];
  searched: number;
  results: SearchResult[];
}

async function search(args: Record<string, unknown>) {
  return handleSearchKnowledge(JSON.stringify(args), ctx);
}

function expectOk(body: Awaited<ReturnType<typeof search>>): SearchData {
  expect(body.ok).toBe(true);
  return (body as ToolOkBody<SearchData>).data;
}

function expectError(body: Awaited<ReturnType<typeof search>>): ToolErrorBody {
  expect(body.ok).toBe(false);
  return body as ToolErrorBody;
}

describe("search_knowledge", () => {
  describe("the case that motivated the tool", () => {
    // PR #914 invented a `BarrasAsociado` join for sales-by-size because the
    // model never saw `report-generation.md`, where the validated query has
    // lived for months. If this test ever goes red, the tool is back to being
    // decorative.
    it("finds a usable sales-by-size query for 'ventas por talla'", async () => {
      const data = expectOk(await search({ query: "ventas por talla" }));
      // Deliberately NOT pinned to a source file: what matters is that the
      // model gets a query it can run against the mirror. Pinning the file is
      // how this test broke when the (better) PostgreSQL pairs started
      // outranking the 4D report — a ranking improvement read as a failure.
      const usable = data.results.find(
        (r) => r.dialect === "postgres" && r.has_sql && /\btalla\b/i.test(r.content),
      );
      expect(usable, `no usable talla query in: ${data.results.map((r) => r.heading).join(" | ")}`)
        .toBeDefined();
      expect(usable!.content).toMatch(/ps_lineas_ventas/);
      // and the size axis itself must be grouped on, not just mentioned
      expect(usable!.content).toMatch(/GROUP BY[^;]*talla/i);
    });

    it("keeps the SQL in the excerpt even though it sits past the character cap", async () => {
      // The talla query lives ~1850 chars into a ~2500-char section, i.e. past
      // MAX_BODY. A positional `slice(0, MAX_BODY)` returns the right section
      // with the wrong bytes — the model still cannot see the query.
      const chunk = KNOWLEDGE_INDEX.find((c) => c.body.includes("CCOPTallaOjo"));
      expect(chunk).toBeDefined();
      expect(chunk!.body.indexOf("CCOPTallaOjo")).toBeGreaterThan(MAX_BODY);

      const data = expectOk(await search({ query: "CCOPTallaOjo" }));
      const hit = data.results.find((r) => r.source === "docs/skills/report-generation.md");
      expect(hit?.content).toContain("CCOPTallaOjo");
      expect(hit?.content).toContain("GROUP BY lv.CCOPTallaOjo");
    });
  });

  describe("4D vs PostgreSQL dialect", () => {
    // Half the corpus queries the source ERP, whose tables have no prefix
    // (`FROM Ventas`). The dashboard queries the mirror (`ps_ventas`). Handing
    // the model 4D SQL unlabelled makes it write tables that do not exist —
    // the same "looked applicable, wasn't" failure the tool exists to prevent.
    it("labels a 4D-only section and shouts about it in the content", async () => {
      // `_USER_TABLES` is a 4D system table: it exists nowhere in the mirror.
      const data = expectOk(await search({ query: "_USER_TABLES tablas del sistema" }));
      const fourD = data.results.find((r) => r.dialect === "4d");
      expect(fourD, `no 4D section in: ${data.results.map((r) => r.heading).join(" | ")}`)
        .toBeDefined();
      expect(fourD!.content.startsWith(FOURD_WARNING)).toBe(true);
      expect(fourD!.content).toContain("NO ejecutable contra el espejo PostgreSQL");
    });

    it("marks every section that queries an unprefixed ERP table as 4d", () => {
      // The invariant that matters: if the body says `FROM Ventas` (no ps_
      // prefix, so not the mirror), the model must be warned. Checked across
      // the whole corpus, not one sample, so a narrowed detector goes red.
      const unprefixed = /\b(?:FROM|JOIN)\s+(?:Ventas|LineasVentas|Articulos|CCStock|Exportaciones)\b/;
      const offenders = KNOWLEDGE_INDEX.filter(
        (c) => unprefixed.test(c.body) && c.dialect !== "4d",
      ).map((c) => `${c.source} | ${c.heading}`);
      expect(offenders).toEqual([]);
    });

    it("still holds 4D originals in sample-queries.md", () => {
      const fourD = KNOWLEDGE_INDEX.filter(
        (c) => c.source === "docs/sample-queries.md" && c.dialect === "4d",
      );
      expect(fourD.length, "fixture assumption: sample-queries.md holds 4D originals")
        .toBeGreaterThan(0);
      expect(
        fourD.some((c) =>
          /\b(?:FROM|JOIN)\s+(?:Ventas|LineasVentas|Articulos|CCStock)\b/.test(c.body),
        ),
      ).toBe(true);
    });

    it("never mislabels the ps_* mirror pairs as 4D", () => {
      const pairs = KNOWLEDGE_INDEX.filter((c) => c.source === "docs/dashboard/sql-pairs.md");
      expect(pairs.length).toBeGreaterThan(0);
      expect(pairs.every((c) => c.dialect === "postgres")).toBe(true);
    });

    it("leaves PostgreSQL sections unprefixed", async () => {
      const data = expectOk(await search({ query: "ventas netas por tienda" }));
      const pg = data.results.find((r) => r.dialect === "postgres");
      expect(pg).toBeDefined();
      expect(pg!.content.startsWith(FOURD_WARNING)).toBe(false);
    });

    it("puts the executable version first when scores tie", () => {
      const tied = [
        { score: 10, dialect: "4d" as const },
        { score: 10, dialect: "n/a" as const },
        { score: 10, dialect: "postgres" as const },
      ];
      expect([...tied].sort(byScoreThenDialect).map((r) => r.dialect)).toEqual([
        "postgres",
        "n/a",
        "4d",
      ]);
    });

    it("never lets the dialect preference override a real score difference", () => {
      const scored = [
        { score: 1, dialect: "postgres" as const },
        { score: 9, dialect: "4d" as const },
      ];
      expect([...scored].sort(byScoreThenDialect).map((r) => r.score)).toEqual([9, 1]);
    });
  });

  describe("only_sql", () => {
    it("narrows the corpus to sections that carry SQL", async () => {
      const all = expectOk(await search({ query: "stock tienda" }));
      const sqlOnly = expectOk(await search({ query: "stock tienda", only_sql: true }));
      expect(sqlOnly.searched).toBeLessThan(all.searched);
      expect(sqlOnly.searched).toBe(KNOWLEDGE_INDEX.filter((c) => c.hasSql).length);
      expect(sqlOnly.results.every((r) => r.has_sql)).toBe(true);
    });

    it("drops a prose-only section that the unfiltered search returns", async () => {
      // Guards against `only_sql` being accepted and then ignored. The section
      // is picked from the live index (its headings shift as the docs change),
      // so the test asserts the behaviour, not a snapshot of the corpus.
      const uniqueHeadings = new Set(
        KNOWLEDGE_INDEX.map((c) => c.heading).filter(
          (h, _i, all) => all.filter((x) => x === h).length === 1,
        ),
      );
      const prose = KNOWLEDGE_INDEX.find(
        (c) => !c.hasSql && uniqueHeadings.has(c.heading) && tokenize(c.heading).length >= 2,
      );
      expect(prose, "fixture assumption: the index has prose-only sections").toBeDefined();

      const all = expectOk(await search({ query: prose!.heading }));
      expect(all.results.some((r) => r.heading === prose!.heading && !r.has_sql)).toBe(true);

      const sqlOnly = expectOk(await search({ query: prose!.heading, only_sql: true }));
      expect(sqlOnly.results.every((r) => r.has_sql)).toBe(true);
      expect(sqlOnly.results.map((r) => r.heading)).not.toContain(prose!.heading);
    });

    it("defaults to the full corpus when omitted", async () => {
      const data = expectOk(await search({ query: "stock tienda" }));
      expect(data.searched).toBe(KNOWLEDGE_INDEX.length);
    });
  });

  describe("bad input returns a tool error, never a crash", () => {
    it("rejects a missing query", async () => {
      const err = expectError(await search({}));
      expect(err.code).toBe("INVALID_ARGS");
      expect(err.requestId).toBe("test-req");
    });

    it("rejects an empty query", async () => {
      expect(expectError(await search({ query: "   " })).code).toBe("EMPTY_QUERY");
    });

    it("rejects a query with no searchable terms", async () => {
      expect(expectError(await search({ query: "de la el" })).code).toBe("NO_SEARCHABLE_TERMS");
      expect(expectError(await search({ query: "?? !! ..." })).code).toBe("NO_SEARCHABLE_TERMS");
    });

    it("rejects a non-string query instead of coercing it", async () => {
      expect(expectError(await search({ query: 42 })).code).toBe("INVALID_ARGS");
    });

    it("rejects malformed JSON arguments", async () => {
      const err = expectError(await handleSearchKnowledge("{not json", ctx));
      expect(err.code).toBe("INVALID_ARGS");
    });

    it("returns an empty result set (not an error) when nothing matches", async () => {
      const data = expectOk(await search({ query: "zzzqqqxyzzy" }));
      expect(data.results).toEqual([]);
    });
  });

  describe("result caps", () => {
    it("never returns more than 6 sections", async () => {
      // Literal, not MAX_RESULTS: asserting against the constant the code uses
      // passes for any value of it, including "no cap at all".
      const query = "ventas stock tienda articulo cliente";
      const data = expectOk(await search({ query }));
      expect(MAX_RESULTS).toBe(6);
      expect(data.results).toHaveLength(6);
      // ...and the corpus genuinely has more matches than that, so the 6 is a
      // cap being applied and not just all there was.
      const terms = tokenize(query);
      const matching = KNOWLEDGE_INDEX.filter((c) => {
        const hay = `${c.heading} ${c.body}`.toLowerCase();
        return terms.some((t) => hay.includes(t));
      });
      expect(matching.length).toBeGreaterThan(6);
    });

    it("caps every section at MAX_BODY and flags it as truncated", async () => {
      const data = expectOk(await search({ query: "ventas por talla" }));
      for (const r of data.results) {
        // The 4D warning is charged against the budget, not added on top, so
        // the cap holds for every dialect.
        expect(r.content.length).toBeLessThanOrEqual(MAX_BODY);
      }
      const long = KNOWLEDGE_INDEX.filter((c) => c.body.length > MAX_BODY);
      expect(long.length, "fixture assumption: some sections exceed the cap").toBeGreaterThan(0);
      const truncatedHit = data.results.find((r) => r.truncated);
      expect(truncatedHit).toBeDefined();
    });

    it("returns short sections whole and unflagged", () => {
      const out = excerpt("una seccion corta sobre ventas", ["ventas"]);
      expect(out.truncated).toBe(false);
      expect(out.content).toBe("una seccion corta sobre ventas");
    });
  });

  describe("excerpt", () => {
    it("keeps the matching block and drops the padding", () => {
      const filler = "prosa irrelevante sobre otras cosas.\n".repeat(60);
      const body = `${filler}\n\`\`\`sql\nSELECT CCOPTallaOjo FROM LineasVentas\n\`\`\`\n${filler}`;
      const out = excerpt(body, ["ccoptallaojo"], 300);
      expect(out.truncated).toBe(true);
      expect(out.content).toContain("CCOPTallaOjo");
      expect(out.content.length).toBeLessThanOrEqual(300);
    });

    it("windows around the match when a single block blows the budget", () => {
      const body = `${"x".repeat(2000)}CCOPTallaOjo${"y".repeat(2000)}`;
      const out = excerpt(body, ["ccoptallaojo"], 300);
      expect(out.truncated).toBe(true);
      expect(out.content.length).toBeLessThanOrEqual(300);
      expect(out.content).toContain("CCOPTallaOjo");
    });
  });

  describe("tokenize", () => {
    it("drops stop words, short words and duplicates", () => {
      expect(tokenize("las ventas de la ventas por talla")).toEqual(["ventas", "talla"]);
    });

    it("folds accents so 'artículo' matches 'articulo'", () => {
      expect(tokenize("artículo")).toEqual(["articulo"]);
    });

    it("returns nothing for a query made only of noise", () => {
      expect(tokenize("de la el ?? !!")).toEqual([]);
    });
  });
});
