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
parse_relationships_from_mds = wpm.parse_relationships_from_mds


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


# ── parse_relationships_from_mds ────────────────────────────────────────────

_RELATIONSHIPS_MD = """\
## LLM:relationships

```json
[
  {"from": "ps_lineas_ventas", "fromColumn": "num_ventas", "to": "ps_ventas", "toColumn": "reg_ventas", "type": "MANY_TO_ONE"},
  {"from": "ps_ventas", "fromColumn": "tienda", "to": "ps_tiendas", "toColumn": "codigo", "type": "MANY_TO_ONE"}
]
```
"""


def test_parse_relationships_basic(tmp_path):
    md_file = tmp_path / "test.md"
    md_file.write_text(_RELATIONSHIPS_MD, encoding="utf-8")
    result = parse_relationships_from_mds([str(md_file)])
    assert len(result) == 2
    assert (
        "ps_lineas_ventas",
        "num_ventas",
        "ps_ventas",
        "reg_ventas",
        "MANY_TO_ONE",
    ) in result
    assert ("ps_ventas", "tienda", "ps_tiendas", "codigo", "MANY_TO_ONE") in result


def test_parse_relationships_tuple_shape(tmp_path):
    md_file = tmp_path / "test.md"
    md_file.write_text(_RELATIONSHIPS_MD, encoding="utf-8")
    result = parse_relationships_from_mds([str(md_file)])
    for item in result:
        assert isinstance(item, tuple)
        assert len(item) == 5
        from_m, from_col, to_m, to_col, rtype = item
        assert isinstance(from_m, str)
        assert isinstance(from_col, str)
        assert isinstance(to_m, str)
        assert isinstance(to_col, str)
        assert rtype == "MANY_TO_ONE"


def test_parse_relationships_multi_md(tmp_path):
    md1 = tmp_path / "a.md"
    md1.write_text(
        "## LLM:relationships\n\n```json\n"
        '[{"from": "ps_ventas", "fromColumn": "tienda", "to": "ps_tiendas", "toColumn": "codigo", "type": "MANY_TO_ONE"}]\n'
        "```\n",
        encoding="utf-8",
    )
    md2 = tmp_path / "b.md"
    md2.write_text(
        "## LLM:relationships\n\n```json\n"
        '[{"from": "ps_articulos", "fromColumn": "num_familia", "to": "ps_familias", "toColumn": "reg_familia", "type": "MANY_TO_ONE"}]\n'
        "```\n",
        encoding="utf-8",
    )
    result = parse_relationships_from_mds([str(md1), str(md2)])
    assert len(result) == 2
    assert ("ps_ventas", "tienda", "ps_tiendas", "codigo", "MANY_TO_ONE") in result
    assert (
        "ps_articulos",
        "num_familia",
        "ps_familias",
        "reg_familia",
        "MANY_TO_ONE",
    ) in result


def test_parse_relationships_no_section(tmp_path):
    md_file = tmp_path / "test.md"
    md_file.write_text("## LLM:rules\n\n```json\n[]\n```\n", encoding="utf-8")
    result = parse_relationships_from_mds([str(md_file)])
    assert result == []


def test_parse_relationships_empty_list(tmp_path):
    md_file = tmp_path / "test.md"
    md_file.write_text("## LLM:relationships\n\n```json\n[]\n```\n", encoding="utf-8")
    result = parse_relationships_from_mds([str(md_file)])
    assert result == []


def test_parse_relationships_missing_file():
    result = parse_relationships_from_mds(["/nonexistent/path.md"])
    assert result == []


def test_parse_relationships_invalid_json_raises(tmp_path):
    md_file = tmp_path / "bad.md"
    md_file.write_text(
        "## LLM:relationships\n\n```json\n{bad json\n```\n", encoding="utf-8"
    )
    with pytest.raises(ValueError, match="Invalid JSON"):
        parse_relationships_from_mds([str(md_file)])


def test_parse_relationships_set_equality(tmp_path):
    """Order of entries doesn't matter — test set-equality."""
    md_file = tmp_path / "test.md"
    md_file.write_text(_RELATIONSHIPS_MD, encoding="utf-8")
    result = parse_relationships_from_mds([str(md_file)])
    expected = {
        ("ps_lineas_ventas", "num_ventas", "ps_ventas", "reg_ventas", "MANY_TO_ONE"),
        ("ps_ventas", "tienda", "ps_tiendas", "codigo", "MANY_TO_ONE"),
    }
    assert set(result) == expected


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


def test_relationships_count():
    """Real SOURCE_MDS must yield exactly 25 relationships (19 original + 6 new)."""
    assert len(wpm.RELATIONSHIPS) == 25, (
        f"Expected 25 relationships, got {len(wpm.RELATIONSHIPS)}"
    )


def test_relationships_are_tuples_of_five():
    """Every relationship must be a 5-tuple of strings."""
    for rel in wpm.RELATIONSHIPS:
        assert isinstance(rel, tuple), f"Expected tuple, got {type(rel)}: {rel!r}"
        assert len(rel) == 5, f"Expected 5-tuple, got {len(rel)}-tuple: {rel!r}"
        assert all(isinstance(s, str) for s in rel), f"Non-string in tuple: {rel!r}"


def test_relationships_new_entries_present():
    """The 6 new cross-domain relationships must be in the loaded set."""
    rels = set(wpm.RELATIONSHIPS)
    expected_new = {
        ("ps_traspasos", "tienda_salida", "ps_tiendas", "codigo", "MANY_TO_ONE"),
        ("ps_traspasos", "tienda_entrada", "ps_tiendas", "codigo", "MANY_TO_ONE"),
        ("ps_traspasos", "codigo", "ps_articulos", "codigo", "MANY_TO_ONE"),
        ("ps_gc_pedidos", "num_cliente", "ps_clientes", "reg_cliente", "MANY_TO_ONE"),
        ("ps_gc_lin_pedidos", "num_pedido", "ps_gc_pedidos", "n_pedido", "MANY_TO_ONE"),
        (
            "ps_compras",
            "num_proveedor",
            "ps_proveedores",
            "reg_proveedor",
            "MANY_TO_ONE",
        ),
    }
    missing = expected_new - rels
    assert not missing, f"Missing new relationships: {missing}"
