"""Reconciliación por particiones: lo único que ve lo que el delta no puede ver.

El delta es `FechaModifica > watermark` + UPSERT. Eso lo hace estructuralmente
ciego a tres cosas, por bien que corra:

1. **Borrados en 4D.** Una fila borrada no tiene `FechaModifica` que reportar,
   así que se queda en el espejo para siempre. El "full" nocturno tampoco los
   quita: para `ventas`/`lineas_ventas`/`pagos_ventas` no hay TRUNCATE ni DELETE
   en `etl/sync/ventas.py` — un "full" ahí es literalmente un delta con
   `since=2014-01-01`. La deriva se ve: el espejo llegó a tener 977.040 ventas
   contra las 977.019 que declaraba 4D.
2. **Filas con `FechaModifica` NULL**, invisibles a cualquier `>= {d '...'}`.
3. **Filas que descarta el prefiltro de D-050** (PK NULL/NaN): se registran como
   omitidas, pero nadie vuelve a por ellas hasta que 4D las toque otra vez.

La reconciliación compara un CENSO por partición entre origen y espejo, y sólo
baja a por las particiones que no cuadran. Coste medido contra producción
(2026-09-02), con la sobrecarga del túnel ya descontada:

    consulta trivial (sobrecarga)                 1,1 s
    GROUP BY Mes sobre las 1,8 M filas           67,0 s   <- ~66 s de trabajo real
    GROUP BY Mes WHERE Mes >= 202607              1,3 s   <- 0,2 s de trabajo real

De ahí sale la cadencia, y no de una intuición: el censo COMPLETO cuesta ~66 s
sobre el ERP en vivo —aceptable una vez por semana, no cada noche—, mientras que
acotado por rango es prácticamente gratis porque `LineasVentas.Mes` está
indexado. Por eso el nocturno mira sólo los últimos meses y el semanal lo mira
todo.

Con la exclusión de material ya aplicada (ver `filtro_4d`) y acotado a 3 meses,
el censo cuesta **1,8 s**. Sigue siendo gratis al lado de las ~3 h del "full" que
sustituye.

Un detalle que NO es cosmético: el censo se pide con `GROUP BY`, así que 4D
devuelve ~150 filas en vez de 1,8 M. La lectura truncada —que es el fallo
dominante del ETL, y que el driver p4d convierte en un final de resultados
limpio e indistinguible— **no puede ocurrir en una respuesta de 150 filas**. La
comprobación es inmune al modo de fallo que precisamente busca detectar.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Callable

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ParticionSpec:
    """Cómo se trocea una tabla para reconciliarla.

    Attributes:
        nombre:          Nombre corto, el que va al log y a los watermarks.
        tabla_4d:        Tabla de origen.
        particion_4d:    Expresión que agrupa en 4D (columna o función).
        tabla_pg:        Tabla espejo.
        particion_pg:    Expresión equivalente en PostgreSQL.
        pk_pg:           Clave primaria en el espejo, para borrar las ausentes.
        pk_4d:           La misma clave en origen.
        trae_particion:  Devuelve las filas de UNA partición, ya mapeadas para
                         el upsert. Se le pasa (conn_4d, valor_de_particion).
        filtro_4d:       Predicado extra en el censo de origen, para que cuente
                         LO MISMO que el espejo.

                         Imprescindible en lineas_ventas: el ETL excluye el
                         material (MA), así que sin el filtro 4D declara ~215.000
                         filas de más y la reconciliación intentaría "arreglar"
                         cada noche algo que ya está bien — reinsertando material
                         y borrándolo después, justo la churn que queremos quitar.

                         Medido contra producción el 2026-09-02: el espejo tenía
                         1.608.011 filas contra 1.823.302 en 4D, y las 80
                         particiones que no cuadraban coincidían una a una con el
                         recuento de líneas MA (202607: −5.059 de diferencia,
                         5.059 líneas MA; 202606: −4.209 y 4.209). Con el filtro
                         puesto, los censos cuadran.
    """

    nombre: str
    tabla_4d: str
    particion_4d: str
    tabla_pg: str
    particion_pg: str
    pk_pg: str
    pk_4d: str
    trae_particion: Callable[[Any, Any], list[dict]]
    filtro_4d: str | None = None


def censo_4d(conn_4d: Any, spec: ParticionSpec, desde: int | None = None) -> dict:
    """Censo {partición: filas} desde 4D.

    `desde` acota el rango. Sin él se recorre la tabla entera, que son ~66 s
    sobre el ERP en vivo — reservado para la pasada semanal.
    """
    from etl.db.fourd import safe_fetch

    condiciones = []
    if desde is not None:
        condiciones.append(f"{spec.particion_4d} >= {int(desde)}")
    if spec.filtro_4d:
        condiciones.append(spec.filtro_4d)
    where = f" WHERE {' AND '.join(condiciones)}" if condiciones else ""
    sql = (
        f"SELECT {spec.particion_4d} AS parte, COUNT(*) AS n "
        f"FROM {spec.tabla_4d}{where} GROUP BY {spec.particion_4d}"
    )
    filas = safe_fetch(conn_4d, sql)
    return {r["parte"]: int(r["n"]) for r in filas if r.get("parte") is not None}


def censo_pg(conn_pg: Any, spec: ParticionSpec, desde: int | None = None) -> dict:
    """Censo {partición: filas} desde el espejo, con el mismo troceado."""
    where = f" WHERE {spec.particion_pg} >= %s" if desde is not None else ""
    sql = (
        f"SELECT {spec.particion_pg} AS parte, COUNT(*) AS n "  # noqa: S608
        f"FROM {spec.tabla_pg}{where} GROUP BY {spec.particion_pg}"
    )
    with conn_pg.cursor() as cur:
        cur.execute(sql, (desde,) if desde is not None else None)
        return {r[0]: int(r[1]) for r in cur.fetchall() if r[0] is not None}


def particiones_divergentes(
    origen: dict, espejo: dict, *, siempre: set | None = None
) -> list:
    """Particiones a revisar: las que no cuadran, más las que se fuerzan.

    `siempre` existe porque un censo que cuadra NO prueba que el contenido
    cuadre: una fila borrada y otra insertada en el mismo mes dan el mismo
    total. Para los meses recientes —donde se concentra casi todo el
    movimiento— se baja a mirar de todas formas.

    Las que sobran en el espejo y no existen en origen también entran: son
    justo las que acumulan borrados.
    """
    claves = set(origen) | set(espejo)
    fuera = set(siempre or ())
    return sorted(
        k for k in claves if origen.get(k, 0) != espejo.get(k, 0) or k in fuera
    )


def reconciliar_particion(
    conn_4d: Any, conn_pg: Any, spec: ParticionSpec, parte: Any
) -> tuple[int, int]:
    """Reconstruye UNA partición: upsert de lo que hay + borrado de lo que no.

    Devuelve (filas_traidas, filas_borradas).

    El borrado va acotado a la partición, así que un fallo al traerla no puede
    vaciar la tabla entera: como mucho deja ese mes sin tocar. Y si el fetch
    devuelve vacío no se borra nada — un mes que de verdad se quedó sin filas es
    indistinguible de un fetch que falló en silencio, y ante esa duda no se
    borra (mismo criterio que D-063).
    """
    from etl.db.postgres import upsert

    filas = spec.trae_particion(conn_4d, parte)
    if not filas:
        logger.warning(
            "reconcile[%s]: la particion %s vino vacia de 4D — no se borra nada",
            spec.nombre,
            parte,
        )
        return 0, 0

    traidas = upsert(conn_pg, spec.tabla_pg, filas, [spec.pk_pg])

    pks = [f[spec.pk_pg] for f in filas if f.get(spec.pk_pg) is not None]
    with conn_pg.cursor() as cur:
        cur.execute(
            f"DELETE FROM {spec.tabla_pg} "  # noqa: S608
            f"WHERE {spec.particion_pg} = %s AND {spec.pk_pg} <> ALL(%s)",
            (parte, pks),
        )
        borradas = cur.rowcount
    conn_pg.commit()

    if borradas:
        logger.info(
            "reconcile[%s]: particion %s — %d filas borradas que ya no estan en 4D",
            spec.nombre,
            parte,
            borradas,
        )
    return traidas, borradas


def reconciliar(
    conn_4d: Any,
    conn_pg: Any,
    spec: ParticionSpec,
    *,
    desde: int | None = None,
    siempre: set | None = None,
) -> dict:
    """Reconcilia una tabla y devuelve el resumen para `etl_reconcile_log`."""
    origen = censo_4d(conn_4d, spec, desde)
    espejo = censo_pg(conn_pg, spec, desde)
    pendientes = particiones_divergentes(origen, espejo, siempre=siempre)

    logger.info(
        "reconcile[%s]: %d particiones en origen, %d en espejo, %d a revisar",
        spec.nombre,
        len(origen),
        len(espejo),
        len(pendientes),
    )

    traidas = borradas = 0
    # De la más reciente a la más antigua: si el run muere a medias, lo que
    # queda hecho es lo que más se mira.
    for parte in sorted(pendientes, reverse=True):
        t, b = reconciliar_particion(conn_4d, conn_pg, spec, parte)
        traidas += t
        borradas += b

    return {
        "tabla": spec.nombre,
        "particiones_origen": len(origen),
        "particiones_revisadas": len(pendientes),
        "filas_traidas": traidas,
        "filas_borradas": borradas,
    }
