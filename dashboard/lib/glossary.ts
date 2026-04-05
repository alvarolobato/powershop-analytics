/**
 * Glossary utility — term matching and React node generation.
 *
 * `applyGlossary()` scans a text string for glossary term matches (case-insensitive,
 * word-boundary aware) and wraps each match with a GlossaryTooltip component.
 * Only the first occurrence of each term per text string is wrapped.
 *
 * Returns a React.ReactNode: either a plain string (when no matches) or a
 * fragment with text + tooltip spans interleaved.
 */

import React from "react";
import { GlossaryTooltip } from "@/components/GlossaryTooltip";
import type { GlossaryItem } from "@/lib/schema";

/**
 * Apply glossary tooltips to a text string.
 *
 * @param text - The plain text to scan.
 * @param glossary - Array of glossary entries. Pass undefined/empty to return plain string.
 * @returns A React.ReactNode — plain string when no matches, ReactFragment otherwise.
 */
export function applyGlossary(
  text: string,
  glossary: GlossaryItem[] | undefined,
): React.ReactNode {
  if (!glossary || glossary.length === 0) return text;

  // Build a list of matches: {start, end, term, definition}
  // Only collect the first occurrence of each term.
  interface Match {
    start: number;
    end: number;
    term: string;
    definition: string;
  }

  const seenTerms = new Set<string>();
  const matches: Match[] = [];

  for (const entry of glossary) {
    const normalizedTerm = entry.term.toLowerCase();
    if (seenTerms.has(normalizedTerm)) continue;

    // Build a word-boundary-aware regex.
    // We use (?<!\w) and (?!\w) instead of \b to correctly handle accented
    // characters (e.g. "entrada" should not match inside "contraindicación").
    // The regex is case-insensitive.
    const escapedTerm = entry.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?<![\\wáéíóúüñÁÉÍÓÚÜÑ])${escapedTerm}(?![\\wáéíóúüñÁÉÍÓÚÜÑ])`, "i");

    const match = regex.exec(text);
    if (match) {
      seenTerms.add(normalizedTerm);
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        term: match[0], // use the matched text (preserves original casing)
        definition: entry.definition,
      });
    }
  }

  if (matches.length === 0) return text;

  // Sort by start position and resolve overlaps (first match wins)
  matches.sort((a, b) => a.start - b.start);
  const nonOverlapping: Match[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start >= cursor) {
      nonOverlapping.push(m);
      cursor = m.end;
    }
  }

  if (nonOverlapping.length === 0) return text;

  // Build an array of React nodes: alternating text segments and tooltips
  const nodes: React.ReactNode[] = [];
  let pos = 0;

  for (const m of nonOverlapping) {
    if (m.start > pos) {
      nodes.push(text.slice(pos, m.start));
    }
    nodes.push(
      React.createElement(GlossaryTooltip, {
        key: `${m.start}-${m.term}`,
        term: m.term,
        definition: m.definition,
      }),
    );
    pos = m.end;
  }

  if (pos < text.length) {
    nodes.push(text.slice(pos));
  }

  return React.createElement(React.Fragment, null, ...nodes);
}
