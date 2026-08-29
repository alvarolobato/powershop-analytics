"""The sales-by-size view must never multiply a sale line.

ps_barras_asociado's primary key is reg_barras, NOT codigo, so a single
barcode can appear on several rows. Joining it directly against a sale line
multiplies that line by the number of matches and inflates every SUM(unidades).

Measured on a four-line fixture where one barcode maps to three sizes, the
naive join produced 7 rows instead of 4 and 29 units instead of 17 (+71%),
and invented sales of M/L/XL that never happened — one 5-unit sale counted
once per size. A "most-sold size" built on that is confidently wrong, which
is worse than the honest "cannot be determined" this view replaces.

These run against a real PostgreSQL when one is configured (same gate as the
rest of the DB-backed suite) because the guarantee is a property of the SQL,
not of any Python we could mock.
"""

import os

import pytest


def _postgres_available() -> bool:
    if os.environ.get("POSTGRES_DSN", "").strip():
        return True
    return bool(
        os.environ.get("POSTGRES_USER", "") and os.environ.get("POSTGRES_DB", "")
    )


pytestmark = pytest.mark.skipif(
    not _postgres_available(), reason="PostgreSQL not configured"
)

# reg_lineas, codigo_asociado, unidades
_LINES = [
    (1, "EAN-DUP", 5),  # barcode maps to three different sizes -> ambiguous
    (2, "EAN-OK", 7),  # barcode maps to exactly one size -> resolves
    (3, "EAN-SAME", 2),  # duplicated rows that agree on the size -> resolves
    (4, None, 3),  # line never carried a barcode
]

# reg_barras, codigo, talla
_BARRAS = [
    (1, "EAN-DUP", "M"),
    (2, "EAN-DUP", "L"),
    (3, "EAN-DUP", "XL"),
    (4, "EAN-OK", "S"),
    (5, "EAN-SAME", "XS"),
    (6, "EAN-SAME", "XS"),
]


@pytest.fixture()
def seeded(pg_conn):
    """Seed the fixture rows and remove them afterwards."""
    regs = [r[0] for r in _LINES]
    barras = [b[0] for b in _BARRAS]
    with pg_conn.cursor() as cur:
        for reg, cod_asoc, uds in _LINES:
            cur.execute(
                "INSERT INTO ps_lineas_ventas (reg_lineas, codigo, codigo_asociado, unidades)"
                " VALUES (%s,'ART-TEST',%s,%s) ON CONFLICT (reg_lineas) DO NOTHING",
                (reg, cod_asoc, uds),
            )
        for reg, cod, talla in _BARRAS:
            cur.execute(
                "INSERT INTO ps_barras_asociado (reg_barras, codigo, talla)"
                " VALUES (%s,%s,%s) ON CONFLICT (reg_barras) DO NOTHING",
                (reg, cod, talla),
            )
    pg_conn.commit()
    yield pg_conn
    with pg_conn.cursor() as cur:
        cur.execute("DELETE FROM ps_lineas_ventas WHERE reg_lineas = ANY(%s)", (regs,))
        cur.execute(
            "DELETE FROM ps_barras_asociado WHERE reg_barras = ANY(%s)", (barras,)
        )
    pg_conn.commit()


def test_view_emits_exactly_one_row_per_sale_line(seeded):
    with seeded.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM ps_lineas_ventas_talla WHERE codigo = 'ART-TEST'"
        )
        assert cur.fetchone()[0] == len(_LINES)


def test_view_does_not_inflate_units(seeded):
    """The whole point: totals through the view must equal the base table."""
    with seeded.cursor() as cur:
        cur.execute(
            "SELECT (SELECT SUM(unidades) FROM ps_lineas_ventas WHERE codigo='ART-TEST'),"
            "       (SELECT SUM(unidades) FROM ps_lineas_ventas_talla WHERE codigo='ART-TEST')"
        )
        base, through_view = cur.fetchone()
        assert base == through_view == sum(u for _, _, u in _LINES)


def test_a_barcode_with_several_sizes_is_ambiguous_never_an_arbitrary_pick(seeded):
    with seeded.cursor() as cur:
        cur.execute(
            "SELECT talla, talla_resolucion FROM ps_lineas_ventas_talla WHERE reg_lineas = 1"
        )
        talla, resolucion = cur.fetchone()
        assert resolucion == "ambiguo"
        assert talla is None, (
            "an ambiguous barcode must not resolve to one of its sizes"
        )


def test_duplicate_rows_that_agree_still_resolve(seeded):
    """Duplication alone is not ambiguity — only disagreement is."""
    with seeded.cursor() as cur:
        cur.execute(
            "SELECT talla, talla_resolucion FROM ps_lineas_ventas_talla WHERE reg_lineas = 3"
        )
        assert cur.fetchone() == ("XS", "ok")


def test_line_without_a_barcode_is_labelled_as_such(seeded):
    with seeded.cursor() as cur:
        cur.execute(
            "SELECT talla, talla_resolucion FROM ps_lineas_ventas_talla WHERE reg_lineas = 4"
        )
        talla, resolucion = cur.fetchone()
        assert resolucion == "sin_codigo_asociado"
        assert talla is None
