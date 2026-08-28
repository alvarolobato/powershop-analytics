/**
 * Regression guard for the D-044 tightening pass (chat + paneles horizontal
 * space — see docs/decisions/D-044-mobile-breakpoint-and-pad-x-token.md).
 *
 * A real phone screenshot of `/c/<id>` showed a results table's headers
 * breaking character-by-character ("Referencia" as "Refe / renc / ia")
 * while the table sat visibly inset from both screen edges. The fix tightens
 * several shared layers — `.chat-msg-area`, `.chat-bubble`, `.chat-table-th`
 * / `.chat-table-td`, `.dashboard-header-pad` / `.dashboard-kmode-banner` /
 * `.dashboard-renderer-pad`, `.panel-header`, `.panel-body`,
 * `.table-widget-cell` — each declared as an unconditional base (reproducing
 * the exact pre-existing desktop value) plus a narrower `@media (max-width:
 * 767.98px)` override, per the established `--pad-x` pattern.
 *
 * This test parses globals.css into (selector, body, mediaCondition) rules
 * and asserts, per class, that the phone-narrowed declaration appears in NO
 * unconditional rule for that selector (checking ALL such rules, not just
 * the first — an earlier draft of this test used `.find()` for the base
 * lookup and it kept passing even after a mutation duplicated the phone
 * rule as a second unconditional rule right after the real base, because
 * `.find()` only inspected the first match; `some()` over every
 * unconditional rule below is what actually catches that class of
 * mistake — verified against the same mutation, see the last test) and
 * DOES appear in at least one rule scoped to `@media (max-width:
 * 767.98px)`.
 *
 * There is no jsdom environment configured in this project (vitest runs
 * with `environment: "node"` — see vitest.config.ts), so this is a static
 * check on the CSS source text, following the same fs.readFileSync
 * drift-guard pattern as __tests__/globals-scroll-x-mobile-only.test.ts.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

const PHONE_QUERY = "@media (max-width: 767.98px)";

/** Strip /* ... *\/ comments so a mention inside one can't fake a match or confuse the brace parser. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

interface Rule {
  /** Raw selector text, e.g. ".chat-bubble" or ".a,\n  .b" for a grouped selector. */
  selector: string;
  /** Selector list, comma-split and trimmed. */
  selectors: string[];
  /** Declaration text between the rule's braces. */
  body: string;
  /** The @media condition this rule is nested in, or null for an unconditional (desktop-visible) rule. */
  mediaCondition: string | null;
}

/**
 * Minimal top-level CSS rule parser: walks the source tracking `@media`
 * nesting via a stack, and for every plain rule (selector + `{ ... }`)
 * records its body and the innermost `@media` condition it sits inside (or
 * null at the top level). Assumes no nested braces inside a plain rule body
 * (true for every rule in this file's pre-@keyframes region) and no
 * `@media`-like at-rules other than the `(max-width: 767.98px)` ones used
 * throughout — both hold for the region this test parses (see `region`
 * below, sliced before `@keyframes`, which *does* nest braces and would
 * break this parser).
 */
function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const mediaStack: string[] = [];
  let i = 0;
  const n = css.length;

  while (i < n) {
    while (i < n && /\s/.test(css[i])) i++;
    if (i >= n) break;

    if (css.startsWith("@media", i)) {
      const braceIdx = css.indexOf("{", i);
      const condition = css.slice(i, braceIdx).trim();
      mediaStack.push(condition);
      i = braceIdx + 1;
      continue;
    }

    if (css[i] === "}") {
      mediaStack.pop();
      i++;
      continue;
    }

    const nextBrace = css.indexOf("{", i);
    if (nextBrace === -1) break;
    const selector = css.slice(i, nextBrace).trim();
    const closeIdx = css.indexOf("}", nextBrace);
    const body = css.slice(nextBrace + 1, closeIdx);
    rules.push({
      selector,
      selectors: selector.split(",").map((s) => s.trim()),
      body,
      mediaCondition: mediaStack.length ? mediaStack[mediaStack.length - 1] : null,
    });
    i = closeIdx + 1;
  }

  return rules;
}

function rulesFor(rules: Rule[], className: string): Rule[] {
  return rules.filter((r) => r.selectors.includes(className));
}

/** Bodies of every UNCONDITIONAL (desktop-visible) rule for this class — plural and exhaustive on purpose, see file header. */
function baseBodies(rules: Rule[], className: string): string[] {
  return rulesFor(rules, className)
    .filter((r) => r.mediaCondition === null)
    .map((r) => r.body);
}

/** Bodies of every rule for this class scoped to the phone media query. */
function phoneBodies(rules: Rule[], className: string): string[] {
  return rulesFor(rules, className)
    .filter((r) => r.mediaCondition === PHONE_QUERY)
    .map((r) => r.body);
}

/**
 * The core assertion: `marker` (a phone-only value, e.g. "92%") must not
 * appear in ANY unconditional rule for `className` (which would mean it
 * also applies on desktop), and must appear in at least one phone-scoped
 * rule for it.
 */
function expectPhoneOnly(rules: Rule[], className: string, marker: string) {
  const base = baseBodies(rules, className);
  const phone = phoneBodies(rules, className);
  expect(base.some((b) => b.includes(marker)), `${className} base rule(s) must NOT contain "${marker}"`).toBe(false);
  expect(phone.some((b) => b.includes(marker)), `${className} phone rule(s) must contain "${marker}"`).toBe(true);
}

