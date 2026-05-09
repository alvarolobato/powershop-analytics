"""Unit tests for the MD parser functions in wren-push-metadata.py.

Most tests use fixture Markdown strings (no filesystem access).
Integration tests at the bottom load from the real SOURCE_MDS files on disk.
"""

import importlib.util
import pathlib
import types

import pytest


# ── Load the module without executing __main__ ──────────────────────────────


def _load_wpm() -> types.ModuleType:
    spec = importlib.util.spec_from_file_location(
        "wren_push_metadata",
        pathlib.Path(__file__).parent.parent / "wren-push-metadata.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


wpm = _load_wpm()

parse_marker_sections = wpm.parse_marker_sections
extract_instructions = wpm.extract_instructions
extract_sql_pairs = wpm.extract_sql_pairs
transform_date_placeholders = wpm.transform_date_placeholders


# ── parse_marker_sections ────────────────────────────────────────────────────


def test_parse_marker_sections_basic():
    md = """\
## LLM:rules

Some content here.

More content.
"""
    sections = parse_marker_sections(md)
    assert len(sections) == 1
    assert sections[0]["marker"] == "rules"
    assert "Some content here" in sections[0]["content"]


def test_parse_marker_sections_multiple():
    md = """\
## LLM:rules

Rules content.

## LLM:sql-pairs

Pairs content.
"""
    sections = parse_marker_sections(md)
    assert len(sections) == 2
    assert sections[0]["marker"] == "rules"
    assert sections[1]["marker"] == "sql-pairs"


def test_parse_marker_sections_terminated_by_non_llm_h2():
    md = """\
## LLM:rules

Rules content.

## Other Section

This is not LLM content.
"""
    sections = parse_marker_sections(md)
    assert len(sections) == 1
    assert sections[0]["marker"] == "rules"
    assert "Other Section" not in sections[0]["content"]


def test_parse_marker_sections_empty_content():
    md = """\
## LLM:rules

## LLM:sql-pairs

Pairs content.
"""
    sections = parse_marker_sections(md)
    assert len(sections) == 2
    assert sections[0]["content"] == ""
    assert sections[1]["marker"] == "sql-pairs"


def test_parse_marker_sections_no_llm_headings():
    md = """\
## Regular Section

Some regular content.
"""
    sections = parse_marker_sections(md)
    assert sections == []


def test_parse_marker_sections_end_of_file():
    md = """\
## LLM:rules

Final section with no trailing heading.
"""
    sections = parse_marker_sections(md)
    assert len(sections) == 1
    assert "Final section" in sections[0]["content"]


# ── extract_instructions ─────────────────────────────────────────────────────

_RULES_MD = """\
## LLM:rules

```json
[
  {"instruction": "Use total_si not total.", "questions": ["¿Ventas?"]},
  {"instruction": "Filter entrada=true.", "questions": ["¿Cuánto?", "¿Tickets?"]}
]
```
"""


def test_extract_instructions_basic():
    instrs = extract_instructions(_RULES_MD)
    assert len(instrs) == 2
    assert instrs[0]["instruction"] == "Use total_si not total."
    assert instrs[0]["questions"] == ["¿Ventas?"]
    assert instrs[1]["instruction"] == "Filter entrada=true."


def test_extract_instructions_empty_array():
    md = "## LLM:rules\n\n```json\n[]\n```\n"
    instrs = extract_instructions(md)
    assert instrs == []


def test_extract_instructions_no_rules_section():
    md = "## LLM:sql-pairs\n\n### Q\n```sql\nSELECT 1\n```\n"
    instrs = extract_instructions(md)
    assert instrs == []


def test_extract_instructions_invalid_json_raises():
    md = "## LLM:rules\n\n```json\n{bad json\n```\n"
    with pytest.raises(ValueError, match="Invalid JSON"):
        extract_instructions(md)


def test_extract_instructions_multiple_rules_sections():
    md = """\
## LLM:rules

```json
[{"instruction": "First.", "questions": []}]
```

## LLM:rules

```json
[{"instruction": "Second.", "questions": []}]
```
"""
    instrs = extract_instructions(md)
    assert len(instrs) == 2
    assert instrs[0]["instruction"] == "First."
    assert instrs[1]["instruction"] == "Second."


# ── extract_sql_pairs ────────────────────────────────────────────────────────

_SQL_PAIRS_MD = """\
## LLM:sql-pairs

### ¿Ventas netas?
```sql
SELECT SUM(total_si) FROM ps_ventas WHERE entrada = true
```

### ¿Tickets hoy?
```sql
SELECT COUNT(*) FROM ps_ventas WHERE fecha_creacion = CURRENT_DATE
```
"""


def test_extract_sql_pairs_basic():
    pairs = extract_sql_pairs(_SQL_PAIRS_MD)
    assert len(pairs) == 2
    q1, sql1 = pairs[0]
    assert q1 == "¿Ventas netas?"
    assert "SUM(total_si)" in sql1
    q2, sql2 = pairs[1]
    assert q2 == "¿Tickets hoy?"


def test_extract_sql_pairs_no_section():
    md = "## LLM:rules\n\n```json\n[]\n```\n"
    pairs = extract_sql_pairs(md)
    assert pairs == []


def test_extract_sql_pairs_skips_missing_sql_block():
    md = """\
## LLM:sql-pairs

### Question without SQL

Some prose but no sql block.

### Question with SQL
```sql
SELECT 1
```
"""
    pairs = extract_sql_pairs(md)
    assert len(pairs) == 1
    assert pairs[0][0] == "Question with SQL"


def test_extract_sql_pairs_date_placeholder_transformed():
    md = """\
## LLM:sql-pairs

### ¿Ventas del mes?
```sql
SELECT SUM(total_si) FROM ps_ventas WHERE fecha_creacion BETWEEN :curr_from AND :curr_to
```
"""
    pairs = extract_sql_pairs(md)
    assert len(pairs) == 1
    _, sql = pairs[0]
    assert ":curr_from" not in sql
    assert ":curr_to" not in sql
    assert "DATE_TRUNC('month', CURRENT_DATE)" in sql
    assert "CURRENT_DATE" in sql


def test_extract_sql_pairs_all_placeholders_transformed():
    md = """\
## LLM:sql-pairs

### ¿Comparativa?
```sql
SELECT * FROM t WHERE d BETWEEN :curr_from AND :curr_to AND d2 BETWEEN :comp_from AND :comp_to
```
"""
    pairs = extract_sql_pairs(md)
    _, sql = pairs[0]
    assert ":curr_from" not in sql
    assert ":curr_to" not in sql
    assert ":comp_from" not in sql
    assert ":comp_to" not in sql
    assert "INTERVAL '1 year'" in sql


# ── transform_date_placeholders ──────────────────────────────────────────────


def test_transform_curr_from():
    sql = "WHERE d >= :curr_from"
    result = transform_date_placeholders(sql)
    assert result == "WHERE d >= DATE_TRUNC('month', CURRENT_DATE)"


def test_transform_curr_to():
    sql = "WHERE d <= :curr_to"
    result = transform_date_placeholders(sql)
    assert result == "WHERE d <= CURRENT_DATE"


def test_transform_comp_from():
    sql = "WHERE d >= :comp_from"
    result = transform_date_placeholders(sql)
    assert result == "WHERE d >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 year'"


def test_transform_comp_to():
    sql = "WHERE d <= :comp_to"
    result = transform_date_placeholders(sql)
    assert result == "WHERE d <= CURRENT_DATE - INTERVAL '1 year'"


def test_transform_all_placeholders():
    sql = "BETWEEN :curr_from AND :curr_to AND BETWEEN :comp_from AND :comp_to"
    result = transform_date_placeholders(sql)
    assert ":curr_from" not in result
    assert ":curr_to" not in result
    assert ":comp_from" not in result
    assert ":comp_to" not in result


def test_transform_no_placeholders_unchanged():
    sql = "SELECT SUM(total_si) FROM ps_ventas WHERE entrada = true"
    assert transform_date_placeholders(sql) == sql


def test_transform_idempotent():
    sql = "WHERE d >= :curr_from"
    result1 = transform_date_placeholders(sql)
    result2 = transform_date_placeholders(result1)
    assert result1 == result2


# ── integration: load from real source MDs ──────────────────────────────────


def test_load_knowledge_counts():
    """Verify the real SOURCE_MDS yield at least the expected minimums."""
    assert len(wpm.INSTRUCTIONS) >= 44, (
        f"Expected ≥44 instructions, got {len(wpm.INSTRUCTIONS)}"
    )
    assert len(wpm.SQL_PAIRS) >= 52, f"Expected ≥52 SQL pairs, got {len(wpm.SQL_PAIRS)}"


def test_no_date_placeholders_in_sql_pairs():
    """All SQL pairs from real MDs must have placeholders resolved."""
    placeholders = (":curr_from", ":curr_to", ":comp_from", ":comp_to")
    for question, sql in wpm.SQL_PAIRS:
        for ph in placeholders:
            assert ph not in sql, (
                f"Placeholder {ph!r} found in SQL pair for question: {question!r}"
            )


def test_instructions_have_required_keys():
    """Every instruction must have 'instruction' and 'questions' keys."""
    for inst in wpm.INSTRUCTIONS:
        assert "instruction" in inst, f"Missing 'instruction' key: {inst!r}"
        assert "questions" in inst, f"Missing 'questions' key: {inst!r}"
        assert isinstance(inst["questions"], list)
