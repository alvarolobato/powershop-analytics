"""Consistency test: SYNC_NAMES_WITH_WATERMARK must match the whitelists in the
dashboard TypeScript files.

Rationale (issue #398, Opus finding #2):
  Three artefacts enumerate the same nine watermark-backed sync names:
    1. etl/main.py                                  — Python tuple (ground truth)
    2. dashboard/app/api/etl/run/route.ts            — ALLOWED_FORCE_TABLES Set
    3. dashboard/components/etl/ForceResyncDialog.tsx — RESYNCABLE_TABLES array

  This test imports/parses all three and asserts they contain the same values so
  drift is caught in CI without requiring runtime file I/O in production code.

  The test does NOT require a live database.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Locate repo root (two parents above etl/tests/)
# ---------------------------------------------------------------------------
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_ROUTE_TS = _REPO_ROOT / "dashboard" / "app" / "api" / "etl" / "run" / "route.ts"
_DIALOG_TSX = _REPO_ROOT / "dashboard" / "components" / "etl" / "ForceResyncDialog.tsx"


# ---------------------------------------------------------------------------
# Source 1 — Python import (always available)
# ---------------------------------------------------------------------------


def _get_python_names() -> frozenset[str]:
    from etl.main import SYNC_NAMES_WITH_WATERMARK

    return frozenset(SYNC_NAMES_WITH_WATERMARK)


# ---------------------------------------------------------------------------
# Source 2 — TypeScript route.ts: extract ALLOWED_FORCE_TABLES Set literal
# ---------------------------------------------------------------------------

_ALLOWED_FORCE_TABLES_RE = re.compile(
    r"ALLOWED_FORCE_TABLES\s*[:\w<>,\s]*=\s*new\s+Set\s*\(\s*\[([^\]]+)\]",
    re.DOTALL,
)


def _get_route_ts_names() -> frozenset[str]:
    if not _ROUTE_TS.exists():
        pytest.skip(f"route.ts not found at {_ROUTE_TS}; skipping TS consistency check")
    text = _ROUTE_TS.read_text(encoding="utf-8")
    m = _ALLOWED_FORCE_TABLES_RE.search(text)
    if m is None:
        pytest.fail(
            f"Could not find ALLOWED_FORCE_TABLES in {_ROUTE_TS}. "
            "Update the regex in test_sync_names_consistency.py if the variable was renamed."
        )
    # Extract quoted strings from the matched bracket content
    names = re.findall(r'"([^"]+)"', m.group(1))
    if not names:
        pytest.fail(
            f"ALLOWED_FORCE_TABLES found but contained no quoted string literals in {_ROUTE_TS}"
        )
    return frozenset(names)


# ---------------------------------------------------------------------------
# Source 3 — ForceResyncDialog.tsx: extract RESYNCABLE_TABLES name fields
#
# The declaration spans multiple lines and may have a complex type annotation:
#   export const RESYNCABLE_TABLES: ReadonlyArray<{ name: string; label: string }> =
#     [
#       { name: "stock", label: "..." },
#       ...
#     ];
#
# Strategy: find the assignment `= \n  [` then scan for name: "value" entries
# until we hit the closing `];` — do NOT rely on bracket counting across
# the type annotation (which also contains `[` and `]`).
# ---------------------------------------------------------------------------


def _get_dialog_tsx_names() -> frozenset[str]:
    if not _DIALOG_TSX.exists():
        pytest.skip(
            f"ForceResyncDialog.tsx not found at {_DIALOG_TSX}; skipping TS consistency check"
        )
    text = _DIALOG_TSX.read_text(encoding="utf-8")

    # Locate the assignment start: RESYNCABLE_TABLES ... = [
    assign_re = re.compile(r"RESYNCABLE_TABLES\b[^=]*=\s*\[", re.DOTALL)
    m = assign_re.search(text)
    if m is None:
        pytest.fail(
            f"Could not find RESYNCABLE_TABLES assignment in {_DIALOG_TSX}. "
            "Update the regex in test_sync_names_consistency.py if the variable was renamed."
        )
    # Extract the array body from after the opening `[` to the matching `];`
    body_start = m.end()
    end_match = re.search(r"\];", text[body_start:])
    if end_match is None:
        pytest.fail(
            f"RESYNCABLE_TABLES array is not terminated with `];` in {_DIALOG_TSX}"
        )
    array_body = text[body_start : body_start + end_match.start()]

    # Extract name: "..." patterns
    names = re.findall(r'name\s*:\s*"([^"]+)"', array_body)
    if not names:
        pytest.fail(
            f"RESYNCABLE_TABLES found but contained no name: '...' fields in {_DIALOG_TSX}"
        )
    return frozenset(names)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestSyncNamesConsistency:
    """All three sources must enumerate the same watermark-backed sync names."""

    def test_route_ts_matches_python(self):
        """ALLOWED_FORCE_TABLES in route.ts must equal SYNC_NAMES_WITH_WATERMARK in main.py."""
        python_names = _get_python_names()
        ts_names = _get_route_ts_names()

        extra_in_ts = ts_names - python_names
        missing_in_ts = python_names - ts_names

        assert not extra_in_ts and not missing_in_ts, (
            "ALLOWED_FORCE_TABLES (route.ts) and SYNC_NAMES_WITH_WATERMARK (main.py) differ.\n"
            f"  Extra in route.ts only:  {sorted(extra_in_ts)}\n"
            f"  Missing from route.ts:   {sorted(missing_in_ts)}\n"
            "Fix: update the constant in the file that is out of date."
        )

    def test_dialog_tsx_matches_python(self):
        """RESYNCABLE_TABLES names in ForceResyncDialog.tsx must equal SYNC_NAMES_WITH_WATERMARK."""
        python_names = _get_python_names()
        tsx_names = _get_dialog_tsx_names()

        extra_in_tsx = tsx_names - python_names
        missing_in_tsx = python_names - tsx_names

        assert not extra_in_tsx and not missing_in_tsx, (
            "RESYNCABLE_TABLES (ForceResyncDialog.tsx) and SYNC_NAMES_WITH_WATERMARK (main.py) differ.\n"
            f"  Extra in ForceResyncDialog.tsx only: {sorted(extra_in_tsx)}\n"
            f"  Missing from ForceResyncDialog.tsx:  {sorted(missing_in_tsx)}\n"
            "Fix: update the constant in the file that is out of date."
        )

    def test_all_three_match(self):
        """All three sources (Python + 2 TS files) must be identical as a set."""
        python_names = _get_python_names()
        ts_names = _get_route_ts_names()
        tsx_names = _get_dialog_tsx_names()

        assert python_names == ts_names == tsx_names, (
            "Three-way mismatch detected:\n"
            f"  Python (main.py):             {sorted(python_names)}\n"
            f"  TypeScript (route.ts):        {sorted(ts_names)}\n"
            f"  TypeScript (dialog.tsx):      {sorted(tsx_names)}\n"
        )
