#!/usr/bin/env python3
"""Extract ## LLM:* marker sections from curated knowledge MDs.

Reads INPUT_SLICES (comma-separated slice names) and GITHUB_WORKSPACE,
extracts all LLM-marked sections from each requested file, and writes
a concatenated bundle to GITHUB_OUTPUT.
"""

import os
import re
import sys

SLICE_MAP = {
    "data-decisions": "docs/data-decisions.md",
    "etl-sync-strategy": "docs/etl-sync-strategy.md",
    "architecture-sales": "docs/architecture/sales.md",
    "architecture-wholesale": "docs/architecture/wholesale.md",
    "architecture-stock": "docs/architecture/stock-logistics.md",
    "architecture-purchasing": "docs/architecture/purchasing.md",
    "architecture-products": "docs/architecture/products.md",
    "architecture-customers": "docs/architecture/customers.md",
    "architecture-stores": "docs/architecture/stores-hr.md",
    "4d-sql-dialect": "docs/skills/4d-sql-dialect.md",
    "data-access": "docs/skills/data-access.md",
    "sql-pairs": "docs/dashboard/sql-pairs.md",
}

LLM_HEADING = re.compile(r"^## LLM:(\w[\w-]*)$")
ANY_H2 = re.compile(r"^## ")


def extract_llm_sections(source: str):
    """Return list of (marker, content) for every ## LLM:* section."""
    sections = []
    current_marker = None
    current_lines = []

    for line in source.splitlines():
        m = LLM_HEADING.match(line.rstrip())
        if m:
            if current_marker is not None:
                sections.append((current_marker, "\n".join(current_lines).strip()))
            current_marker = m.group(1)
            current_lines = []
        elif current_marker is not None:
            if ANY_H2.match(line):
                sections.append((current_marker, "\n".join(current_lines).strip()))
                current_marker = None
                current_lines = []
            else:
                current_lines.append(line)

    if current_marker is not None:
        sections.append((current_marker, "\n".join(current_lines).strip()))

    return sections


def main() -> None:
    raw_slices = os.environ.get("INPUT_SLICES", "").strip()
    workspace = os.environ.get("GITHUB_WORKSPACE", ".")
    github_output = os.environ.get("GITHUB_OUTPUT", "")

    slices = [s.strip() for s in raw_slices.split(",") if s.strip()]

    bundle_parts = []

    for slice_name in slices:
        if slice_name not in SLICE_MAP:
            print(f"WARNING: unknown slice '{slice_name}' — skipping", file=sys.stderr)
            continue

        rel_path = SLICE_MAP[slice_name]
        abs_path = os.path.join(workspace, rel_path)

        if not os.path.isfile(abs_path):
            print(f"WARNING: file not found '{abs_path}' for slice '{slice_name}' — skipping", file=sys.stderr)
            continue

        with open(abs_path, encoding="utf-8") as f:
            source = f.read()

        sections = extract_llm_sections(source)
        if not sections:
            continue

        file_parts = [f"### Source: {rel_path}"]
        for marker, content in sections:
            if content:
                file_parts.append(f"#### {marker}\n\n{content}")

        if len(file_parts) > 1:  # has at least one non-empty section
            bundle_parts.append("\n\n".join(file_parts))

    if bundle_parts:
        bundle = "## Data Platform Knowledge\n\n" + "\n\n".join(bundle_parts) + "\n\n---"
    else:
        bundle = ""

    if github_output:
        # GITHUB_OUTPUT multiline (heredoc) format. The naive form
        #     bundle<<KNOWLEDGE_EOF
        #     <bundle>
        #     KNOWLEDGE_EOF
        # encodes an empty bundle as `\n` (a single newline) instead of `""`,
        # because the trailing `\n` before the delimiter belongs to the value.
        # Skip the value-line entirely when bundle is empty so the output
        # value is the empty string. Also skip the trailing newline when the
        # bundle already ends with one to avoid trailing-blank-line drift.
        with open(github_output, "a", encoding="utf-8") as f:
            f.write("bundle<<KNOWLEDGE_EOF\n")
            if bundle:
                f.write(bundle)
                if not bundle.endswith("\n"):
                    f.write("\n")
            f.write("KNOWLEDGE_EOF\n")
    else:
        print(bundle)


if __name__ == "__main__":
    main()
