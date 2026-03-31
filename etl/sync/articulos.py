"""ETL sync for Articulos and catalog dimension tables.

Full-refresh nightly strategy:
- Articulos: all 41K rows have FechaModifica >= 2025-03-26 (batch update rendered
  delta sync useless).  Truncate and reload every night.
- Catalog dimension tables (FamiGrupMarc, DepaSeccFabr, CCOPColores, CCOPTempTipo,
  CCOPMarcTrat) are trivially small (10–147 rows each) — full refresh is simplest.

Column mapping convention
-------------------------
safe_fetch returns lowercase keys (4D returns column names uppercase; fourd.py
normalises them).  The mapping dicts below translate those lowercase 4D names to
the snake_case PostgreSQL column names defined in etl/schema/init.sql.

PK precision warning
--------------------
4D PKs are REAL (float) with a .99 suffix pattern.  They are stored as NUMERIC in
PostgreSQL to avoid binary-float precision loss.  All PK/FK values are converted to
decimal.Decimal before being passed to the PostgreSQL insert helpers.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_NUMERIC_FIELDS = {
    # ps_articulos
    "regarticulo",
    "numfamilia",
    "numdepartament",
    "numcolor",
    "numtemporada",
    "nummarca",
    "numproveedor",
    "preciocoste",
    "prcostene",
    "piva",
    # ps_familias
    "regfamilia",
    "coeficiente1",
    "coeficiente2",
    "presupuesto",
    # ps_departamentos
    "regdepartament",
    "joiva",
    # ps_colores
    "regcolor",
    # ps_temporadas
    "regtemporada",
    # ps_marcas
    "regmarca",
    "descuentocompra",
}


def _to_decimal(value: Any) -> Any:
    """Convert float to Decimal; pass other types through unchanged."""
    if isinstance(value, float):
        return Decimal(str(value))
    return value


def _map_row(source: dict[str, Any], mapping: dict[str, str]) -> dict[str, Any]:
    """Return a new dict with keys renamed according to *mapping*.

    Keys in *source* that are absent from *mapping* are silently dropped.
    Values that are floats (in known numeric fields) are converted to Decimal.
    """
    result: dict[str, Any] = {}
    for src_key, pg_key in mapping.items():
        value = source.get(src_key)
        if src_key in _NUMERIC_FIELDS:
            value = _to_decimal(value)
        result[pg_key] = value
    return result


# ---------------------------------------------------------------------------
# Column mapping: 4D lowercase name → PostgreSQL column name
# ---------------------------------------------------------------------------

_ARTICULOS_MAPPING: dict[str, str] = {
    "regarticulo": "reg_articulo",
    "codigo": "codigo",
    "ccrefejofacm": "ccrefejofacm",
    "descripcion": "descripcion",
    "codigobarra": "codigo_barra",
    "numfamilia": "num_familia",
    "numdepartament": "num_departament",
    "numcolor": "num_color",
    "numtemporada": "num_temporada",
    "nummarca": "num_marca",
    "numproveedor": "num_proveedor",
    "preciocoste": "precio_coste",
    "prcostene": "pr_coste_ne",
    "piva": "p_iva",
    "anulado": "anulado",
    "fechacreacion": "fecha_creacion",
    "fechamodifica": "fecha_modifica",
    "color": "color",
    "clavetemporada": "clave_temporada",
    "modelo": "modelo",
    "sexo": "sexo",
}

_FAMILIAS_MAPPING: dict[str, str] = {
    "regfamilia": "reg_familia",
    "clave": "clave",
    "famigrupmarc": "fami_grup_marc",
    "coeficiente1": "coeficiente1",
    "coeficiente2": "coeficiente2",
    "cuentaventas": "cuenta_ventas",
    "presupuesto": "presupuesto",
    "anulado": "anulado",
    "serietallas": "serie_tallas",
    "claveseccion": "clave_seccion",
}

_DEPARTAMENTOS_MAPPING: dict[str, str] = {
    "regdepartament": "reg_departament",
    "clave": "clave",
    "depaseccfabr": "depa_secc_fabr",
    "joiva": "jo_iva",
    "presupuesto": "presupuesto",
    "anulado": "anulado",
}

_COLORES_MAPPING: dict[str, str] = {
    "regcolor": "reg_color",
    "clave": "clave",
    "color": "color",
}

_TEMPORADAS_MAPPING: dict[str, str] = {
    "regtemporada": "reg_temporada",
    "clave": "clave",
    "temporadatipo": "temporada_tipo",
    "temporadaactiv": "temporada_activ",
    "inicioventas": "inicio_ventas",
    "finventas": "fin_ventas",
    "iniciorebajas": "inicio_rebajas",
    "finrebajas": "fin_rebajas",
}

_MARCAS_MAPPING: dict[str, str] = {
    "regmarca": "reg_marca",
    "clave": "clave",
    "marcatratamien": "marca_tratamien",
    "presupuesto": "presupuesto",
    "descuentocompra": "descuento_compra",
}


# ---------------------------------------------------------------------------
# SQL queries (explicit column lists — never SELECT *)
# ---------------------------------------------------------------------------

_SQL_ARTICULOS = (
    "SELECT RegArticulo, Codigo, CCRefeJOFACM, Descripcion, CodigoBarra,"
    " NumFamilia, NumDepartament, NumColor, NumTemporada, NumMarca, NumProveedor,"
    " PrecioCoste, PrCosteNe, PIva, Anulado, FechaCreacion, FechaModifica,"
    " Color, ClaveTemporada, Modelo, Sexo"
    " FROM Articulos"
)

_SQL_FAMILIAS = (
    "SELECT RegFamilia, Clave, FamiGrupMarc, Coeficiente1, Coeficiente2,"
    " CuentaVentas, Presupuesto, Anulado, SerieTallas, ClaveSeccion"
    " FROM FamiGrupMarc"
)

_SQL_DEPARTAMENTOS = (
    "SELECT RegDepartament, Clave, DepaSeccFabr, JOIva, Presupuesto, Anulado"
    " FROM DepaSeccFabr"
)

_SQL_COLORES = "SELECT RegColor, Clave, Color FROM CCOPColores"

_SQL_TEMPORADAS = (
    "SELECT RegTemporada, Clave, TemporadaTipo, TemporadaActiv,"
    " InicioVentas, FinVentas, InicioRebajas, FinRebajas"
    " FROM CCOPTempTipo"
)

_SQL_MARCAS = (
    "SELECT RegMarca, Clave, MarcaTratamien, Presupuesto, DescuentoCompra"
    " FROM CCOPMarcTrat"
)


# ---------------------------------------------------------------------------
# Public sync functions
# ---------------------------------------------------------------------------


def sync_articulos(conn_4d: Any, conn_pg: Any) -> int:
    """Full-refresh ps_articulos from the 4D Articulos table.

    Args:
        conn_4d: An open p4d connection.
        conn_pg: An open psycopg2 connection.

    Returns:
        Number of rows loaded into ps_articulos.
    """
    from etl.db.fourd import safe_fetch
    from etl.db.postgres import truncate_and_insert

    raw_rows = safe_fetch(conn_4d, _SQL_ARTICULOS)
    pg_rows = [_map_row(r, _ARTICULOS_MAPPING) for r in raw_rows]
    return truncate_and_insert(conn_pg, "ps_articulos", pg_rows)


def sync_catalogos(conn_4d: Any, conn_pg: Any) -> dict[str, int]:
    """Full-refresh all catalog dimension tables.

    Syncs: ps_familias, ps_departamentos, ps_colores, ps_temporadas, ps_marcas.

    Args:
        conn_4d: An open p4d connection.
        conn_pg: An open psycopg2 connection.

    Returns:
        Dict mapping each PostgreSQL table name to the number of rows loaded.
    """
    from etl.db.fourd import safe_fetch
    from etl.db.postgres import truncate_and_insert

    catalog_tables: list[tuple[str, str, dict[str, str]]] = [
        ("ps_familias", _SQL_FAMILIAS, _FAMILIAS_MAPPING),
        ("ps_departamentos", _SQL_DEPARTAMENTOS, _DEPARTAMENTOS_MAPPING),
        ("ps_colores", _SQL_COLORES, _COLORES_MAPPING),
        ("ps_temporadas", _SQL_TEMPORADAS, _TEMPORADAS_MAPPING),
        ("ps_marcas", _SQL_MARCAS, _MARCAS_MAPPING),
    ]

    counts: dict[str, int] = {}
    for pg_table, sql, mapping in catalog_tables:
        raw_rows = safe_fetch(conn_4d, sql)
        pg_rows = [_map_row(r, mapping) for r in raw_rows]
        counts[pg_table] = truncate_and_insert(conn_pg, pg_table, pg_rows)

    return counts