/**
 * Remove every `@keyframes` block (balanced-brace skip, so its percentage
 * stops don't confuse the flat parser) while KEEPING everything after it.
 *
 * An earlier version sliced the file at the first `@keyframes` instead. That
 * left the guard blind to anything below it — and the end of the file is the
 * most natural place for someone to append a rule, so the one mutation most
 * likely to happen in practice was the one it could not see. Verified by
 * appending `.chat-bubble { padding-left: 8px; padding-right: 8px; }` to the
 * end of globals.css: the sliced version still passed, this one fails.
 */
function stripKeyframes(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf("@keyframes", i);
    if (at === -1) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, at);
    const open = css.indexOf("{", at);
    if (open === -1) break;
    let depth = 0;
    let j = open;
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    i = j + 1;
  }
  return out;
}

function loadRules(cssText: string): Rule[] {
  return parseRules(stripKeyframes(stripComments(cssText)));
}

let rules: Rule[];
let rawCss: string;

beforeAll(() => {
  const cssPath = path.resolve(__dirname, "../app/globals.css");
  rawCss = fs.readFileSync(cssPath, "utf8");
  rules = loadRules(rawCss);
});

describe("globals.css: D-044 tightening rules are phone-scoped, desktop base is untouched", () => {
  it("sanity: the parser finds a plausible number of rules in the region", () => {
    // Loose floor — just guards against the parser silently returning [].
    expect(rules.length).toBeGreaterThan(20);
  });

  it(".chat-msg-area / .chat-msg-area--panel: base keeps 16px/14px, phone narrows to --pad-x", () => {
    expect(baseBodies(rules, ".chat-msg-area").join("\n")).toContain("16px");
    expect(baseBodies(rules, ".chat-msg-area--panel").join("\n")).toContain("14px");
    expectPhoneOnly(rules, ".chat-msg-area", "var(--pad-x, 12px)");
    expectPhoneOnly(rules, ".chat-msg-area--panel", "var(--pad-x, 12px)");
  });

  it(".chat-bubble: base keeps max-width 85% / 12px padding, phone widens to 92% / 8px", () => {
    expect(baseBodies(rules, ".chat-bubble").join("\n")).toContain("max-width: 85%");
    expectPhoneOnly(rules, ".chat-bubble", "max-width: 92%");
  });

  it(".chat-table-th / .chat-table-td: base has no white-space:nowrap, phone adds it to th only", () => {
    expect(baseBodies(rules, ".chat-table-th").join("\n")).toContain("8px");
    expect(baseBodies(rules, ".chat-table-th").some((b) => b.includes("nowrap"))).toBe(false);
    expect(baseBodies(rules, ".chat-table-td").some((b) => b.includes("nowrap"))).toBe(false);

    // Only the header gets forced onto one line — this is the actual fix
    // for the reported character-splitting bug, and it must not leak to
    // desktop (a docked ChatSidebar chat panel can be just as narrow as a
    // phone even on a wide screen, but the reported bug — and the
    // "desktop must be pixel-identical" requirement — is about the phone
    // breakpoint, so this stays gated the same as every other rule here).
    expectPhoneOnly(rules, ".chat-table-th", "white-space: nowrap");
    expect(phoneBodies(rules, ".chat-table-td").some((b) => b.includes("nowrap"))).toBe(false);
  });

  it(".dashboard-header-pad / .dashboard-kmode-banner / .dashboard-renderer-pad: base keeps 20px, phone narrows to --pad-x", () => {
    for (const cls of [".dashboard-header-pad", ".dashboard-kmode-banner", ".dashboard-renderer-pad"]) {
      expect(baseBodies(rules, cls).join("\n")).toContain("20px");
      expectPhoneOnly(rules, cls, "var(--pad-x, 12px)");
    }
  });

  it(".panel-header: base keeps 16px, phone narrows to --pad-x", () => {
    expect(baseBodies(rules, ".panel-header").join("\n")).toContain("16px");
    expectPhoneOnly(rules, ".panel-header", "var(--pad-x, 12px)");
  });

  it(".panel-body: base mirrors --pad (density token), phone narrows to --pad-x", () => {
    expect(baseBodies(rules, ".panel-body").join("\n")).toContain("var(--pad, 12px)");
    expectPhoneOnly(rules, ".panel-body", "var(--pad-x, 12px)");
  });

  it(".table-widget-cell: base keeps 12px, phone tightens to 8px", () => {
    expect(baseBodies(rules, ".table-widget-cell").join("\n")).toContain("12px");
    expectPhoneOnly(rules, ".table-widget-cell", "padding-left: 8px");
  });

  it("mutation check: expectPhoneOnly fails if a phone rule is duplicated as a second unconditional rule (the exact mistake this file guards against)", () => {
    // Simulate hoisting `.chat-bubble`'s phone override out of the media
    // query by injecting a second, unconditional `.chat-bubble { max-width:
    // 92%; ... }` rule right after the real base rule — the same shape a
    // careless merge/refactor would produce, and the shape a naive
    // `.find()`-based lookup (an earlier draft of this test) missed
    // entirely because it only inspected the FIRST unconditional match.
    const marker = ".chat-bubble {\n  max-width: 85%;\n  padding-left: 12px;\n  padding-right: 12px;\n}\n";
    expect(rawCss).toContain(marker);
    const mutated = rawCss.replace(
      marker,
      marker + ".chat-bubble {\n  max-width: 92%;\n  padding-left: 8px;\n  padding-right: 8px;\n}\n",
    );
    const mutatedRules = loadRules(mutated);

    expect(() => expectPhoneOnly(mutatedRules, ".chat-bubble", "max-width: 92%")).toThrow();
  });
});
