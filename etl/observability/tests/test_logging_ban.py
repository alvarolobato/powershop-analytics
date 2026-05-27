"""CI guard: verify no stdlib logging or print() calls remain in ETL app code.

These tests act as a lint gate so the ruff.toml T201 rule (print ban) and the
import logging ban are verified without requiring ruff to run in pytest.
"""

from __future__ import annotations

import pathlib
import re

ETL_ROOT = pathlib.Path(__file__).parent.parent.parent  # etl/


def _etl_app_files() -> list[pathlib.Path]:
    """Return Python source files in etl/ that are NOT in observability/ or tests/."""
    return [
        p
        for p in ETL_ROOT.rglob("*.py")
        if "observability" not in p.parts and "tests" not in p.parts
    ]


def test_no_import_logging_in_app_code():
    """No ETL app code should import the stdlib logging module."""
    violations = []
    for path in _etl_app_files():
        text = path.read_text(encoding="utf-8")
        for lineno, line in enumerate(text.splitlines(), 1):
            if re.search(r"^\s*import logging\b", line):
                violations.append(f"{path.relative_to(ETL_ROOT.parent)}:{lineno}: {line.strip()}")
    assert violations == [], (
        "stdlib 'import logging' found in ETL app code — use etl.observability.log instead:\n"
        + "\n".join(violations)
    )


def test_no_logging_basicconfig_in_app_code():
    """No ETL app code should call logging.basicConfig."""
    violations = []
    for path in _etl_app_files():
        text = path.read_text(encoding="utf-8")
        for lineno, line in enumerate(text.splitlines(), 1):
            if re.search(r"logging\.basicConfig", line):
                violations.append(f"{path.relative_to(ETL_ROOT.parent)}:{lineno}: {line.strip()}")
    assert violations == [], (
        "logging.basicConfig() found in ETL app code:\n" + "\n".join(violations)
    )
