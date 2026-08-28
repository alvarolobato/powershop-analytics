/**
 * Regression guard for PR #894 review finding 1: `.scroll-x-wrapper` /
 * `.scroll-x-inner` (the 480px min-width floor for wide charts/tables on
 * phones — see globals.css) must stay scoped to the mobile breakpoint.
 *
 * Left unscoped, `.scroll-x-inner`'s 480px floor also applied at desktop
 * widths — on a 1440px laptop with the chat sidebar open, a half-width
 * chart column lands around 476–518px, under the floor, so charts got
 * clipped behind a horizontal scrollbar on DESKTOP too.
 *
 * There is no jsdom environment configured in this project (vitest runs
 * with `environment: "node"` — see vitest.config.ts), so this is a static
 * check on the CSS source text rather than a computed-style assertion,
 * following the same fs.readFileSync drift-guard pattern as
 * __tests__/sync-names-drift.test.ts.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/** Strip /* ... *\/ comments so a mention inside one can't fake a match. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Remove every `@media (max-width: 767.98px) { ... }` block (matching
 * nested braces, since rules inside can themselves contain `{ }`, e.g.
 * `:root[data-density="compact"] { --pad-x: 10px; }`), returning the rest
 * of the stylesheet.
 */
function stripMobileMediaBlocks(css: string): string {
  const openerRe = /@media\s*\(max-width:\s*767\.98px\)\s*\{/g;
  let out = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = openerRe.exec(css)) !== null) {
    out += css.slice(cursor, match.index);
    // Walk forward from the opening brace to find its matching close.
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    cursor = i; // resume just past the matched closing brace
    openerRe.lastIndex = cursor;
  }
  out += css.slice(cursor);
  return out;
}

describe("globals.css: .scroll-x-wrapper / .scroll-x-inner are mobile-only", () => {
  const cssPath = path.resolve(__dirname, "../app/globals.css");
  const css = stripComments(fs.readFileSync(cssPath, "utf8"));
  const outsideMobileQueries = stripMobileMediaBlocks(css);

  it(".scroll-x-wrapper does not appear outside @media (max-width: 767.98px)", () => {
    expect(outsideMobileQueries).not.toContain(".scroll-x-wrapper");
  });

  it(".scroll-x-inner does not appear outside @media (max-width: 767.98px)", () => {
    expect(outsideMobileQueries).not.toContain(".scroll-x-inner");
  });

  // Sanity check that the extraction logic actually finds and strips the
  // mobile block in the first place — otherwise the two assertions above
  // would pass trivially even if the selectors were never wrapped at all.
  it("sanity: both selectors DO appear somewhere in the full stylesheet", () => {
    expect(css).toContain(".scroll-x-wrapper");
    expect(css).toContain(".scroll-x-inner");
  });
});
