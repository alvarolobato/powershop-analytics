"""Tests de la reconciliación por particiones.

Lo que se está probando es la única pieza capaz de ver lo que el delta no puede:
borrados en 4D, filas con `FechaModifica` NULL y filas que descartó el prefiltro
de D-050. Los casos peligrosos no son los felices, sino los de borrado: una
condición mal puesta en el DELETE vacía un mes entero del espejo.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from etl.sync.reconcile import (
    ParticionSpec,
    particiones_divergentes,
    reconciliar,
    reconciliar_particion,
)


def _spec(filas_por_particion=None) -> ParticionSpec:
    datos = filas_por_particion or {}
    return ParticionSpec(
        nombre="lineas_ventas",
        tabla_4d="LineasVentas",
        particion_4d="Mes",
        tabla_pg="ps_lineas_ventas",
        particion_pg="mes",
        pk_pg="reg_lineas",
        pk_4d="RegLineas",
        trae_particion=lambda conn, parte: datos.get(parte, []),
    )


def _conn_pg(rowcount=0):
    cur = MagicMock()
    cur.rowcount = rowcount
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cur
    return conn, cur


class TestQueParticionesSeRevisan:
    def test_solo_las_que_no_cuadran(self):
        origen = {202607: 100, 202608: 200, 202609: 50}
        espejo = {202607: 100, 202608: 199, 202609: 50}
        assert particiones_divergentes(origen, espejo) == [202608]

    def test_una_particion_que_sobra_en_el_espejo_entra(self):
        """Justo el caso de los borrados: en el espejo y ya no en origen."""
        assert particiones_divergentes({202608: 5}, {202607: 3, 202608: 5}) == [202607]

    def test_los_meses_forzados_entran_aunque_cuadren(self):
        """Un censo que cuadra no prueba que el contenido cuadre.

        Una fila borrada y otra insertada en el mismo mes dan el mismo total.
        Por eso los meses recientes se miran igualmente.
        """
        origen = espejo = {202607: 10, 202608: 20}
        assert particiones_divergentes(origen, espejo) == []
        assert particiones_divergentes(origen, espejo, siempre={202608}) == [202608]


class TestReconciliarUnaParticion:
    def test_borra_solo_dentro_de_la_particion(self):
        """El DELETE va acotado: un fallo no puede vaciar la tabla entera."""
        spec = _spec({202608: [{"reg_lineas": 1}, {"reg_lineas": 2}]})
        conn_pg, cur = _conn_pg(rowcount=3)
        with patch("etl.db.postgres.upsert", return_value=2):
            traidas, borradas = reconciliar_particion(
                MagicMock(), conn_pg, spec, 202608
            )
        assert (traidas, borradas) == (2, 3)
        sql = " ".join(cur.execute.call_args[0][0].split())
        assert "DELETE FROM ps_lineas_ventas" in sql
        assert "mes = %s" in sql, f"el borrado debe ir acotado a la particion: {sql!r}"
        assert "<> ALL(%s)" in sql
        # Los parametros son (particion, pks_que_siguen_existiendo)
        assert cur.execute.call_args[0][1][0] == 202608
        assert sorted(cur.execute.call_args[0][1][1]) == [1, 2]

    def test_una_particion_vacia_no_borra_nada(self):
        """Un mes realmente vacío es indistinguible de un fetch que falló.

        Ante esa duda no se borra — mismo criterio que D-063. Sin esto, un
        fetch que devuelve vacío en silencio vaciaría ese mes del espejo.
        """
        spec = _spec({})  # 4D no devuelve nada para esa particion
        conn_pg, cur = _conn_pg(rowcount=999)
        with patch("etl.db.postgres.upsert", return_value=0) as mock_upsert:
            traidas, borradas = reconciliar_particion(
                MagicMock(), conn_pg, spec, 202608
            )
        assert (traidas, borradas) == (0, 0)
        mock_upsert.assert_not_called()
        cur.execute.assert_not_called()


class TestReconciliarEntero:
    def test_solo_baja_a_por_lo_que_no_cuadra(self):
        """El punto de todo esto: no traerse 1,8 M filas para comprobar."""
        spec = _spec({202608: [{"reg_lineas": 7}]})
        conn_pg, _ = _conn_pg()
        with (
            patch(
                "etl.sync.reconcile.censo_4d",
                return_value={202607: 10, 202608: 20, 202609: 5},
            ),
            patch(
                "etl.sync.reconcile.censo_pg",
                return_value={202607: 10, 202608: 19, 202609: 5},
            ),
            patch("etl.db.postgres.upsert", return_value=1),
        ):
            res = reconciliar(MagicMock(), conn_pg, spec)

        assert res["particiones_origen"] == 3
        assert res["particiones_revisadas"] == 1, (
            "sólo debe bajarse la partición que no cuadra"
        )
        assert res["filas_traidas"] == 1

    def test_de_la_mas_reciente_a_la_mas_antigua(self):
        """Si el run muere a medias, lo hecho debe ser lo que más se mira."""
        orden: list[int] = []
        spec = ParticionSpec(
            nombre="t",
            tabla_4d="T",
            particion_4d="Mes",
            tabla_pg="ps_t",
            particion_pg="mes",
            pk_pg="id",
            pk_4d="Id",
            trae_particion=lambda c, p: (orden.append(p), [{"id": p}])[1],
        )
        conn_pg, _ = _conn_pg()
        with (
            patch("etl.sync.reconcile.censo_4d", return_value={1: 1, 2: 1, 3: 1}),
            patch("etl.sync.reconcile.censo_pg", return_value={}),
            patch("etl.db.postgres.upsert", return_value=1),
        ):
            reconciliar(MagicMock(), conn_pg, spec)

        assert orden == [3, 2, 1], f"de más reciente a más antigua; fue {orden}"


class TestElCensoDeOrigenCuentaLoMismoQueElEspejo:
    """Sin el filtro de material, la reconciliación "arreglaría" 215.000 filas.

    El ETL excluye los artículos MA del espejo. Un censo de 4D sin ese mismo
    filtro declara ~215.000 líneas de más, así que las 80 particiones saldrían
    divergentes cada noche y la reconciliación reinsertaría material para
    borrarlo después — exactamente la churn que se quiere eliminar.

    Comprobado contra producción el 2026-09-02: espejo 1.608.011 filas contra
    1.823.302 en 4D, y la diferencia por partición coincidía una a una con el
    recuento de líneas MA de ese mes.
    """

    def test_el_filtro_va_en_el_censo_de_origen(self):
        from etl.sync.reconcile import censo_4d

        spec = ParticionSpec(
            nombre="lineas_ventas",
            tabla_4d="LineasVentas",
            particion_4d="Mes",
            tabla_pg="ps_lineas_ventas",
            particion_pg="mes",
            pk_pg="reg_lineas",
            pk_4d="RegLineas",
            trae_particion=lambda c, p: [],
            filtro_4d="Codigo NOT IN (SELECT Codigo FROM Articulos "
            "WHERE CCRefeJOFACM LIKE 'MA%')",
        )
        with patch("etl.db.fourd.safe_fetch", return_value=[]) as mock_fetch:
            censo_4d(MagicMock(), spec, desde=202607)
        sql = " ".join(mock_fetch.call_args[0][1].split())
        assert "Mes >= 202607" in sql, f"falta el acotado por rango: {sql!r}"
        assert "CCRefeJOFACM LIKE 'MA%'" in sql, (
            f"el censo de origen debe excluir el material: {sql!r}"
        )
        assert sql.count("WHERE") >= 1 and "AND" in sql, (
            f"las dos condiciones deben combinarse: {sql!r}"
        )

    def test_sin_filtro_no_se_cuela_un_AND_suelto(self):
        from etl.sync.reconcile import censo_4d

        with patch("etl.db.fourd.safe_fetch", return_value=[]) as mock_fetch:
            censo_4d(MagicMock(), _spec(), desde=202607)
        sql = " ".join(mock_fetch.call_args[0][1].split())
        assert "WHERE Mes >= 202607 GROUP BY" in sql, f"SQL mal formado: {sql!r}"

    def test_sin_acotar_ni_filtro_no_hay_WHERE(self):
        from etl.sync.reconcile import censo_4d

        with patch("etl.db.fourd.safe_fetch", return_value=[]) as mock_fetch:
            censo_4d(MagicMock(), _spec())
        sql = " ".join(mock_fetch.call_args[0][1].split())
        assert "WHERE" not in sql, f"no debe haber WHERE vacio: {sql!r}"
