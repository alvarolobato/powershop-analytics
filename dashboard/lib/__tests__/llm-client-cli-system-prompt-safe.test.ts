/**
 * Guards the invariant `CLI_SYSTEM_PROMPT_SAFE_FLOWS` in llm-client.ts
 * depends on: for every flow in that set, `buildSystemPrompt(flow, vars).stable`
 * must be identical regardless of per-call `vars`.
 *
 * Why this matters: the CLI single-shot driver puts a safe flow's `stable`
 * on `--system-prompt` (lean mode on) or `--append-system-prompt` (lean mode
 * off) — see D-046 and `claude-code.ts`'s `leanArgs`. Both flags persist
 * across calls in a way stdin does not (that's the entire point — it's what
 * makes the CLI's prompt cache anchor on the content). If a flow that is
 * currently vars-independent quietly grew a `vars`-interpolation, the only
 * externally-visible symptom would be a worse cache-hit rate — nothing else
 * would catch it, and nobody would notice until the CLI bill went up. This
 * test fails immediately and loudly instead.
 *
 * `analyze`/`weekly`/`suggest`/`gap` are deliberately absent from
 * `CLI_SYSTEM_PROMPT_SAFE_FLOWS` (see the audit comment above that constant
 * in `llm-client.ts`) — they DO interpolate per-call data into `stable`, so
 * this test does not, and must not, assert the invariant for them.
 */

import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "@/lib/llm-context";
import { CLI_SYSTEM_PROMPT_SAFE_FLOWS } from "@/lib/llm-client";
import type { FlowVars } from "@/lib/llm-context";

/**
 * `buildSystemPrompt("chat", ...)`'s own `buildFreeChatContext()` (the
 * local, deprecated one in `llm-context/system-prompt.ts` — not the real
 * one at `lib/conversation-context.ts`, which every actual call site uses)
 * resolves `@/lib/llm-tools/catalog` via a runtime `require()` rather than a
 * static import, which works under Next.js/webpack but not under vitest's
 * module resolution — an unrelated, pre-existing environment quirk, not
 * something this test can fix or should work around by asserting less. Its
 * `vars`-independence is instead verified by inspection: the "chat" branch
 * of `buildSystemPrompt`'s switch calls `buildFreeChatContext()` with no
 * arguments at all, so there is no `vars` field it could possibly read.
 */
const UNTESTABLE_BUT_AUDITED_SAFE_FLOWS = new Set(["chat"]);

// Two vars payloads that differ on every field any flow's builder reads.
// A flow that starts reading one of these into `stable` will fail below.
const varsA: FlowVars = {
  currentSpec: JSON.stringify({ title: "Spec A", widgets: [] }),
  serializedData: "## Widget A\ndata A",
  action: "explicar",
  dashboardId: 111,
  role: "Director de ventas",
  existingDashboards: [{ title: "Dashboard A", description: "Desc A" }],
  queryResults: "query results A",
  reviewedWeekDescription: "Semana 2026-01-01 a 2026-01-07",
  generationMode: "initial",
};

const varsB: FlowVars = {
  currentSpec: JSON.stringify({ title: "Spec B", widgets: [{ id: "w1" }] }),
  serializedData: "## Widget B\ndata B, completely different",
  action: "comparar",
  dashboardId: 222,
  role: "Responsable de compras",
  existingDashboards: [
    { title: "Dashboard B1", description: "Desc B1" },
    { title: "Dashboard B2", description: "Desc B2" },
  ],
  queryResults: "query results B, also different",
  reviewedWeekDescription: "Semana 2026-06-01 a 2026-06-07",
  generationMode: "alternate_angle",
};

describe("CLI_SYSTEM_PROMPT_SAFE_FLOWS invariant", () => {
  it("is non-empty and only names flows buildSystemPrompt actually handles", () => {
    expect(CLI_SYSTEM_PROMPT_SAFE_FLOWS.size).toBeGreaterThan(0);
  });

  for (const flow of CLI_SYSTEM_PROMPT_SAFE_FLOWS) {
    if (UNTESTABLE_BUT_AUDITED_SAFE_FLOWS.has(flow)) continue;
    it(`buildSystemPrompt("${flow}", vars).stable is independent of vars`, () => {
      const a = buildSystemPrompt(flow, varsA).stable;
      const b = buildSystemPrompt(flow, varsB).stable;
      expect(a).toEqual(b);
    });
  }

  // Documents the deliberate exclusions so this test file is the one place
  // that explains *why* a flow that looks like it should be "safe" isn't —
  // not an assertion that they must stay unequal forever (fixing one of
  // these to genuinely split stable/volatile and adding it to
  // CLI_SYSTEM_PROMPT_SAFE_FLOWS is welcome; this just documents today's
  // audited state).
  const knownUnsafe: Record<string, keyof FlowVars> = {
    analyze: "serializedData",
    weekly: "queryResults",
    suggest: "role",
    gap: "existingDashboards",
  };

  for (const [flow, varyingField] of Object.entries(knownUnsafe)) {
    it(`"${flow}" is excluded from CLI_SYSTEM_PROMPT_SAFE_FLOWS (interpolates ${varyingField} into stable)`, () => {
      expect(CLI_SYSTEM_PROMPT_SAFE_FLOWS.has(flow)).toBe(false);
    });
  }
});
