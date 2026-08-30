// GENERADO por dashboard/scripts/build-knowledge-index.mjs — NO editar a mano.
// Regenerar con `npm run build:knowledge` (lo ejecuta también el prebuild).
// Fuente: 16 ficheros. 250 secciones (167 con SQL,
// 11 en dialecto 4D del ERP origen, no ejecutables contra el espejo PostgreSQL).
// Se consulta con la tool `search_knowledge`; no va en el prompt del sistema.

export interface KnowledgeChunk {
  source: string;
  heading: string;
  body: string;
  hasSql: boolean;
  /**
   * "4d"       — SQL contra el ERP origen (tablas sin prefijo: Ventas, CCStock).
   *              NO ejecutable contra el espejo; sirve como semantica de negocio.
   * "postgres" — SQL contra el espejo (tablas ps_*). Ejecutable tal cual.
   * "n/a"      — prosa, glosario o decisiones sin SQL de ninguno de los dos.
   */
  dialect: "4d" | "postgres" | "n/a";
}

export const KNOWLEDGE_INDEX: KnowledgeChunk[] = [
  {
    "source": "docs/sample-queries.md",
    "heading": "Recetario SQL del espejo PostgreSQL",
    "body": "> Consultas listas para usar contra el **espejo PostgreSQL** (`ps_*`) que alimenta\n> el dashboard y WrenAI. Todas usan **valores de ejemplo** — sustituye códigos y\n> fechas según necesites.\n\n> **Un solo dialecto.** Este fichero es PostgreSQL de principio a fin. Las tablas\n> son las del espejo (`ps_ventas`, `ps_lineas_ventas`, `ps_articulos`…), nunca las\n> del ERP 4D de origen (`Ventas`, `LineasVentas`, `Articulos`…), que no existen\n> aquí y no se pueden consultar desde el dashboard. Si necesitas explorar el ERP\n> origen —tablas de sistema `_USER_*`, dialecto 4D, catálogo de vistas `*_SQL`—\n> eso es herramienta del ETL y vive en [docs/skills/4d-sql-dialect.md](skills/4d-sql-dialect.md)\n> y [docs/skills/data-access.md](skills/data-access.md), fuera del alcance del modelo.\n>\n> Lo que el espejo **no** replica está listado en\n> [§11 Datos que no están en el espejo](#11-datos-que-no-están-en-el-espejo).\n> Si te piden algo de esa lista, dilo — no inventes una tabla.",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Índice",
    "body": "1. [Ventas retail](#1-ventas-retail)\n2. [Mayorista](#2-mayorista)\n3. [Stock](#3-stock)\n4. [Clientes](#4-clientes)\n5. [Cobros y formas de pago](#5-cobros-y-formas-de-pago)\n6. [Márgenes](#6-márgenes)\n7. [Traspasos entre tiendas](#7-traspasos-entre-tiendas)\n8. [Filtro de prefijo M (mayorista vs retail)](#8-filtro-de-prefijo-m)\n9. [Movimiento de stock de una tienda](#9-movimiento-de-stock-de-una-tienda)\n10. [Avisos de calidad de dato](#10-avisos-de-calidad-de-dato)\n11. [Datos que no están en el espejo](#11-datos-que-no-están-en-el-espejo)\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Venta neta diaria de una tienda",
    "body": "```sql\nSELECT v.fecha_creacion AS \"Fecha\",\n       COUNT(*) FILTER (WHERE v.entrada) AS \"Tickets\",\n       COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0) AS \"Venta Neta\"\nFROM ps_ventas v\nWHERE v.tienda = '154'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY v.fecha_creacion\nORDER BY v.fecha_creacion\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Venta neta mensual por tienda",
    "body": "```sql\nSELECT t.identificador AS \"Tienda\",\n       DATE_TRUNC('month', v.fecha_creacion)::date AS \"Mes\",\n       COUNT(*) FILTER (WHERE v.entrada) AS \"Tickets\",\n       COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0) AS \"Venta Neta\"\nFROM ps_ventas v\nJOIN ps_tiendas t ON t.codigo = v.tienda\nWHERE v.tienda <> '99'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY t.identificador, DATE_TRUNC('month', v.fecha_creacion)\nORDER BY \"Mes\", \"Venta Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Top 20 artículos (modelo + color) por venta neta",
    "body": "```sql\nSELECT LEFT(a.ccrefejofacm, LENGTH(a.ccrefejofacm) - 2) AS \"Artículo\",\n       MIN(a.descripcion) AS \"Descripción\",\n       COALESCE(SUM(lv.unidades) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(lv.unidades) FILTER (WHERE NOT v.entrada), 0) AS \"Unidades\",\n       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS \"Venta Neta\"\nFROM ps_lineas_ventas lv\nJOIN ps_ventas v ON v.reg_ventas = lv.num_ventas\nJOIN ps_articulos a ON a.codigo = lv.codigo\nWHERE v.tienda <> '99'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\n  AND LENGTH(COALESCE(a.ccrefejofacm, '')) > 2\nGROUP BY 1\nORDER BY \"Venta Neta\" DESC\nLIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Venta neta por familia",
    "body": "```sql\nSELECT f.fami_grup_marc AS \"Familia\",\n       COALESCE(SUM(lv.unidades) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(lv.unidades) FILTER (WHERE NOT v.entrada), 0) AS \"Unidades\",\n       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS \"Venta Neta\"\nFROM ps_lineas_ventas lv\nJOIN ps_ventas v ON v.reg_ventas = lv.num_ventas\nJOIN ps_articulos a ON a.codigo = lv.codigo\nJOIN ps_familias f ON f.reg_familia = a.num_familia\nWHERE v.tienda <> '99'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY f.fami_grup_marc\nORDER BY \"Venta Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Venta neta por departamento",
    "body": "```sql\nSELECT d.depa_secc_fabr AS \"Departamento\",\n       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS \"Venta Neta\"\nFROM ps_lineas_ventas lv\nJOIN ps_ventas v ON v.reg_ventas = lv.num_ventas\nJOIN ps_articulos a ON a.codigo = lv.codigo\nJOIN ps_departamentos d ON d.reg_departament = a.num_departament\nWHERE v.tienda <> '99'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY d.depa_secc_fabr\nORDER BY \"Venta Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Venta neta por marca",
    "body": "```sql\nSELECT m.marca_tratamien AS \"Marca\",\n       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS \"Venta Neta\"\nFROM ps_lineas_ventas lv\nJOIN ps_ventas v ON v.reg_ventas = lv.num_ventas\nJOIN ps_articulos a ON a.codigo = lv.codigo\nJOIN ps_marcas m ON m.reg_marca = a.num_marca\nWHERE v.tienda <> '99'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY m.marca_tratamien\nORDER BY \"Venta Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Venta neta por temporada",
    "body": "```sql\nSELECT te.temporada_tipo AS \"Temporada\",\n       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS \"Venta Neta\"\nFROM ps_lineas_ventas lv\nJOIN ps_ventas v ON v.reg_ventas = lv.num_ventas\nJOIN ps_articulos a ON a.codigo = lv.codigo\nJOIN ps_temporadas te ON te.reg_temporada = a.num_temporada\nWHERE v.tienda <> '99'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY te.temporada_tipo\nORDER BY \"Venta Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Devoluciones por tienda y mes",
    "body": "```sql\nSELECT t.identificador AS \"Tienda\",\n       DATE_TRUNC('month', v.fecha_creacion)::date AS \"Mes\",\n       COUNT(*) FILTER (WHERE NOT v.entrada) AS \"Tickets Devolución\",\n       COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0) AS \"Importe Devuelto\",\n       ROUND(100.0 * COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0)\n             / NULLIF(COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0), 0), 2) AS \"% sobre Bruto\"\nFROM ps_ventas v\nJOIN ps_tiendas t ON t.codigo = v.tienda\nWHERE v.tienda <> '99'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY t.identificador, DATE_TRUNC('month', v.fecha_creacion)\nORDER BY \"Mes\", \"Importe Devuelto\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Patrón por día de la semana",
    "body": "```sql\nSELECT TO_CHAR(v.fecha_creacion, 'ID') AS \"Día ISO\",\n       TRIM(TO_CHAR(v.fecha_creacion, 'Day')) AS \"Día\",\n       COUNT(*) FILTER (WHERE v.entrada) AS \"Tickets\",\n       COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0) AS \"Venta Neta\"\nFROM ps_ventas v\nWHERE v.tienda <> '99'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY 1, 2\nORDER BY 1\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Distribución horaria",
    "body": "```sql\nSELECT EXTRACT(HOUR FROM v.hora_creacion)::int AS \"Hora\",\n       COUNT(*) FILTER (WHERE v.entrada) AS \"Tickets\",\n       COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0) AS \"Venta Neta\"\nFROM ps_ventas v\nWHERE v.hora_creacion IS NOT NULL\n  AND v.tienda <> '99'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY 1\nORDER BY 1\n```\n\n`hora_creacion` es NULL en las filas sincronizadas antes de que existiera la\ncolumna; se rellena en el siguiente upsert de esa fila.",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Ticket medio por tienda",
    "body": "```sql\nSELECT t.identificador AS \"Tienda\",\n       COUNT(*) FILTER (WHERE v.entrada) AS \"Tickets\",\n       COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0) AS \"Venta Neta\",\n       ROUND((COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0)\n            - COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0))\n             / NULLIF(COUNT(*) FILTER (WHERE v.entrada), 0), 2) AS \"Ticket Medio\"\nFROM ps_ventas v\nJOIN ps_tiendas t ON t.codigo = v.tienda\nWHERE v.tienda <> '99'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY t.identificador\nORDER BY \"Ticket Medio\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Venta neta por talla",
    "body": "```sql\nSELECT lv.talla AS \"Talla\",\n       COALESCE(SUM(lv.unidades) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(lv.unidades) FILTER (WHERE NOT v.entrada), 0) AS \"Unidades\",\n       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS \"Venta Neta\"\nFROM ps_lineas_ventas lv\nJOIN ps_ventas v ON v.reg_ventas = lv.num_ventas\nWHERE lv.talla IS NOT NULL AND lv.talla <> ''\n  AND v.tienda <> '99'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY lv.talla\nORDER BY \"Unidades\" DESC\n```\n\nLa talla de una venta está en `ps_lineas_ventas.talla` (normalizada a MAYÚSCULAS\npor el ETL). Nunca se deduce del código de barras ([D-048](decisions/D-048-sales-by-size.md)).\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Albaranes por cliente (neto de abonos)",
    "body": "```sql\nSELECT c.nombre AS \"Cliente\",\n       COUNT(DISTINCT ga.reg_albaran) AS \"Albaranes\",\n       COALESCE(SUM(gl.unidades) FILTER (WHERE ga.abono IS NOT TRUE), 0)\n     - COALESCE(SUM(gl.unidades) FILTER (WHERE ga.abono IS TRUE), 0) AS \"Unidades Netas\",\n       COALESCE(SUM(gl.total) FILTER (WHERE ga.abono IS NOT TRUE), 0)\n     - COALESCE(SUM(gl.total) FILTER (WHERE ga.abono IS TRUE), 0) AS \"Importe Neto\"\nFROM ps_gc_lin_albarane gl\nJOIN ps_gc_albaranes ga ON ga.reg_albaran = gl.num_albaran\nJOIN ps_clientes c ON c.reg_cliente = ga.num_cliente\nWHERE (CASE WHEN ga.fecha_envio >= DATE '2000-01-01' THEN ga.fecha_envio ELSE ga.fecha_valor END)\n      BETWEEN :curr_from AND :curr_to\nGROUP BY c.nombre\nORDER BY \"Importe Neto\" DESC\nLIMIT 20\n```\n\nDos trampas de esta tabla:\n\n- La FK línea → cabecera es `num_albaran` → `reg_albaran`. `n_albaran` es el\n  número visible del albarán y **no** es único: no lo uses para unir.\n- **La fecha efectiva no es `fecha_envio` a secas.** Un albarán aún sin enviar\n  lleva `NULL` o un centinela anterior al año 2000, y como `NULL >= fecha` es\n  `NULL`, acotar por `fecha_envio` los descarta en silencio. Usa siempre\n  `CASE WHEN fecha_envio >= DATE '2000-01-01' THEN fecha_envio ELSE fecha_valor END`.",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Facturación mensual (neta de abonos)",
    "body": "```sql\nSELECT DATE_TRUNC('month', gf.fecha_factura)::date AS \"Mes\",\n       COUNT(*) FILTER (WHERE gf.abono IS NOT TRUE) AS \"Facturas\",\n       COALESCE(SUM(gf.total_factura) FILTER (WHERE gf.abono IS NOT TRUE), 0)\n     - COALESCE(SUM(gf.total_factura) FILTER (WHERE gf.abono IS TRUE), 0) AS \"Facturación Neta\"\nFROM ps_gc_facturas gf\nWHERE gf.fecha_factura BETWEEN :curr_from AND :curr_to\nGROUP BY 1\nORDER BY 1\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Top productos del canal mayorista",
    "body": "```sql\nSELECT gl.codigo AS \"Código\",\n       MIN(gl.descripcion) AS \"Descripción\",\n       COALESCE(SUM(gl.unidades) FILTER (WHERE gf.abono IS NOT TRUE), 0)\n     - COALESCE(SUM(gl.unidades) FILTER (WHERE gf.abono IS TRUE), 0) AS \"Unidades\",\n       COALESCE(SUM(gl.total) FILTER (WHERE gf.abono IS NOT TRUE), 0)\n     - COALESCE(SUM(gl.total) FILTER (WHERE gf.abono IS TRUE), 0) AS \"Importe Neto\"\nFROM ps_gc_lin_facturas gl\nJOIN ps_gc_facturas gf ON gf.reg_factura = gl.num_factura\nWHERE gl.fecha_factura BETWEEN :curr_from AND :curr_to\nGROUP BY gl.codigo\nORDER BY \"Importe Neto\" DESC\nLIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Facturación por comercial",
    "body": "```sql\nSELECT co.comercial AS \"Comercial\",\n       co.zona_comercial AS \"Zona\",\n       COALESCE(SUM(gf.total_factura) FILTER (WHERE gf.abono IS NOT TRUE), 0)\n     - COALESCE(SUM(gf.total_factura) FILTER (WHERE gf.abono IS TRUE), 0) AS \"Facturación Neta\"\nFROM ps_gc_facturas gf\nJOIN ps_gc_comerciales co ON co.reg_comercial = gf.num_comercial\nWHERE gf.fecha_factura BETWEEN :curr_from AND :curr_to\nGROUP BY co.comercial, co.zona_comercial\nORDER BY \"Facturación Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Abonos (devoluciones) por cliente",
    "body": "```sql\nSELECT c.nombre AS \"Cliente\",\n       COUNT(*) AS \"Abonos\",\n       SUM(gf.total_factura) AS \"Importe Abonado\"\nFROM ps_gc_facturas gf\nJOIN ps_clientes c ON c.reg_cliente = gf.num_cliente\nWHERE gf.abono IS TRUE\n  AND gf.fecha_factura BETWEEN :curr_from AND :curr_to\nGROUP BY c.nombre\nORDER BY \"Importe Abonado\" DESC\nLIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Facturación mayorista por familia",
    "body": "La línea de factura mayorista lleva sus propias FK de dimensión, así que no hace\nfalta pasar por `ps_articulos`.\n\n```sql\nSELECT f.fami_grup_marc AS \"Familia\",\n       COALESCE(SUM(gl.total) FILTER (WHERE gf.abono IS NOT TRUE), 0)\n     - COALESCE(SUM(gl.total) FILTER (WHERE gf.abono IS TRUE), 0) AS \"Importe Neto\"\nFROM ps_gc_lin_facturas gl\nJOIN ps_gc_facturas gf ON gf.reg_factura = gl.num_factura\nJOIN ps_familias f ON f.reg_familia = gl.num_familia\nWHERE gl.fecha_factura BETWEEN :curr_from AND :curr_to\nGROUP BY f.fami_grup_marc\nORDER BY \"Importe Neto\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Pedidos mayoristas pendientes de servir",
    "body": "```sql\nSELECT c.nombre AS \"Cliente\",\n       COUNT(*) AS \"Pedidos Abiertos\",\n       SUM(gp.unidades) AS \"Unidades Pedidas\",\n       SUM(gp.entregadas) AS \"Unidades Entregadas\",\n       SUM(gp.pendientes) AS \"Unidades Pendientes\"\nFROM ps_gc_pedidos gp\nJOIN ps_clientes c ON c.reg_cliente = gp.num_cliente\nWHERE gp.pedido_cerrado IS NOT TRUE\n  AND gp.abono IS NOT TRUE\n  AND gp.fecha_pedido BETWEEN :curr_from AND :curr_to\nGROUP BY c.nombre\nORDER BY \"Unidades Pendientes\" DESC\nLIMIT 20\n```\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "3. Stock",
    "body": "El stock vive en **dos** tablas con claves distintas:\n\n| Tabla | Grano | Une con |\n|---|---|---|\n| `ps_stock_central` | artículo (almacén central) | `num_articulo` → `ps_articulos.reg_articulo` |\n| `ps_stock_tienda` | artículo + tienda + talla | `codigo` → `ps_articulos.codigo` |",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Stock del almacén central por artículo",
    "body": "```sql\nSELECT a.ccrefejofacm AS \"Referencia\",\n       a.descripcion AS \"Descripción\",\n       sc.stock AS \"Stock Central\"\nFROM ps_stock_central sc\nJOIN ps_articulos a ON a.reg_articulo = sc.num_articulo\nWHERE sc.stock > 0\nORDER BY sc.stock DESC\nLIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Stock de una tienda por talla",
    "body": "```sql\nSELECT a.ccrefejofacm AS \"Referencia\",\n       a.descripcion AS \"Descripción\",\n       st.talla AS \"Talla\",\n       st.stock AS \"Stock\"\nFROM ps_stock_tienda st\nJOIN ps_articulos a ON a.codigo = st.codigo\nWHERE st.tienda = '154'\n  AND st.stock > 0\nORDER BY st.stock DESC\nLIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Stock total de una referencia (central + tiendas)",
    "body": "```sql\nSELECT 'Central' AS \"Ubicación\", COALESCE(SUM(sc.stock), 0) AS \"Unidades\"\nFROM ps_stock_central sc\nJOIN ps_articulos a ON a.reg_articulo = sc.num_articulo\nWHERE a.ccrefejofacm = 'V26212484'\nUNION ALL\nSELECT st.tienda, SUM(st.stock)\nFROM ps_stock_tienda st\nJOIN ps_articulos a ON a.codigo = st.codigo\nWHERE a.ccrefejofacm = 'V26212484'\nGROUP BY st.tienda\nORDER BY 2 DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Artículos sin stock en ningún sitio",
    "body": "```sql\nSELECT a.ccrefejofacm AS \"Referencia\",\n       a.descripcion AS \"Descripción\",\n       a.precio1 AS \"PVP\"\nFROM ps_articulos a\nLEFT JOIN ps_stock_central sc ON sc.num_articulo = a.reg_articulo\nWHERE a.anulado IS NOT TRUE\n  AND a.precio1 > 0\n  AND COALESCE(sc.stock, 0) = 0\n  AND NOT EXISTS (\n        SELECT 1 FROM ps_stock_tienda st\n        WHERE st.codigo = a.codigo AND st.stock > 0)\nORDER BY a.ccrefejofacm\nLIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Stock negativo (error de inventario)",
    "body": "```sql\nSELECT a.ccrefejofacm AS \"Referencia\",\n       a.descripcion AS \"Descripción\",\n       st.tienda AS \"Tienda\",\n       st.talla AS \"Talla\",\n       st.stock AS \"Stock\"\nFROM ps_stock_tienda st\nJOIN ps_articulos a ON a.codigo = st.codigo\nWHERE st.stock < 0\nORDER BY st.stock ASC\nLIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Resumen de stock por tienda",
    "body": "```sql\nSELECT t.identificador AS \"Tienda\",\n       COUNT(DISTINCT st.codigo) AS \"Referencias\",\n       SUM(st.stock) AS \"Unidades\"\nFROM ps_stock_tienda st\nJOIN ps_tiendas t ON t.codigo = st.tienda\nWHERE st.stock > 0\nGROUP BY t.identificador\nORDER BY \"Unidades\" DESC\n```\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Mejores clientes de retail por gasto neto",
    "body": "```sql\nSELECT c.nombre AS \"Cliente\",\n       COUNT(*) FILTER (WHERE v.entrada) AS \"Compras\",\n       COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0) AS \"Gasto Neto\",\n       MAX(v.fecha_creacion) AS \"Última Compra\"\nFROM ps_ventas v\nJOIN ps_clientes c ON c.reg_cliente = v.num_cliente\nWHERE v.tienda <> '99'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY c.nombre\nORDER BY \"Gasto Neto\" DESC\nLIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Frecuencia de compra",
    "body": "```sql\nSELECT c.nombre AS \"Cliente\",\n       COUNT(*) FILTER (WHERE v.entrada) AS \"Visitas\",\n       MIN(v.fecha_creacion) AS \"Primera Compra\",\n       MAX(v.fecha_creacion) AS \"Última Compra\",\n       COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0) AS \"Gasto Neto\"\nFROM ps_ventas v\nJOIN ps_clientes c ON c.reg_cliente = v.num_cliente\nWHERE v.tienda <> '99'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY c.nombre\nHAVING COUNT(*) FILTER (WHERE v.entrada) > 1\nORDER BY \"Visitas\" DESC\nLIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Clientes dados de alta en un periodo",
    "body": "```sql\nSELECT c.nombre AS \"Cliente\",\n       c.poblacion AS \"Población\",\n       c.pais AS \"País\",\n       c.fecha_creacion AS \"Alta\"\nFROM ps_clientes c\nWHERE c.fecha_creacion BETWEEN :curr_from AND :curr_to\nORDER BY c.fecha_creacion DESC\nLIMIT 100\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Clientes únicos por tienda",
    "body": "```sql\nSELECT t.identificador AS \"Tienda\",\n       COUNT(DISTINCT v.num_cliente) AS \"Clientes Únicos\"\nFROM ps_ventas v\nJOIN ps_tiendas t ON t.codigo = v.tienda\nWHERE v.num_cliente IS NOT NULL\n  AND v.tienda <> '99'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY t.identificador\nORDER BY \"Clientes Únicos\" DESC\n```\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Cobros por forma de pago",
    "body": "```sql\nSELECT pv.forma AS \"Forma de Pago\",\n       COUNT(*) FILTER (WHERE pv.entrada) AS \"Cobros\",\n       COALESCE(SUM(pv.importe_cob) FILTER (WHERE pv.entrada), 0)\n     - COALESCE(SUM(pv.importe_cob) FILTER (WHERE NOT pv.entrada), 0) AS \"Importe Neto\"\nFROM ps_pagos_ventas pv\nWHERE pv.tienda <> '99'\n  AND pv.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY pv.forma\nORDER BY \"Importe Neto\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Mix de formas de pago por tienda",
    "body": "```sql\nSELECT t.identificador AS \"Tienda\",\n       pv.forma AS \"Forma de Pago\",\n       COALESCE(SUM(pv.importe_cob) FILTER (WHERE pv.entrada), 0)\n     - COALESCE(SUM(pv.importe_cob) FILTER (WHERE NOT pv.entrada), 0) AS \"Importe Neto\"\nFROM ps_pagos_ventas pv\nJOIN ps_tiendas t ON t.codigo = pv.tienda\nWHERE pv.tienda <> '99'\n  AND pv.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY t.identificador, pv.forma\nORDER BY t.identificador, \"Importe Neto\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Efectivo frente al resto, día a día",
    "body": "```sql\nSELECT pv.fecha_creacion AS \"Fecha\",\n       COALESCE(SUM(pv.importe_cob) FILTER (WHERE pv.entrada AND pv.codigo_forma = '01'), 0)\n     - COALESCE(SUM(pv.importe_cob) FILTER (WHERE NOT pv.entrada AND pv.codigo_forma = '01'), 0) AS \"Efectivo\",\n       COALESCE(SUM(pv.importe_cob) FILTER (WHERE pv.entrada AND pv.codigo_forma <> '01'), 0)\n     - COALESCE(SUM(pv.importe_cob) FILTER (WHERE NOT pv.entrada AND pv.codigo_forma <> '01'), 0) AS \"Otras Formas\",\n       COALESCE(SUM(pv.importe_cob) FILTER (WHERE pv.entrada), 0)\n     - COALESCE(SUM(pv.importe_cob) FILTER (WHERE NOT pv.entrada), 0) AS \"Total\"\nFROM ps_pagos_ventas pv\nWHERE pv.tienda <> '99'\n  AND pv.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY pv.fecha_creacion\nORDER BY pv.fecha_creacion\n```\n\n`codigo_forma = '01'` suele ser metálico; confírmalo con los valores de\n`pv.forma` antes de presentarlo como «efectivo».\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Margen por artículo (retail)",
    "body": "```sql\nSELECT LEFT(a.ccrefejofacm, LENGTH(a.ccrefejofacm) - 2) AS \"Artículo\",\n       MIN(a.descripcion) AS \"Descripción\",\n       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS \"Venta Neta\",\n       COALESCE(SUM(lv.total_coste_si) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(lv.total_coste_si) FILTER (WHERE NOT v.entrada), 0) AS \"Coste\",\n       (COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)\n      - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0))\n     - (COALESCE(SUM(lv.total_coste_si) FILTER (WHERE v.entrada), 0)\n      - COALESCE(SUM(lv.total_coste_si) FILTER (WHERE NOT v.entrada), 0)) AS \"Margen\"\nFROM ps_lineas_ventas lv\nJOIN ps_ventas v ON v.reg_ventas = lv.num_ventas\nJOIN ps_articulos a ON a.codigo = lv.codigo\nWHERE v.tienda <> '99'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\n  AND LENGTH(COALESCE(a.ccrefejofacm, '')) > 2\nGROUP BY 1\nORDER BY \"Margen\" DESC\nLIMIT 20\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Porcentaje de margen por familia",
    "body": "```sql\nSELECT f.fami_grup_marc AS \"Familia\",\n       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS \"Venta Neta\",\n       ROUND(100.0 * ((COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)\n                     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0))\n                    - (COALESCE(SUM(lv.total_coste_si) FILTER (WHERE v.entrada), 0)\n                     - COALESCE(SUM(lv.total_coste_si) FILTER (WHERE NOT v.entrada), 0)))\n             / NULLIF(COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)\n                    - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0), 0), 1) AS \"Margen %\"\nFROM ps_lineas_ventas lv\nJOIN ps_ventas v ON v.reg_ventas = lv.num_ventas\nJOIN ps_articulos a ON a.codigo = lv.codigo\nJOIN ps_familias f ON f.reg_familia = a.num_familia\nWHERE v.tienda <> '99'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY f.fami_grup_marc\nORDER BY \"Margen %\" DESC\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Margen por tienda",
    "body": "```sql\nSELECT t.identificador AS \"Tienda\",\n       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS \"Venta Neta\",\n       ROUND(100.0 * ((COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)\n                     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0))\n                    - (COALESCE(SUM(lv.total_coste_si) FILTER (WHERE v.entrada), 0)\n                     - COALESCE(SUM(lv.total_coste_si) FILTER (WHERE NOT v.entrada), 0)))\n             / NULLIF(COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)\n                    - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0), 0), 1) AS \"Margen %\"\nFROM ps_lineas_ventas lv\nJOIN ps_ventas v ON v.reg_ventas = lv.num_ventas\nJOIN ps_tiendas t ON t.codigo = v.tienda\nWHERE v.tienda <> '99'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY t.identificador\nORDER BY \"Margen %\" DESC\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Artículos con margen teórico bajo (< 30 %)",
    "body": "Margen de tarifa, no de venta real: compara PVP contra coste en la ficha del\nartículo.\n\n```sql\nSELECT a.ccrefejofacm AS \"Referencia\",\n       a.descripcion AS \"Descripción\",\n       a.precio1 AS \"PVP\",\n       a.precio_coste AS \"Coste\",\n       ROUND(100.0 * (a.precio1 - a.precio_coste) / NULLIF(a.precio1, 0), 1) AS \"Margen %\"\nFROM ps_articulos a\nWHERE a.anulado IS NOT TRUE\n  AND a.precio1 > 0\n  AND a.precio_coste > 0\n  AND (a.precio1 - a.precio_coste) / a.precio1 < 0.3\nORDER BY \"Margen %\" ASC\nLIMIT 50\n```\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Volumen por ruta",
    "body": "```sql\nSELECT tr.tienda_salida AS \"Origen\",\n       tr.tienda_entrada AS \"Destino\",\n       COUNT(*) AS \"Movimientos\",\n       SUM(tr.unidades_s) AS \"Unidades Enviadas\"\nFROM ps_traspasos tr\nWHERE NOT tr.entrada\n  AND tr.\"tipo\" = 'Autoreposicion'\n  AND tr.fecha_s BETWEEN :curr_from AND :curr_to\nGROUP BY tr.tienda_salida, tr.tienda_entrada\nORDER BY \"Unidades Enviadas\" DESC\nLIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Volumen por tipo de traspaso",
    "body": "```sql\nSELECT tr.tipo AS \"Tipo\",\n       tr.concepto AS \"Concepto\",\n       COUNT(*) AS \"Movimientos\",\n       SUM(tr.unidades_e) AS \"Unidades Recibidas\"\nFROM ps_traspasos tr\nWHERE tr.entrada\n  AND tr.\"tipo\" = 'Autoreposicion'\n  AND tr.fecha_e BETWEEN :curr_from AND :curr_to\nGROUP BY tr.tipo, tr.concepto\nORDER BY \"Movimientos\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Actividad diaria de traspasos",
    "body": "```sql\nSELECT tr.fecha_s AS \"Fecha\",\n       COUNT(*) AS \"Movimientos\",\n       SUM(tr.unidades_s) AS \"Unidades Enviadas\"\nFROM ps_traspasos tr\nWHERE NOT tr.entrada\n  AND tr.\"tipo\" = 'Autoreposicion'\n  AND tr.fecha_s BETWEEN :curr_from AND :curr_to\nGROUP BY tr.fecha_s\nORDER BY tr.fecha_s\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Traspasos de una referencia concreta",
    "body": "```sql\nSELECT tr.fecha_s AS \"Fecha\",\n       tr.tienda_salida AS \"Origen\",\n       tr.tienda_entrada AS \"Destino\",\n       tr.talla AS \"Talla\",\n       tr.unidades_s AS \"Unidades\",\n       tr.tipo AS \"Tipo\",\n       tr.concepto AS \"Concepto\"\nFROM ps_traspasos tr\nJOIN ps_articulos a ON a.codigo = tr.codigo\nWHERE a.ccrefejofacm = 'V26212484'\n  AND NOT tr.entrada\n  AND tr.\"tipo\" = 'Autoreposicion'\n  AND tr.fecha_s BETWEEN :curr_from AND :curr_to\nORDER BY tr.fecha_s DESC\n```\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Artículos de retail con stock",
    "body": "```sql\nSELECT a.ccrefejofacm AS \"Referencia\",\n       a.descripcion AS \"Descripción\",\n       a.precio1 AS \"PVP\",\n       SUM(st.stock) AS \"Unidades en Tienda\"\nFROM ps_articulos a\nJOIN ps_stock_tienda st ON st.codigo = a.codigo\nWHERE a.codigo NOT LIKE 'M%'\n  AND a.anulado IS NOT TRUE\n  AND st.stock > 0\nGROUP BY a.ccrefejofacm, a.descripcion, a.precio1\nORDER BY \"Unidades en Tienda\" DESC\nLIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Artículos exclusivos de mayorista",
    "body": "```sql\nSELECT a.codigo AS \"Código\",\n       a.ccrefejofacm AS \"Referencia\",\n       a.descripcion AS \"Descripción\",\n       a.precio1 AS \"PVP\"\nFROM ps_articulos a\nWHERE a.codigo LIKE 'M%'\n  AND a.anulado IS NOT TRUE\nORDER BY a.codigo\nLIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Venta retail excluyendo artículos de mayorista",
    "body": "```sql\nSELECT DATE_TRUNC('month', v.fecha_creacion)::date AS \"Mes\",\n       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)\n     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS \"Venta Neta Retail\"\nFROM ps_lineas_ventas lv\nJOIN ps_ventas v ON v.reg_ventas = lv.num_ventas\nWHERE lv.codigo NOT LIKE 'M%'\n  AND v.tienda <> '99'\n  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to\nGROUP BY 1\nORDER BY 1\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Líneas de albarán mayorista con artículos M",
    "body": "```sql\nSELECT gl.n_albaran AS \"Nº Albarán\",\n       gl.fecha_albaran AS \"Fecha\",\n       gl.codigo AS \"Código\",\n       gl.descripcion AS \"Descripción\",\n       gl.unidades AS \"Unidades\",\n       gl.total AS \"Importe\"\nFROM ps_gc_lin_albarane gl\nWHERE gl.codigo LIKE 'M%'\n  AND gl.fecha_albaran BETWEEN :curr_from AND :curr_to\nORDER BY gl.fecha_albaran DESC\nLIMIT 50\n```\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "9. Movimiento de stock de una tienda",
    "body": "Con lo que hay en el espejo se cubren los dos movimientos que explican la mayor\nparte de la variación de stock de una tienda: traspasos y ventas.\n\n```\nEntradas ≈ traspasos recibidos + devoluciones de clientes\nSalidas  ≈ ventas + traspasos enviados\nNeto     = Entradas − Salidas\n```\n\nLas **entradas de albarán de compra** (mercancía del proveedor) **no** están en\nel espejo: `ps_albaranes` guarda sólo cabeceras, sin líneas ni unidades. Ver\n[§11](#11-datos-que-no-están-en-el-espejo). El neto de abajo es, por tanto,\nmovimiento de tienda, no la ecuación completa de inventario.\n\n```sql\nSELECT\n  (SELECT COALESCE(SUM(tr.unidades_e), 0)\n     FROM ps_traspasos tr\n    WHERE tr.tienda_entrada = '154' AND tr.entrada\n      AND tr.\"tipo\" = 'Autoreposicion'\n      AND tr.fecha_e BETWEEN :curr_from AND :curr_to) AS \"Traspasos Recibidos\",\n  (SELECT COALESCE(SUM(tr.unidades_s), 0)\n     FROM ps_traspasos tr\n    WHERE tr.tienda_salida = '154' AND NOT tr.entrada\n      AND tr.\"tipo\" = 'Autoreposicion'\n      AND tr.fecha_s BETWEEN :curr_from AND :curr_to) AS \"Traspasos Enviados\",\n  (SELECT COALESCE(SUM(lv.unidades) FILTER (WHERE v.entrada), 0)\n     FROM ps_lineas_ventas lv\n     JOIN ps_ventas v ON v.reg_ventas = lv.num_ventas\n    WHERE v.tienda = '154'\n      AND v.fecha_creacion BETWEEN :curr_from AND :curr_to) AS \"Unidades Vendidas\",\n  (SELECT COALESCE(SUM(lv.unidades) FILTER (WHERE NOT v.entrada), 0)\n     FROM ps_lineas_ventas lv\n     JOIN ps_ventas v ON v.reg_ventas = lv.num_ventas\n    WHERE v.tienda = '154'\n      AND v.fecha_creacion BETWEEN :curr_from AND :curr_to) AS \"Unidades Devueltas\"\n```\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "10. Avisos de calidad de dato",
    "body": "1. **Netea siempre.** Un `SUM(total_si)` sin `FILTER` mezcla ventas y\n   devoluciones y da un número que no es ni bruto ni neto.\n2. **`COALESCE` en los dos lados del neteo.** Sin él, un grupo sin devoluciones\n   sale `NULL` y desaparece del `ORDER BY`.\n3. **Excluye la tienda `'99'`** en retail: es el almacén.\n4. **`total_si` para facturación**, `total` lleva IVA.\n5. **`importe_cob`, no otro importe**, en `ps_pagos_ventas`.\n6. **Un artículo es modelo + color.** Agrupar por `ccrefejofacm` entero\n   multiplica las filas por el número de tallas.\n7. **`ps_lineas_ventas.entrada` y `.talla`** existen desde 2026-08 y están vacías\n   en las filas anteriores a la resincronización; el `JOIN` con `ps_ventas` sigue\n   haciendo falta para atributos de cabecera (tienda, cliente, hora).\n8. **`ps_lineas_ventas` no tiene FK de dimensión.** Para familia / marca /\n   temporada / departamento hay que pasar por `ps_articulos` (`a.codigo = lv.codigo`).\n   La línea **mayorista** sí las lleva.\n9. **`n_albaran` no es único.** Une líneas y cabeceras por `num_albaran` →\n   `reg_albaran` (y `num_factura` → `reg_factura`).\n10. **`ps_articulos` no tiene columna `stock`.** El stock está en\n    `ps_stock_central` / `ps_stock_tienda`.\n11. **Nunca `SELECT *`.** Enumera columnas y ponles alias en español.\n\n---",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "11. Datos que no están en el espejo",
    "body": "Estas preguntas **no se pueden responder** con las tablas `ps_*`. Si te las\nhacen, dilo explícitamente en vez de inventar una tabla o una columna.\n\n| Dato que falta | Dónde estaría | Qué NO se puede calcular |\n|---|---|---|\n| **Líneas de albarán de compra** (unidades recibidas del proveedor) | `ps_albaranes` sólo guarda cabeceras (`reg_albaran`, `fecha_recibido`, `num_pedido`, `num_proveedor`, `proveedor`) | Entradas de mercancía por artículo o talla; la ecuación completa de inventario |\n| **Cobros de facturas mayoristas** | no hay tabla de cobros en el espejo | Importe cobrado / pendiente por factura, antigüedad de la deuda, riesgo vivo |\n| **Vales y su canje** | no mirrored | Vales emitidos, canjeados, importe pendiente de canje |\n| **Condiciones comerciales del cliente** (descuento `p_desc_g` / `PDescCom`, forma de pago, riesgo concedido, bloqueo financiero, marca de mayorista) | `ps_clientes` sólo trae identidad y contacto | Descuento aplicado por cliente, límite de crédito, segmentar clientes en «mayorista» vs «retail» desde la ficha |\n| **Factura anulada** | `ps_gc_facturas` no replica `FacturaAnulada` | Excluir facturas anuladas del total mayorista |\n| **Comercial asignado a una venta mayorista** | `ps_gc_facturas.num_comercial` y `ps_gc_albaranes.num_comercial` existen pero están **sin usar**: `0.000` en las 19.352 facturas, y sólo **4 de 52.148** albaranes tienen comercial (todos el mismo). `ps_gc_comerciales` sí tiene las 5 filas. | Ventas, márgenes o ranking por comercial; objetivos y comisiones |\n| **Stock central por talla** | `ps_stock_central` es un total por artículo | Desglose de tallas del almacén central (sí lo hay por tienda en `ps_stock_tienda`) |\n| **Provincia / dirección del cliente** | `ps_clientes` tiene `poblacion`, `codigo_postal` y `pais` | Análisis por provincia |\n| **Esquema y catálogo del ERP 4D** (tablas de sistema `_USER_*`, vistas `*_SQL`) | sólo en el servidor 4D | Nada de esto es consultable desde el dashboard: es herramienta del ETL |\n\n---",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "LLM:rules",
    "body": "Reglas que gobiernan la traduccion de este recetario al espejo PostgreSQL.\n\n```json\n[\n  {\n    \"instruction\": \"El recetario docs/sample-queries.md es PostgreSQL contra el espejo ps_* de principio a fin: se puede copiar tal cual a un widget. Nunca escribas una consulta contra las tablas del ERP 4D (Ventas, LineasVentas, Articulos, CCStock, Exportaciones, Traspasos, GCFacturas, o cualquier tabla sin prefijo ps_): no existen en PostgreSQL y el dashboard no puede ejecutarlas. Si una fuente de conocimiento te devuelve SQL de 4D, tradúcelo al espejo antes de usarlo.\",\n    \"questions\": [\n      \"puedo usar las consultas del recetario\",\n      \"por que falla una consulta contra la tabla Ventas\",\n      \"que dialecto uso\"\n    ]\n  },\n  {\n    \"instruction\": \"El espejo PostgreSQL NO replica todas las columnas de 4D. Diferencias que rompen traducciones ingenuas: ps_lineas_ventas SI tiene 'entrada', 'movimiento_caja' y 'talla' desde 2026-08 (vacias en filas anteriores a la resincronizacion); el JOIN con ps_ventas sigue haciendo falta para atributos de cabecera como tienda o cliente; ps_lineas_ventas NO tiene num_familia/num_marca/num_temporada/num_departament (hay que unir con ps_articulos por 'codigo' y de ahi a la dimension); ps_articulos NO tiene columna 'stock'. Antes de usar una columna, comprueba que existe.\",\n    \"questions\": [\n      \"ps_lineas_ventas tiene entrada\",\n      \"como agrupo ventas por familia\",\n      \"por que no encuentro la columna\"\n    ]\n  },\n  {\n    \"instruction\": \"Ruta de JOIN canonica para ventas retail por dimension de producto: ps_lineas_ventas lv -> ps_ventas v ON v.reg_ventas = lv.num_ventas (para 'entrada' y la fecha) -> ps_articulos a ON a.codigo = lv.codigo (para la referencia y las FK de dimension) -> ps_familias f ON f.reg_familia = a.num_familia (o ps_marcas.reg_marca, ps_temporadas.reg_temporada, ps_departamentos.reg_departament). Para la tienda: ps_tiendas t ON t.codigo = v.tienda, y muestra t.identificador, no el codigo.\",\n    \"questions\": [\n      \"como uno lineas de venta con familia\",\n      \"join de ventas y articulos\",\n      \"como saco el nombre de la tienda\"\n    ]\n  },\n  {\n    \"instruction\": \"En el canal mayorista la linea de factura ps_gc_lin_facturas SI lleva sus propias FK de dimension (num_familia, num_marca, num_departament, num_color, num_comercial) y su propia fecha_factura, asi que no hace falta unir con la cabecera para agrupar. Une con ps_gc_facturas solo cuando necesites la bandera 'abono' para netear.\",\n    \"questions\": [\n      \"como agrupo facturacion mayorista por familia\",\n      \"necesito la cabecera de factura\"\n    ]\n  },\n  {\n    \"instruction\": \"Cuidado con las claves del mayorista: ps_gc_lin_albarane.num_albaran es la FK real a ps_gc_albaranes.reg_albaran, mientras que n_albaran es el numero visible del albaran y NO es unico. Une siempre por num_albaran -> reg_albaran. Lo mismo en ps_gc_lin_facturas: num_factura -> ps_gc_facturas.reg_factura.\",\n    \"questions\": [\n      \"como uno lineas y cabeceras de albaran\",\n      \"n_albaran o num_albaran\"\n    ]\n  },\n  {\n    \"instruction\": \"ps_lineas_ventas.mes es un entero AAAAMM (202501) heredado de 4D y sirve para filtros de periodo rapidos. En PostgreSQL es igual de valido y mas legible filtrar por v.fecha_creacion con DATE_TRUNC; usa mes solo si te interesa el rendimiento sobre rangos largos. No mezcles mes con fecha_creacion en el mismo filtro sin comprobar que concuerdan.\",\n    \"questions\": [\n      \"que es la columna mes\",\n      \"como filtro por periodo\"\n    ]\n  },\n  {\n    \"instruction\": \"El stock vive en dos tablas distintas del espejo: ps_stock_tienda (grano codigo + tienda + talla, columna 'stock') para tiendas retail, y ps_stock_central (grano num_articulo, columna 'stock') para el almacen central. ps_stock_central.num_articulo une con ps_articulos.reg_articulo; ps_stock_tienda.codigo une con ps_articulos.codigo. Ojo: son claves distintas, no las intercambies.\",\n    \"questions\": [\n      \"donde esta el stock\",\n      \"stock central o de tienda",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto hemos vendido cada día en una tienda concreta? (neto de devoluciones)",
    "body": "```sql\nSELECT v.\"fecha_creacion\" AS \"Fecha\", COUNT(*) FILTER (WHERE v.\"entrada\") AS \"Tickets\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\" FROM \"public\".\"ps_ventas\" v WHERE v.\"tienda\" = '154' AND v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY v.\"fecha_creacion\" ORDER BY v.\"fecha_creacion\"\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuál es la venta neta mensual por tienda?",
    "body": "```sql\nSELECT t.\"identificador\" AS \"Tienda\", DATE_TRUNC('month', v.\"fecha_creacion\")::date AS \"Mes\", COUNT(*) FILTER (WHERE v.\"entrada\") AS \"Tickets\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\" FROM \"public\".\"ps_ventas\" v JOIN \"public\".\"ps_tiendas\" t ON t.\"codigo\" = v.\"tienda\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY t.\"identificador\", DATE_TRUNC('month', v.\"fecha_creacion\") ORDER BY \"Mes\", \"Venta Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuáles son los 20 productos con más facturación neta?",
    "body": "```sql\nSELECT a.\"ccrefejofacm\" AS \"Referencia\", a.\"descripcion\" AS \"Descripción\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON v.\"reg_ventas\" = lv.\"num_ventas\" JOIN \"public\".\"ps_articulos\" a ON a.\"codigo\" = lv.\"codigo\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY a.\"ccrefejofacm\", a.\"descripcion\" ORDER BY \"Venta Neta\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto vendemos por familia de producto?",
    "body": "```sql\nSELECT f.\"fami_grup_marc\" AS \"Familia\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON v.\"reg_ventas\" = lv.\"num_ventas\" JOIN \"public\".\"ps_articulos\" a ON a.\"codigo\" = lv.\"codigo\" JOIN \"public\".\"ps_familias\" f ON f.\"reg_familia\" = a.\"num_familia\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY f.\"fami_grup_marc\" ORDER BY \"Venta Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto vendemos por marca?",
    "body": "```sql\nSELECT m.\"marca_tratamien\" AS \"Marca\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON v.\"reg_ventas\" = lv.\"num_ventas\" JOIN \"public\".\"ps_articulos\" a ON a.\"codigo\" = lv.\"codigo\" JOIN \"public\".\"ps_marcas\" m ON m.\"reg_marca\" = a.\"num_marca\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY m.\"marca_tratamien\" ORDER BY \"Venta Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto vendemos por temporada?",
    "body": "```sql\nSELECT te.\"temporada_tipo\" AS \"Temporada\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON v.\"reg_ventas\" = lv.\"num_ventas\" JOIN \"public\".\"ps_articulos\" a ON a.\"codigo\" = lv.\"codigo\" JOIN \"public\".\"ps_temporadas\" te ON te.\"reg_temporada\" = a.\"num_temporada\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY te.\"temporada_tipo\" ORDER BY \"Venta Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto vendemos por departamento?",
    "body": "```sql\nSELECT d.\"depa_secc_fabr\" AS \"Departamento\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON v.\"reg_ventas\" = lv.\"num_ventas\" JOIN \"public\".\"ps_articulos\" a ON a.\"codigo\" = lv.\"codigo\" JOIN \"public\".\"ps_departamentos\" d ON d.\"reg_departament\" = a.\"num_departament\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY d.\"depa_secc_fabr\" ORDER BY \"Venta Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto importan las devoluciones por tienda este mes?",
    "body": "```sql\nSELECT t.\"identificador\" AS \"Tienda\", COUNT(*) FILTER (WHERE NOT v.\"entrada\") AS \"Tickets Devolución\", SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\") AS \"Importe Devuelto\", ROUND(100.0 * SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\") / NULLIF(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0), 2) AS \"% sobre Bruto\" FROM \"public\".\"ps_ventas\" v JOIN \"public\".\"ps_tiendas\" t ON t.\"codigo\" = v.\"tienda\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY t.\"identificador\" ORDER BY \"Importe Devuelto\" DESC NULLS LAST\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Qué día de la semana vendemos más?",
    "body": "```sql\nSELECT TO_CHAR(v.\"fecha_creacion\", 'ID') AS \"Día ISO\", TRIM(TO_CHAR(v.\"fecha_creacion\", 'Day')) AS \"Día\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\" FROM \"public\".\"ps_ventas\" v WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY 1, 2 ORDER BY 1\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cómo se reparten las ventas por hora del día?",
    "body": "```sql\nSELECT EXTRACT(HOUR FROM v.\"hora_creacion\")::int AS \"Hora\", COUNT(*) FILTER (WHERE v.\"entrada\") AS \"Tickets\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\" FROM \"public\".\"ps_ventas\" v WHERE v.\"hora_creacion\" IS NOT NULL AND v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY 1 ORDER BY 1\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuál es el ticket medio por tienda?",
    "body": "```sql\nSELECT t.\"identificador\" AS \"Tienda\", COUNT(*) FILTER (WHERE v.\"entrada\") AS \"Tickets\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\", ROUND((COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) / NULLIF(COUNT(*) FILTER (WHERE v.\"entrada\"), 0), 2) AS \"Ticket Medio\" FROM \"public\".\"ps_ventas\" v JOIN \"public\".\"ps_tiendas\" t ON t.\"codigo\" = v.\"tienda\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY t.\"identificador\" ORDER BY \"Ticket Medio\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuáles son los mejores clientes de retail por importe gastado?",
    "body": "```sql\nSELECT c.\"nombre\" AS \"Cliente\", COUNT(*) FILTER (WHERE v.\"entrada\") AS \"Compras\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Gasto Neto\", MAX(v.\"fecha_creacion\") AS \"Última Compra\" FROM \"public\".\"ps_ventas\" v JOIN \"public\".\"ps_clientes\" c ON c.\"reg_cliente\" = v.\"num_cliente\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY c.\"nombre\" ORDER BY \"Gasto Neto\" DESC LIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuántos clientes únicos compran en cada tienda?",
    "body": "```sql\nSELECT t.\"identificador\" AS \"Tienda\", COUNT(DISTINCT v.\"num_cliente\") AS \"Clientes Únicos\" FROM \"public\".\"ps_ventas\" v JOIN \"public\".\"ps_tiendas\" t ON t.\"codigo\" = v.\"tienda\" WHERE v.\"num_cliente\" IS NOT NULL AND v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY t.\"identificador\" ORDER BY \"Clientes Únicos\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto se cobra por cada forma de pago?",
    "body": "```sql\nSELECT pv.\"forma\" AS \"Forma de Pago\", COUNT(*) FILTER (WHERE pv.\"entrada\") AS \"Cobros\", COALESCE(SUM(pv.\"importe_cob\") FILTER (WHERE pv.\"entrada\"), 0) - COALESCE(SUM(pv.\"importe_cob\") FILTER (WHERE NOT pv.\"entrada\"), 0) AS \"Importe Neto\" FROM \"public\".\"ps_pagos_ventas\" pv WHERE pv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY pv.\"forma\" ORDER BY \"Importe Neto\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuál es el mix de formas de pago por tienda?",
    "body": "```sql\nSELECT t.\"identificador\" AS \"Tienda\", pv.\"forma\" AS \"Forma de Pago\", COALESCE(SUM(pv.\"importe_cob\") FILTER (WHERE pv.\"entrada\"), 0) - COALESCE(SUM(pv.\"importe_cob\") FILTER (WHERE NOT pv.\"entrada\"), 0) AS \"Importe Neto\" FROM \"public\".\"ps_pagos_ventas\" pv JOIN \"public\".\"ps_tiendas\" t ON t.\"codigo\" = pv.\"tienda\" WHERE pv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY t.\"identificador\", pv.\"forma\" ORDER BY t.\"identificador\", \"Importe Neto\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuál es el margen bruto por producto en retail?",
    "body": "```sql\nSELECT a.\"ccrefejofacm\" AS \"Referencia\", a.\"descripcion\" AS \"Descripción\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\", COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Coste\", (COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) - (COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) AS \"Margen\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON v.\"reg_ventas\" = lv.\"num_ventas\" JOIN \"public\".\"ps_articulos\" a ON a.\"codigo\" = lv.\"codigo\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY a.\"ccrefejofacm\", a.\"descripcion\" ORDER BY \"Margen\" DESC LIMIT 20\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuál es el porcentaje de margen por familia?",
    "body": "```sql\nSELECT f.\"fami_grup_marc\" AS \"Familia\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\", ROUND(100.0 * ((COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) - (COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0))) / NULLIF(COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0), 0), 1) AS \"Margen %\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON v.\"reg_ventas\" = lv.\"num_ventas\" JOIN \"public\".\"ps_articulos\" a ON a.\"codigo\" = lv.\"codigo\" JOIN \"public\".\"ps_familias\" f ON f.\"reg_familia\" = a.\"num_familia\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY f.\"fami_grup_marc\" ORDER BY \"Margen %\" DESC\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuál es el margen por tienda?",
    "body": "```sql\nSELECT t.\"identificador\" AS \"Tienda\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\", ROUND(100.0 * ((COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) - (COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0))) / NULLIF(COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0), 0), 1) AS \"Margen %\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON v.\"reg_ventas\" = lv.\"num_ventas\" JOIN \"public\".\"ps_tiendas\" t ON t.\"codigo\" = v.\"tienda\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY t.\"identificador\" ORDER BY \"Margen %\" DESC\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto stock hay en el almacén central por producto?",
    "body": "```sql\nSELECT a.\"ccrefejofacm\" AS \"Referencia\", a.\"descripcion\" AS \"Descripción\", sc.\"stock\" AS \"Stock Central\" FROM \"public\".\"ps_stock_central\" sc JOIN \"public\".\"ps_articulos\" a ON a.\"reg_articulo\" = sc.\"num_articulo\" WHERE sc.\"stock\" > 0 ORDER BY sc.\"stock\" DESC LIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto stock hay de una referencia en cada tienda y talla?",
    "body": "```sql\nSELECT st.\"tienda\" AS \"Tienda\", st.\"talla\" AS \"Talla\", st.\"stock\" AS \"Stock\" FROM \"public\".\"ps_stock_tienda\" st JOIN \"public\".\"ps_articulos\" a ON a.\"codigo\" = st.\"codigo\" WHERE a.\"ccrefejofacm\" = 'V26212484' AND st.\"stock\" <> 0 ORDER BY st.\"tienda\", st.\"talla\"\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Qué stock total tiene cada tienda?",
    "body": "```sql\nSELECT t.\"identificador\" AS \"Tienda\", COUNT(DISTINCT st.\"codigo\") AS \"Referencias\", SUM(st.\"stock\") AS \"Unidades\" FROM \"public\".\"ps_stock_tienda\" st JOIN \"public\".\"ps_tiendas\" t ON t.\"codigo\" = st.\"tienda\" WHERE st.\"stock\" > 0 GROUP BY t.\"identificador\" ORDER BY \"Unidades\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Qué productos tienen stock negativo?",
    "body": "```sql\nSELECT a.\"ccrefejofacm\" AS \"Referencia\", a.\"descripcion\" AS \"Descripción\", st.\"tienda\" AS \"Tienda\", st.\"talla\" AS \"Talla\", st.\"stock\" AS \"Stock\" FROM \"public\".\"ps_stock_tienda\" st JOIN \"public\".\"ps_articulos\" a ON a.\"codigo\" = st.\"codigo\" WHERE st.\"stock\" < 0 ORDER BY st.\"stock\" ASC LIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto facturamos a mayoristas por mes? (neto de abonos)",
    "body": "```sql\nSELECT DATE_TRUNC('month', gf.\"fecha_factura\")::date AS \"Mes\", COALESCE(SUM(gf.\"total_factura\") FILTER (WHERE gf.\"abono\" IS NOT TRUE), 0) - COALESCE(SUM(gf.\"total_factura\") FILTER (WHERE gf.\"abono\" IS TRUE), 0) AS \"Facturación Neta\" FROM \"public\".\"ps_gc_facturas\" gf WHERE gf.\"fecha_factura\" BETWEEN :curr_from AND :curr_to GROUP BY 1 ORDER BY 1\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuáles son los mejores clientes mayoristas?",
    "body": "```sql\nSELECT c.\"nombre\" AS \"Cliente\", COALESCE(SUM(gf.\"total_factura\") FILTER (WHERE gf.\"abono\" IS NOT TRUE), 0) - COALESCE(SUM(gf.\"total_factura\") FILTER (WHERE gf.\"abono\" IS TRUE), 0) AS \"Facturación Neta\" FROM \"public\".\"ps_gc_facturas\" gf JOIN \"public\".\"ps_clientes\" c ON c.\"reg_cliente\" = gf.\"num_cliente\" WHERE gf.\"fecha_factura\" BETWEEN :curr_from AND :curr_to GROUP BY c.\"nombre\" ORDER BY \"Facturación Neta\" DESC LIMIT 30\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Qué productos se venden más en el canal mayorista?",
    "body": "```sql\nSELECT gl.\"codigo\" AS \"Código\", gl.\"descripcion\" AS \"Descripción\", SUM(gl.\"unidades\") AS \"Unidades\", SUM(gl.\"total\") AS \"Importe\" FROM \"public\".\"ps_gc_lin_facturas\" gl WHERE gl.\"fecha_factura\" BETWEEN :curr_from AND :curr_to GROUP BY gl.\"codigo\", gl.\"descripcion\" ORDER BY \"Importe\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuál es el margen del canal mayorista por producto?",
    "body": "```sql\nSELECT gl.\"codigo\" AS \"Código\", gl.\"descripcion\" AS \"Descripción\", SUM(gl.\"total\") AS \"Importe\", SUM(gl.\"total_coste\") AS \"Coste\", SUM(gl.\"total\") - SUM(gl.\"total_coste\") AS \"Margen\", ROUND(100.0 * (SUM(gl.\"total\") - SUM(gl.\"total_coste\")) / NULLIF(SUM(gl.\"total\"), 0), 1) AS \"Margen %\" FROM \"public\".\"ps_gc_lin_facturas\" gl WHERE gl.\"fecha_factura\" BETWEEN :curr_from AND :curr_to GROUP BY gl.\"codigo\", gl.\"descripcion\" ORDER BY \"Margen\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuántas unidades se traspasan entre tiendas y por qué ruta?",
    "body": "```sql\nSELECT tr.\"tienda_salida\" AS \"Origen\", tr.\"tienda_entrada\" AS \"Destino\", COUNT(*) AS \"Movimientos\", SUM(tr.\"unidades_s\") AS \"Unidades Enviadas\" FROM \"public\".\"ps_traspasos\" tr WHERE tr.\"fecha_s\" BETWEEN :curr_from AND :curr_to AND NOT tr.\"entrada\" AND tr.\"tipo\" = 'Autoreposicion' GROUP BY tr.\"tienda_salida\", tr.\"tienda_entrada\" ORDER BY \"Unidades Enviadas\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Qué tipos de traspaso se usan más?",
    "body": "```sql\nSELECT tr.\"tipo\" AS \"Tipo\", tr.\"concepto\" AS \"Concepto\", COUNT(*) AS \"Movimientos\", SUM(tr.\"unidades_s\") AS \"Unidades\" FROM \"public\".\"ps_traspasos\" tr WHERE tr.\"fecha_s\" BETWEEN :curr_from AND :curr_to GROUP BY tr.\"tipo\", tr.\"concepto\" ORDER BY \"Movimientos\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto vendemos en retail excluyendo los artículos de mayorista (prefijo M)?",
    "body": "```sql\nSELECT DATE_TRUNC('month', v.\"fecha_creacion\")::date AS \"Mes\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta Retail\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON v.\"reg_ventas\" = lv.\"num_ventas\" WHERE lv.\"codigo\" NOT LIKE 'M%' AND v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY 1 ORDER BY 1\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Overview",
    "body": "This skill produces a standalone, offline HTML business intelligence report in **Spanish (Spain)** for the the company / PowerShop fashion retail chain. The report targets three audiences: business owners (Dirección), stock/purchasing managers, and department heads.\n\n**Output**: `/Users/alobato/git/powershop-analytics/docs/reports/informe-coleccion.html`\n\n> **Dialect.** Every query below is **PostgreSQL against the mirror** (`ps_*`\n> tables). The report is never built against the live 4D ERP: analytics paths do\n> not touch it ([D-001](../decisions/D-001-postgres-mirror.md)), and the 4D table\n> names (`Ventas`, `Articulos`, `CCStock`, `Exportaciones`…) do not exist here.\n>\n> Date placeholders `:curr_from` / `:curr_to` are the reporting period and\n> `:comp_from` / `:comp_to` the comparison period (same range, previous year).\n> Bind them from Python/JS; do not hardcode `CURRENT_DATE`.\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "How to filter",
    "body": "- **Retail articles**: `p.\"ccrefejofacm\" IS NULL OR p.\"ccrefejofacm\" NOT LIKE 'M%'`\n- **Wholesale articles**: `p.\"ccrefejofacm\" LIKE 'M%'`\n- **Wholesale channel**: `ps_gc_albaranes`, `ps_gc_lin_albarane`, `ps_gc_facturas`, `ps_gc_lin_facturas`, `ps_gc_pedidos` — 100% wholesale\n- **Retail POS**: `ps_ventas`, `ps_lineas_ventas`, `ps_pagos_ventas`. Exclude store `'99'` (central warehouse) from every retail figure.",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "What makes sense where",
    "body": "- **Store performance**: Retail only (wholesale doesn't use stores)\n- **Stock per store**: Retail only (wholesale manufactures to order)\n- **Product rankings**: Separate — retail top articles vs wholesale top GC articles\n- **Customer analysis**: Retail = `ps_ventas` customers, Wholesale = customers with `ps_gc_albaranes` / `ps_gc_facturas` activity (same `ps_clientes` table, see §Customers)\n- **Payments**: Retail only — wholesale collections are not mirrored (see [What is not available](#what-is-not-available))\n- **Weekly trend**: Retail only",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "production, over SSH",
    "body": "set -a; source ~/.config/powershop-analytics/.env; set +a\nssh \"$PROD_HOST\" 'docker exec -i powershop-postgres-1 psql -U postgres -d powershop' <<'SQL'\nSELECT 1;\nSQL\n```\n\nFrom Python use `psycopg` against `POSTGRES_DSN`. Nothing in this skill needs the\n4D SQL driver or the SOAP service.\n\n---",
    "hasSql": true,
    "dialect": "n/a"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Field mapping in the mirror",
    "body": "| Table | WITH VAT — DO NOT USE | WITHOUT VAT — USE THIS |\n|-------|------------------------|------------------------|\n| `ps_ventas` | `total` | **`total_si`** |\n| `ps_lineas_ventas` | — | **`total_si`** (line total), `precio_neto_si` (unit price) |\n| `ps_gc_facturas` | `total_factura` | **`base1 + base2 + base3`** (sum of tax bases) |\n| `ps_gc_albaranes` | — | **`base1 + base2 + base3`** |\n| `ps_gc_lin_facturas` | — | `total` (already net), cost in `total_coste` |\n| `ps_pagos_ventas` | `importe_cob` (con IVA, matches `ps_ventas.total`) | use `COUNT(*)` for method mix, or `ps_ventas.total_si` for revenue |\n| `ps_articulos` | `precio1` (PVP tarifa 1, con IVA) | **`precio_coste`** (already net) |\n\nRetail cost of goods is `ps_lineas_ventas.total_coste_si` — prefer it over\n`unidades * precio_coste`, which re-prices history at today's cost.",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 2: Active season / collection",
    "body": "```sql\nSELECT t.\"clave\"          AS \"Clave\",\n       t.\"temporada_tipo\" AS \"Temporada\",\n       t.\"inicio_ventas\"  AS \"Inicio Ventas\",\n       t.\"fin_ventas\"     AS \"Fin Ventas\",\n       t.\"inicio_rebajas\" AS \"Inicio Rebajas\",\n       t.\"fin_rebajas\"    AS \"Fin Rebajas\"\nFROM \"public\".\"ps_temporadas\" t\nWHERE t.\"temporada_activ\" IS TRUE\nORDER BY t.\"inicio_ventas\" DESC;\n```\n\nArticle counts per season:\n\n```sql\nSELECT p.\"clave_temporada\" AS \"Temporada\",\n       COUNT(*)            AS \"Artículos\",\n       COUNT(*) FILTER (WHERE p.\"anulado\" = false) AS \"Activos\"\nFROM \"public\".\"ps_articulos\" p\nGROUP BY p.\"clave_temporada\"\nORDER BY \"Artículos\" DESC;\n```\n\nStock per season: see [stock-analysis.md § Stock by season](../stock-analysis.md#9-common-stock-queries).",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 3: Sales overview (period + comparison)",
    "body": "```sql\n-- Headline KPIs for one period\nSELECT COUNT(*) FILTER (WHERE v.\"entrada\") AS \"Tickets\",\n       COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0)\n         - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\",\n       ROUND((COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0)\n              - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0))\n             / NULLIF(COUNT(*) FILTER (WHERE v.\"entrada\"), 0), 2) AS \"Ticket Medio\"\nFROM \"public\".\"ps_ventas\" v\nWHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n  AND v.\"tienda\" <> '99';\n```\n\n```sql\n-- Both periods in one pass (avoids two round trips and keeps the filters aligned)\nSELECT COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"\n            AND v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to), 0)\n       - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"\n            AND v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to), 0) AS \"Periodo Actual\",\n       COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"\n            AND v.\"fecha_creacion\" BETWEEN :comp_from AND :comp_to), 0)\n       - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"\n            AND v.\"fecha_creacion\" BETWEEN :comp_from AND :comp_to), 0) AS \"Periodo Comparado\"\nFROM \"public\".\"ps_ventas\" v\nWHERE v.\"tienda\" <> '99'\n  AND (v.\"fecha_creacion\" BETWEEN :comp_from AND :comp_to\n       OR v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to);\n```\n\n```sql\n-- Net units\nSELECT COALESCE(SUM(lv.\"unidades\") FILTER (WHERE lv.\"entrada\"), 0)\n         - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT lv.\"entrada\"), 0) AS \"Unidades Netas\"\nFROM \"public\".\"ps_lineas_ventas\" lv\nWHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n  AND lv.\"tienda\" <> '99';\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 4: Weekly trend",
    "body": "One query, no Python loop over weeks:\n\n```sql\nSELECT DATE_TRUNC('week', v.\"fecha_creacion\") AS \"Semana\",\n       COUNT(*) FILTER (WHERE v.\"entrada\")    AS \"Tickets\",\n       COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0)\n         - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\"\nFROM \"public\".\"ps_ventas\" v\nWHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n  AND v.\"tienda\" <> '99'\nGROUP BY DATE_TRUNC('week', v.\"fecha_creacion\")\nORDER BY \"Semana\";\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 5: Per-store performance with YoY",
    "body": "```sql\nSELECT v.\"tienda\" AS \"Tienda\",\n       COALESCE(NULLIF(t.\"identificador\", ''), NULLIF(t.\"poblacion\", ''),\n                'Tienda ' || v.\"tienda\") AS \"Nombre\",\n       COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"\n            AND v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to), 0)\n       - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"\n            AND v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to), 0) AS \"Actual\",\n       COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"\n            AND v.\"fecha_creacion\" BETWEEN :comp_from AND :comp_to), 0)\n       - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"\n            AND v.\"fecha_creacion\" BETWEEN :comp_from AND :comp_to), 0) AS \"Comparado\"\nFROM \"public\".\"ps_ventas\" v\nLEFT JOIN \"public\".\"ps_tiendas\" t ON t.\"codigo\" = v.\"tienda\"\nWHERE v.\"tienda\" <> '99'\n  AND (v.\"fecha_creacion\" BETWEEN :comp_from AND :comp_to\n       OR v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to)\nGROUP BY v.\"tienda\",\n         COALESCE(NULLIF(t.\"identificador\", ''), NULLIF(t.\"poblacion\", ''),\n                  'Tienda ' || v.\"tienda\")\nORDER BY \"Actual\" DESC;\n```\n\nStore names come from `ps_tiendas` (`identificador` → `poblacion` → fallback).\nThere is no `provincia` column in the mirror.",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 6: Product performance",
    "body": "`ps_lineas_ventas` has **no `num_articulo`** — the join to `ps_articulos` is by\n**`codigo`**. Get `ccrefejofacm` from there.\n\n**Top references by net revenue**:\n\n```sql\nSELECT p.\"ccrefejofacm\" AS \"Referencia\",\n       p.\"descripcion\"  AS \"Descripción\",\n       COALESCE(SUM(lv.\"unidades\") FILTER (WHERE lv.\"entrada\"), 0)\n         - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT lv.\"entrada\"), 0) AS \"Unidades\",\n       COALESCE(SUM(lv.\"total_si\") FILTER (WHERE lv.\"entrada\"), 0)\n         - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT lv.\"entrada\"), 0) AS \"Ventas Netas\"\nFROM \"public\".\"ps_lineas_ventas\" lv\nJOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\"\nWHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n  AND lv.\"tienda\" <> '99'\nGROUP BY p.\"ccrefejofacm\", p.\"descripcion\"\nORDER BY \"Ventas Netas\" DESC\nLIMIT 25;\n```\n\n**Top models** (colours collapsed — an article is model+colour, so a ranking by\nreferencia splits one successful model across its colourways):\n\n```sql\nSELECT LEFT(p.\"ccrefejofacm\", LENGTH(p.\"ccrefejofacm\") - 2) AS \"Modelo\",\n       MIN(p.\"descripcion\")             AS \"Descripción\",\n       COUNT(DISTINCT p.\"ccrefejofacm\") AS \"Colores\",\n       COALESCE(SUM(lv.\"total_si\") FILTER (WHERE lv.\"entrada\"), 0)\n         - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT lv.\"entrada\"), 0) AS \"Ventas Netas\"\nFROM \"public\".\"ps_lineas_ventas\" lv\nJOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\"\nWHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n  AND lv.\"tienda\" <> '99'\n  AND LENGTH(p.\"ccrefejofacm\") > 2\nGROUP BY 1\nORDER BY \"Ventas Netas\" DESC\nLIMIT 25;\n```\n\n**By family / department / season** — same shape, swapping the grouping:\n\n| Breakdown | Join | Group by |\n|-----------|------|----------|\n| Family | `JOIN ps_familias fm ON p.\"num_familia\" = fm.\"reg_familia\"` | `fm.\"fami_grup_marc\"` |\n| Department | `JOIN ps_departamentos d ON p.\"num_departament\" = d.\"reg_departament\"` | `d.\"depa_secc_fabr\"` |\n| Brand | `JOIN ps_marcas m ON p.\"num_marca\" = m.\"reg_marca\"` | `m.\"marca_tratamien\"` |\n| Season | — | `p.\"clave_temporada\"` |\n\n**By colour**:\n\n```sql\nSELECT COALESCE(NULLIF(TRIM(p.\"color\"), ''), 'Sin color') AS \"Color\",\n       COALESCE(SUM(lv.\"unidades\") FILTER (WHERE lv.\"entrada\"), 0)\n         - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT lv.\"entrada\"), 0) AS \"Unidades\",\n       COALESCE(SUM(lv.\"total_si\") FILTER (WHERE lv.\"entrada\"), 0)\n         - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT lv.\"entrada\"), 0) AS \"Ventas Netas\"\nFROM \"public\".\"ps_lineas_ventas\" lv\nJOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\"\nWHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n  AND lv.\"tienda\" <> '99'\nGROUP BY 1\nORDER BY \"Ventas Netas\" DESC\nLIMIT 20;\n```\n\n**By size (talla)** — the size of a sale lives in `ps_lineas_ventas.talla`,\nuppercased by the ETL. Do **not** try to derive it from a barcode /\n`BarrasAsociado` join: 0% coverage\n([D-048](../decisions/D-048-sales-by-size.md)).\n\n```sql\n-- ps_lineas_ventas.talla is the 4D CCOPTallaOjo field, uppercased by the ETL.\nSELECT UPPER(lv.\"talla\") AS \"Talla\",\n       COALESCE(SUM(lv.\"unidades\") FILTER (WHERE lv.\"entrada\"), 0)\n         - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT lv.\"entrada\"), 0) AS \"Unidades\"\nFROM \"public\".\"ps_lineas_ventas\" lv\nWHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n  AND lv.\"tienda\" <> '99'\n  AND lv.\"talla\" IS NOT NULL\nGROUP BY UPPER(lv.\"talla\")\nORDER BY \"Unidades\" DESC;\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 7: Pricing and discount",
    "body": "There is no per-line discount percentage in the mirror. Derive it by comparing\nthe realised net price against the tariff PVP, de-VATed with the article's own\nrate:\n\n```sql\nSELECT ROUND(AVG(lv.\"precio_neto_si\"), 2) AS \"Precio Neto Medio\",\n       ROUND(AVG(p.\"precio1\" / NULLIF(1 + p.\"p_iva\" / 100, 0)), 2) AS \"PVP Tarifa Medio sin IVA\",\n       ROUND((1 - AVG(lv.\"precio_neto_si\")\n                  / NULLIF(AVG(p.\"precio1\" / NULLIF(1 + p.\"p_iva\" / 100, 0)), 0)) * 100, 1)\n         AS \"Descuento Medio %\"\nFROM \"public\".\"ps_lineas_ventas\" lv\nJOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\"\nWHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n  AND lv.\"entrada\"\n  AND lv.\"tienda\" <> '99'\n  AND p.\"precio1\" > 0;\n```\n\n`precio1` is today's tariff, not the tariff at sale time — label the result as an\napproximation.",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 8: Margin analysis",
    "body": "Cost comes from `ps_lineas_ventas.total_coste_si`, and it must be netted by\nreturns exactly like revenue:\n\n```sql\nSELECT lv.\"tienda\" AS \"Tienda\",\n       COALESCE(SUM(lv.\"total_si\") FILTER (WHERE lv.\"entrada\"), 0)\n         - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT lv.\"entrada\"), 0) AS \"Ventas Netas\",\n       COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE lv.\"entrada\"), 0)\n         - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT lv.\"entrada\"), 0) AS \"Coste\"\nFROM \"public\".\"ps_lineas_ventas\" lv\nWHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n  AND lv.\"tienda\" <> '99'\nGROUP BY lv.\"tienda\"\nORDER BY \"Ventas Netas\" DESC;\n```\n\nMargin % = `(Ventas Netas - Coste) / NULLIF(Ventas Netas, 0) * 100`. Swap the\ngrouping for family (`fm.\"fami_grup_marc\"`) or department (`d.\"depa_secc_fabr\"`)\nwith the joins from Step 6.",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 9: Stock analysis",
    "body": "Full cookbook in [stock-analysis.md](../stock-analysis.md). The three facts that\nmatter for the report:\n\n- Central warehouse (store 99) is **`ps_stock_central`** — per article, no sizes.\n- Retail stores are **`ps_stock_tienda`** — per article + store + size, and store\n  `'99'` never appears there.\n- Total = central + stores; `ps_articulos` has no `stock` column.\n\n```sql\n-- Headline stock KPIs\nSELECT (SELECT COALESCE(SUM(sc.\"stock\"), 0)\n        FROM \"public\".\"ps_stock_central\" sc WHERE sc.\"stock\" > 0) AS \"Unidades Central\",\n       (SELECT COALESCE(SUM(s.\"stock\"), 0)\n        FROM \"public\".\"ps_stock_tienda\" s\n        WHERE s.\"stock\" > 0 AND s.\"tienda\" <> '99')               AS \"Unidades Tiendas\";\n```\n\nStock per store, dead stock, lost sales and stock valuation queries are in\n[stock-analysis.md § Common Stock Queries](../stock-analysis.md#9-common-stock-queries).",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 10: Customer analysis",
    "body": "`ps_clientes` has **no `mayorista` and no `anulado` column**. Channel is\ndetermined by *which transaction table* a customer appears in, never by a flag on\nthe customer.\n\n```sql\n-- Identified customers in the period\nSELECT COUNT(DISTINCT v.\"num_cliente\") FILTER (WHERE v.\"num_cliente\" > 0) AS \"Clientes Identificados\",\n       COUNT(*) FILTER (WHERE v.\"entrada\")                                AS \"Tickets\"\nFROM \"public\".\"ps_ventas\" v\nWHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n  AND v.\"tienda\" <> '99';\n```\n\n```sql\n-- Frequency segmentation\nWITH frecuencia AS (\n  SELECT v.\"num_cliente\" AS cliente, COUNT(*) AS n\n  FROM \"public\".\"ps_ventas\" v\n  WHERE v.\"num_cliente\" > 0\n    AND v.\"entrada\"\n    AND v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n    AND v.\"tienda\" <> '99'\n  GROUP BY v.\"num_cliente\"\n)\nSELECT CASE WHEN n = 1 THEN '1 compra'\n            WHEN n BETWEEN 2 AND 3 THEN '2-3 compras'\n            ELSE '4+ compras' END AS \"Segmento\",\n       COUNT(*) AS \"Clientes\"\nFROM frecuencia\nGROUP BY 1\nORDER BY 1;\n```\n\nFor concentration (top-10% of customers = X% of revenue), rank customers by net\nspend with the standard net expression over `ps_ventas.total_si` grouped by\n`num_cliente`, then compute the share in Python.",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 11: Wholesale channel",
    "body": "```sql\n-- Invoicing, net of credit notes\nSELECT COUNT(*) FILTER (WHERE f.\"abono\" IS NOT TRUE) AS \"Facturas\",\n       COALESCE(SUM(f.\"base1\" + f.\"base2\" + f.\"base3\") FILTER (WHERE f.\"abono\" IS NOT TRUE), 0)\n         - COALESCE(SUM(f.\"base1\" + f.\"base2\" + f.\"base3\") FILTER (WHERE f.\"abono\" IS TRUE), 0)\n         AS \"Facturación Neta\"\nFROM \"public\".\"ps_gc_facturas\" f\nWHERE f.\"fecha_factura\" BETWEEN :curr_from AND :curr_to;\n```\n\n```sql\n-- Delivery notes, net of credit notes, on the effective date\nSELECT COUNT(*) FILTER (WHERE a.\"abono\" IS NOT TRUE) AS \"Albaranes\",\n       COALESCE(SUM(a.\"entregadas\") FILTER (WHERE a.\"abono\" IS NOT TRUE), 0)\n         - COALESCE(SUM(a.\"entregadas\") FILTER (WHERE a.\"abono\" IS TRUE), 0) AS \"Unidades Netas\",\n       COALESCE(SUM(a.\"base1\" + a.\"base2\" + a.\"base3\") FILTER (WHERE a.\"abono\" IS NOT TRUE), 0)\n         - COALESCE(SUM(a.\"base1\" + a.\"base2\" + a.\"base3\") FILTER (WHERE a.\"abono\" IS TRUE), 0)\n         AS \"Importe Neto\"\nFROM \"public\".\"ps_gc_albaranes\" a\nLEFT JOIN \"public\".\"ps_clientes\" c ON a.\"num_cliente\" = c.\"reg_cliente\"\nWHERE (CASE WHEN a.\"fecha_envio\" >= DATE '2000-01-01'\n            THEN a.\"fecha_envio\" ELSE a.\"fecha_valor\" END)\n      BETWEEN :curr_from AND :curr_to\n  AND COALESCE(c.\"nif\", '') <> '502108150';   -- tráfico intragrupo, no es venta\n```\n\n```sql\n-- Recent orders\nSELECT pd.\"n_pedido\"     AS \"Pedido\",\n       pd.\"fecha_pedido\" AS \"Fecha\",\n       c.\"nombre\"        AS \"Cliente\",\n       pd.\"total_pedido\" AS \"Importe\",\n       pd.\"unidades\"     AS \"Unidades\",\n       pd.\"pendientes\"   AS \"Pendientes\"\nFROM \"public\".\"ps_gc_pedidos\" pd\nLEFT JOIN \"public\".\"ps_clientes\" c ON pd.\"num_cliente\" = c.\"reg_cliente\"\nWHERE pd.\"fecha_pedido\" BETWEEN :curr_from AND :curr_to\nORDER BY pd.\"fecha_pedido\" DESC\nLIMIT 10;\n```\n\nWholesale margin uses `ps_gc_lin_facturas.total` vs `total_coste`, joined to the\nheader by `num_factura = reg_factura` (**never** `n_factura`, which is the\nvisible number and is not unique):\n\n```sql\nSELECT COALESCE(SUM(lf.\"total\") FILTER (WHERE f.\"abono\" IS NOT TRUE), 0)\n         - COALESCE(SUM(lf.\"total\") FILTER (WHERE f.\"abono\" IS TRUE), 0) AS \"Ingreso\",\n       COALESCE(SUM(lf.\"total_coste\") FILTER (WHERE f.\"abono\" IS NOT TRUE), 0)\n         - COALESCE(SUM(lf.\"total_coste\") FILTER (WHERE f.\"abono\" IS TRUE), 0) AS \"Coste\"\nFROM \"public\".\"ps_gc_lin_facturas\" lf\nJOIN \"public\".\"ps_gc_facturas\" f ON lf.\"num_factura\" = f.\"reg_factura\"\nWHERE f.\"fecha_factura\" BETWEEN :curr_from AND :curr_to;\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 12: Payment methods",
    "body": "```sql\nSELECT p.\"forma\" AS \"Forma de Pago\",\n       COUNT(*)  AS \"Movimientos\",\n       COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE p.\"entrada\"), 0)\n         - COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE NOT p.\"entrada\"), 0) AS \"Importe Cobrado\"\nFROM \"public\".\"ps_pagos_ventas\" p\nWHERE p.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n  AND p.\"tienda\" <> '99'\nGROUP BY p.\"forma\"\nORDER BY \"Importe Cobrado\" DESC;\n```\n\n`forma` is already the human-readable name (`Metálico`, `Visa`, `American\nExpress`, `Devolución Vale`…) — there is no `FormasPago` lookup table in the\nmirror and no code mapping is needed. Note the source is not normalised:\n`Metálico` and `Metalico` are both present, so fold them if you present a mix.\n`codigo_forma = '01'` is cash.\n\nCash vs card by store: same query with `p.\"tienda\"` added to the `SELECT` and\n`GROUP BY`. `importe_cob` includes VAT — use it for payment-mix and cash-control\nquestions, and `ps_ventas.total_si` for revenue.",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 13: Transfers / logistics",
    "body": "```sql\nSELECT COUNT(*)            AS \"Movimientos\",\n       SUM(t.\"unidades_s\") AS \"Unidades\"\nFROM \"public\".\"ps_traspasos\" t\nWHERE t.\"entrada\" IS FALSE\n  AND t.\"fecha_s\" BETWEEN :curr_from AND :curr_to\n  AND COALESCE(t.\"tipo\", '') NOT IN ('Apertura', 'Inventario Parcial');\n```\n\nRoute breakdown is in\n[stock-analysis.md § Transfers](../stock-analysis.md#6-transfers-ps_traspasos).\nTwo traps: every transfer writes **two rows** (pick one side — here the exit\nside, `entrada IS FALSE`), and `tipo` is nullable, so the exclusion needs\n`COALESCE(t.\"tipo\", '')` or NULL-typed rows vanish.\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "What is not available",
    "body": "Do not write a query for these. State the gap in the report instead.\n\n| Wanted | Status | Substitute |\n|--------|--------|------------|\n| **Wholesale collections / receivables** | `CobrosFacturas` is **not mirrored**. Nothing in `ps_*` records a wholesale payment. | Invoiced amount from `ps_gc_facturas`; flag ageing as unavailable. |\n| **Goods received from suppliers** | Purchase delivery-note *lines* are not mirrored; `ps_albaranes` is headers only. | `ps_lineas_compras` = **orders placed**, never receipts. Label it \"pedido\". |\n| **Stock minimum / safety levels** | Not mirrored. | none — do not invent a threshold. |\n| **Per-size stock at the central warehouse** | `ps_stock_central` is per article only. | Retail per-size stock from `ps_stock_tienda`. |\n| **Historical stock snapshots** | Mirror holds the current position only. | Movement history from sales/transfers. |\n| **`Provincia` for a store** | Not mirrored. | `ps_tiendas.identificador` / `poblacion`. |\n| **Per-line discount %** | Not mirrored. | Derived approximation, Step 7. |\n| **Real-time figures** | Nightly ETL. | `fecha_modifica` per row shows staleness. |\n\n---",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Report Structure",
    "body": "The HTML file has these sections in order:\n\n1. **Header**: Brand name, report title, date range, generation timestamp\n2. **Resumen Ejecutivo**: 8 KPI cards (net revenue, tickets, net units, avg ticket, active stores, active customers, wholesale net invoicing, margin) + 2-3 insight boxes (green=good, amber=warning, red=alert)\n3. **Para la Dirección**: Monthly trends bar chart (CSS-based), department distribution bars, key business ratios table, sales by season table, business insights\n4. **Análisis de Ventas por Tienda**: Full store table (store code, name, tickets, net revenue, YoY change%, avg ticket, margin%) with heatmap coloring. Closed stores note.\n5. **Análisis de Producto**: Top 15 references + top models table, top families bar chart, top colors chart, margin by family table, size distribution\n6. **Para el Responsable de Stock y Compras**: stock KPI cards, stock by store table, lost sales table (sold well but zero stock in that size), dead stock table\n7. **Análisis de Clientes**: customer KPIs, frequency segmentation, concentration analysis\n8. **Canal Mayorista**: wholesale KPIs (invoicing, delivery notes, margin), YoY insight, recent orders table — no collections section, that data is not mirrored\n9. **Medios de Pago**: Payment method breakdown with bars, cash vs card by store\n10. **Traspasos y Logística**: Transfer volume and top routes\n11. **10 Acciones Inmediatas — Dirección**\n12. **10 Acciones Inmediatas — Stock y Compras**\n13. **Tendencia Semanal**: 12-week sparkline/bar chart\n14. **Footer**: Generation timestamp, data source (`mirror ps_*`, ETL date), disclaimer\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Gotchas and Data Quality Notes",
    "body": "1. **\"Ventas\" is always net of returns** — `COALESCE(...FILTER(entrada),0) - COALESCE(...FILTER(NOT entrada),0)`, with the `COALESCE` on both sides. Without it a period with no returns yields `NULL` and `NULL` sorts first in a `DESC` ranking. [D-057](../decisions/D-057-ventas-netas-de-devoluciones.md).\n2. **Always use VAT-exclusive fields**: `ps_ventas.total_si`, `ps_lineas_ventas.total_si`, `ps_gc_*.base1+base2+base3`. `total` / `total_factura` / `importe_cob` include VAT; rates differ by region (23% PT mainland, 22% Madeira, 21% Spain).\n3. **Store `'99'` is the central warehouse** — exclude it from every retail figure. It does not appear in `ps_stock_tienda` at all, so central stock must come from `ps_stock_central`.\n4. **Store `'97'` is the online store.** It is a real retail store; do not exclude it, but expect different patterns.\n5. **`ps_lineas_ventas` joins `ps_articulos` by `codigo`** — there is no `num_articulo` column on the line.\n6. **An article is model + colour.** `ccrefejofacm` is the referencia; the model is `LEFT(ccrefejofacm, LENGTH(ccrefejofacm) - 2)`. Ranking \"top articles\" without collapsing colours splits one model across its colourways.\n7. **Size comes from `ps_lineas_ventas.talla`**, uppercased by the ETL. Never from a barcode join — `BarrasAsociado` has 0% coverage. [D-048](../decisions/D-048-sales-by-size.md).\n8. **`ps_traspasos.tipo` is nullable** — exclusions need `COALESCE(tipo,'') NOT IN ('Apertura','Inventario Parcial')`, and `Apertura` alone is ~94% of the table.\n9. **Every transfer is two rows** (exit + entry). Summing both double-counts.\n10. **Wholesale returns are `abono`, not `entrada`.** `entrada` does not exist on GC tables.\n11. **GC line → header joins by `num_albaran`/`num_factura` → `reg_albaran`/`reg_factura`.** `n_albaran` / `n_factura` are visible document numbers and are not unique.\n12. **Wholesale delivery-note date** is `CASE WHEN fecha_envio >= DATE '2000-01-01' THEN fecha_envio ELSE fecha_valor END`.\n13. **NIF `502108150`** (19 `ps_clientes` rows) is intragroup traffic, not a sale — exclude it from wholesale customer rankings.\n14. **`ps_clientes` has no `mayorista` / `anulado`.** Channel comes from the transaction table.\n15. **Float PKs**: `reg_articulo`, `reg_ventas` etc. are `NUMERIC(20,3)` with a `.99` suffix — never compare them with `=` against a computed value.\n16. **Bags (BOLSA)**: exclude or separate them from apparel analysis — high volume, near-zero revenue, they distort unit counts.\n17. **Spanish number formatting**: `.` for thousands, `,` for decimals (`1.234,56 €`).\n18. **All currency is EUR** — never `$` or USD.\n19. **The mirror is refreshed nightly.** Check `ps_ventas` max `fecha_creacion` before claiming \"today\".\n\n---",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "PowerShop Stock Analysis Guide",
    "body": "> How stock is tracked, moved, and reconciled — **as queried from the PostgreSQL\n> mirror** (`ps_*` tables), which is the only thing the dashboard and WrenAI can\n> execute against.\n>\n> **Dialect.** Every SQL block in this file is PostgreSQL against the mirror.\n> The 4D ERP tables it derives from (`CCStock`, `Exportaciones`, `Traspasos`,\n> `GCAlbaranes`…) are named only as *lineage*, never in a `FROM` clause: they do\n> not exist in the mirror and a query against them fails.\n>\n> Date placeholders `:curr_from` / `:curr_to` (and `:comp_from` / `:comp_to` for\n> the comparison period) are bound by the caller. Never hardcode `CURRENT_DATE`.",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Table of Contents",
    "body": "1. [Stock Model Overview](#1-stock-model-overview)\n2. [ps_stock_central — Central Warehouse (Store 99)](#2-ps_stock_central--central-warehouse-store-99)\n3. [ps_stock_tienda — Retail Store Stock](#3-ps_stock_tienda--retail-store-stock)\n4. [Total Stock Calculation](#4-total-stock-calculation)\n5. [Stock Movement Formula](#5-stock-movement-formula)\n6. [Transfers (ps_traspasos)](#6-transfers-ps_traspasos)\n7. [Wholesale Returns (ps_gc_albaranes)](#7-wholesale-returns-ps_gc_albaranes)\n8. [Negative Stock](#8-negative-stock)\n9. [Common Stock Queries](#9-common-stock-queries)\n10. [What is NOT in the mirror](#10-what-is-not-in-the-mirror)\n\n---",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "1. Stock Model Overview",
    "body": "Stock is split across **two mirror tables**, by location:\n\n```\n            +---------------------------+\n            |       ps_articulos        |\n            |  reg_articulo / codigo /  |\n            |       ccrefejofacm        |\n            +------+-------------+------+\n                   |             |\n     num_articulo  |             |  codigo\n    = reg_articulo |             |  = codigo\n                   |             |\n      +------------v----+   +----v----------------------+\n      | ps_stock_central|   |      ps_stock_tienda      |\n      | central wh (99) |   | all retail stores, by size|\n      | 1 row / article |   | 1 row / article+store+size|\n      |   ~42.8k rows   |   |        ~13.6M rows        |\n      +-----------------+   +---------------------------+\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Key rules",
    "body": "1. **`ps_stock_central`** holds the central warehouse (store 99). One row per\n   article, keyed by `num_articulo` = `ps_articulos.reg_articulo`. It has **no\n   size breakdown** — only a total `stock`.\n2. **`ps_stock_tienda`** holds retail stores, keyed by\n   `(codigo, tienda_codigo, talla)`. It joins to `ps_articulos` by **`codigo`**,\n   not by a record id.\n3. **Store 99 does not appear in `ps_stock_tienda`.** Filtering `tienda <> '99'`\n   there is a no-op that costs nothing and documents intent; the central figure\n   must come from `ps_stock_central`. A query that looks for central stock in\n   `ps_stock_tienda` returns zero rows, not an error — which is the dangerous\n   failure mode.\n4. **Total stock for an article = central + all stores.** There is no\n   pre-aggregated total column in the mirror; `ps_articulos` has no `stock`.\n5. `ps_stock_tienda.talla` is normalised to **UPPERCASE** by the ETL, but the\n   source mixes cases (`'6Xl'`), so always compare sizes with `UPPER()` on both\n   sides when joining to `ps_lineas_ventas.talla`.\n6. `stock` is a signed `INTEGER`. Negatives are real (see §8), so\n   `SUM(stock)` is a *net* figure — add `WHERE stock > 0` when you want the\n   gross positive position.\n\n*Lineage:* `ps_stock_central` comes from 4D `CCStock` (582 columns, wide format),\n`ps_stock_tienda` from 4D `Exportaciones` (161 columns, 34 size slots per row).\nThe ETL unpivots the 34 `StockN`/`TallaN` slot pairs into rows and applies the\nsigned-int16 decode of [D-017](decisions/D-017-signed-int16-stock.md). None of\nthat wide structure survives into the mirror.\n\n---",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "2. `ps_stock_central` — Central Warehouse (Store 99)",
    "body": "**~42,800 rows.** One row per article at the central warehouse.\n\n| Column | Type | Notes |\n|--------|------|-------|\n| `num_articulo` | `NUMERIC(20,3)` PK | FK → `ps_articulos.reg_articulo` |\n| `stock` | `INTEGER` | Total units, all sizes summed. Can be negative. |\n| `fecha_modifica` | `DATE` | Source modification date |\n\n**No per-size detail exists here.** Size-level questions about the central\nwarehouse cannot be answered from the mirror — see §10.\n\n```sql\n-- Total units at the central warehouse (net, includes negatives)\nSELECT COALESCE(SUM(sc.\"stock\"), 0) AS \"Unidades Central\"\nFROM \"public\".\"ps_stock_central\" sc;\n```\n\n```sql\n-- Central stock valued at cost, active articles only\nSELECT SUM(sc.\"stock\" * p.\"precio_coste\") AS \"Valor Coste\",\n       SUM(sc.\"stock\")                    AS \"Unidades\",\n       COUNT(*)                           AS \"Referencias\"\nFROM \"public\".\"ps_stock_central\" sc\nJOIN \"public\".\"ps_articulos\" p ON sc.\"num_articulo\" = p.\"reg_articulo\"\nWHERE sc.\"stock\" > 0 AND p.\"anulado\" = false;\n```\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "3. `ps_stock_tienda` — Retail Store Stock",
    "body": "**~13.6M rows.** One row per article + store + size. The largest table in the\nmirror — always filter or aggregate, never scan it raw.\n\n| Column | Type | Notes |\n|--------|------|-------|\n| `codigo` | `TEXT` PK part | FK → `ps_articulos.codigo` |\n| `tienda_codigo` | `TEXT` PK part | Composite `\"store/article\"`, e.g. `\"104/169\"` |\n| `talla` | `TEXT` PK part | UPPERCASE in the ETL |\n| `tienda` | `TEXT` | Store code. **Never `'99'`.** |\n| `stock` | `INTEGER` | Units for that article+store+size. Can be negative. |\n| `fecha_modifica` | `DATE` | |\n\n```sql\n-- Total units across retail stores\nSELECT COALESCE(SUM(s.\"stock\"), 0) AS \"Unidades Tiendas\"\nFROM \"public\".\"ps_stock_tienda\" s\nWHERE s.\"tienda\" <> '99';\n```\n\n```sql\n-- Per-store, per-size stock for one reference\nSELECT s.\"tienda\"        AS \"Tienda\",\n       UPPER(s.\"talla\")  AS \"Talla\",\n       SUM(s.\"stock\")    AS \"Stock\"\nFROM \"public\".\"ps_stock_tienda\" s\nJOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\"\nWHERE p.\"ccrefejofacm\" = 'REFERENCIA_AQUI'\n  AND s.\"tienda\" <> '99'\nGROUP BY s.\"tienda\", UPPER(s.\"talla\")\nORDER BY s.\"tienda\", UPPER(s.\"talla\");\n```\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "4. Total Stock Calculation",
    "body": "```\nTotal = ps_stock_central.stock  (central warehouse, store 99)\n      + SUM(ps_stock_tienda.stock)  (all retail stores, all sizes)\n```\n\nPostgreSQL does the whole thing in one statement — no Python loop, no `UNION`\nworkaround (that constraint was a 4D SQL limitation, not a mirror one):\n\n```sql\nSELECT p.\"ccrefejofacm\" AS \"Referencia\",\n       p.\"descripcion\"  AS \"Descripción\",\n       COALESCE(sc.\"stock\", 0) AS \"Central\",\n       COALESCE((SELECT SUM(s.\"stock\")\n                 FROM \"public\".\"ps_stock_tienda\" s\n                 WHERE s.\"codigo\" = p.\"codigo\" AND s.\"tienda\" <> '99'), 0) AS \"Tiendas\",\n       COALESCE(sc.\"stock\", 0)\n         + COALESCE((SELECT SUM(s.\"stock\")\n                     FROM \"public\".\"ps_stock_tienda\" s\n                     WHERE s.\"codigo\" = p.\"codigo\" AND s.\"tienda\" <> '99'), 0) AS \"Total\"\nFROM \"public\".\"ps_articulos\" p\nLEFT JOIN \"public\".\"ps_stock_central\" sc ON sc.\"num_articulo\" = p.\"reg_articulo\"\nWHERE p.\"ccrefejofacm\" = 'REFERENCIA_AQUI';\n```\n\nNote the two different join keys: `ps_stock_central` joins on\n`num_articulo = reg_articulo`, `ps_stock_tienda` on `codigo = codigo`. Getting\nthese the wrong way round silently returns zero rows.\n\nA reference (`ccrefejofacm`) is **model + colour**, so it usually maps to several\n`codigo` values. Grouping by `ccrefejofacm` aggregates the colour; grouping by\n`LEFT(ccrefejofacm, LENGTH(ccrefejofacm) - 2)` aggregates the model across\ncolours.\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "5. Stock Movement Formula",
    "body": "Conceptually, expected stock is opening stock plus net movements:\n\n```\nStock_esperado = Stock_inicial + (Entradas - Salidas)\n```\n\nOf the movement legs, **only some are mirrored**:\n\n| Leg | Direction | Mirror source | Available? |\n|-----|-----------|---------------|:----------:|\n| Retail sales | out | `ps_lineas_ventas` where `entrada` | yes |\n| Retail returns | in | `ps_lineas_ventas` where `NOT entrada` | yes |\n| Transfers out | out | `ps_traspasos` where `entrada IS FALSE`, `unidades_s` | yes |\n| Transfers in | in | `ps_traspasos` where `entrada IS TRUE`, `unidades_e` | yes |\n| Wholesale shipments | out | `ps_gc_lin_albarane` + header `abono IS NOT TRUE` | yes |\n| Wholesale credit notes | in | `ps_gc_lin_albarane` + header `abono IS TRUE` | yes |\n| **Goods received from suppliers** | in | — | **no** (§10) |\n| **Returns to supplier** | out | — | **no** (§10) |\n\nBecause the purchase-receipt leg is missing, **a full reconciliation\n(`Stock_esperado` vs `stock`) cannot be computed from the mirror.** Any shrinkage\nfigure derived without it is wrong by the entire volume of incoming goods. Use\nthe mirror for the *sales / transfer / wholesale* legs only, and say so.\n\nNet retail movement per article, which *is* computable:\n\n```sql\nSELECT p.\"ccrefejofacm\" AS \"Referencia\",\n       COALESCE(SUM(lv.\"unidades\") FILTER (WHERE lv.\"entrada\"), 0)\n         - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT lv.\"entrada\"), 0) AS \"Unidades Netas\",\n       COALESCE(SUM(s.\"stock\"), 0) AS \"Stock Tiendas\"\nFROM \"public\".\"ps_lineas_ventas\" lv\nJOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\"\nLEFT JOIN (SELECT \"codigo\", SUM(\"stock\") AS \"stock\"\n           FROM \"public\".\"ps_stock_tienda\"\n           WHERE \"tienda\" <> '99'\n           GROUP BY \"codigo\") s ON s.\"codigo\" = lv.\"codigo\"\nWHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n  AND lv.\"tienda\" <> '99'\nGROUP BY p.\"ccrefejofacm\", p.\"descripcion\"\nORDER BY \"Unidades Netas\" DESC\nLIMIT 30;\n```\n\nThe `COALESCE` on **each** side of the subtraction is mandatory\n([D-057](../DECISIONS.md)): a period with no returns makes the second\n`SUM ... FILTER` `NULL`, `x - NULL` is `NULL`, and `NULL` sorts first in\n`ORDER BY ... DESC` — the top of the ranking becomes the articles with no data.\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Transfers into a store",
    "body": "```sql\nSELECT t.\"fecha_e\"        AS \"Fecha\",\n       t.\"tienda_salida\"  AS \"Origen\",\n       p.\"ccrefejofacm\"   AS \"Referencia\",\n       t.\"talla\"          AS \"Talla\",\n       t.\"unidades_e\"     AS \"Unidades\",\n       t.\"tipo\"           AS \"Tipo\",\n       t.\"concepto\"       AS \"Concepto\"\nFROM \"public\".\"ps_traspasos\" t\nLEFT JOIN \"public\".\"ps_articulos\" p ON t.\"codigo\" = p.\"codigo\"\nWHERE t.\"tienda_entrada\" = '104'\n  AND t.\"entrada\" IS TRUE\n  AND t.\"fecha_e\" BETWEEN :curr_from AND :curr_to\n  AND COALESCE(t.\"tipo\", '') NOT IN ('Apertura', 'Inventario Parcial')\nORDER BY t.\"fecha_e\" DESC\nLIMIT 50;\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Transfer volume by route",
    "body": "```sql\nSELECT t.\"tienda_salida\"  AS \"Origen\",\n       t.\"tienda_entrada\" AS \"Destino\",\n       DATE_TRUNC('month', t.\"fecha_s\") AS \"Mes\",\n       COUNT(*)           AS \"Movimientos\",\n       SUM(t.\"unidades_s\") AS \"Unidades\"\nFROM \"public\".\"ps_traspasos\" t\nWHERE t.\"entrada\" IS FALSE\n  AND t.\"fecha_s\" BETWEEN :curr_from AND :curr_to\n  AND COALESCE(t.\"tipo\", '') NOT IN ('Apertura', 'Inventario Parcial')\nGROUP BY t.\"tienda_salida\", t.\"tienda_entrada\", DATE_TRUNC('month', t.\"fecha_s\")\nORDER BY \"Unidades\" DESC\nLIMIT 15;\n```\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "7. Wholesale Returns (`ps_gc_albaranes`)",
    "body": "In the wholesale channel a return is a **credit note**, flagged on the *header*:\n`ps_gc_albaranes.abono IS TRUE`. `entrada` does not exist there — that is the\nretail discriminator, and using it on GC tables is a column-does-not-exist error.\n\nTwo rules that are easy to get wrong:\n\n- **Line → header joins by `num_albaran` → `reg_albaran`** (both are 4D record\n  ids, despite the `num_` prefix). `n_albaran` is the *visible* document number\n  and is **not unique** — joining on it fans out the result set.\n- **Effective date** of a delivery note is\n  `CASE WHEN fecha_envio >= DATE '2000-01-01' THEN fecha_envio ELSE fecha_valor END`.\n  `fecha_envio` can be NULL or a sentinel; the `CASE` falls back to `fecha_valor`.\n\n```sql\n-- Credit notes by customer\nSELECT c.\"nombre\" AS \"Cliente\",\n       COUNT(*)   AS \"Abonos\",\n       SUM(a.\"base1\" + a.\"base2\" + a.\"base3\") AS \"Importe Neto\",\n       SUM(a.\"entregadas\")                    AS \"Unidades\"\nFROM \"public\".\"ps_gc_albaranes\" a\nJOIN \"public\".\"ps_clientes\" c ON a.\"num_cliente\" = c.\"reg_cliente\"\nWHERE a.\"abono\" IS TRUE\n  AND (CASE WHEN a.\"fecha_envio\" >= DATE '2000-01-01'\n            THEN a.\"fecha_envio\" ELSE a.\"fecha_valor\" END)\n      BETWEEN :curr_from AND :curr_to\n  AND COALESCE(c.\"nif\", '') <> '502108150'   -- tráfico intragrupo, no es venta\nGROUP BY c.\"nombre\"\nORDER BY \"Importe Neto\" DESC\nLIMIT 20;\n```\n\n```sql\n-- Credit-note detail lines\nSELECT l.\"fecha_albaran\" AS \"Fecha\",\n       l.\"codigo\"        AS \"Código\",\n       l.\"descripcion\"   AS \"Descripción\",\n       l.\"unidades\"      AS \"Unidades\",\n       l.\"total\"         AS \"Importe\"\nFROM \"public\".\"ps_gc_lin_albarane\" l\nJOIN \"public\".\"ps_gc_albaranes\" a ON l.\"num_albaran\" = a.\"reg_albaran\"\nWHERE a.\"abono\" IS TRUE\n  AND (CASE WHEN a.\"fecha_envio\" >= DATE '2000-01-01'\n            THEN a.\"fecha_envio\" ELSE a.\"fecha_valor\" END)\n      BETWEEN :curr_from AND :curr_to\nORDER BY l.\"fecha_albaran\" DESC\nLIMIT 50;\n```\n\nAmounts: use `base1 + base2 + base3` (the VAT bases, i.e. sin IVA). There is no\n`total_albaran` column in the mirror.",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Retail returns",
    "body": "```sql\nSELECT v.\"tienda\"        AS \"Tienda\",\n       p.\"ccrefejofacm\"  AS \"Referencia\",\n       lv.\"descripcion\"  AS \"Descripción\",\n       lv.\"talla\"        AS \"Talla\",\n       lv.\"unidades\"     AS \"Unidades\",\n       lv.\"total_si\"     AS \"Importe\",\n       lv.\"fecha_creacion\" AS \"Fecha\"\nFROM \"public\".\"ps_lineas_ventas\" lv\nJOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\"\nLEFT JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\"\nWHERE lv.\"entrada\" IS FALSE\n  AND lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n  AND v.\"tienda\" <> '99'\nORDER BY lv.\"fecha_creacion\" DESC\nLIMIT 50;\n```\n\n`ps_lineas_ventas.entrada` is a line-level copy of the header flag (they agree\n100%), so a returns filter does not need the `ps_ventas` join at all — that\nmissing join was the root cause of the \"returns ignored for months\" bug.\n\nReturn rate per store:\n\n```sql\nSELECT v.\"tienda\" AS \"Tienda\",\n       COALESCE(SUM(lv.\"unidades\") FILTER (WHERE lv.\"entrada\"), 0)     AS \"Vendidas\",\n       COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT lv.\"entrada\"), 0) AS \"Devueltas\",\n       ROUND(COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT lv.\"entrada\"), 0)\n             / NULLIF(COALESCE(SUM(lv.\"unidades\") FILTER (WHERE lv.\"entrada\"), 0), 0) * 100, 1)\n         AS \"% Devolución\"\nFROM \"public\".\"ps_lineas_ventas\" lv\nJOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\"\nWHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n  AND v.\"tienda\" <> '99'\nGROUP BY v.\"tienda\"\nORDER BY \"% Devolución\" DESC;\n```\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Finding it",
    "body": "```sql\n-- Per store and size\nSELECT s.\"tienda\"       AS \"Tienda\",\n       p.\"ccrefejofacm\" AS \"Referencia\",\n       s.\"talla\"        AS \"Talla\",\n       s.\"stock\"        AS \"Stock\"\nFROM \"public\".\"ps_stock_tienda\" s\nJOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\"\nWHERE s.\"stock\" < 0\nORDER BY s.\"stock\" ASC\nLIMIT 20;\n```\n\n```sql\n-- Central warehouse\nSELECT p.\"ccrefejofacm\" AS \"Referencia\",\n       p.\"descripcion\"  AS \"Descripción\",\n       sc.\"stock\"       AS \"Stock Central\"\nFROM \"public\".\"ps_stock_central\" sc\nJOIN \"public\".\"ps_articulos\" p ON sc.\"num_articulo\" = p.\"reg_articulo\"\nWHERE sc.\"stock\" < 0\nORDER BY sc.\"stock\" ASC\nLIMIT 20;\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Stock per store, valued",
    "body": "```sql\nSELECT s.\"tienda\" AS \"Tienda\",\n       COALESCE(NULLIF(t.\"identificador\", ''), NULLIF(t.\"poblacion\", ''),\n                'Tienda ' || s.\"tienda\") AS \"Nombre\",\n       COUNT(DISTINCT s.\"codigo\") AS \"Referencias\",\n       SUM(s.\"stock\")             AS \"Unidades\",\n       ROUND(SUM(s.\"stock\" * p.\"precio_coste\"), 2) AS \"Valor Coste\"\nFROM \"public\".\"ps_stock_tienda\" s\nJOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\"\nLEFT JOIN \"public\".\"ps_tiendas\" t ON t.\"codigo\" = s.\"tienda\"\nWHERE s.\"stock\" > 0 AND s.\"tienda\" <> '99'\nGROUP BY s.\"tienda\",\n         COALESCE(NULLIF(t.\"identificador\", ''), NULLIF(t.\"poblacion\", ''),\n                  'Tienda ' || s.\"tienda\")\nORDER BY \"Unidades\" DESC;\n```\n\n`precio_coste` is already VAT-exclusive — it is the correct valuation basis.",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Stock by family",
    "body": "```sql\nSELECT COALESCE(NULLIF(TRIM(fm.\"fami_grup_marc\"), ''), 'Sin clasificar') AS \"Familia\",\n       SUM(s.\"stock\") AS \"Unidades\",\n       ROUND(SUM(s.\"stock\" * p.\"precio_coste\"), 2) AS \"Valor Coste\"\nFROM \"public\".\"ps_stock_tienda\" s\nJOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\"\nLEFT JOIN \"public\".\"ps_familias\" fm ON p.\"num_familia\" = fm.\"reg_familia\"\nWHERE s.\"stock\" > 0 AND s.\"tienda\" <> '99' AND p.\"anulado\" = false\nGROUP BY 1\nORDER BY \"Unidades\" DESC;\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Stock by season",
    "body": "```sql\nSELECT p.\"clave_temporada\" AS \"Temporada\",\n       COUNT(DISTINCT p.\"ccrefejofacm\") AS \"Referencias\",\n       SUM(s.\"stock\") AS \"Unidades\",\n       ROUND(SUM(s.\"stock\" * p.\"precio_coste\"), 2) AS \"Valor Coste\"\nFROM \"public\".\"ps_stock_tienda\" s\nJOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\"\nWHERE s.\"stock\" > 0 AND p.\"anulado\" = false\nGROUP BY p.\"clave_temporada\"\nORDER BY \"Unidades\" DESC;\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Dead stock — stock on hand, no sales in the period",
    "body": "```sql\nSELECT p.\"ccrefejofacm\"   AS \"Referencia\",\n       p.\"descripcion\"    AS \"Descripción\",\n       p.\"clave_temporada\" AS \"Temporada\",\n       SUM(s.\"stock\")     AS \"Stock\"\nFROM \"public\".\"ps_stock_tienda\" s\nJOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\"\nWHERE s.\"stock\" > 10\n  AND s.\"tienda\" <> '99'\n  AND p.\"anulado\" = false\n  AND NOT EXISTS (SELECT 1\n                  FROM \"public\".\"ps_lineas_ventas\" lv\n                  WHERE lv.\"codigo\" = p.\"codigo\"\n                    AND lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to)\nGROUP BY p.\"ccrefejofacm\", p.\"descripcion\", p.\"clave_temporada\"\nORDER BY \"Stock\" DESC\nLIMIT 30;\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Lost sales — a size that sells but is out of stock",
    "body": "```sql\nWITH vendido AS (\n  SELECT p.\"ccrefejofacm\" AS ref,\n         UPPER(lv.\"talla\") AS talla,\n         COALESCE(SUM(lv.\"unidades\") FILTER (WHERE lv.\"entrada\"), 0)\n           - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT lv.\"entrada\"), 0) AS uds\n  FROM \"public\".\"ps_lineas_ventas\" lv\n  JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\"\n  WHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n    AND lv.\"tienda\" <> '99'\n    AND lv.\"talla\" IS NOT NULL\n  GROUP BY 1, 2\n),\nstock AS (\n  SELECT p.\"ccrefejofacm\" AS ref,\n         UPPER(s.\"talla\") AS talla,\n         SUM(s.\"stock\")   AS stock\n  FROM \"public\".\"ps_stock_tienda\" s\n  JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\"\n  WHERE s.\"tienda\" <> '99'\n  GROUP BY 1, 2\n)\nSELECT v.ref   AS \"Referencia\",\n       v.talla AS \"Talla\",\n       v.uds   AS \"Vendidas\",\n       COALESCE(st.stock, 0) AS \"Stock\"\nFROM vendido v\nLEFT JOIN stock st ON st.ref = v.ref AND st.talla = v.talla\nWHERE v.uds > 0 AND COALESCE(st.stock, 0) <= 0\nORDER BY v.uds DESC\nLIMIT 50;\n```\n\nBoth sides `UPPER()` the size: the ETL normalises, but a join written without it\nis one bad source row away from silently dropping matches.\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "10. What is NOT in the mirror",
    "body": "These questions cannot be answered from `ps_*`. Say so rather than writing a\nquery that looks right and returns a wrong or empty answer.\n\n| Question | Why not | Nearest usable substitute |\n|----------|---------|---------------------------|\n| **Goods received from suppliers** (units per article per delivery) | Purchase *delivery-note lines* are not mirrored. `ps_albaranes` holds only headers (`reg_albaran`, `fecha_recibido`, `num_pedido`, `num_proveedor`, `proveedor`) — no article, no quantity. | `ps_albaranes` gives counts of receipts and which supplier/order they belong to, nothing about what was inside. |\n| **Purchase quantities actually received** | `ps_lineas_compras` (4D `CCLineasCompr`) holds **purchase-order lines — what was ordered, not what arrived**. Treating it as receipts overstates incoming stock by every unmet or partial order. | `ps_lineas_compras` for *ordered* units/amounts, labelled as orders. |\n| **Returns to supplier** | Same gap: they live in the unmirrored purchase-delivery lines. | none |\n| **Full stock reconciliation / shrinkage** | Requires the receipts leg above (§5). | Net sales + transfers + wholesale movement only, stated as partial. |\n| **Per-size stock at the central warehouse** | `ps_stock_central` carries only a per-article total; the 34 size slots are collapsed by the ETL. | Per-size stock for retail stores from `ps_stock_tienda`. |\n| **Minimum / safety stock levels** | 4D `Minimo1..34` is not mirrored, and `ps_articulos` has no `stock_minimo`. | none — do not invent a threshold and present it as the system's. |\n| **Historical stock snapshots** | The mirror holds only the current position; 4D `Inventarios` / `DetalleInventa` are empty and unmirrored. | Movement history from `ps_lineas_ventas` / `ps_traspasos` / `ps_gc_lin_albarane`. |\n| **Real-time stock** | The mirror is refreshed by the nightly ETL. | `ps_stock_*.fecha_modifica` tells you how stale a row is. |\n\nFor the record: what *is* mirrored on the purchasing side is\n`ps_compras` (~2,800 order headers), `ps_lineas_compras` (~46,200 **order**\nlines), `ps_albaranes` (~3,800 receipt headers) and `ps_facturas_compra`\n(~4,000 invoice dates). Ordered volume by supplier, for example, is fine:\n\n```sql\nSELECT pr.\"nombre\" AS \"Proveedor\",\n       COUNT(DISTINCT lc.\"num_pedido\") AS \"Pedidos\",\n       SUM(lc.\"unidades\")              AS \"Unidades Pedidas\",\n       ROUND(SUM(lc.\"total_si\"), 2)    AS \"Importe sin IVA\"\nFROM \"public\".\"ps_lineas_compras\" lc\nLEFT JOIN \"public\".\"ps_proveedores\" pr ON lc.\"num_proveedor\" = pr.\"reg_proveedor\"\nWHERE lc.\"fecha\" BETWEEN :curr_from AND :curr_to\nGROUP BY pr.\"nombre\"\nORDER BY \"Importe sin IVA\" DESC\nLIMIT 20;\n```\n\nLabel such a result **\"pedido\"** (ordered), never \"recibido\" (received).",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Wholesale vs Retail Split in PowerShop",
    "body": "> How to distinguish wholesale (B2B) from retail (B2C) data **in the PostgreSQL\n> mirror** (`ps_*` tables). Covers the M-prefix convention, the POS vs GC\n> channels, and what that implies for reporting.\n>\n> **Dialect.** Every SQL block here is PostgreSQL against the mirror. The 4D ERP\n> names (`Ventas`, `GCAlbaranes`, `CCStock`, `Clientes`…) appear only as lineage\n> — they are not queryable from the dashboard or WrenAI.\n>\n> `:curr_from` / `:curr_to` are the reporting period, bound by the caller.",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "1. Overview",
    "body": "Two sales channels share the same database and the same product/customer\nmasters:\n\n| Aspect | Retail (B2C) | Wholesale (B2B) |\n|--------|-------------|-----------------|\n| **Mirror tables** | `ps_ventas`, `ps_lineas_ventas`, `ps_pagos_ventas` | `ps_gc_pedidos`, `ps_gc_lin_pedidos`, `ps_gc_albaranes`, `ps_gc_lin_albarane`, `ps_gc_facturas`, `ps_gc_lin_facturas` |\n| **Document flow** | Ticket | Order → Delivery note → Invoice |\n| **Return / credit flag** | `entrada = FALSE` (line and header) | `abono IS TRUE` (header only) |\n| **Product codes** | Standard codes | Often `M`-prefixed referencias |\n| **Customers** | `ps_clientes` rows with `ps_ventas` activity | `ps_clientes` rows with `ps_gc_*` activity |\n| **Payments** | `ps_pagos_ventas` | **not mirrored** (§10) |\n| **Amounts sin IVA** | `total_si` | `base1 + base2 + base3` (headers), `total` (invoice lines) |\n| **Stock source** | `ps_stock_tienda` (retail stores) | `ps_stock_central` (central warehouse, store 99) |\n| **Rows** | ~910K tickets, ~1.82M lines | ~52K delivery notes, ~1.05M lines, ~19K invoices |\n\nThe two channels use **different discriminators**, and that is the single\nbiggest source of wrong queries: `entrada` does not exist on GC tables, `abono`\ndoes not exist on retail tables.\n\n---",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "2. The M-Prefix Convention",
    "body": "Referencias starting with **`M`** (e.g. `M12345`) are wholesale/bulk products.\nThe prefix lives on **`ps_articulos.ccrefejofacm`**, the referencia — not on\n`codigo`.\n\n```sql\n-- Retail products only  (ccrefejofacm is nullable — the IS NULL branch matters)\nWHERE p.\"ccrefejofacm\" IS NULL OR p.\"ccrefejofacm\" NOT LIKE 'M%'\n\n-- Wholesale products only\nWHERE p.\"ccrefejofacm\" LIKE 'M%'\n```\n\n```sql\n-- Channel mix of the active catalogue\nSELECT COUNT(*) AS \"Total\",\n       COUNT(*) FILTER (WHERE p.\"ccrefejofacm\" LIKE 'M%') AS \"Mayorista\",\n       COUNT(*) FILTER (WHERE p.\"ccrefejofacm\" IS NULL\n                          OR p.\"ccrefejofacm\" NOT LIKE 'M%') AS \"Retail\"\nFROM \"public\".\"ps_articulos\" p\nWHERE p.\"anulado\" = false;\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Tables",
    "body": "| Table | Rows | Description |\n|-------|------|-------------|\n| `ps_ventas` | ~910K | Ticket headers (`reg_ventas` PK) |\n| `ps_lineas_ventas` | ~1.82M | Ticket lines (`num_ventas` → `ps_ventas.reg_ventas`) |\n| `ps_pagos_ventas` | ~964K | Payment records (`num_ventas` → `ps_ventas.reg_ventas`) |",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Key queries",
    "body": "```sql\n-- Net retail revenue for the period\nSELECT COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0)\n         - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\"\nFROM \"public\".\"ps_ventas\" v\nWHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n  AND v.\"tienda\" <> '99';\n```\n\n```sql\n-- Net revenue from non-M products only (pure retail)\nSELECT COALESCE(SUM(lv.\"total_si\") FILTER (WHERE lv.\"entrada\"), 0)\n         - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT lv.\"entrada\"), 0)\n         AS \"Ventas Netas Retail Puro\"\nFROM \"public\".\"ps_lineas_ventas\" lv\nJOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\"\nWHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n  AND lv.\"tienda\" <> '99'\n  AND (p.\"ccrefejofacm\" IS NULL OR p.\"ccrefejofacm\" NOT LIKE 'M%');\n```\n\nBoth `COALESCE`s are mandatory: without them a period with no returns yields\n`NULL`, and `NULL` sorts first in a `DESC` ranking\n([D-057](decisions/D-057-ventas-netas-de-devoluciones.md)).\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Tables",
    "body": "| Table | Rows | PK | Line → header key |\n|-------|------|----|-------------------|\n| `ps_gc_pedidos` | ~101 | `reg_pedido` | `ps_gc_lin_pedidos.num_pedido` |\n| `ps_gc_lin_pedidos` | ~2.6K | `reg_linea` | |\n| `ps_gc_albaranes` | ~52K | `reg_albaran` | `ps_gc_lin_albarane.num_albaran` |\n| `ps_gc_lin_albarane` | ~1.05M | `reg_linea` | |\n| `ps_gc_facturas` | ~19K | `reg_factura` | `ps_gc_lin_facturas.num_factura` |\n| `ps_gc_lin_facturas` | ~1.01M | `reg_linea` | |\n| `ps_gc_comerciales` | 5 | `reg_comercial` | via `num_comercial` on headers |\n\n**Join lines to headers by `num_albaran` → `reg_albaran` and\n`num_factura` → `reg_factura`.** Despite the `num_` prefix these are 4D record\nids. The `n_albaran` / `n_factura` columns are the *visible document numbers* and\nare **not unique** — joining on them fans the result set out and inflates every\ntotal.",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Document flow",
    "body": "```\nps_gc_pedidos (order)\n    -> ps_gc_albaranes (delivery note — goods shipped)\n        -> ps_gc_facturas (invoice)\n            -> [collection — NOT MIRRORED, see §10]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Key queries",
    "body": "```sql\n-- Net invoicing for the period\nSELECT COUNT(*) FILTER (WHERE f.\"abono\" IS NOT TRUE) AS \"Facturas\",\n       COALESCE(SUM(f.\"base1\" + f.\"base2\" + f.\"base3\") FILTER (WHERE f.\"abono\" IS NOT TRUE), 0)\n         - COALESCE(SUM(f.\"base1\" + f.\"base2\" + f.\"base3\") FILTER (WHERE f.\"abono\" IS TRUE), 0)\n         AS \"Facturación Neta\"\nFROM \"public\".\"ps_gc_facturas\" f\nWHERE f.\"fecha_factura\" BETWEEN :curr_from AND :curr_to;\n```\n\n```sql\n-- Net delivery-note volume, intragroup traffic excluded\nSELECT COUNT(*) FILTER (WHERE a.\"abono\" IS NOT TRUE) AS \"Albaranes\",\n       COALESCE(SUM(a.\"entregadas\") FILTER (WHERE a.\"abono\" IS NOT TRUE), 0)\n         - COALESCE(SUM(a.\"entregadas\") FILTER (WHERE a.\"abono\" IS TRUE), 0) AS \"Unidades Netas\",\n       COALESCE(SUM(a.\"base1\" + a.\"base2\" + a.\"base3\") FILTER (WHERE a.\"abono\" IS NOT TRUE), 0)\n         - COALESCE(SUM(a.\"base1\" + a.\"base2\" + a.\"base3\") FILTER (WHERE a.\"abono\" IS TRUE), 0)\n         AS \"Importe Neto\"\nFROM \"public\".\"ps_gc_albaranes\" a\nLEFT JOIN \"public\".\"ps_clientes\" c ON a.\"num_cliente\" = c.\"reg_cliente\"\nWHERE (CASE WHEN a.\"fecha_envio\" >= DATE '2000-01-01'\n            THEN a.\"fecha_envio\" ELSE a.\"fecha_valor\" END)\n      BETWEEN :curr_from AND :curr_to\n  AND COALESCE(c.\"nif\", '') <> '502108150';   -- tráfico intragrupo, no es venta\n```\n\n```sql\n-- Top wholesale references by net invoiced amount\nSELECT p.\"ccrefejofacm\" AS \"Referencia\",\n       p.\"descripcion\"  AS \"Descripción\",\n       COALESCE(SUM(lf.\"unidades\") FILTER (WHERE f.\"abono\" IS NOT TRUE), 0)\n         - COALESCE(SUM(lf.\"unidades\") FILTER (WHERE f.\"abono\" IS TRUE), 0) AS \"Unidades Netas\",\n       COALESCE(SUM(lf.\"total\") FILTER (WHERE f.\"abono\" IS NOT TRUE), 0)\n         - COALESCE(SUM(lf.\"total\") FILTER (WHERE f.\"abono\" IS TRUE), 0) AS \"Importe Neto\"\nFROM \"public\".\"ps_gc_lin_facturas\" lf\nJOIN \"public\".\"ps_gc_facturas\" f ON lf.\"num_factura\" = f.\"reg_factura\"\nJOIN \"public\".\"ps_articulos\" p ON lf.\"codigo\" = p.\"codigo\"\nWHERE f.\"fecha_factura\" BETWEEN :curr_from AND :curr_to\nGROUP BY p.\"ccrefejofacm\", p.\"descripcion\"\nORDER BY \"Importe Neto\" DESC\nLIMIT 20;\n```\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "5. Stock by Channel",
    "body": "| Location | Mirror table | Store | Channel served |\n|----------|--------------|-------|----------------|\n| Central warehouse | `ps_stock_central` | 99 | Primarily wholesale |\n| Retail stores | `ps_stock_tienda` | all except 99 | Retail |\n\n**Store `'99'` does not appear in `ps_stock_tienda`.** Looking for central stock\nthere returns zero rows — no error, just a silently wrong answer.\n\n```\nSupplier -> [purchase receipt — NOT MIRRORED, §10] -> ps_stock_central\n                -> ps_traspasos -> ps_stock_tienda   (to the shops)\n                -> ps_gc_albaranes -> customer        (wholesale shipment)\n```\n\n```sql\nSELECT (SELECT COALESCE(SUM(sc.\"stock\"), 0)\n        FROM \"public\".\"ps_stock_central\" sc\n        WHERE sc.\"stock\" > 0) AS \"Central (mayorista)\",\n       (SELECT COALESCE(SUM(s.\"stock\"), 0)\n        FROM \"public\".\"ps_stock_tienda\" s\n        WHERE s.\"stock\" > 0 AND s.\"tienda\" <> '99') AS \"Tiendas (retail)\";\n```\n\nNote the two different join keys to the catalogue:\n`ps_stock_central.num_articulo = ps_articulos.reg_articulo`, but\n`ps_stock_tienda.codigo = ps_articulos.codigo`. Full stock cookbook in\n[stock-analysis.md](stock-analysis.md).\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "6. Customers by Channel",
    "body": "**`ps_clientes` has no `mayorista` flag and no `anulado` flag.** Channel is\ndetermined by *where the customer transacts*, not by an attribute on the\ncustomer. Any query filtering `WHERE mayorista = TRUE` is written against the 4D\n`Clientes` table and fails here.\n\n```sql\nSELECT COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM \"public\".\"ps_ventas\" v\n                                      WHERE v.\"num_cliente\" = c.\"reg_cliente\")) AS \"Con Retail\",\n       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM \"public\".\"ps_gc_albaranes\" a\n                                      WHERE a.\"num_cliente\" = c.\"reg_cliente\")) AS \"Con Mayorista\",\n       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM \"public\".\"ps_ventas\" v\n                                      WHERE v.\"num_cliente\" = c.\"reg_cliente\")\n                          AND EXISTS (SELECT 1 FROM \"public\".\"ps_gc_albaranes\" a\n                                      WHERE a.\"num_cliente\" = c.\"reg_cliente\")) AS \"Ambos Canales\"\nFROM \"public\".\"ps_clientes\" c;\n```\n\nAvailable columns are `reg_cliente`, `num_cliente`, `nombre`, `nif`, `email`,\n`codigo_postal`, `poblacion`, `pais`, `fecha_creacion`, `fecha_modifica`,\n`ultima_compra_f`. Credit terms, discounts, credit limits, assigned sales rep and\nVAT-regime flags are **not** mirrored — the sales rep is available on the\n*documents* instead (`ps_gc_albaranes.num_comercial` /\n`ps_gc_facturas.num_comercial` → `ps_gc_comerciales.reg_comercial`).\n\nNIF `502108150` (19 rows) is intragroup traffic, not a customer — exclude it from\nwholesale rankings.\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Retail payments — `ps_pagos_ventas`",
    "body": "| Column | Description |\n|--------|-------------|\n| `importe_cob` | Amount charged (**use this**; includes VAT, matches `ps_ventas.total`) |\n| `forma` | Payment method name, already human-readable |\n| `codigo_forma` | Method code (`'01'` = cash) |\n| `entrada` | `FALSE` on refunds — net them out |\n| `tienda`, `fecha_creacion` | |\n\n```sql\nSELECT p.\"forma\" AS \"Forma de Pago\",\n       COUNT(*)  AS \"Movimientos\",\n       COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE p.\"entrada\"), 0)\n         - COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE NOT p.\"entrada\"), 0) AS \"Importe Cobrado\"\nFROM \"public\".\"ps_pagos_ventas\" p\nWHERE p.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n  AND p.\"tienda\" <> '99'\nGROUP BY p.\"forma\"\nORDER BY \"Importe Cobrado\" DESC;\n```\n\n`forma` values seen in production: `Metálico`, `American Express`, `Metalico`,\n`Visa`, `Devolución Vale`, `Vale`, `Devolución Metálico`, `MasterCard`,\n`Maestro`, `Transferencia`, `Pago PowerShop B2C`, `Cheque`. Note `Metálico` and\n`Metalico` both occur — fold them before presenting a mix. There is no\n`FormasPago` lookup table in the mirror and no code→name mapping is needed.\n\n`importe_cob` includes VAT. Use it for payment-mix and cash-control questions;\nuse `ps_ventas.total_si` when the question is about revenue.",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Revenue",
    "body": "| Report | Source | Expression |\n|--------|--------|------------|\n| Retail revenue | `ps_ventas` / `ps_lineas_ventas` | net over `total_si` by `entrada`, `tienda <> '99'` |\n| Wholesale revenue | `ps_gc_facturas` | net over `base1+base2+base3` by `abono` |\n| Pure retail | `ps_lineas_ventas` + `ps_articulos` | as above, plus `ccrefejofacm` not `M%` (with the `IS NULL` branch) |\n| Group total | both | sum the two nets; both are already sin IVA |",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Margin",
    "body": "| Channel | Revenue | Cost |\n|---------|---------|------|\n| Retail | `ps_lineas_ventas.total_si` | `ps_lineas_ventas.total_coste_si` |\n| Wholesale | `ps_gc_lin_facturas.total` | `ps_gc_lin_facturas.total_coste` |\n\nBoth sides must be netted by the channel's own discriminator — netting revenue\nbut not cost inflates margin on any period with returns.",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Units",
    "body": "| Channel | Table | Field |\n|---------|-------|-------|\n| Retail | `ps_lineas_ventas` | `unidades`, netted by `entrada` |\n| Wholesale | `ps_gc_lin_facturas` / `ps_gc_lin_albarane` | `unidades`, netted by the header's `abono` |",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Dates",
    "body": "| Channel | Date column |\n|---------|-------------|\n| Retail | `ps_ventas.fecha_creacion` / `ps_lineas_ventas.fecha_creacion` (both populated, no NULLs) |\n| Wholesale — invoice | `ps_gc_facturas.fecha_factura` |\n| Wholesale — delivery note | the `CASE` on `fecha_envio` / `fecha_valor` (§4) |\n\n`ps_lineas_ventas.mes` (YYYYMM integer) and `ps_gc_lin_facturas.mes` exist as\nfast filters, but prefer the real date columns — `DATE_TRUNC('month', ...)` is\nindexed-friendly enough and does not need a second format to keep in sync.\n\n---",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "7. Store 99 in retail reports",
    "body": "```sql\nSELECT v.\"tienda\" AS \"Tienda\",\n       COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0)\n         - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\"\nFROM \"public\".\"ps_ventas\" v\nWHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n  AND v.\"tienda\" <> '99'\nGROUP BY v.\"tienda\"\nORDER BY \"Ventas Netas\" DESC;\n```\n\nStore `'97'` is the online shop — a real retail store, keep it.",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "10. What is not mirrored",
    "body": "| Wanted | Status | Substitute |\n|--------|--------|------------|\n| **Wholesale collections / receivables / ageing** | `CobrosFacturas` has no `ps_*` table. | Invoiced amount from `ps_gc_facturas`; state that collection data is unavailable. |\n| **Customer channel flag, credit terms, discount, credit limit, VAT-regime flags** | Not mirrored on `ps_clientes`. | Channel by transaction table (§6); sales rep via `num_comercial` on the documents. |\n| **Per-size wholesale quantities** | 4D `Entregadas1..34` is not unpivoted into `ps_gc_lin_albarane`. | Line-level `unidades` only. |\n| **Purchase receipts (goods in)** | Purchase delivery-note *lines* are not mirrored; `ps_albaranes` is headers only. | `ps_lineas_compras` = **orders placed**, never receipts — label it \"pedido\". |\n| **`Facturas` (retail formal invoices) detail** | `ps_facturas` holds dates only (`reg_factura`, `fecha_factura`, `fecha_modifica`). | Ticket-level data from `ps_ventas`. |\n| **Register sessions (`Cajas`)** | Not mirrored. | `ps_pagos_ventas` by store and date. |\n\n---",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Summary Decision Tree",
    "body": "```\nQ: What channel is this data from?\n|\n+-- Table starts with \"ps_gc_\"? -> Wholesale\n|   (discriminator: header abono; line->header by reg_* id)\n|\n+-- ps_ventas / ps_lineas_ventas / ps_pagos_ventas? -> Retail (POS)\n|   (discriminator: entrada; exclude tienda '99')\n|\n+-- ps_articulos? -> Both channels\n|   (split by ccrefejofacm LIKE / NOT LIKE 'M%', with the IS NULL branch)\n|\n+-- ps_clientes? -> Both channels\n|   (no flag on the row — decide by which transaction table has activity)\n|\n+-- ps_stock_central? -> Central warehouse (store 99), serves wholesale\n+-- ps_stock_tienda?  -> Retail stores only (never contains '99')\n|\n+-- ps_traspasos? -> Stock operations between stores (supports both)\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/data-dictionary.md",
    "heading": "Table of Contents",
    "body": "1. [Naming Conventions](#naming-conventions)\n2. [Primary Key Pattern (.99 Suffix)](#primary-key-pattern)\n3. [Articulos -- Product Master](#articulos)\n4. [Ventas -- POS Ticket Headers](#ventas)\n5. [LineasVentas -- POS Ticket Lines](#lineasventas)\n6. [PagosVentas -- POS Payments](#pagosventas)\n7. [Clientes -- Customer Master](#clientes)\n8. [Tiendas -- Store Master](#tiendas)\n9. [GCAlbaranes -- Wholesale Delivery Notes](#gcalbaranes)\n10. [GCLinAlbarane -- Wholesale Delivery Note Lines](#gclinalbarane)\n11. [GCFacturas -- Wholesale Invoices](#gcfacturas)\n12. [Traspasos -- Stock Transfers](#traspasos)\n13. [CCStock -- Central Warehouse Stock](#ccstock)\n14. [Exportaciones -- Retail Store Stock](#exportaciones)\n15. [FamiGrupMarc -- Family/Group Classification](#famigrupmarc)\n16. [FormasPago -- Payment Methods](#formaspago)\n17. [Proveedores -- Supplier Master](#proveedores)\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/data-dictionary.md",
    "heading": "Primary Key Pattern",
    "body": "PowerShop uses **Real (float)** fields as primary keys with a special `.99` suffix convention:\n\n- `Articulos.RegArticulo` = `534.99` -- the `.99` encodes store affiliation\n- `Ventas.RegVentas` = `12345.155` -- the `.155` encodes store code\n- `Clientes.RegCliente` = `678.99` -- `.99` = central record\n\nThis encoding allows implicit store-level filtering without a separate store column in some queries. Foreign keys reference these same float values:\n\n```\nLineasVentas.NumVentas -> Ventas.RegVentas\nLineasVentas.NumArticulo -> Articulos.RegArticulo\nVentas.NumCliente -> Clientes.RegCliente\nGCAlbaranes.NumCliente -> Clientes.RegCliente\n```\n\n**Important**: Do not perform arithmetic on PK values. They should be treated as opaque identifiers that happen to be stored as floats.\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/data-dictionary.md",
    "heading": "Grain: a row is model + colour, not a SKU",
    "body": "One `Articulos` row is **a model in one colour**, not a sellable SKU. The last two\ncharacters of `CCRefeJOFACM` encode the colour (`V26212484` -> colour `84`).\n\nSize is **not** a column of `Articulos`. Size lives:\n\n- on the sale line, in 4D, as `LineasVentas.CCOPTallaOjo` (100 % populated);\n- in the PostgreSQL mirror, in `ps_lineas_ventas.talla`, `ps_stock_tienda.talla`\n  and `ps_traspasos.talla`.\n\n`ps_lineas_ventas.talla` mirrors `CCOPTallaOjo` desde 2026-08, **normalizada a\nMAYÚSCULAS en el ETL**. No es una rareza aislada: medido contra el 4D vivo sobre\n60.000 líneas, **9 de los 29 valores distintos** de `CCOPTallaOjo` llevan\nminúsculas (`'m'` ×330, `'l'` ×282, `'u'` ×270, `'xl'` ×241, `'xxl'` ×164,\n`'s'` ×133). Sin normalizar, cada talla se parte en dos y el ranking cambia:\nen el artículo `I26101833` la más vendida sale **M (9 uds)** porque L queda\ndividida en `'L'` (8) y `'l'` (3); normalizando gana **L con 11**. Las filas anteriores a la\nresincronización tienen la columna vacía, así que conviene filtrar\n`talla IS NOT NULL` en análisis históricos.",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/data-dictionary.md",
    "heading": "Stock",
    "body": "| Field | Type | Description |\n|-------|------|-------------|\n| Stock | Real | Total stock across all stores (aggregate) |\n| StockInicial | Real | Initial stock at start of period |\n| StockMinimo | Real | Reorder threshold |\n| StockMaximo | Real | Maximum stock level |\n\n**Note**: Articulos.Stock is a denormalized aggregate. For per-store stock, use CCStock (store 99/central) and Exportaciones (retail stores).\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/data-dictionary.md",
    "heading": "Key Relationships",
    "body": "```\nVentas.RegVentas -> LineasVentas.NumVentas (1:N)\nVentas.RegVentas -> PagosVentas.NumVentas (1:N)\nVentas.NumCliente -> Clientes.RegCliente\n```\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/data-dictionary.md",
    "heading": "Relationship to CCStock",
    "body": "| Table | Store | Description |\n|-------|-------|-------------|\n| CCStock | 99 (central) | One row per product |\n| Exportaciones | All others | One row per product per store |\n\n**Store 99 never appears in Exportaciones.** To get total stock for a product:\n```\nTotal Stock = CCStock.Stock (central) + SUM(Exportaciones.STStock) per store\n```",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/data-dictionary.md",
    "heading": "LLM:rules",
    "body": "Reglas de negocio derivadas de este diccionario, compiladas al bundle de\nconocimiento (`dashboard/lib/knowledge.ts`) y a WrenAI. Editar aqui, no alli.\n\n```json\n[\n  {\n    \"instruction\": \"Los nombres de tablas y columnas de PowerShop estan en espanol. Equivalencias basicas: Ventas=tickets de venta, LineasVentas=lineas de ticket, PagosVentas=cobros, Compras=pedidos de compra, Albaranes=albaranes, Facturas=facturas, Traspasos=movimientos entre tiendas, Tienda=tienda, Cajero=cajero, Proveedor=proveedor, Articulo=producto, Unidades=cantidad, Importe=importe monetario, Abono=nota de credito o devolucion.\",\n    \"questions\": [\n      \"que significa LineasVentas\",\n      \"que quiere decir abono\",\n      \"glosario de nombres de tablas\"\n    ]\n  },\n  {\n    \"instruction\": \"Prefijos de columna en PowerShop: 'Reg' = clave primaria del registro (RegVentas, RegArticulo); 'Num' = clave ajena a otra tabla (NumCliente -> Clientes.RegCliente); 'N' = numero de documento visible y NO unico (NDocumento, NAlbaran); 'P' = porcentaje (PIva); 'I' = importe (IIva1); 'Clave' = codigo corto; 'Libre' = campo libre configurable por el cliente. En el espejo PostgreSQL estos nombres van en snake_case: RegVentas -> reg_ventas, NumCliente -> num_cliente.\",\n    \"questions\": [\n      \"que significa el prefijo Num\",\n      \"diferencia entre Reg y Num\",\n      \"como se traducen los nombres al espejo\"\n    ]\n  },\n  {\n    \"instruction\": \"Sufijos de importe: 'SI' = Sin Impuestos (sin IVA) y es SIEMPRE la medida de analisis; 'CI' = con costes de importacion; 'Bruto' = antes de descuentos; 'Neto' = despues de descuentos; 'Cob' = cobrado; 'Ent' = entregado o entregado en efectivo. Para facturacion e ingresos usa total_si, nunca total. En ps_pagos_ventas usa importe_cob (lo realmente cobrado), nunca importe_ent (lo entregado por el cliente, que incluye el cambio).\",\n    \"questions\": [\n      \"total o total_si\",\n      \"que significa SI en TotalSI\",\n      \"importe_cob o importe_ent\"\n    ]\n  },\n  {\n    \"instruction\": \"Las claves primarias de PowerShop son numeros Real con sufijo decimal (RegArticulo=534.99, RegVentas=12345.155) donde los decimales codifican la tienda. En el espejo se guardan como NUMERIC, nunca como FLOAT8. Son identificadores OPACOS: no hagas aritmetica, ni sumas, ni comparaciones de rango, ni CAST a entero sobre ellos. Usalos solo para igualdad en JOINs.\",\n    \"questions\": [\n      \"por que las claves tienen .99\",\n      \"puedo sumar reg_articulo\",\n      \"patron de clave primaria\"\n    ]\n  },\n  {\n    \"instruction\": \"En ps_articulos, 'codigo' NO es la referencia de negocio: contiene un codigo interno corto ('169', '168'). La referencia que usa el negocio es 'ccrefejofacm' (ej. 'V26212484'). Usa 'codigo' solo como clave de JOIN (ps_lineas_ventas.codigo, ps_stock_tienda.codigo) y muestra SIEMPRE 'ccrefejofacm' como etiqueta del producto al usuario.\",\n    \"questions\": [\n      \"cual es la referencia de un articulo\",\n      \"que es ccrefejofacm\",\n      \"como identifico un producto\"\n    ]\n  },\n  {\n    \"instruction\": \"Una fila de ps_articulos es un modelo EN UN COLOR, no un SKU vendible. Los dos ultimos caracteres de ccrefejofacm codifican el color. La talla NO esta en ps_articulos ni en ps_lineas_ventas: en 4D vive en LineasVentas.CCOPTallaOjo (poblada al 100%) pero NO esta replicada en el espejo. En PostgreSQL solo hay talla en ps_stock_tienda.talla y ps_traspasos.talla. Nunca inventes una columna talla en ps_lineas_ventas.\",\n    \"questions\": [\n      \"ventas por talla\",\n      \"que granularidad tiene ps_articulos\",\n      \"donde esta la talla\"\n    ]\n  },\n  {\n    \"instruction\": \"Semantica de 'entrada': entrada = true es una venta (dinero que entra), entrada = false es una devolucion (dinero que sale, con el importe guardado en POSITIVO). En ps_ventas y ps_pagos_ventas existe la columna 'entrada'; en ps_lineas_ventas NO existe, hay que unir con ps_ventas por lv.num_ventas = v.reg_ventas para obtenerla.\",\n    \"questions\": [\n      \"que es entrada\",\n      \"como distingo una devolucio",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/etl-sync-strategy.md",
    "heading": "Key findings",
    "body": "- **Ventas/LineasVentas/PagosVentas are NOT append-only.** 19–21% of historical records have `FechaModifica > FechaCreacion`, caused by returns, TBAI fiscal corrections, and payment flag updates. All three tables require **UPSERT by `FechaModifica`**.\n- **`FechaDocumento` is NULL for all records in Ventas.** Never use it as a delta field. Use `FechaModifica` or `FechaCreacion`.\n- **`LineasCompras` exists but is empty (0 rows, 57 columns).** The populated purchase-order line table is `CCLineasCompr` (44K rows), linked to `Compras` via `NumPedido`. Earlier revisions claimed `LineasCompras` \"does not exist\" — it does; querying it just returns nothing.\n- **`Exportaciones.TiendaCodigo`** has the format `\"tienda/articulo\"` (e.g. `\"104/169\"`), not just a store code. The compound PK is `(Codigo, TiendaCodigo)`.\n- **PKs are REAL (float) with `.99` suffix** (e.g. `RegVentas = 10028816.641`). Store as `NUMERIC` in PostgreSQL, not `FLOAT8`, to avoid precision loss.\n- **Referencia prefix `MA` = material (no inventory).** Articles whose `CCRefeJOFACM` starts with `MA` are materials (bolsas, perchas, etc.) — no stock tracking, no inventory management. Exclude from stock analysis and sales KPIs. `M` (non-MA) = wholesale. No prefix = retail.\n- **MA articles (materials) excluded at ETL level.** Articles whose `CCRefeJOFACM` starts with `'MA'` are filtered from the 4D extraction query in `sync_articulos` (`WHERE LEFT(CCRefeJOFACM, 2) <> 'MA'`). After each full sync, a cascade cleanup step also removes MA-linked rows from line-item tables (`ps_lineas_ventas`, `ps_stock_tienda`, `ps_gc_lin_albarane`, `ps_gc_lin_facturas`) using `get_ma_article_codes()` in `etl/sync/articulos.py`. This eliminates the need for `MA%` filtering in all downstream queries and WrenAI instructions.\n- **All 41K Articulos have `FechaModifica >= 2025-03-26`** due to a batch update. Delta sync is ineffective; use full refresh.\n- **GCLinAlbarane and GCLinFacturas have no modification timestamp.** Delta is derived from the parent header's `Modifica` field via a parent-join strategy.",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/etl-sync-strategy.md",
    "heading": "Learnings from first production sync (2026-03-31)",
    "body": "- **NUMERIC(20,3) not (20,2)** for PKs. Some 4D PKs have 3 decimal places (e.g. `RegCliente = 4.152, 4.153`). Scale 2 rounded them and caused duplicate-key violations.\n- **4D SQL `!=` not supported** — use `<>`. This broke `get_queryable_columns()` and all tables using it (Compras, Facturas, Albaranes, FacturasCompra).\n- **Exportaciones needs progressive sync by store** — single 2M-row fetch OOMs. Fetch per-store (`WHERE Tienda = 'X'`): 50 stores × ~41K rows × ~80s = ~67 min total. Each store normalizes to ~247K rows (6 tallas avg).\n- **Single-query is still correct for tables <2M rows** — Ventas (911K, 16 min), LineasVentas (1.7M, 30 min), PagosVentas (965K, 14 min) all completed with single-fetch. LIMIT/OFFSET is never correct for 4D (re-scans from row 0 at each offset).\n- **GCLinAlbarane missing columns**: `NumComercial` and `Mes` don't exist in GCLinAlbarane (they do in GCLinFacturas). Column lists must be verified per table.\n- **GCAlbaranes has `Unidades` not `Entregadas`** — column name mismatch from the architecture docs.\n- **n_albaran/n_factura are NOT unique** — multiple documents can share the same number (different series). UNIQUE indexes and FK constraints on these fail.\n- **NUL byte padding** in 4D text fields — fixed-length fields come with `\\x00` padding.\n- **p4d cursor.description returns bytes** — column names are `b'REGARTICULO'`, not str.\n- **TRUNCATE CASCADE needed** when FK constraints exist between full-refresh tables.\n- **Full initial load time**: ~2.5 hours total (Ventas chain ~60 min, GC chain ~50 min, Stock ~67 min, rest ~15 min).\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/etl-sync-strategy.md",
    "heading": "Ventas domain (retail POS)",
    "body": "| Table | Rows | PK | Delta field | Strategy |\n|-------|------|----|-------------|---------|\n| Ventas | 911,619 | `RegVentas` | `FechaModifica` (max = today) | UPSERT delta |\n| LineasVentas | 1,689,796 | `RegLineas` | `FechaModifica` (max = today) | UPSERT delta |\n| PagosVentas | 964,971 | `RegPagos` | `FechaModifica` (max = today) | UPSERT delta |\n\n**Daily volume:** ~454 Ventas + ~897 LineasVentas new/modified per day.\n\n```sql\n-- Delta pattern for all three tables\nSELECT ... FROM Ventas WHERE FechaModifica > :last_sync\n-- → UPSERT INTO ps_ventas ON CONFLICT (reg_ventas) DO UPDATE SET ...\n```\n\n**Why UPSERT and not INSERT?**\n- 177,530 Ventas records modified since 2025-01-01 (19% of total)\n- 356,505 LineasVentas records modified since 2025-01-01 (21% of total)\n- 188,859 PagosVentas records modified since 2025-01-01 (20% of total)\n\n**FK chain:** `LineasVentas.NumVentas` → `Ventas.RegVentas`, `PagosVentas.NumVentas` → `Ventas.RegVentas`\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/etl-sync-strategy.md",
    "heading": "Stock domain",
    "body": "| Table | Rows | PK | Delta field | Strategy |\n|-------|------|----|-------------|---------|\n| Exportaciones | 2,058,201 | `(Codigo, TiendaCodigo)` compound | `FechaModifica` (some NULLs for zero-stock articles) | UPSERT delta + normalize |\n| Traspasos | 262,689 | `RegTraspaso` | `FechaS` (send date) | Append-only by `FechaS` |\n| CCStock | 41,478 | `NumArticulo` (Real) | None | Full refresh nightly → `ps_stock_central` |\n\n**Exportaciones normalization:** The source table is wide-format (Talla1..Talla34 + Stock1..Stock34 per row). `_USER_COLUMNS` shows every **`Stock1`…`Stock34`** as **`DATA_TYPE = 3`**, **`DATA_LENGTH = 2`** (16-bit integer). Through **4D SQL / p4d**, slot values can arrive as **unsigned** (`65535` for `−1`); ETL applies **`decode_signed_int16_word()`** (`etl/db/fourd.py`) before `int` cast so `ps_stock_tienda.stock` matches native/POS signed semantics. **`CCStock`** on the same row (the `Exportaciones.CCStock` column) is **Real** and already carries the signed row total.\n\n`TiendaCodigo` format: `\"104/169\"` = store 104 / article 169. The compound `(Codigo, TiendaCodigo)` is the natural PK — verified by row count.\n\n**Traspasos:** Only 153 rows since 2025-01-01 (mostly historical log). No `FechaModifica`. Records appear immutable once created. Append-only by `FechaS`. Initial load covers all 262K rows.\n\n**CCStock (central warehouse, confirmed 2026-05-01):** One row per article (41 478 rows). `NumArticulo` is the PK (Real, .99 suffix). `Stock1..Stock34` are **`DATA_TYPE=3, DATA_LENGTH=2`** (16-bit WORD) — same type as `Exportaciones.StockN`. `decode_signed_int16_word()` is applied before summing. The root-level `Stock` column (Real, type 6) is the 4D-maintained total but we recompute from slots for accuracy. No delta field: full refresh is fast at 41K rows. Mirror: `ps_stock_central(num_articulo, stock, fecha_modifica)`.\n\n---",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/etl-sync-strategy.md",
    "heading": "Wholesale domain (Gestión Comercial)",
    "body": "| Table | Rows | PK | Delta field | Strategy |\n|-------|------|----|-------------|---------|\n| GCAlbaranes | 48,948 | `RegAlbaran` | `Modifica` (max = today, ~19/day) | UPSERT delta |\n| GCLinAlbarane | 1,016,290 | `RegLinea` | **None** — derive from parent | Delete+reinsert via parent |\n| GCFacturas | 18,060 | `RegFactura` | `Modifica` (all 18K populated) | UPSERT delta |\n| GCLinFacturas | 974,742 | `RegLinea` | **None** — derive from parent | Delete+reinsert via parent |\n| GCPedidos | 101 | `RegPedido` | `Modifica` (available) | Full refresh (trivially small) |\n| GCLinPedidos | 2,645 | `RegLinea` | None | Full refresh (trivially small) |\n\n**Parent-join delta pattern for lines:**\n```sql\n-- Fetch lines for recently modified delivery notes.\n-- The parent key is the 4D record ID (RegAlbaran), never the visible NAlbaran.\nSELECT * FROM GCLinAlbarane\nWHERE NumAlbaran IN (\n    SELECT RegAlbaran FROM GCAlbaranes WHERE Modifica >= :last_sync\n)\n-- → DELETE FROM ps_gc_lin_albarane WHERE num_albaran = ANY(:changed_reg_albaran)\n-- → INSERT INTO ps_gc_lin_albarane ...\n```\n\n**Line → header join key (corrected 2026-08-29):**\nDespite the `Num` prefix, the line tables carry the parent's **4D record ID**:\n- `GCLinAlbarane.NumAlbaran` → `GCAlbaranes.RegAlbaran` (4000/4000 on a production sample)\n- `GCLinFacturas.NumFactura` → `GCFacturas.RegFactura` (4000/4000)\n\nThe *visible* document numbers are the wrong key on both counts:\n`GCLinFacturas.NumFactura` matches `GCFacturas.NFactura` **0/4000**, and neither\nvisible number is unique (52,148 GCAlbaranes rows carry 40,727 distinct\n`NAlbaran` values; 19,351 GCFacturas rows carry 14,515 distinct `NFactura`\nvalues), so joining on them mixes lines from unrelated documents.  The ETL used\nthe visible numbers until 2026-08-29: the invoice-line delta re-inserted 0 rows\non every nightly run, and the mirror had drifted 1,873 invoice lines and 3,826\ndelivery-note lines behind 4D.\n\n**GCAlbaranes daily volume:** ~19 modified/day, ~833/month. Lines delta is lightweight.\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/etl-sync-strategy.md",
    "heading": "Nightly execution order",
    "body": "Tables must be synced in topological order (dimensions before facts):\n\n1. Catalog: Articulos, FamiGrupMarc, CCOPColores, CCOPTempTipo, DepaSeccFabr\n2. Masters: Tiendas, Clientes, Proveedores, GCComerciales\n3. Stock: Exportaciones\n4. Retail: Ventas → LineasVentas → PagosVentas\n5. Wholesale: GCAlbaranes → GCLinAlbarane | GCFacturas → GCLinFacturas | GCPedidos → GCLinPedidos\n6. Purchasing: Compras → CCLineasCompr → Facturas → Albaranes → FacturasCompra\n7. Movements: Traspasos",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/etl-sync-strategy.md",
    "heading": "LLM:rules",
    "body": "Business rules and field conventions the dashboard LLM must follow when generating SQL against the `ps_*` mirror tables.\n\n```json\n[\n  {\n    \"instruction\": \"Siempre usar el campo total_si (sin IVA) para análisis económico de ventas retail. NUNCA usar el campo total que incluye IVA. El IVA varía por región (23% Portugal continental, 22% Madeira, 21% España) y distorsiona las comparaciones entre tiendas.\",\n    \"questions\": [\"¿Cuánto vendimos?\", \"¿Cuáles son las ventas netas?\", \"¿Cuál es la facturación?\", \"¿Cuántos ingresos tuvimos este mes?\"]\n  },\n  {\n    \"instruction\": \"El campo fecha_creacion en Venta y LineaVenta es la fecha de la venta (tipo DATE, formato YYYY-MM-DD). Para filtrar por fecha usar comparaciones simples: fecha_creacion >= '2026-03-24' AND fecha_creacion < '2026-03-31'. NUNCA hacer CAST a TIMESTAMP WITH TIME ZONE — el campo ya es DATE. El campo fecha_documento está vacío (NULL) en todos los registros de Ventas — NUNCA usarlo para filtrar.\",\n    \"questions\": [\"¿Ventas de la semana pasada?\", \"¿Ventas de hoy?\", \"¿Ventas de este mes?\", \"¿Cuánto vendimos en marzo?\"]\n  },\n  {\n    \"instruction\": \"El campo mes en LineaVenta es un entero con formato YYYYMM (ej: 202603 = marzo 2026). Usar para filtrado rápido por período en vez de funciones de fecha: WHERE mes BETWEEN 202601 AND 202612. Es el filtro más eficiente para consultas de ventas por período.\",\n    \"questions\": [\"¿Ventas del primer trimestre?\", \"¿Ventas de enero a marzo?\", \"¿Rendimiento del año 2025?\"]\n  },\n  {\n    \"instruction\": \"VENTAS = NETO DE DEVOLUCIONES. En Venta, entrada=true es venta y entrada=false es devolución, y PowerShop presenta tres cifras distintas: 01VEN (ventas brutas), 02DEV (devoluciones) y NETO (01VEN - 02DEV). Cuando el usuario pide 'ventas' SIN más matices se refiere al NETO: filtrar entrada=true a secas descarta las devoluciones en vez de restarlas y sobrestima las ventas entre un 7 y un 10 por ciento (medido en produccion 2026-08). El patron obligatorio es: COALESCE(SUM(total_si) FILTER (WHERE entrada), 0) - COALESCE(SUM(total_si) FILTER (WHERE NOT entrada), 0) AS ventas_netas. Usar entrada=true a secas SOLO si el usuario pide explicitamente ventas brutas o excluir devoluciones. Para ver las tres cifras como en el ERP: COALESCE(SUM(total_si) FILTER (WHERE entrada), 0) AS ventas_brutas, COALESCE(SUM(total_si) FILTER (WHERE NOT entrada), 0) AS devoluciones, y la resta como ventas_netas. Los importes de devolucion se guardan en POSITIVO, por eso hay que restarlos explicitamente. El campo tipo_documento contiene 'Ticket' para ventas POS normales. NO filtrar por tipo_documento='V' que no existe en el mirror.\",\n    \"questions\": [\"¿Cuántas devoluciones hubo?\", \"¿Ventas netas sin devoluciones?\", \"¿Cuánto se devolvió este mes?\", \"¿Tasa de devolución?\"]\n  },\n  {\n    \"instruction\": \"Para excluir la tienda 99 (almacén central) del análisis retail, añadir WHERE tienda <> '99' en consultas de ventas por tienda. El almacén central no es una tienda física de venta al público. La tienda 97 es la tienda online con patrones diferentes.\",\n    \"questions\": [\"¿Ventas por tienda?\", \"¿Qué tiendas venden más?\", \"¿Rendimiento de tiendas retail?\", \"¿Ranking de tiendas?\"]\n  },\n  {\n    \"instruction\": \"El ticket medio es ventas NETAS entre numero de tickets de VENTA: (COALESCE(SUM(total_si) FILTER (WHERE entrada), 0) - COALESCE(SUM(total_si) FILTER (WHERE NOT entrada), 0)) / NULLIF(COUNT(DISTINCT reg_ventas) FILTER (WHERE entrada), 0). Usar siempre total_si (sin IVA). El numerador es neto porque una devolucion reduce lo vendido; el denominador cuenta solo tickets de venta, que es lo que hace PowerShop. No filtrar entrada=true en el numerador: eso ignora las devoluciones en vez de restarlas.\",\n    \"questions\": [\"¿Cuál es el ticket medio?\", \"¿Cuánto gasta cada cliente de media?\", \"¿Valor medio por transacción?\"]\n  },\n  {\n    \"instruction\": \"Las ventas YTD (año hasta la fecha) se calculan con: WHERE fecha_creacion >= DATE_TRUNC('year', CURRENT_DATE) AND fecha_creacion <= ",
    "hasSql": true,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/overview.md",
    "heading": "Dashboard JSON spec example",
    "body": "The LLM generates a JSON specification that the frontend renders:\n\n```json\n{\n  \"title\": \"Cuadro de Mandos — Ventas Marzo 2026\",\n  \"description\": \"Panel para el responsable de ventas\",\n  \"widgets\": [\n    {\n      \"id\": \"w1\",\n      \"type\": \"kpi_row\",\n      \"items\": [\n        {\"label\": \"Ventas Netas\", \"sql\": \"SELECT SUM(total_si) ...\", \"format\": \"currency\", \"prefix\": \"€\"},\n        {\"label\": \"Tickets\", \"sql\": \"SELECT COUNT(DISTINCT reg_ventas) FILTER (WHERE entrada) ...\", \"format\": \"number\"},\n        {\"label\": \"Ticket Medio\", \"sql\": \"SELECT SUM(total_si)/COUNT(...) ...\", \"format\": \"currency\", \"prefix\": \"€\"}\n      ]\n    },\n    {\n      \"type\": \"bar_chart\",\n      \"title\": \"Ventas por Tienda\",\n      \"sql\": \"SELECT tienda AS label, SUM(total_si) AS value FROM ps_ventas ...\",\n      \"x\": \"label\", \"y\": \"value\"\n    },\n    {\n      \"type\": \"line_chart\",\n      \"title\": \"Tendencia Semanal\",\n      \"sql\": \"SELECT DATE_TRUNC('week', fecha_creacion) AS x, SUM(total_si) AS y FROM ps_ventas ...\"\n    },\n    {\n      \"type\": \"table\",\n      \"title\": \"Top 10 Artículos\",\n      \"sql\": \"SELECT p.ccrefejofacm AS \\\"Referencia\\\", p.descripcion AS \\\"Descripción\\\", ...\"\n    }\n  ]\n}\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/sales.md",
    "heading": "Entity Relationship Diagram",
    "body": "```mermaid\nerDiagram\n    Ventas {\n        float RegVentas PK \"Internal record ID (encodes store)\"\n        date FechaCreacion \"Sale date\"\n        date FechaModifica \"Last modified date (delta field)\"\n        time Hora \"Sale time\"\n        float Total \"Total amount\"\n        float TotalSI \"Total without VAT\"\n        float TotalBruto \"Gross total\"\n        float Metalico \"Cash amount\"\n        float Credito \"Credit amount\"\n        float Vale \"Voucher amount\"\n        float Descuento \"Discount amount\"\n        float Cambio \"Change given\"\n        float NumCliente FK \"-> Clientes.RegCliente\"\n        text Cliente \"Customer name (denorm)\"\n        text CodigoCajero \"Cashier code\"\n        text CajeroNombre \"Cashier name\"\n        text Caja \"Cash register code\"\n        text Tienda \"Store code\"\n        text CodigoForma \"Payment method code\"\n        text TipoDocumento \"Document type\"\n        text TipoVenta \"Sale type\"\n        boolean FacturadoVenta \"Invoice generated\"\n        boolean Pendiente \"Pending flag\"\n        boolean Entrada \"Is entry (vs return)\"\n        float NDocumento \"Document number\"\n        text PedidoWeb \"Web order ID\"\n        text NumPedido \"Online order number\"\n        text MarketPlace \"Marketplace source\"\n        text IntegradorMK \"Marketplace integrator code\"\n        boolean EnviadoCentral \"Sent to HQ\"\n        text EnvCliente \"Delivery customer name\"\n        text EnvDireccion \"Delivery address\"\n        text EnvPoblacion \"Delivery city\"\n        text EnvProvincia \"Delivery province\"\n        text EnvPostal \"Delivery postcode\"\n        text EnvTelefono \"Delivery phone\"\n        text EnvPais \"Delivery country\"\n        text TaxFreeID \"Tax-free certificate ID\"\n        boolean TaxFreeRefund \"Tax-free refund flag\"\n        text AenaNacionalidad \"Aena passenger nationality\"\n        text AenaOrigen \"Aena origin airport code\"\n        text AenaDestino \"Aena destination airport code\"\n        text AenaVuelo \"Aena flight number\"\n        text SaftFecha \"SAF-T fiscal date\"\n        text SaftHora \"SAF-T fiscal time\"\n        text SaftHashNcf \"SAF-T hash/NCF\"\n        text SaftMotivoExenta \"SAF-T exemption reason\"\n        text SaftSeriecodVal \"SAF-T series/validation code\"\n        text TbaiHaciendaId \"TicketBAI Hacienda ID\"\n        boolean TbaiFirmado \"TicketBAI signed flag\"\n        text TbaiFirma13 \"TicketBAI signature (13-char)\"\n        text TbaiErrorFirma \"TicketBAI signing error\"\n        boolean TbaiEnviado \"TicketBAI sent to Hacienda\"\n        text TbaiErrorEnvio \"TicketBAI send error\"\n        date TbaiAnuladoFecha \"TicketBAI annulment date\"\n        boolean TbaiAnuladoFirmado \"TicketBAI annulment signed\"\n        boolean TbaiAnuladoEnviado \"TicketBAI annulment sent\"\n        text WappingId \"Wapping loyalty/CRM transaction ID\"\n        text WappingPromo \"Wapping promotion code\"\n        float WappingPuntosMas \"Wapping loyalty points earned\"\n        float WappingPuntosMenos \"Wapping loyalty points spent\"\n        float ValeRegaloImp \"Gift voucher amount\"\n        date ValeRegaloFec \"Gift voucher date\"\n        text ValeRegaloTie \"Gift voucher store\"\n        text FactExtNDoc \"External invoice number\"\n        date FactExtFecha \"External invoice date\"\n        text FactExtSerie \"External invoice series\"\n    }\n\n    LineasVentas {\n        float RegLineas PK \"Line record ID\"\n        float NumVentas FK \"-> Ventas.RegVentas\"\n        float NumArticulo FK \"-> Articulos.RegArticulo\"\n        text Codigo \"Product code (denorm)\"\n        text Descripcion \"Product description (denorm)\"\n        float Unidades \"Quantity sold\"\n        float PrecioNeto \"Net unit price\"\n        float PrecioBruto \"Gross unit price\"\n        float Total \"Line total\"\n        float TotalSI \"Line total w/o VAT\"\n        float ImporteDescuento \"Discount amount\"\n        float ImporteRebajas \"Markdown amount\"\n        date FechaCreacion \"Sale date\"\n        time Hora \"Sale time\"\n        int Mes \"YYYYMM period (int)\"\n        float NumCliente FK \"-> Clientes\"\n        float NumFamilia FK \"-> FamiGrupMarc\"\n     ",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/sales.md",
    "heading": "Table Descriptions",
    "body": "| Table | Rows | Columns | Description |\n|-------|------|---------|-------------|\n| **Ventas** | 910,253 | 148 (Ventas table) / 150 (Ventas_SQL view) | Sales header/ticket. One row per POS transaction with totals, payment breakdown, customer, store, cashier, and fiscal data (TBAI/SAFT). Has a corresponding SQL view `Ventas_SQL` with all 150 columns queryable via the 4D SQL port. |\n| **LineasVentas** | 1,687,094 | 159 | Sales line items. One row per product on a ticket. Contains article ref, units, price, discounts, and full product classification for analytics. Queryable as `LineasVentas_SQL` view. |\n| **PagosVentas** | 963,541 | 49 (PagosVentas_SQL view) | Payment details per sale. Multiple rows per ticket if split payment (cash + card, etc.). Queryable as `PagosVentas_SQL` view (49 columns including PSCARD1-10 payment card slots). |\n| **Cajas** | 42,484 | 272 | Cash register sessions/closings. Daily summaries with payment type breakdowns, drawer counts, and VAT summaries. |\n| **LCajas** | 50 | 40 | Cash register configuration/definitions. One per physical register. |\n| **Cajeros** | 20 | 13 | Cashier master. Login credentials and commission rates. |",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/sales.md",
    "heading": "SQL Views",
    "body": "> Discovered 2026-04-05\n\nThe 4D SQL port (19812) exposes dedicated SQL views for the core sales tables. These views expose all columns and are the recommended access path for ETL and ad-hoc queries:\n\n| View | Underlying table | Columns | Notes |\n|------|-----------------|---------|-------|\n| `Ventas_SQL` | Ventas | 150 | Full header/ticket data including TBAI, SAF-T, marketplace, delivery, Aena fields |\n| `LineasVentas_SQL` | LineasVentas | ~159 | Full line-item data |\n| `PagosVentas_SQL` | PagosVentas | 49 | Payment data including PSCARD1-10 card slots |\n| `Cajas_SQL` | Cajas | ~272 | Register session/closing data |\n\nQuery example: `SELECT REGVENTAS, FECHACREACION, TOTALSI FROM Ventas_SQL WHERE FECHACREACION >= '2026-01-01'`",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/architecture/sales.md",
    "heading": "Notes",
    "body": "- **Ventas.RegVentas** encodes the store in its decimal part (e.g., `.153`, `.155`), enabling implicit store filtering.\n- **LineasVentas.Mes** stores YYYYMM as Long Integer (e.g., `201410`) for fast period-based queries.\n- **PagosVentas.Mes** stores the same YYYYMM but as Text type.\n- **Cajas** has 272 columns due to repeating groups: L1-L20 (line totals), A1-A20 (article counts), C1-C20 (category counts), plus morning/afternoon splits and multi-currency fields.\n- Sales support fiscal compliance: TBAI (Basque Country tax) and SAFT (Portugal audit file) fields on Ventas.\n- **Denormalization**: LineasVentas carries copies of Codigo, Descripcion, NumFamilia, NumDepartament, etc., from Articulos for reporting efficiency.\n- **TBAI annulment fields** share the same lifecycle pattern as the primary TBAI fields; use `TBAI_ANULADOFECHA` to detect annulled tickets.\n- **LIBRE fields**: `Ventas` has `LIBRE03` and `LIBRE06..LIBRE15` (free/custom fields, typically NULL). `PagosVentas` has `LIBRE01..LIBRE12`.\n- **`LineasVentas.Entrada` exists in the source; the mirror is only now catching up.** Earlier revisions of this file said the field \"does not exist\", which contradicted the ER diagram above. Verified against 4D `_USER_COLUMNS` (`LineasVentas`, 159 columns): the table **does** have `Entrada` (boolean) and `MovimientoCaja` (text, `'Venta'` / `'Devolucion'`), and the two agree 100% of the time. What was missing was the **mirror** column. As of commit `e4491b5` the ETL selects `entrada`, `movimiento_caja` and `talla` into `ps_lineas_ventas`, but **production has not been re-synced yet** — the deployed mirror still has only the original 14 columns. Until that sync runs, every line-level query must `JOIN ps_ventas` and use the net pattern:\n  `COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0) - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0)`.\n  The `COALESCE` wrappers are not optional: `SUM(...) FILTER (...)` is NULL when a group has no row on one side, and `NULL - x` is NULL, which silently blanks 30.6% of article-level groups.\n- **`LineasVentas.PDescG` / `ImporteDescuento` are the same story**: present in 4D, absent from `ps_lineas_ventas`. Discount metrics cannot be computed from the mirror today — see the discount rule in [etl-sync-strategy.md](../etl-sync-strategy.md).",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/architecture/sales.md",
    "heading": "ETL Sync Strategy",
    "body": "> Validated against production data 2026-03-30.\n\n**These tables are NOT append-only.** Historical records are modified retroactively for returns, TBAI fiscal corrections, payment flag updates, and export markers.\n\n| Table | Rows | Modifications since 2025-01-01 | Delta field | Strategy |\n|-------|------|-------------------------------|-------------|---------|\n| Ventas | 911,619 | 177,530 (19%) | `FechaModifica` | UPSERT delta |\n| LineasVentas | 1,689,796 | 356,505 (21%) | `FechaModifica` | UPSERT delta |\n| PagosVentas | 964,971 | 188,859 (20%) | `FechaModifica` | UPSERT delta |\n\nDaily volume: ~454 Ventas + ~897 LineasVentas new/modified per day.\n\n**Critical gotchas:**\n- `FechaDocumento` is **NULL for all records** in Ventas — never use as a delta field.\n- `FechaModifica` is the correct delta field (max = today, always updated on any change).\n- PKs (`RegVentas`, `RegLineas`, `RegPagos`) are REAL floats — store as `NUMERIC` in PostgreSQL to avoid precision loss.\n\nSee [etl-sync-strategy.md](../etl-sync-strategy.md) for the full sync plan.\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/sales.md",
    "heading": "LLM:tables",
    "body": "```json\n[\n  {\n    \"table\": \"ps_ventas\",\n    \"alias\": \"Venta\",\n    \"description\": \"Tickets de venta retail. total_si=sin IVA (usar siempre). entrada=true para ventas, false para devoluciones.\",\n    \"keyColumns\": [\"reg_ventas (PK)\", \"n_documento\", \"tienda\", \"fecha_creacion\", \"total_si (SIN IVA - usar siempre)\", \"total (CON IVA - NO usar)\", \"num_cliente (0=anónimo)\", \"entrada (true=venta, false=devolución)\", \"tipo_documento\", \"cajero_nombre\"]\n  },\n  {\n    \"table\": \"ps_lineas_ventas\",\n    \"alias\": \"LineaVenta\",\n    \"description\": \"Líneas de venta (detalle por artículo). El espejo NO tiene entrada — el ETL no la selecciona todavía; en 4D LineasVentas SÍ la tiene. Usar JOIN con ps_ventas y el patrón neto FILTER.\",\n    \"keyColumns\": [\"reg_lineas (PK)\", \"num_ventas (FK -> ps_ventas.reg_ventas)\", \"mes (YYYYMM)\", \"tienda\", \"codigo (FK -> ps_articulos.codigo)\", \"descripcion\", \"unidades\", \"precio_neto_si\", \"total_si\", \"total_coste_si\", \"fecha_creacion\"]\n  },\n  {\n    \"table\": \"ps_pagos_ventas\",\n    \"alias\": \"PagoVenta\",\n    \"description\": \"Pagos por ticket. importe_cob=importe cobrado.\",\n    \"keyColumns\": [\"reg_pagos (PK)\", \"num_ventas (FK)\", \"forma\", \"codigo_forma\", \"importe_cob\", \"tienda\", \"entrada\", \"fecha_creacion\"]\n  }\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/sales.md",
    "heading": "LLM:relationships",
    "body": "```json\n[\n  {\"from\": \"ps_lineas_ventas\", \"fromColumn\": \"num_ventas\", \"to\": \"ps_ventas\", \"toColumn\": \"reg_ventas\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_pagos_ventas\", \"fromColumn\": \"num_ventas\", \"to\": \"ps_ventas\", \"toColumn\": \"reg_ventas\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_ventas\", \"fromColumn\": \"tienda\", \"to\": \"ps_tiendas\", \"toColumn\": \"codigo\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_ventas\", \"fromColumn\": \"num_cliente\", \"to\": \"ps_clientes\", \"toColumn\": \"reg_cliente\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_lineas_ventas\", \"fromColumn\": \"codigo\", \"to\": \"ps_articulos\", \"toColumn\": \"codigo\", \"type\": \"MANY_TO_ONE\"}\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/purchasing.md",
    "heading": "Notes",
    "body": "- **Two purchase line tables exist**: `LineasCompras` (exists, 57 cols, 0 rows) and `CCLineasCompr` (44,395 rows). The CC-prefixed version is the active one. `LineasCompras` **is a real table** — do not repeat the claim that it \"does not exist\"; it is simply empty.\n- **Purchase flow**: Compras (order) -> Albaranes (receipt) -> FacturasCompra (supplier invoice) -> PagosCompras (payment).\n- **Retail invoicing**: `Facturas` are formal invoices generated from POS sales (Ventas), separate from wholesale invoices (GCFacturas).\n- **LinAlbaranes has 34 size slots, not 17.** Verified against 4D `_USER_COLUMNS` (109 columns total): `Talla1..Talla34` (size labels) **and** `Recibidas1..Recibidas34` (units received per size) — 68 of the 109 columns. The \"Talla1-17\" that used to appear here was the loop bound of a legacy Visual FoxPro report, copied into this doc as if it were the schema. Anything iterating sizes must go to 34 or it silently drops the tail of the size run.\n- **LinAlbaranes money/quantity columns** (verified, not guessed): `PrecioCoste`, `PrecioNetoSI`, `TotalSI`, `TotalImport`, `IvaUnitario`, `PDescCompra`, `PIva`, `Recibidas`. There is **no** `PrecioBruto`, `PrecioNeto`, `Unidades` or `Total` on this table — those names were invented in an earlier revision of this file.\n- **Purchases are `Albaranes` + `LinAlbaranes`, not `Compras` + `LineasCompras`.** `Compras`/`CCLineasCompr` are *orders* (what was asked for); `Albaranes`/`LinAlbaranes` are *goods actually received*. Any \"what did we buy\" analysis must use the delivery-note pair — the order pair overstates, because orders get cancelled and partially served. `LineasCompras` itself is empty in production.\n- **DivisionCompra** (10,981 rows) tracks how purchase orders are allocated across multiple stores.\n- Proveedores links to Articulos via `Articulos.NumProveedor -> Proveedores.RegProveedor`.",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/architecture/purchasing.md",
    "heading": "LLM:tables",
    "body": "```json\n[\n  {\n    \"table\": \"ps_compras\",\n    \"alias\": \"PedidoCompra\",\n    \"description\": \"Pedidos de compra a proveedores. La fecha del pedido es fecha_pedido (NO fecha_creacion). fecha_recibido es NULL mientras el pedido está pendiente de recibir.\",\n    \"keyColumns\": [\"reg_pedido (PK)\", \"num_proveedor (FK)\", \"fecha_pedido\", \"fecha_recibido\", \"modificada\"]\n  },\n  {\n    \"table\": \"ps_lineas_compras\",\n    \"alias\": \"LineaPedidoCompra\",\n    \"description\": \"Líneas de pedido de compra. NOTA: la tabla NO tiene columnas codigo ni unidades; el artículo se referencia por num_articulo (FK NUMERIC) y la tienda por num_tienda.\",\n    \"keyColumns\": [\"reg_linea_compra (PK)\", \"num_pedido (FK → ps_compras.reg_pedido)\", \"num_tienda (FK)\", \"num_articulo (FK)\", \"fecha\"]\n  },\n  {\n    \"table\": \"ps_albaranes\",\n    \"alias\": \"AlbaranRecepcion\",\n    \"description\": \"Albaranes de recepción de mercancía. La fecha de recepción es fecha_recibido (NO fecha_creacion).\",\n    \"keyColumns\": [\"reg_albaran (PK)\", \"fecha_recibido\", \"modificada\"]\n  },\n  {\n    \"table\": \"ps_facturas_compra\",\n    \"alias\": \"FacturaCompra\",\n    \"description\": \"Facturas de compra a proveedores.\",\n    \"keyColumns\": [\"reg_factura (PK)\"]\n  },\n  {\n    \"table\": \"ps_proveedores\",\n    \"alias\": \"Proveedor\",\n    \"description\": \"Proveedores de mercancía.\",\n    \"keyColumns\": [\"reg_proveedor (PK)\", \"nombre\"]\n  }\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/purchasing.md",
    "heading": "LLM:relationships",
    "body": "```json\n[\n  {\"from\": \"ps_lineas_compras\", \"fromColumn\": \"num_pedido\",    \"to\": \"ps_compras\",      \"toColumn\": \"reg_pedido\",     \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_compras\",        \"fromColumn\": \"num_proveedor\", \"to\": \"ps_proveedores\",  \"toColumn\": \"reg_proveedor\",  \"type\": \"MANY_TO_ONE\"}\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/stock-logistics.md",
    "heading": "Entity Relationship Diagram",
    "body": "```mermaid\nerDiagram\n    Traspasos {\n        float RegTraspaso PK \"Transfer record ID\"\n        float Documento \"Document number\"\n        text Codigo \"Article code\"\n        text Descripcion \"Article description\"\n        text Talla \"Size\"\n        float UnidadesS \"Units sent\"\n        float UnidadesE \"Units received\"\n        text TiendaSalida FK \"Origin store code\"\n        text TiendaEntrada FK \"Destination store code\"\n        text CajaSalida \"Origin register\"\n        text CajaEntrada \"Destination register\"\n        date FechaS \"Send date\"\n        time HoraS \"Send time\"\n        date FechaE \"Receipt date\"\n        time HoraE \"Receipt time\"\n        text Tipo \"Transfer type\"\n        text Concepto \"Reason/concept\"\n        boolean Entrada \"Is entry record\"\n        text EmpleadoS \"Sending employee\"\n        text EmpleadoE \"Receiving employee\"\n        text CajeroS \"Sending cashier\"\n        text CajeroE \"Receiving cashier\"\n        text Transportista \"Carrier\"\n        int NExpedicion \"Expedition number\"\n        int Bultos \"Number of packages\"\n        text ZonaTienda \"Store zone\"\n    }\n\n    Movimientos {\n        text Tipo \"Movement type\"\n        text Codigo \"Code\"\n        boolean Entrada \"Is entry\"\n        boolean Almacen \"Is warehouse\"\n    }\n\n    Inventarios {\n        float RegInventario PK \"Inventory record ID\"\n        date FechaInventa \"Inventory date\"\n        text Tienda FK \"Store code\"\n        float Real \"Actual count\"\n        float Grabado \"System count\"\n        float DeMenos \"Shortage\"\n        float DeMas \"Surplus\"\n        text Responsable \"Person responsible\"\n        text Concepto \"Inventory type\"\n        text ZonaTienda \"Store zone\"\n    }\n\n    BarrasAsociado {\n        text CodigoBarra \"Barcode (EAN)\"\n        float NumArticulo FK \"-> Articulos.RegArticulo\"\n        text Talla \"Size\"\n    }\n\n    SemiCodigo {\n        text Codigo \"Short/partial code\"\n        float NumArticulo FK \"-> Articulos.RegArticulo\"\n    }\n\n    CCPorcentajeTemp {\n        float NumTemporada FK \"-> CCOPTempTipo\"\n        float Porcentaje \"Percentage\"\n    }\n\n    CCOPSeriCali {\n        text Clave \"Series code\"\n        text Serie \"Series name\"\n    }\n\n    CCOPCriXDiam {\n        text Clave \"Criterion X code\"\n    }\n\n    CCOPLotePuEj {\n        text Lote \"Lot code\"\n    }\n\n    Traspasos }o--|| Tiendas : \"TiendaSalida -> Codigo\"\n    Traspasos }o--|| Tiendas : \"TiendaEntrada -> Codigo\"\n    BarrasAsociado }o--|| Articulos : \"NumArticulo -> RegArticulo\"\n    SemiCodigo }o--|| Articulos : \"NumArticulo -> RegArticulo\"\n\n    Tiendas {\n        text Codigo PK \"Store code\"\n        text Tienda \"Store name\"\n    }\n\n    Articulos {\n        float RegArticulo PK \"Article record ID\"\n        text Codigo \"Article code\"\n    }\n```",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/stock-logistics.md",
    "heading": "Table Descriptions",
    "body": "| Table | Rows | Columns | Description |\n|-------|------|---------|-------------|\n| **Traspasos** | 262,689 | 30 | Stock transfers between stores and regularizations. Contains origin/destination, article, size, quantities, timestamps, and reason codes (e.g., \"Traspaso\", \"Regularizacion\", \"S-Robo\" for theft). |\n| **Movimientos** | 4 | 4 | Stock movement type definitions. Minimal reference table. |\n| **BarrasAsociado** | 63,756 | -- | Associated barcodes. Maps additional EAN codes to articles (beyond the primary CodigoBarra on Articulos). |\n| **SemiCodigo** | 110,536 | -- | Short/partial codes. Lookup for partial barcode scanning or internal short codes. |\n| **CCPorcentajeTemp** | 406 | -- | Season percentage allocations. |\n| **CCOPSeriCali** | 47 | -- | Size series/caliber definitions (e.g., S/M/L, 36-46, etc.). |\n| **CCOPCriXDiam** | 3 | -- | Criterion X (diamond/special) definitions. |\n| **CCOPLotePuEj** | 3 | -- | Lot/batch definitions. |",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/stock-logistics.md",
    "heading": "Notes",
    "body": "- **Traspasos** is the primary stock movement table (263K rows), used for both inter-store transfers and stock regularizations (adjustments for theft, damage, etc.).\n- Each transfer appears twice: once as an exit from origin store (Entrada=false) and once as an entry at destination (Entrada=true), matched by `Documento` number.\n- **BarrasAsociado** (64K rows) supplements `Articulos.CodigoBarra` by mapping multiple EAN barcodes to a single article (e.g., different size barcodes).\n- **SemiCodigo** (111K rows) is a large lookup for partial code resolution during scanning.\n- The **RFID** module (RFIDMovimientos, RFIDNumerosSerie, RFIDSinMovimiento) exists in the schema but is completely empty.\n- The **Logistics** module (Logistica, PackingList, LOGNivel1-3, LOGZonas) is defined but unused.\n- **Inventarios is empty, but that does NOT mean there are no inventories.** The annual physical count is recorded in `Traspasos` with `Tipo='Apertura'` dated 1 January: one row per store, article and **size**, carrying the counted units. It is valued at `Articulos.PrecioCoste`. This is the real inventory source for the business — 247,502 `Apertura` rows in the mirror (measured 2026-08). Do not conclude \"no inventory data exists\" from the empty `Inventarios` table.\n- **`Traspasos.Tipo` must be filtered in every stock-movement analysis.** `'Apertura'` (247,502 rows) and `'Inventario Parcial'` (739 rows) are inventory entries, not transfers, and together they are ~94% of the 262,724-row table. Without `WHERE tipo NOT IN ('Apertura', 'Inventario Parcial')` a \"transfer volume\" or \"busiest route\" query returns almost nothing but openings. The types that are genuine movement are `'Autoreposicion'` and `'Regularización'`.\n- **`Articulos.NoInventariabl = FALSE` is the mandatory filter for any inventory calculation.** Articles flagged `NoInventariabl` (bags, carriage, services, charges) are not merchandise and inflate both unit counts and valuation. The field exists in 4D `Articulos` but is **not mirrored** into `ps_articulos`, so it cannot be applied from PostgreSQL today — say so when reporting a valuation rather than silently omitting it. `ps_articulos.anulado = false` is the nearest available filter and is **not** equivalent.\n- Stock positions are primarily tracked in the **CCStock** table (Products domain), which uses a wide-format layout with stock quantities per size per store.",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/stock-logistics.md",
    "heading": "Stock via Exportaciones (preferred for ETL)",
    "body": "The `Exportaciones` table (2,058,201 rows) is the preferred source for per-store, per-size stock in ETL and analytics. It was the export table used by the legacy VFP application and is actively maintained.\n\n**Structure (confirmed from `Exportaciones_SQL` view, 2026-04-05):** One row per (article, store) pair with a **34-slot size matrix**:\n- `Talla1..Talla34` — size label per slot (e.g. \"XS\", \"S\", \"M\", \"L\", \"XL\", \"40\", \"42\"...)\n- `Stock1..Stock34` — current stock quantity per size (**`_USER_COLUMNS`:** `DATA_TYPE = 3`, `DATA_LENGTH = 2` — **16-bit integer** in the 4D structure). Via **4D SQL / p4d**, negatives are often returned as **unsigned** (`65535` = `−1`); the ETL reinterprets before `ps_stock_tienda.stock`. Compare with the POS grid: per-size cells show signed values natively.\n- `Minimo1..Minimo34` — minimum stock quantity per size\n- `REPPorcentaje1..REPPorcentaje34` — replenishment percentage per size\n- `STStock` — **Real** (`DATA_TYPE = 6`) — secondary numeric field on the export row (legacy naming; not a substitute for slot-level analysis).\n- `CCStock` — **Real** (`DATA_TYPE = 6`) — **row-level net stock** for that `(Codigo, TiendaCodigo)` (matches the “TS” style total in POS when slots are signed). This is **not** the wide **`CCStock` table** in the Products domain (582 columns); same name, different object.\n- `Tienda` (store name), `TiendaCodigo` (composite key), `Codigo` (article code)\n- `FechaModifica`, `HoraModifica` — delta sync fields\n- `Ubicacion1`, `Ubicacion2`, `Ubicacion3` — warehouse location codes\n- `PuntoPedido`, `Recomendado`, `UnidadesReposi` — replenishment config\n- `REPPrioridadWeb` — web replenishment priority\n- `BORRAR5`, `BORRAR6`, `BORRAR7`, `BORRAR8`, `BORRAR9`, `BORRAR10`, `BORRAR12` — **deprecated columns, always ignore**\n\n> **Note on slot count:** Not all 34 slots are populated for every article. The number of active\n> slots is determined by the article's product family (`FamiGrupMarc.SerieTallas` field).\n> Clothing typically uses slots 1-17 (S/M/L/XL...), footwear and optics use all 34.\n> Empty slots have `Talla=''` and `Stock=0`.\n\n**Key gotcha — TiendaCodigo format:** The `TiendaCodigo` field is `\"tienda/articulo\"` (e.g. `\"104/169\"`), NOT just a store code. The compound `(Codigo, TiendaCodigo)` is the natural PK.\n\n**ETL normalization:** The wide format must be unpivoted to `(codigo, tienda_codigo, talla, stock)` rows for PostgreSQL. Filter out empty talla slots (`WHERE talla != ''`). Each `StockN` is decoded with `decode_signed_int16_word()` so SQL-layer unsigned values become signed integers. See [etl-sync-strategy.md](../etl-sync-strategy.md).",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/architecture/stock-logistics.md",
    "heading": "ETL Sync Strategy",
    "body": "> Validated against production data 2026-03-30; CCStock added 2026-05-01.\n\n| Table | Rows | Delta field | Strategy |\n|-------|------|-------------|---------|\n| Exportaciones | 2,058,201 | `FechaModifica` (NULLs exist for zero-stock articles) | UPSERT delta + unpivot |\n| Traspasos | 262,689 | `FechaS` (send date — no FechaModifica) | Append-only by `FechaS` |\n| CCStock | 41,478 | None | Full refresh nightly → `ps_stock_central` |\n\n**Traspasos** is mostly historical: only 153 new rows since 2025-01-01. Records appear immutable once created. Append-only by `FechaS` is safe.",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/stock-logistics.md",
    "heading": "CCStock (central warehouse stock) — confirmed 2026-05-01",
    "body": "`CCStock` is the central-warehouse stock matrix: one row per article (41 478 rows), 34 stock-slot columns (`Stock1..Stock34`). Confirmed field types via `_USER_COLUMNS`:\n\n- `NumArticulo` : `DATA_TYPE=6` (Real, 8 bytes) — PK (.99 suffix pattern)\n- `Stock` : `DATA_TYPE=6` (Real, 8 bytes) — row-level total maintained by 4D\n- `Stock1..Stock34` : **`DATA_TYPE=3, DATA_LENGTH=2` (16-bit WORD)** — same type as `Exportaciones.StockN`. The p4d driver returns unsigned values for negatives (`65535 = −1`). `decode_signed_int16_word()` is applied on each slot before summing.\n- `FechaModifica` : `DATA_TYPE=8` (Date)\n\n> **Important correction to issue #428 description**: The issue stated CCStock columns are \"Real (DATA_TYPE=6)\". This is TRUE for the root-level `Stock` column but FALSE for `Stock1..Stock34` which are int16 WORD (type 3, length 2) — confirmed by `_USER_COLUMNS` and live samples showing 65535 values. The ETL must apply `decode_signed_int16_word()` on these slots, the same as for `Exportaciones`.\n\n**Mirror**: `ps_stock_central` columns: `num_articulo NUMERIC(20,3) PK`, `stock INTEGER` (SUM of 34 decoded slots), `fecha_modifica DATE`. Full-refresh nightly; ~41 500 rows; no watermark needed.\n\nSee [etl-sync-strategy.md](../etl-sync-strategy.md) for the full sync plan.\n\n---",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/architecture/stock-logistics.md",
    "heading": "LLM:tables",
    "body": "```json\n[\n  {\n    \"table\": \"ps_stock_tienda\",\n    \"alias\": \"StockTienda\",\n    \"description\": \"Stock por tienda y talla. tienda=99 es almacén central.\",\n    \"keyColumns\": [\"codigo (FK)\", \"tienda\", \"talla\", \"stock\", \"fecha_modifica\"]\n  },\n  {\n    \"table\": \"ps_traspasos\",\n    \"alias\": \"Traspaso\",\n    \"description\": \"Traspasos de stock. Cada movimiento = 2 filas (salida + entrada).\",\n    \"keyColumns\": [\"codigo (FK)\", \"tienda_salida\", \"tienda_entrada\", \"entrada\", \"unidades_s\", \"unidades_e\", \"fecha_s\", \"talla\"]\n  }\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/stock-logistics.md",
    "heading": "LLM:relationships",
    "body": "```json\n[\n  {\"from\": \"ps_stock_tienda\",  \"fromColumn\": \"codigo\",         \"to\": \"ps_articulos\", \"toColumn\": \"codigo\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_stock_tienda\",  \"fromColumn\": \"tienda\",         \"to\": \"ps_tiendas\",   \"toColumn\": \"codigo\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_traspasos\",     \"fromColumn\": \"tienda_salida\",  \"to\": \"ps_tiendas\",   \"toColumn\": \"codigo\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_traspasos\",     \"fromColumn\": \"tienda_entrada\", \"to\": \"ps_tiendas\",   \"toColumn\": \"codigo\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_traspasos\",     \"fromColumn\": \"codigo\",         \"to\": \"ps_articulos\", \"toColumn\": \"codigo\", \"type\": \"MANY_TO_ONE\"}\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/products.md",
    "heading": "Entity Relationship Diagram",
    "body": "```mermaid\nerDiagram\n    Articulos {\n        float RegArticulo PK \"Internal record ID\"\n        text Codigo \"Product code\"\n        text Descripcion \"Product description\"\n        text CodigoBarra \"Barcode (EAN)\"\n        text SKU \"Stock Keeping Unit\"\n        float NumFamilia FK \"-> FamiGrupMarc\"\n        float NumSubfamilia FK \"-> SubfamModelo\"\n        float NumDepartament FK \"-> DepaSeccFabr\"\n        float NumColor FK \"-> CCOPColores\"\n        float NumTemporada FK \"-> CCOPTempTipo\"\n        float NumMarca FK \"-> CCOPMarcTrat\"\n        float NumProveedor FK \"-> Proveedores\"\n        float Precio1 \"Retail price level 1\"\n        float Precio2 \"Retail price level 2\"\n        float PrecioCoste \"Cost price\"\n        float PrCosteNe \"Net cost price\"\n        float PIva \"VAT percentage\"\n        float Stock \"Total stock quantity\"\n        text Color \"Color name\"\n        text ClaveTemporada \"Season code\"\n        text ClaveMarca \"Brand code\"\n        text Modelo \"Model\"\n        text Sexo \"Gender target\"\n        boolean PActiva \"Price active flag\"\n        boolean Anulado \"Cancelled/disabled\"\n        date FechaCreacion \"Creation date\"\n        date FechaModifica \"Last modified\"\n        text Moneda \"Currency\"\n        float PrecioDivisa \"Foreign currency price\"\n    }\n\n    FamiGrupMarc {\n        float RegFamilia PK \"Internal record ID\"\n        text Clave \"Short code\"\n        text FamiGrupMarc \"Family/group name\"\n        float Coeficiente1 \"Markup coefficient 1\"\n        float Coeficiente2 \"Markup coefficient 2\"\n        text CuentaVentas \"Sales account code\"\n        float Presupuesto \"Budget amount\"\n        boolean Anulado \"Disabled flag\"\n        text SerieTallas \"Size series\"\n        text ClaveSeccion \"Section code\"\n    }\n\n    SubfamModelo {\n        float RegSubfamilia PK \"Internal record ID\"\n        text SubfamModelo \"Subfamily/model name\"\n        text CuentaVentas \"Sales account code\"\n        float Coeficiente1 \"Markup coefficient\"\n    }\n\n    DepaSeccFabr {\n        float RegDepartament PK \"Internal record ID\"\n        text Clave \"Short code\"\n        text DepaSeccFabr \"Department name\"\n        float JOIva \"Default VAT rate\"\n        float Presupuesto \"Budget\"\n        float Contador \"Counter\"\n        boolean Anulado \"Disabled flag\"\n    }\n\n    CCOPColores {\n        float RegColor PK \"Internal record ID\"\n        text Clave \"Short code\"\n        text Color \"Color name\"\n        text WebIdioma1 \"Web label (lang 1)\"\n    }\n\n    CCOPTempTipo {\n        float RegTemporada PK \"Internal record ID\"\n        text Clave \"Short code\"\n        text TemporadaTipo \"Season/type name\"\n        boolean TemporadaActiv \"Season is active\"\n        date InicioVentas \"Sales start date\"\n        date FinVentas \"Sales end date\"\n        date InicioRebajas \"Markdown start\"\n        date FinRebajas \"Markdown end\"\n    }\n\n    CCOPMarcTrat {\n        float RegMarca PK \"Internal record ID\"\n        text Clave \"Short code\"\n        text MarcaTratamien \"Brand name\"\n        float Presupuesto \"Budget\"\n        float DescuentoCompra \"Purchase discount %\"\n    }\n\n    CCStock {\n        float NumArticulo FK \"-> Articulos.RegArticulo\"\n        float Stock \"Total stock\"\n        int Stock1 \"Stock size slot 1\"\n        int Stock2 \"Stock size slot 2\"\n        text Talla1 \"Size label slot 1\"\n        text Talla2 \"Size label slot 2\"\n        float PVP11 \"PVP store 1 size 1\"\n        float Compra1 \"Purchase cost size 1\"\n        int Minimo1 \"Minimum stock size 1\"\n    }\n\n    Articulos ||--o| FamiGrupMarc : \"NumFamilia -> RegFamilia\"\n    Articulos ||--o| SubfamModelo : \"NumSubfamilia -> RegSubfamilia\"\n    Articulos ||--o| DepaSeccFabr : \"NumDepartament -> RegDepartament\"\n    Articulos ||--o| CCOPColores : \"NumColor -> RegColor\"\n    Articulos ||--o| CCOPTempTipo : \"NumTemporada -> RegTemporada\"\n    Articulos ||--o| CCOPMarcTrat : \"NumMarca -> RegMarca\"\n    Articulos ||--|| CCStock : \"RegArticulo -> NumArticulo\"\n```",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/products.md",
    "heading": "Notes",
    "body": "- **Articulos** has 379 columns; most are repeating patterns for sizes (Medida1-20), prices (Precio1-15), markdowns (Rebajas1-15), coefficients (Coef1-15), and multilingual descriptions (Idioma1-10).\n- **CCStock** uses a wide-format layout with 582 columns: `Stock1..Stock34` (stock per size slot), `Talla1..Talla34` (size labels), `PVP1..PVP7 x 34` (prices per tariff per size), `Minimo1..Minimo34`, `Compra1..Compra34`, `Rebaja1..Rebaja2 x 34`, `Ubicacion1..Ubicacion3 x 34`, and `Anulada1..Anulada34`.\n- Classification hierarchy: **DepaSeccFabr** (department) -> **FamiGrupMarc** (family) -> **SubfamModelo** (subfamily). Cross-classified by **CCOPMarcTrat** (brand), **CCOPTempTipo** (season), and **CCOPColores** (color).\n- Related tables in other domains: `Proveedores` (purchasing), `LineasVentas` and `GCLinAlbarane` reference `NumArticulo`.",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/products.md",
    "heading": "FamiGrupMarc Field Groups",
    "body": "> Confirmed 2026-04-05 from `_USER_COLUMNS` (112 columns total, 78 rows in production).\n\n| Group | Fields | Purpose |\n|-------|--------|---------|\n| Identity | `RegFamilia` (PK), `Clave`, `FamiGrupMarc`, `CodigoGenerico`, `Codigo1..Codigo6` | Family ID and short codes |\n| Accounting | `CuentaVentas`, `CuentaVentas2`, `Presupuesto`, `Comision`, `Coeficiente1..Coeficiente4` | Sales accounts, budget, markup |\n| Section/Dept | `ClaveSeccion`, `Seccion1..Seccion6`, `SerieEmpresa` | Cross-reference to DepaSeccFabr sections |\n| Size series | `SerieTallas` | **Dead end — not the size series source.** Blank in all 78 production rows, and structurally wrong: the series hangs off the *article*, via `Articulos.ClaveSerie` → `CCOPSeriCali.Clave`. See the gotcha below. |\n| Promotions | `PrecioPromocion`, `PorcenPromocion`, `PromoDesde`, `PromoHasta`, `UnidadPromocion`, `ValeCliente` | Promotional pricing |\n| Web/Commerce | `NoPSCloud`, `NoPSCommerce`, `NoPSCommerceM`, `PathPSCloud`, `WebIdioma1..WebIdioma5`, `Weborden` | E-commerce visibility |\n| Brand integrations | `CATAdidasMat1..10` (Adidas material codes), `CATNikeModel21/22`, `CATNikeStyleC1..3` | Third-party catalog mapping |\n| Volume/loyalty | `VolumenImporte`, `VolumenNumero`, `VolumenPorcen`, `VolumenVale`, `GrupoClientes` | Volume discount and loyalty rules |\n| Unit pricing | `Unidades1..Unidades6`, `Unidad1Imp..Unidad3Imp`, `Unidad1Por..Unidad3Por`, `UsarPVPUnidad2`, `STUnidad2` | Multi-unit pricing (e.g., pairs, sets) |\n| Stock special | `ST2X1`, `STVolumen`, `OPIncremento`, `NoPSCloud`, `AenaEsRentaUni`, `AenaRentaConIVA` | Stock/rental special rules |\n| Free fields | `Libre01..Libre10` | Custom use |\n| Metadata | `FModifica`, `HModifica`, `Anulado`, `Contador`, `Historico1..Historico4`, `CorrectorMDV` | Admin fields |\n\n> **Key gotcha — the size series is `Articulos.ClaveSerie`, not `FamiGrupMarc.SerieTallas`.**\n> The canonical definition of an article's size run is:\n> **`Articulos.ClaveSerie` → `CCOPSeriCali.Clave` → `CCOPSeriCali.Talla1..Talla34`** (that table has 219 columns; the 34 `Talla*` slots hold the size labels).\n>\n> `FamiGrupMarc.SerieTallas` is blank in all 78 production rows — but \"it's blank\" was the wrong reason to close this question. The field is not merely unpopulated, it is at the wrong grain: the series belongs to the **article**, not the family, so two articles in the same family can carry different size runs. An earlier revision of this file concluded \"use the literal labels from `Exportaciones`/`GCLinPedidos`\" and stopped there, which works by accident for those two tables and leaves you with no answer for any article that does not appear in them.\n>\n> Neither `Articulos.ClaveSerie` nor `CCOPSeriCali` is mirrored into PostgreSQL. For queries against the mirror the size labels do already come resolved in `ps_stock_tienda.talla` and `ps_traspasos.talla` — use those. Go to `ClaveSerie` → `CCOPSeriCali` when working against 4D directly, or when you need an article's full size run including sizes it has no stock rows for.\n\n> **Key gotcha — `CCRefeJOFACM` is reference+colour, not the model.** The last 2 characters are the colour code. Grouping a \"top articles\" ranking by `ccrefejofacm` splits one model across several rows: production holds 42,244 distinct `ccrefejofacm` values against only 19,941 models — 2.12 colours per model on average (measured 2026-08). A model that sells well can miss the top-N entirely because its volume is spread over its colours. Group by `LEFT(ccrefejofacm, LENGTH(ccrefejofacm) - 2)` to rank by model. Real example: `75221411`, `75221420`, `75221421`, `75221470`, `75221490`, `75221496` are six colours of model `752214`. Use the raw `ccrefejofacm` only when the colour breakdown is what was actually asked for.\n\n> **Brand integrations:** `CATAdidasMat1..10` and `CATNikeModel/Style` fields map product families to Adidas and Nike catalog codes for data feed exports. These are the \"ADIDAS data feeds\" and \"corners/concessions\" modules discove",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/architecture/products.md",
    "heading": "LLM:tables",
    "body": "```json\n[\n  {\n    \"table\": \"ps_articulos\",\n    \"alias\": \"Producto\",\n    \"description\": \"Catálogo de productos. ccrefejofacm=Referencia REFERENCIA+COLOR (los 2 ultimos caracteres son el color): para rankear por MODELO agrupar por LEFT(ccrefejofacm, LENGTH(ccrefejofacm)-2). M=mayorista, MA=material (excluido del ETL).\",\n    \"keyColumns\": [\"reg_articulo (PK)\", \"codigo\", \"ccrefejofacm (Referencia = modelo+color; NO es el modelo)\", \"descripcion\", \"num_familia (FK)\", \"num_departament (FK)\", \"num_color (FK)\", \"num_temporada (FK)\", \"num_marca (FK)\", \"precio_coste\", \"p_iva\", \"anulado\", \"fecha_creacion\", \"clave_temporada\", \"modelo\", \"sexo\"]\n  },\n  {\n    \"table\": \"ps_familias\",\n    \"alias\": \"Familia\",\n    \"description\": \"Familias/grupos de productos.\",\n    \"keyColumns\": [\"reg_familia (PK)\", \"fami_grup_marc\"]\n  },\n  {\n    \"table\": \"ps_departamentos\",\n    \"alias\": \"Departamento\",\n    \"description\": \"Departamentos/secciones.\",\n    \"keyColumns\": [\"reg_departament (PK)\", \"depa_secc_fabr\"]\n  },\n  {\n    \"table\": \"ps_colores\",\n    \"alias\": \"Color\",\n    \"description\": \"Catálogo de colores.\",\n    \"keyColumns\": [\"reg_color (PK)\", \"color\"]\n  },\n  {\n    \"table\": \"ps_temporadas\",\n    \"alias\": \"Temporada\",\n    \"description\": \"Temporadas y tipos.\",\n    \"keyColumns\": [\"reg_temporada (PK)\", \"temporada_tipo\"]\n  },\n  {\n    \"table\": \"ps_marcas\",\n    \"alias\": \"Marca\",\n    \"description\": \"Marcas de producto.\",\n    \"keyColumns\": [\"reg_marca (PK)\", \"marca\"]\n  }\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/products.md",
    "heading": "LLM:relationships",
    "body": "```json\n[\n  {\"from\": \"ps_articulos\", \"fromColumn\": \"num_familia\", \"to\": \"ps_familias\", \"toColumn\": \"reg_familia\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_articulos\", \"fromColumn\": \"num_departament\", \"to\": \"ps_departamentos\", \"toColumn\": \"reg_departament\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_articulos\", \"fromColumn\": \"num_color\", \"to\": \"ps_colores\", \"toColumn\": \"reg_color\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_articulos\", \"fromColumn\": \"num_temporada\", \"to\": \"ps_temporadas\", \"toColumn\": \"reg_temporada\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_articulos\", \"fromColumn\": \"num_marca\", \"to\": \"ps_marcas\", \"toColumn\": \"reg_marca\", \"type\": \"MANY_TO_ONE\"}\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/customers.md",
    "heading": "Entity Relationship Diagram",
    "body": "```mermaid\nerDiagram\n    Clientes {\n        float RegCliente PK \"Internal record ID\"\n        text Cliente \"Customer name\"\n        float Codigo \"Customer code\"\n        text CIF \"Tax ID (NIF/CIF)\"\n        text Direccion \"Billing address\"\n        text Poblacion \"City\"\n        text Provincia \"Province\"\n        text Postal \"Postal code\"\n        text Telefono \"Phone\"\n        text Telefono2 \"Phone 2\"\n        text Movil \"Mobile\"\n        text Fax \"Fax\"\n        text DireccionE \"Shipping address\"\n        text PoblacionE \"Shipping city\"\n        text ProvinciaE \"Shipping province\"\n        text PostalE \"Shipping postal code\"\n        text FormaPago \"Payment method\"\n        float PDescCom \"Commercial discount %\"\n        float ImpTarjetaPuntos \"Loyalty card points\"\n        boolean LlevaIva \"Subject to VAT\"\n        boolean LlevaRE \"Subject to surcharge\"\n        boolean BloqueoFinancials \"Financial block\"\n        int RiesgoConcedid \"Credit limit\"\n        text Tienda \"Home store code\"\n        float NumComercial FK \"-> GCComerciales.RegComercial\"\n        text Transportista \"Default carrier\"\n        text Contacto1 \"Contact person\"\n        text Marketing1 \"Marketing segment 1\"\n        text Marketing2 \"Marketing segment 2\"\n        date FechaCreacion \"Creation date\"\n        date FechaModifica \"Last modified\"\n    }\n\n    TiposClientes {\n        text TipoCliente \"Client type name\"\n    }\n\n    GrupoClientes {\n        text GrupoCliente \"Client group name\"\n    }\n\n    OPClientes {\n        text Descripcion \"Optical client data\"\n    }\n\n    GCComerciales {\n        float RegComercial PK \"Sales rep record ID\"\n        text Comercial \"Sales rep name\"\n        text ZonaComercial \"Commercial zone\"\n        float Comision1 \"Commission rate 1\"\n    }\n\n    Ventas {\n        float RegVentas PK \"Sale record ID\"\n        float NumCliente FK \"-> Clientes\"\n        text Cliente \"Customer name\"\n    }\n\n    GCAlbaranes {\n        float RegAlbaran PK \"Delivery note ID\"\n        float NumCliente FK \"-> Clientes\"\n    }\n\n    GCFacturas {\n        float RegFactura PK \"Invoice ID\"\n        float NumCliente FK \"-> Clientes\"\n    }\n\n    CobrosFacturas {\n        float RegCobroRefAde PK \"Collection record ID\"\n        float NumCliente FK \"-> Clientes\"\n    }\n\n    Clientes }o--|| GCComerciales : \"NumComercial -> RegComercial\"\n    Clientes ||--o{ Ventas : \"RegCliente -> NumCliente\"\n    Clientes ||--o{ GCAlbaranes : \"RegCliente -> NumCliente\"\n    Clientes ||--o{ GCFacturas : \"RegCliente -> NumCliente\"\n    Clientes ||--o{ CobrosFacturas : \"RegCliente -> NumCliente\"\n```",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/customers.md",
    "heading": "Notes",
    "body": "- **Clientes** has 311 columns including: multiple address sets (billing, shipping, invoicing), up to 12 payment installment fields, bank details (Banco, Agencia, CuentaCorriente, IBAN, BIC), risk management (RiesgoConcedid, BloqueoFinancials), loyalty (ImpTarjetaPuntos), and extensive CRM fields.\n- The same `Clientes` table serves both retail POS customers (linked via `Ventas.NumCliente`) and wholesale clients (linked via `GCAlbaranes.NumCliente`, `GCFacturas.NumCliente`).\n- **Customer segmentation is `TipoCliente`, and none of it is mirrored.** 4D `Clientes` has both a `Mayorista` boolean and a `TipoCliente` text field; the one that actually segments the business is **`TipoCliente`** (uppercase text: `'FRANQUICIADO INTERNO'`, `'FRANQUICIADO'`, `'MAYORISTA'`, `'MINORISTA'`). **Neither field is synced into `ps_clientes`** — the mirror has only `reg_cliente, num_cliente, nombre, nif, email, codigo_postal, poblacion, pais, fecha_creacion, fecha_modifica, ultima_compra_f`. A query against the mirror using `mayorista` fails outright with *column does not exist*; segment by **channel** instead (present in `ps_ventas` ⇒ retail, present in `ps_gc_albaranes`/`ps_gc_facturas` ⇒ wholesale). A customer can legitimately be in both. `B2B1..B2B4Provisional` flags track provisional B2B portal access levels.\n- **GCComerciales** links customers to sales representatives via `Clientes.NumComercial -> GCComerciales.RegComercial`.\n- **Optical module**: `Medida1..Medida26` + `MedidaT1..MedidaT26` store 26 optical prescription measurements per customer (eyeglass prescriptions). Label slots (MedidaT*) contain measurement names.\n- **Wapping**: `Wapping_ID` links the customer to the Wapping omnichannel loyalty platform.\n- **GDPR**: `PoliticaPrivacidad` (policy accepted), `FAcceptaComuni` (date accepted communications), `FAcceptaPP` (date accepted privacy policy) are GDPR consent fields — required for marketing.\n- The CRM module (CRMCampañas, CRMVisitados, etc.) exists in the schema but is completely empty.\n\n---",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/customers.md",
    "heading": "LLM:tables",
    "body": "```json\n[\n  {\n    \"table\": \"ps_clientes\",\n    \"alias\": \"Cliente\",\n    \"description\": \"Clientes. num_cliente=0 son ventas anónimas. NO tiene campo mayorista ni tipo_cliente: segmentar por canal (ps_ventas = retail, ps_gc_albaranes/ps_gc_facturas = mayorista). nif = 502108150 marca sociedades del propio grupo (19 registros).\",\n    \"keyColumns\": [\"reg_cliente (PK)\", \"num_cliente\", \"nombre\", \"nif\", \"email\", \"codigo_postal\", \"poblacion\", \"pais\", \"fecha_creacion\", \"fecha_modifica\", \"ultima_compra_f\"]\n  }\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/wholesale.md",
    "heading": "Entity Relationship Diagram",
    "body": "```mermaid\nerDiagram\n    GCPedidos {\n        float RegPedido PK \"Order record ID\"\n        float NPedido \"Order number\"\n        date FechaPedido \"Order date\"\n        float NumCliente FK \"-> Clientes.RegCliente\"\n        text Cliente \"Customer name (denorm)\"\n        float NumComercial FK \"-> GCComerciales\"\n        text Comercial \"Sales rep name (denorm)\"\n        float TotalPedido \"Order total\"\n        float ImporteBruto \"Gross amount\"\n        float Unidades \"Total units\"\n        float Entregadas \"Units delivered\"\n        float Pendientes \"Units pending\"\n        text FormaPago \"Payment method\"\n        int Tarifa \"Price list used\"\n        boolean LlevaIva \"Subject to VAT\"\n        boolean LlevaRE \"Subject to surcharge\"\n        text Temporada \"Season name\"\n        float NumTemporada FK \"-> CCOPTempTipo\"\n        text TiendaAlmacen \"Warehouse/store\"\n        boolean PedidoCerrado \"Order closed\"\n        boolean Abono \"Is credit note\"\n        boolean Presupuesto \"Is quote\"\n    }\n\n    GCLinPedidos {\n        float RegLinea PK \"Line record ID\"\n        float NumPedido FK \"-> GCPedidos.RegPedido\"\n        float NumArticulo FK \"-> Articulos.RegArticulo\"\n        text Codigo \"Article code (denorm)\"\n        text Descripcion \"Description (denorm)\"\n        float PrecioBruto \"Gross unit price\"\n        float PrecioNeto \"Net unit price\"\n        float Unidades \"Qty ordered (total)\"\n        float Entregadas \"Qty delivered (total)\"\n        float Pendientes \"Qty pending\"\n        float Asignadas \"Warehouse allocated (total)\"\n        float Total \"Line total\"\n        float TotalNeto \"Net total\"\n        float PIva \"VAT %\"\n        text Lote \"Lot/batch\"\n        text TipoP \"Order type\"\n        text ClaveTemporada \"Season key\"\n        text Modelo \"Model code\"\n        float NumFamilia FK \"-> FamiGrupMarc\"\n        float NumDepartament FK \"-> DepaSeccFabr\"\n        float NumTemporada FK \"-> CCOPTempTipo\"\n        float NumMarca FK \"-> CCOPMarcTrat\"\n        float NumColor FK \"-> CCOPColores\"\n        int Talla1_34 \"34 size label slots (TALLA1..TALLA34)\"\n        int Pedidas1_34 \"34 ordered qty slots (PEDIDAS1..PEDIDAS34)\"\n        int Entregadas1_34 \"34 delivered qty slots (ENTREGADAS1..ENTREGADAS34)\"\n        int Asignadas1_34 \"34 warehouse-allocated slots (ASIGNADAS1..ASIGNADAS34)\"\n        int Original1_34 \"34 original order qty slots (ORIGINAL1..ORIGINAL34)\"\n    }\n\n    GCAlbaranes {\n        float RegAlbaran PK \"Delivery note record ID\"\n        float NAlbaran \"Delivery note number\"\n        date FechaEnvio \"Shipping date\"\n        float NumCliente FK \"-> Clientes.RegCliente\"\n        text Cliente \"Customer name (denorm)\"\n        float NumComercial FK \"-> GCComerciales\"\n        text Comercial \"Sales rep (denorm)\"\n        text Transportista \"Carrier name\"\n        float TotalAlbaran \"Total amount\"\n        float ImporteBruto \"Gross amount\"\n        float Unidades \"Total units\"\n        text FormaPago \"Payment method\"\n        int Tarifa \"Price list used\"\n        int SerieF \"Invoice series\"\n        boolean LlevaIva \"Subject to VAT\"\n        boolean Abono \"Is credit note\"\n        boolean Deposito \"Is deposit/consignment\"\n        text TiendaAlmacen \"Warehouse/store\"\n        text Temporada \"Season name\"\n        text TrackingNumber \"Carrier tracking number\"\n        text TrackingInfo \"Tracking status info\"\n        text TrackingURL \"Carrier tracking URL\"\n        date TrackingFEntrega \"Delivery date from carrier\"\n        date TrackingFEnvio \"Shipment date from carrier\"\n        text IntegradorMK \"Marketplace integrator code\"\n        text Marketplace \"Marketplace name (e-commerce)\"\n        text IDOrderMarket \"Marketplace order ID\"\n        text CarrierTipoEnvio \"Carrier shipment type\"\n        text IDSendCloud \"SendCloud shipment ID\"\n        float JoPorPesoUni \"Jewelry: price-per-gram unit\"\n        float JoConversion \"Jewelry: weight conversion factor\"\n        float PesoJoGramos \"Jewelry: item weight in grams\"\n        float JoGramosTotal \"Jewelry: total grams for line\"\n    }\n\n    GCLinAlbarane {",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/wholesale.md",
    "heading": "Notes",
    "body": "- The wholesale flow follows a standard document chain: **Order -> Delivery Note -> Invoice -> Collection**.\n- **GCLinAlbarane** (1M+ rows) is the primary source for wholesale sales analytics, carrying full product classification (family, department, season, brand, color) denormalized for reporting.\n- **GCLinFacturas** closely mirrors GCLinAlbarane but at the invoice level. Both carry `Mes` (YYYYMM) for period filtering.\n- All header tables (GCPedidos, GCAlbaranes, GCFacturas) link to `Clientes` via `NumCliente` and to `GCComerciales` via `NumComercial`.\n- **GCLinPedidos** is the widest wholesale table (239 columns) due to the 5-dimension × 34-slot size matrix.\n- **Wholesale also handles e-commerce**: GCAlbaranes has Marketplace, IDOrderMarket, and IntegradorMK fields — same pattern as retail Ventas. Discovered 2026-04-05.\n- **Jewelry weight-based pricing**: GCAlbaranes has JoPorPesoUni, JoConversion, PesoJoGramos, JoGramosTotal — indicates the business sells jewelry priced by weight in the wholesale channel. Discovered 2026-04-05.\n- **Effective date of a delivery note = `FechaEnvio` if `>= 2000-01-01`, else `FechaValor`.** Not-yet-shipped notes carry a NULL or pre-2000 sentinel in `FechaEnvio`, so filtering a period on `fecha_envio` alone drops them silently. Use `CASE WHEN a.fecha_envio >= DATE '2000-01-01' THEN a.fecha_envio ELSE a.fecha_valor END`. Mirror impact today is 1 row out of 52,148 (measured 2026-08), but the sentinel reappears as soon as pending notes sync, so the pattern is mandatory rather than optional.\n- **CIF `502108150` marks intra-group traffic.** That tax ID (LINFE LDA / MHIA, Portugal) belongs to the group's own companies and is spread across **19 distinct `ps_clientes` rows** with different `num_cliente` *and different names* (LINFE FUNCHAL, LINFE FACTORY, MHIA CALDAS, MHIA TOMAR, MHIA ABRANTES, Linfe Moda Feminina Lda…). A wholesale delivery note or invoice to that CIF is **not a sale outside the group** — it is an internal movement. Exclude it by NIF, never by name: `JOIN ps_clientes c ON a.num_cliente = c.reg_cliente WHERE COALESCE(c.nif,'') <> '502108150'`. In 2026 it accounts for 38 delivery notes and ~€29,900.",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/wholesale.md",
    "heading": "Query pattern",
    "body": "To aggregate size-level quantities, unpivot the 34 slots in PostgreSQL:\n```sql\n-- Example: total units per size across all delivery note lines\nSELECT size_slot, SUM(qty_delivered) AS units\nFROM ps_gc_lin_albarane\nCROSS JOIN LATERAL (VALUES\n  (talla1, entregadas1), (talla2, entregadas2), ... (talla34, entregadas34)\n) AS t(size_slot, qty_delivered)\nWHERE size_slot IS NOT NULL AND qty_delivered > 0\nGROUP BY size_slot\nORDER BY units DESC;\n```\nThis is expensive on 1M rows — add a `WHERE numalbaran IN (...)` filter when possible.",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/wholesale.md",
    "heading": "ETL Sync Strategy",
    "body": "> Validated against production data 2026-03-30.\n\n| Table | Rows | Delta field | Strategy |\n|-------|------|-------------|---------|\n| GCAlbaranes | 48,948 | `Modifica` (~19 modified/day, ~833/month) | UPSERT delta |\n| GCLinAlbarane | 1,016,290 | **None** | Delete+reinsert via parent `Modifica` |\n| GCFacturas | 18,060 | `Modifica` (all rows populated) | UPSERT delta |\n| GCLinFacturas | 974,742 | **None** | Delete+reinsert via parent `Modifica` |\n| GCPedidos | 101 | `Modifica` | Full refresh (trivially small) |\n| GCLinPedidos | 2,645 | None | Full refresh (trivially small) |\n\n**Lines delta pattern** (no modification timestamp on line tables):\n```sql\n-- Fetch lines for recently changed delivery notes.\n-- The parent key is the 4D record ID (RegAlbaran), never the visible NAlbaran.\nSELECT * FROM GCLinAlbarane\nWHERE NumAlbaran IN (SELECT RegAlbaran FROM GCAlbaranes WHERE Modifica >= :last_sync)\n-- → DELETE + INSERT in PostgreSQL for those RegAlbaran values\n```\n\n**Line → header join key (corrected 2026-08-29):**\nDespite the `Num` prefix, the line tables carry the parent's **4D record ID**:\n- `GCLinAlbarane.NumAlbaran` → `GCAlbaranes.RegAlbaran` (4000/4000 on a production sample)\n- `GCLinFacturas.NumFactura` → `GCFacturas.RegFactura` (4000/4000)\n\nThe *visible* document numbers are the wrong key on both counts:\n`GCLinFacturas.NumFactura` matches `GCFacturas.NFactura` **0/4000**, and neither\nvisible number is unique (52,148 GCAlbaranes rows carry 40,727 distinct\n`NAlbaran` values; 19,351 GCFacturas rows carry 14,515 distinct `NFactura`\nvalues), so joining on them mixes lines from unrelated documents.  The ETL used\nthe visible numbers until 2026-08-29: the invoice-line delta re-inserted 0 rows\non every nightly run, and the mirror had drifted 1,873 invoice lines and 3,826\ndelivery-note lines behind 4D.\n\nSee [etl-sync-strategy.md](../etl-sync-strategy.md) for the full sync plan.\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/architecture/wholesale.md",
    "heading": "LLM:tables",
    "body": "```json\n[\n  {\n    \"table\": \"ps_gc_albaranes\",\n    \"alias\": \"AlbaranMayorista\",\n    \"description\": \"Albaranes mayorista. Importe neto = base1 + base2 + base3. Fecha efectiva = fecha_envio si >= 2000-01-01, si no fecha_valor. abono=true son devoluciones del cliente (entrada de stock), abono=false son envios.\",\n    \"keyColumns\": [\"reg_albaran (PK)\", \"n_albaran\", \"num_cliente (FK)\", \"num_comercial (FK)\", \"fecha_envio (usar con fecha_valor como fallback)\", \"fecha_valor\", \"base1\", \"base2\", \"base3\", \"entregadas\", \"abono\", \"temporada\"]\n  },\n  {\n    \"table\": \"ps_gc_lin_albarane\",\n    \"alias\": \"LineaAlbaranMayorista\",\n    \"description\": \"Líneas de albarán mayorista.\",\n    \"keyColumns\": [\"n_albaran (FK)\", \"codigo\", \"unidades\", \"total\"]\n  },\n  {\n    \"table\": \"ps_gc_facturas\",\n    \"alias\": \"FacturaMayorista\",\n    \"description\": \"Facturas mayorista. Importe neto = base1 + base2 + base3.\",\n    \"keyColumns\": [\"reg_factura (PK)\", \"n_factura\", \"fecha_factura\", \"num_cliente (FK)\", \"num_comercial (FK)\", \"base1\", \"base2\", \"base3\", \"abono\", \"total_factura (CON IVA)\"]\n  },\n  {\n    \"table\": \"ps_gc_lin_facturas\",\n    \"alias\": \"LineaFacturaMayorista\",\n    \"description\": \"Líneas de factura mayorista.\",\n    \"keyColumns\": [\"num_factura (FK)\", \"codigo\", \"unidades\", \"total\", \"total_coste\"]\n  },\n  {\n    \"table\": \"ps_gc_pedidos\",\n    \"alias\": \"PedidoMayorista\",\n    \"description\": \"Pedidos mayorista.\",\n    \"keyColumns\": [\"reg_pedido (PK)\", \"num_cliente (FK)\"]\n  },\n  {\n    \"table\": \"ps_gc_lin_pedidos\",\n    \"alias\": \"LineaPedidoMayorista\",\n    \"description\": \"Líneas de pedido mayorista.\",\n    \"keyColumns\": [\"num_pedido (FK)\", \"codigo\", \"unidades\"]\n  },\n  {\n    \"table\": \"ps_gc_comerciales\",\n    \"alias\": \"Comercial\",\n    \"description\": \"Comerciales/agentes de ventas mayorista.\",\n    \"keyColumns\": [\"reg_comercial (PK)\", \"comercial\"]\n  }\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/wholesale.md",
    "heading": "LLM:relationships",
    "body": "<!--\nLAS LÍNEAS SE UNEN POR EL ID DE REGISTRO 4D, NUNCA POR EL NÚMERO VISIBLE.\n\n`Num*` en una tabla de líneas apunta al `Reg*` de su cabecera (el ID interno de\n4D), NO al `N*` (el número que ve el usuario en el documento). Los nombres\ninducen a error justo al revés de lo que parece.\n\nMedido contra el 4D de producción sobre muestras de 2.000-4.000 líneas:\n\n  GCLinFacturas.NumFactura -> RegFactura  4000/4000   -> NFactura  0/4000\n  GCLinAlbarane.NumAlbaran -> RegAlbaran  4000/4000   -> NAlbaran  0/4000\n  GCLinPedidos.NumPedido   -> RegPedido   2000/2000   -> NPedido   0/2000\n\nY los números visibles NO son únicos (40.727 NAlbaran distintos para 52.148\nalbaranes; 76 NPedido para 120 pedidos), así que unir por ellos además mezcla\nlíneas de documentos distintos.\n\nEste fichero declaraba las tres relaciones al revés. Consecuencia real: el ETL\nmayorista perdió 5.699 líneas y toda consulta mayorista que generase el\ndashboard salía vacía o se multiplicaba.\n-->\n\n```json\n[\n  {\"from\": \"ps_gc_lin_albarane\", \"fromColumn\": \"num_albaran\", \"to\": \"ps_gc_albaranes\",   \"toColumn\": \"reg_albaran\",  \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_gc_lin_facturas\", \"fromColumn\": \"num_factura\", \"to\": \"ps_gc_facturas\",    \"toColumn\": \"reg_factura\",  \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_gc_albaranes\",    \"fromColumn\": \"num_cliente\", \"to\": \"ps_clientes\",       \"toColumn\": \"reg_cliente\",  \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_gc_facturas\",     \"fromColumn\": \"num_cliente\", \"to\": \"ps_clientes\",       \"toColumn\": \"reg_cliente\",  \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_gc_albaranes\",    \"fromColumn\": \"num_comercial\", \"to\": \"ps_gc_comerciales\", \"toColumn\": \"reg_comercial\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_gc_facturas\",     \"fromColumn\": \"num_comercial\", \"to\": \"ps_gc_comerciales\", \"toColumn\": \"reg_comercial\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_gc_pedidos\",      \"fromColumn\": \"num_cliente\", \"to\": \"ps_clientes\",       \"toColumn\": \"reg_cliente\",  \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_gc_lin_pedidos\",  \"fromColumn\": \"num_pedido\",  \"to\": \"ps_gc_pedidos\",     \"toColumn\": \"reg_pedido\",   \"type\": \"MANY_TO_ONE\"}\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/stores-hr.md",
    "heading": "Notes",
    "body": "- **Tiendas** has 208 columns (via `Tiendas_SQL` view) covering store identity, multi-register config, franchise data, fiscal settings, web/commerce flags, airport concession financials, and operational parameters. Column count corrected from 209 to 208 on 2026-04-05.\n- **Exportaciones** (2M+ rows) is the largest table by row count -- it logs all data synchronization events between stores and the central server.\n- **RRHHEmpleados** includes per-module access flags (PDFuturShop, PDWarehouse, PDFinancials, PDCommerce, PDAdministrador, etc.) acting as a permission system.\n- The full HR module (RRHH*) has 17+ tables but only RRHHEmpleados (15 rows) and RRHHAcceso (937 rows) contain data. The rest of the HR functionality is unused.\n- **Vales** (54K rows) tracks vouchers/store credit across stores, with both issuance and redemption tracked by store.\n- **FormasPago** is a shared lookup used by POS, wholesale, and purchasing modules. Has 30 columns including 12 payment installment slots (`VP1..VP12`), bank remittance flags, Datisa ERP integration code (`CodigoDatisa`), and wholesale-specific flags (`GCDPP`, `GCSinImpuestos`). Referenced as `FormaPago` FK from Clientes, Ventas, GCPedidos, GCFacturas.\n- **AENA_* fields** are only populated for stores operating inside airports under AENA concessions — null for all regular stores.\n- The `CON*` accounting fields map store transactions to the chart of accounts in the connected accounting ERP. Each store can have a different account structure.\n\n---",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "Dashboard SQL Pairs",
    "body": "Curated question → SQL examples for the dashboard LLM prompt.\n\nThese pairs teach the LLM how to translate natural-language business questions\ninto correct PostgreSQL queries against the `ps_*` mirror tables.\n\n**Rules for new pairs:**\n- Always use `:curr_from` / `:curr_to` for current-period date ranges (never `CURRENT_DATE` or bare `INTERVAL`).\n- Use `:comp_from` / `:comp_to` only for explicitly comparative questions (YoY, año anterior, etc.).\n- Always use `total_si` (not `total`) for sales amounts.\n- Always filter `entrada = true` for sales, `entrada = false` for returns. **`entrada` exists only on `ps_ventas`, NOT on `ps_lineas_ventas`** — when querying `ps_lineas_ventas`, JOIN `ps_ventas v ON lv.num_ventas = v.reg_ventas` and filter `v.entrada`.\n- Exclude tienda `'99'` from retail store rankings.\n- Test new SQL against the local mirror with `ps sql query \"...\"`.\n\n---",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "LLM:sql-pairs",
    "body": "<!--\nREGLA QUE GOBIERNA TODOS LOS PARES DE ABAJO — \"ventas\" significa NETO.\n\nPowerShop presenta tres cifras distintas en su pantalla de caja:\n  01VEN  ventas brutas\n  02DEV  devoluciones   (importe guardado en POSITIVO)\n  NETO   01VEN - 02DEV  <- esto es lo que el usuario llama \"ventas\"\n\nFiltrar `entrada = true` a secas DESCARTA las devoluciones en vez de restarlas\ny sobrestima las ventas entre un 7 y un 10 % (medido en produccion, 2026-08:\n~20.000 EUR/mes de devoluciones ignoradas). Verificado contra la pantalla del\nERP de Ferrol el 2026-08-29: ventas 1.630,09 - devoluciones 201,46 = NETO\n1.428,63; el panel mostraba el bruto.\n\nPatron obligatorio para cualquier importe o unidad agregada de ps_ventas,\nps_lineas_ventas o ps_pagos_ventas:\n\n  COALESCE(SUM(x) FILTER (WHERE v.\"entrada\"), 0)\n  - COALESCE(SUM(x) FILTER (WHERE NOT v.\"entrada\"), 0)\n\nLos COALESCE NO son decorativos. SUM(...) FILTER (...) devuelve NULL cuando el\ngrupo no tiene ninguna fila de ese lado, y NULL - algo = NULL, asi que la fila\nentera sale vacia. Sin ellos el 30,6 % de los grupos de un ranking por articulo\nsalen NULL y, como NULL ordena primero en DESC, el \"top 10\" acaba siendo diez\nfilas vacias. Medido en produccion el 2026-08-29: 8.726 de 28.493 referencias.\n\nExcepciones legitimas (usar entrada=true a secas):\n  - contar TICKETS de venta (una devolucion no es un ticket vendido)\n  - la propia consulta de devoluciones, que filtra entrada=false\n\nNO es una excepcion el \"descuento medio\": ps_lineas_ventas no tiene p_desc_g ni\nimporte_descuento (existen en 4D LineasVentas, pero el ETL no las sincroniza),\nasi que esa metrica no se puede calcular contra el espejo.\n\nOtras reglas que gobiernan los pares de abajo:\n  - ps_clientes NO tiene 'mayorista' ni 'tipo_cliente'; segmentar por canal\n    (ps_ventas = retail, ps_gc_albaranes / ps_gc_facturas = mayorista).\n  - ps_traspasos: excluir SIEMPRE tipo IN ('Apertura','Inventario Parcial'),\n    que son asientos de inventario y suponen el 94 % de la tabla.\n  - albaran mayorista: fecha efectiva = fecha_envio si >= 2000-01-01, si no\n    fecha_valor.\n  - CIF 502108150 (19 registros de ps_clientes) es trafico intragrupo, no venta.\n  - ccrefejofacm es REFERENCIA+COLOR; el modelo es\n    LEFT(ccrefejofacm, LENGTH(ccrefejofacm) - 2).\n-->",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son los 10 artículos más vendidos por cantidad?",
    "body": "```sql\nSELECT p.\"ccrefejofacm\" AS \"Referencia\", p.\"descripcion\" AS \"Descripción\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades Vendidas\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" GROUP BY p.\"ccrefejofacm\", p.\"descripcion\" ORDER BY \"Unidades Vendidas\" DESC LIMIT 10\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son los 10 modelos más vendidos?",
    "body": "```sql\nSELECT LEFT(p.\"ccrefejofacm\", LENGTH(p.\"ccrefejofacm\") - 2) AS \"Modelo\", MIN(p.\"descripcion\") AS \"Descripción\", COUNT(DISTINCT p.\"ccrefejofacm\") AS \"Colores\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades Vendidas\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" WHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND LENGTH(p.\"ccrefejofacm\") > 2 GROUP BY 1 ORDER BY \"Unidades Vendidas\" DESC LIMIT 10\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son las ventas netas por tienda este mes?",
    "body": "```sql\nSELECT v.\"tienda\" AS \"Tienda\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COUNT(DISTINCT v.\"reg_ventas\") AS \"Tickets\" FROM \"public\".\"ps_ventas\" v WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND v.\"tienda\" <> '99' GROUP BY v.\"tienda\" ORDER BY \"Ventas Netas\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son las ventas de la semana pasada por tienda?",
    "body": "```sql\nSELECT v.\"tienda\" AS \"Tienda\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COUNT(DISTINCT v.\"reg_ventas\") AS \"Tickets\" FROM \"public\".\"ps_ventas\" v WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND v.\"tienda\" <> '99' GROUP BY v.\"tienda\" ORDER BY \"Ventas Netas\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuál es el ticket medio?",
    "body": "```sql\nSELECT ROUND((COALESCE(SUM(\"total_si\") FILTER (WHERE \"entrada\"), 0) - COALESCE(SUM(\"total_si\") FILTER (WHERE NOT \"entrada\"), 0)) / NULLIF(COUNT(DISTINCT \"reg_ventas\") FILTER (WHERE \"entrada\"), 0), 2) AS \"Ticket Medio\" FROM \"public\".\"ps_ventas\" WHERE \"tienda\" <> '99' AND \"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuántas devoluciones hubo este mes?",
    "body": "```sql\nSELECT COUNT(*) AS \"Devoluciones\", SUM(\"total_si\") AS \"Importe Devuelto\" FROM \"public\".\"ps_ventas\" WHERE \"entrada\" = false AND \"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son las ventas de hoy?",
    "body": "```sql\nSELECT v.\"tienda\" AS \"Tienda\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COUNT(DISTINCT v.\"reg_ventas\") AS \"Tickets\" FROM \"public\".\"ps_ventas\" v WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND v.\"tienda\" <> '99' GROUP BY v.\"tienda\" ORDER BY \"Ventas Netas\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuánto vendimos ayer?",
    "body": "```sql\nSELECT COALESCE(SUM(\"total_si\") FILTER (WHERE \"entrada\"), 0) - COALESCE(SUM(\"total_si\") FILTER (WHERE NOT \"entrada\"), 0) AS \"Ventas Netas\", COUNT(DISTINCT \"reg_ventas\") AS \"Tickets\" FROM \"public\".\"ps_ventas\" WHERE \"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ventas netas acumuladas del año (YTD) comparadas con el año anterior?",
    "body": "```sql\nSELECT 'Este año' AS \"Período\", COALESCE(SUM(\"total_si\") FILTER (WHERE \"entrada\"), 0) - COALESCE(SUM(\"total_si\") FILTER (WHERE NOT \"entrada\"), 0) AS \"Ventas Netas\", COUNT(DISTINCT \"reg_ventas\") AS \"Tickets\" FROM \"public\".\"ps_ventas\" WHERE \"fecha_creacion\" BETWEEN :curr_from AND :curr_to UNION ALL SELECT 'Año anterior' AS \"Período\", COALESCE(SUM(\"total_si\") FILTER (WHERE \"entrada\"), 0) - COALESCE(SUM(\"total_si\") FILTER (WHERE NOT \"entrada\"), 0) AS \"Ventas Netas\", COUNT(DISTINCT \"reg_ventas\") AS \"Tickets\" FROM \"public\".\"ps_ventas\" WHERE \"fecha_creacion\" BETWEEN :comp_from AND :comp_to\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ventas mensuales por tienda en el año actual?",
    "body": "```sql\nSELECT DATE_TRUNC('month', v.\"fecha_creacion\") AS \"Mes\", v.\"tienda\" AS \"Tienda\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COUNT(DISTINCT v.\"reg_ventas\") AS \"Tickets\" FROM \"public\".\"ps_ventas\" v WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND v.\"tienda\" <> '99' GROUP BY DATE_TRUNC('month', v.\"fecha_creacion\"), v.\"tienda\" ORDER BY \"Mes\", v.\"tienda\"\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuántas unidades vendimos la semana pasada?",
    "body": "```sql\nSELECT COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ventas por día de la semana?",
    "body": "```sql\nSELECT TO_CHAR(v.\"fecha_creacion\", 'Day') AS \"Día\", EXTRACT(DOW FROM v.\"fecha_creacion\") AS \"Num Día\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COUNT(DISTINCT v.\"reg_ventas\") AS \"Tickets\" FROM \"public\".\"ps_ventas\" v WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND v.\"tienda\" <> '99' GROUP BY TO_CHAR(v.\"fecha_creacion\", 'Day'), EXTRACT(DOW FROM v.\"fecha_creacion\") ORDER BY EXTRACT(DOW FROM v.\"fecha_creacion\")\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son los 10 artículos más vendidos por importe?",
    "body": "```sql\nSELECT p.\"ccrefejofacm\" AS \"Referencia\", p.\"descripcion\" AS \"Descripción\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Importe Neto\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" GROUP BY p.\"ccrefejofacm\", p.\"descripcion\" ORDER BY \"Importe Neto\" DESC LIMIT 10\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Qué familias de producto venden más?",
    "body": "```sql\nSELECT fm.\"fami_grup_marc\" AS \"Familia\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" JOIN \"public\".\"ps_familias\" fm ON p.\"num_familia\" = fm.\"reg_familia\" GROUP BY fm.\"fami_grup_marc\" ORDER BY \"Ventas Netas\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ventas por departamento?",
    "body": "```sql\nSELECT d.\"depa_secc_fabr\" AS \"Departamento\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" JOIN \"public\".\"ps_departamentos\" d ON p.\"num_departament\" = d.\"reg_departament\" GROUP BY d.\"depa_secc_fabr\" ORDER BY \"Ventas Netas\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ventas por temporada de la colección?",
    "body": "```sql\nSELECT p.\"clave_temporada\" AS \"Temporada\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\", COUNT(DISTINCT p.\"ccrefejofacm\") AS \"Artículos\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" GROUP BY p.\"clave_temporada\" ORDER BY \"Ventas Netas\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ventas por marca?",
    "body": "```sql\nSELECT m.\"marca_tratamien\" AS \"Marca\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" JOIN \"public\".\"ps_marcas\" m ON p.\"num_marca\" = m.\"reg_marca\" GROUP BY m.\"marca_tratamien\" ORDER BY \"Ventas Netas\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuántos artículos activos hay en el catálogo?",
    "body": "```sql\nSELECT COUNT(*) AS \"Total Artículos\", SUM(CASE WHEN \"ccrefejofacm\" IS NULL OR \"ccrefejofacm\" NOT LIKE 'M%' THEN 1 ELSE 0 END) AS \"Retail\", SUM(CASE WHEN \"ccrefejofacm\" LIKE 'M%' THEN 1 ELSE 0 END) AS \"Mayorista\" FROM \"public\".\"ps_articulos\" WHERE \"anulado\" = false\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuál es el stock total por tienda?",
    "body": "```sql\nSELECT s.\"tienda\" AS \"Tienda\", SUM(s.\"stock\") AS \"Stock Total\", COUNT(DISTINCT s.\"codigo\") AS \"Artículos\" FROM \"public\".\"ps_stock_tienda\" s WHERE s.\"stock\" > 0 GROUP BY s.\"tienda\" ORDER BY \"Stock Total\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Qué artículos tienen más stock en el almacén central?",
    "body": "```sql\nSELECT s.\"codigo\" AS \"Código\", p.\"ccrefejofacm\" AS \"Referencia\", p.\"descripcion\" AS \"Descripción\", SUM(s.\"stock\") AS \"Stock\" FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" WHERE s.\"tienda\" = '99' AND s.\"stock\" > 0 GROUP BY s.\"codigo\", p.\"ccrefejofacm\", p.\"descripcion\" ORDER BY \"Stock\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuál es el valor del stock al coste?",
    "body": "```sql\nSELECT SUM(s.\"stock\" * p.\"precio_coste\") AS \"Valor al Coste\", SUM(s.\"stock\") AS \"Unidades Totales\", COUNT(DISTINCT s.\"codigo\") AS \"Referencias\" FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" WHERE s.\"stock\" > 0 AND p.\"anulado\" = false\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Qué tallas se venden más de una referencia?",
    "body": "```sql\nSELECT UPPER(lv.\"talla\") AS \"Talla\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" WHERE p.\"ccrefejofacm\" = 'REFERENCIA_AQUI' AND lv.\"talla\" IS NOT NULL GROUP BY UPPER(lv.\"talla\") ORDER BY \"Unidades\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son las tallas más vendidas de toda la cadena?",
    "body": "```sql\nSELECT UPPER(lv.\"talla\") AS \"Talla\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" WHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND lv.\"tienda\" <> '99' AND lv.\"talla\" IS NOT NULL GROUP BY UPPER(lv.\"talla\") ORDER BY \"Unidades\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Qué tallas vendo bien pero no tengo en stock?",
    "body": "```sql\nWITH vendido AS (SELECT p.\"ccrefejofacm\" AS ref, UPPER(lv.\"talla\") AS talla, COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS uds FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" WHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND lv.\"talla\" IS NOT NULL GROUP BY 1, 2), stock AS (SELECT p.\"ccrefejofacm\" AS ref, UPPER(s.\"talla\") AS talla, SUM(s.\"stock\") AS stock FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" WHERE s.\"tienda\" <> '99' GROUP BY 1, 2) SELECT v.ref AS \"Referencia\", v.talla AS \"Talla\", v.uds AS \"Vendidas\", COALESCE(st.stock, 0) AS \"Stock\" FROM vendido v LEFT JOIN stock st ON st.ref = v.ref AND st.talla = v.talla WHERE v.uds > 0 AND COALESCE(st.stock, 0) <= 0 ORDER BY v.uds DESC LIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son las ventas, devoluciones y neto por tienda?",
    "body": "```sql\nSELECT \"tienda\" AS \"Tienda\", COALESCE(SUM(\"total_si\") FILTER (WHERE \"entrada\"), 0) AS \"Ventas (01VEN)\", COALESCE(SUM(\"total_si\") FILTER (WHERE NOT \"entrada\"), 0) AS \"Devoluciones (02DEV)\", COALESCE(SUM(\"total_si\") FILTER (WHERE \"entrada\"), 0) - COALESCE(SUM(\"total_si\") FILTER (WHERE NOT \"entrada\"), 0) AS \"Neto (NETO)\", COUNT(DISTINCT \"reg_ventas\") FILTER (WHERE \"entrada\") AS \"Tickets\" FROM \"public\".\"ps_ventas\" WHERE \"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND \"tienda\" <> '99' GROUP BY \"tienda\" ORDER BY \"Neto (NETO)\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Stock por artículo y talla?",
    "body": "```sql\nSELECT s.\"codigo\" AS \"Código\", p.\"ccrefejofacm\" AS \"Referencia\", s.\"talla\" AS \"Talla\", SUM(s.\"stock\") AS \"Stock\" FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" WHERE s.\"stock\" > 0 GROUP BY s.\"codigo\", p.\"ccrefejofacm\", s.\"talla\" ORDER BY p.\"ccrefejofacm\", s.\"talla\"\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Artículos con stock negativo?",
    "body": "```sql\nSELECT s.\"codigo\" AS \"Código\", p.\"ccrefejofacm\" AS \"Referencia\", s.\"tienda\" AS \"Tienda\", s.\"talla\" AS \"Talla\", s.\"stock\" AS \"Stock\" FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" WHERE s.\"stock\" < 0 ORDER BY s.\"stock\" ASC LIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Stock por familia de producto?",
    "body": "```sql\nSELECT fm.\"fami_grup_marc\" AS \"Familia\", SUM(s.\"stock\") AS \"Unidades\", ROUND(SUM(s.\"stock\" * p.\"precio_coste\"), 2) AS \"Valor Coste\" FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" JOIN \"public\".\"ps_familias\" fm ON p.\"num_familia\" = fm.\"reg_familia\" WHERE s.\"stock\" > 0 AND p.\"anulado\" = false GROUP BY fm.\"fami_grup_marc\" ORDER BY \"Unidades\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Artículos con stock pero sin ventas recientes (dead stock)?",
    "body": "```sql\nSELECT p.\"ccrefejofacm\" AS \"Referencia\", p.\"descripcion\" AS \"Descripción\", SUM(s.\"stock\") AS \"Stock\", p.\"clave_temporada\" AS \"Temporada\" FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" WHERE s.\"stock\" > 10 AND p.\"anulado\" = false AND p.\"codigo\" NOT IN (SELECT DISTINCT lv.\"codigo\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" WHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to) GROUP BY p.\"ccrefejofacm\", p.\"descripcion\", p.\"clave_temporada\" ORDER BY \"Stock\" DESC LIMIT 30\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Top artículos vendidos con su stock actual?",
    "body": "```sql\nSELECT p.\"ccrefejofacm\" AS \"Referencia\", p.\"descripcion\" AS \"Descripción\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades Vendidas\", COALESCE(SUM(s.\"stock\"), 0) AS \"Stock Actual\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" LEFT JOIN \"public\".\"ps_stock_tienda\" s ON lv.\"codigo\" = s.\"codigo\" WHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY p.\"ccrefejofacm\", p.\"descripcion\" ORDER BY \"Unidades Vendidas\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Distribución de stock por talla?",
    "body": "```sql\nSELECT s.\"talla\" AS \"Talla\", SUM(s.\"stock\") AS \"Unidades\" FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" WHERE s.\"stock\" > 0 AND s.\"tienda\" <> '99' AND p.\"anulado\" = false GROUP BY s.\"talla\" ORDER BY s.\"talla\" ASC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Qué familias y tallas tienen más roturas de stock (referencias sin stock)?",
    "body": "```sql\nWITH stock_por_codigo AS (SELECT COALESCE(NULLIF(TRIM(fm.\"fami_grup_marc\"), ''), 'Sin clasificar') AS familia, s.\"talla\", s.\"codigo\", SUM(s.\"stock\") AS stock_total FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" LEFT JOIN \"public\".\"ps_familias\" fm ON p.\"num_familia\" = fm.\"reg_familia\" WHERE s.\"tienda\" <> '99' AND p.\"anulado\" = false GROUP BY COALESCE(NULLIF(TRIM(fm.\"fami_grup_marc\"), ''), 'Sin clasificar'), s.\"talla\", s.\"codigo\") SELECT familia AS \"Familia\", \"talla\" AS \"Talla\", COUNT(CASE WHEN stock_total <= 0 THEN 1 END) AS \"Sin Stock\", COUNT(CASE WHEN stock_total > 0 THEN 1 END) AS \"Con Stock\", COUNT(*) AS \"Total Refs\", ROUND(COUNT(CASE WHEN stock_total <= 0 THEN 1 END)::NUMERIC / NULLIF(COUNT(*), 0) * 100, 1) AS \"% Rotura\" FROM stock_por_codigo GROUP BY familia, \"talla\" HAVING COUNT(CASE WHEN stock_total <= 0 THEN 1 END) > 0 ORDER BY \"% Rotura\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Qué artículos acumulan más stock por talla?",
    "body": "```sql\nSELECT COALESCE(NULLIF(TRIM(fm.\"fami_grup_marc\"), ''), 'Sin clasificar') AS \"Familia\", s.\"talla\" AS \"Talla\", COALESCE(NULLIF(p.\"ccrefejofacm\", ''), '—') AS \"Referencia\", COALESCE(NULLIF(p.\"descripcion\", ''), '—') AS \"Descripción\", SUM(s.\"stock\") AS \"Stock\" FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" LEFT JOIN \"public\".\"ps_familias\" fm ON p.\"num_familia\" = fm.\"reg_familia\" WHERE s.\"stock\" > 0 AND s.\"tienda\" <> '99' AND p.\"anulado\" = false GROUP BY COALESCE(NULLIF(TRIM(fm.\"fami_grup_marc\"), ''), 'Sin clasificar'), s.\"talla\", COALESCE(NULLIF(p.\"ccrefejofacm\", ''), '—'), COALESCE(NULLIF(p.\"descripcion\", ''), '—') ORDER BY \"Stock\" DESC LIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuál es la facturación mayorista por comercial?",
    "body": "```sql\nSELECT c.\"comercial\" AS \"Comercial\", COUNT(DISTINCT f.\"reg_factura\") AS \"Facturas\", SUM(f.\"base1\" + f.\"base2\" + f.\"base3\") AS \"Facturación Neta\" FROM \"public\".\"ps_gc_facturas\" f JOIN \"public\".\"ps_gc_comerciales\" c ON f.\"num_comercial\" = c.\"reg_comercial\" WHERE f.\"abono\" = false GROUP BY c.\"comercial\" ORDER BY \"Facturación Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Facturación mayorista mensual del año actual?",
    "body": "```sql\nSELECT DATE_TRUNC('month', f.\"fecha_factura\") AS \"Mes\", COUNT(DISTINCT f.\"reg_factura\") AS \"Facturas\", SUM(f.\"base1\" + f.\"base2\" + f.\"base3\") AS \"Importe Neto\" FROM \"public\".\"ps_gc_facturas\" f WHERE f.\"fecha_factura\" BETWEEN :curr_from AND :curr_to AND f.\"abono\" = false GROUP BY DATE_TRUNC('month', f.\"fecha_factura\") ORDER BY \"Mes\"\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son los principales clientes mayoristas por facturación?",
    "body": "```sql\nSELECT c.\"nombre\" AS \"Cliente\", COUNT(DISTINCT f.\"reg_factura\") AS \"Facturas\", SUM(f.\"base1\" + f.\"base2\" + f.\"base3\") AS \"Facturación Neta\" FROM \"public\".\"ps_gc_facturas\" f JOIN \"public\".\"ps_clientes\" c ON f.\"num_cliente\" = c.\"reg_cliente\" WHERE f.\"abono\" = false GROUP BY c.\"nombre\" ORDER BY \"Facturación Neta\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuántos albaranes mayoristas se enviaron este mes?",
    "body": "```sql\nSELECT COUNT(*) AS \"Albaranes\", SUM(a.\"entregadas\") AS \"Unidades\", SUM(a.\"base1\" + a.\"base2\" + a.\"base3\") AS \"Importe Neto\" FROM \"public\".\"ps_gc_albaranes\" a LEFT JOIN \"public\".\"ps_clientes\" c ON a.\"num_cliente\" = c.\"reg_cliente\" WHERE (CASE WHEN a.\"fecha_envio\" >= DATE '2000-01-01' THEN a.\"fecha_envio\" ELSE a.\"fecha_valor\" END) BETWEEN :curr_from AND :curr_to AND a.\"abono\" = false AND COALESCE(c.\"nif\", '') <> '502108150'\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Notas de crédito mayoristas (abonos) del año?",
    "body": "```sql\nSELECT c.\"nombre\" AS \"Cliente\", COUNT(*) AS \"Abonos\", SUM(a.\"base1\" + a.\"base2\" + a.\"base3\") AS \"Total Abonado\" FROM \"public\".\"ps_gc_albaranes\" a JOIN \"public\".\"ps_clientes\" c ON a.\"num_cliente\" = c.\"reg_cliente\" WHERE a.\"abono\" = true AND (CASE WHEN a.\"fecha_envio\" >= DATE '2000-01-01' THEN a.\"fecha_envio\" ELSE a.\"fecha_valor\" END) BETWEEN :curr_from AND :curr_to AND COALESCE(c.\"nif\", '') <> '502108150' GROUP BY c.\"nombre\" ORDER BY \"Total Abonado\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Productos más vendidos en canal mayorista?",
    "body": "```sql\nSELECT p.\"ccrefejofacm\" AS \"Referencia\", p.\"descripcion\" AS \"Descripción\", SUM(lf.\"unidades\") AS \"Unidades\", SUM(lf.\"total\") AS \"Importe\" FROM \"public\".\"ps_gc_lin_facturas\" lf JOIN \"public\".\"ps_articulos\" p ON lf.\"codigo\" = p.\"codigo\" WHERE lf.\"unidades\" > 0 GROUP BY p.\"ccrefejofacm\", p.\"descripcion\" ORDER BY \"Unidades\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son los mejores clientes retail por compras?",
    "body": "```sql\nSELECT c.\"nombre\" AS \"Cliente\", COUNT(DISTINCT v.\"reg_ventas\") AS \"Compras\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Total Gastado\" FROM \"public\".\"ps_ventas\" v JOIN \"public\".\"ps_clientes\" c ON v.\"num_cliente\" = c.\"reg_cliente\" WHERE v.\"num_cliente\" > 0 AND v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY c.\"nombre\" ORDER BY \"Total Gastado\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuántos clientes únicos compraron este mes?",
    "body": "```sql\nSELECT COUNT(DISTINCT \"num_cliente\") AS \"Clientes Identificados\", SUM(CASE WHEN \"num_cliente\" = 0 THEN 1 ELSE 0 END) AS \"Tickets Anónimos\", COUNT(*) AS \"Total Tickets\" FROM \"public\".\"ps_ventas\" WHERE \"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Nuevos clientes registrados este año?",
    "body": "```sql\nSELECT COUNT(*) AS \"Nuevos Clientes\", COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM \"public\".\"ps_ventas\" v WHERE v.\"num_cliente\" = c.\"reg_cliente\")) AS \"Con Compra Retail\", COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM \"public\".\"ps_gc_albaranes\" a WHERE a.\"num_cliente\" = c.\"reg_cliente\")) AS \"Con Actividad Mayorista\" FROM \"public\".\"ps_clientes\" c WHERE c.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Frecuencia de compra de clientes?",
    "body": "```sql\nSELECT CASE WHEN compras = 1 THEN '1 compra' WHEN compras BETWEEN 2 AND 3 THEN '2-3 compras' WHEN compras BETWEEN 4 AND 10 THEN '4-10 compras' ELSE 'Más de 10' END AS \"Segmento\", COUNT(*) AS \"Clientes\" FROM (SELECT \"num_cliente\", COUNT(DISTINCT \"reg_ventas\") AS compras FROM \"public\".\"ps_ventas\" WHERE \"num_cliente\" > 0 AND \"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY \"num_cliente\") t GROUP BY 1 ORDER BY 2 DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ingresos por método de pago este mes?",
    "body": "```sql\nSELECT p.\"forma\" AS \"Forma de Pago\", COUNT(*) AS \"Transacciones\", COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE p.\"entrada\"), 0) - COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE NOT p.\"entrada\"), 0) AS \"Importe Cobrado\" FROM \"public\".\"ps_pagos_ventas\" p WHERE p.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY p.\"forma\" ORDER BY \"Importe Cobrado\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Mix de formas de pago por tienda?",
    "body": "```sql\nSELECT p.\"tienda\" AS \"Tienda\", p.\"forma\" AS \"Forma de Pago\", COUNT(*) AS \"Transacciones\", COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE p.\"entrada\"), 0) - COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE NOT p.\"entrada\"), 0) AS \"Importe\" FROM \"public\".\"ps_pagos_ventas\" p WHERE p.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND p.\"tienda\" <> '99' GROUP BY p.\"tienda\", p.\"forma\" ORDER BY p.\"tienda\", \"Importe\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Efectivo vs tarjeta por tienda?",
    "body": "```sql\nSELECT p.\"tienda\" AS \"Tienda\", SUM(CASE WHEN p.\"codigo_forma\" = '01' THEN p.\"importe_cob\" ELSE 0 END) AS \"Efectivo\", SUM(CASE WHEN p.\"codigo_forma\" <> '01' THEN p.\"importe_cob\" ELSE 0 END) AS \"Tarjeta/Otro\", COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE p.\"entrada\"), 0) - COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE NOT p.\"entrada\"), 0) AS \"Total\" FROM \"public\".\"ps_pagos_ventas\" p WHERE p.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND p.\"tienda\" <> '99' GROUP BY p.\"tienda\" ORDER BY \"Total\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Evolución diaria de ingresos por forma de pago?",
    "body": "```sql\nSELECT p.\"fecha_creacion\" AS \"Fecha\", p.\"forma\" AS \"Forma de Pago\", COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE p.\"entrada\"), 0) - COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE NOT p.\"entrada\"), 0) AS \"Importe\" FROM \"public\".\"ps_pagos_ventas\" p WHERE p.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY p.\"fecha_creacion\", p.\"forma\" ORDER BY p.\"fecha_creacion\", p.\"forma\"\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Margen bruto por familia de producto?",
    "body": "```sql\nSELECT fm.\"fami_grup_marc\" AS \"Familia\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Coste Total\", ROUND(((COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) - (COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0))) / NULLIF(COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0), 0) * 100, 1) AS \"Margen %\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" JOIN \"public\".\"ps_familias\" fm ON p.\"num_familia\" = fm.\"reg_familia\" GROUP BY fm.\"fami_grup_marc\" HAVING COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) > 0 ORDER BY \"Margen %\" DESC\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Margen bruto por tienda?",
    "body": "```sql\nSELECT lv.\"tienda\" AS \"Tienda\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Coste Total\", ROUND(((COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) - (COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0))) / NULLIF(COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0), 0) * 100, 1) AS \"Margen %\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" WHERE lv.\"tienda\" <> '99' GROUP BY lv.\"tienda\" HAVING COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) > 0 ORDER BY \"Margen %\" DESC\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Productos con bajo margen (menos del 30%)?",
    "body": "```sql\nSELECT p.\"ccrefejofacm\" AS \"Referencia\", p.\"descripcion\" AS \"Descripción\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", ROUND(((COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) - (COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0))) / NULLIF(COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0), 0) * 100, 1) AS \"Margen %\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" GROUP BY p.\"ccrefejofacm\", p.\"descripcion\" HAVING COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) > 0 AND ((COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) - (COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0))) / NULLIF(COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0), 0) < 0.30 ORDER BY \"Margen %\" ASC LIMIT 30\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Margen bruto por departamento?",
    "body": "```sql\nSELECT d.\"depa_secc_fabr\" AS \"Departamento\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Coste Total\", ROUND(((COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) - (COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0))) / NULLIF(COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0), 0) * 100, 1) AS \"Margen %\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" JOIN \"public\".\"ps_departamentos\" d ON p.\"num_departament\" = d.\"reg_departament\" GROUP BY d.\"depa_secc_fabr\" HAVING COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) > 0 ORDER BY \"Margen %\" DESC\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Margen mayorista por comercial?",
    "body": "```sql\nWITH neto AS (SELECT c.\"comercial\" AS comercial, COALESCE(SUM(lf.\"total\") FILTER (WHERE f.\"abono\" IS NOT TRUE), 0) - COALESCE(SUM(lf.\"total\") FILTER (WHERE f.\"abono\" IS TRUE), 0) AS ingreso, COALESCE(SUM(lf.\"total_coste\") FILTER (WHERE f.\"abono\" IS NOT TRUE), 0) - COALESCE(SUM(lf.\"total_coste\") FILTER (WHERE f.\"abono\" IS TRUE), 0) AS coste FROM \"public\".\"ps_gc_lin_facturas\" lf JOIN \"public\".\"ps_gc_facturas\" f ON lf.\"num_factura\" = f.\"reg_factura\" JOIN \"public\".\"ps_gc_comerciales\" c ON f.\"num_comercial\" = c.\"reg_comercial\" WHERE f.\"fecha_factura\" BETWEEN :curr_from AND :curr_to GROUP BY c.\"comercial\") SELECT comercial AS \"Comercial\", ingreso AS \"Ingreso\", coste AS \"Coste\", ROUND((ingreso - coste) / NULLIF(ingreso, 0) * 100, 1) AS \"Margen %\" FROM neto WHERE ingreso <> 0 ORDER BY \"Margen %\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Volumen de traspasos por ruta?",
    "body": "```sql\nSELECT t.\"tienda_salida\" AS \"Tienda Origen\", t.\"tienda_entrada\" AS \"Tienda Destino\", COUNT(*) AS \"Traspasos\", SUM(t.\"unidades_s\") AS \"Unidades\" FROM \"public\".\"ps_traspasos\" t WHERE t.\"entrada\" = false AND t.\"tipo\" = 'Autoreposicion' AND t.\"fecha_s\" BETWEEN :curr_from AND :curr_to GROUP BY t.\"tienda_salida\", t.\"tienda_entrada\" ORDER BY \"Unidades\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Traspasos diarios de stock?",
    "body": "```sql\nSELECT t.\"fecha_s\" AS \"Fecha\", COUNT(*) AS \"Traspasos\", SUM(t.\"unidades_s\") AS \"Unidades\" FROM \"public\".\"ps_traspasos\" t WHERE t.\"entrada\" = false AND t.\"tipo\" = 'Autoreposicion' AND t.\"fecha_s\" BETWEEN :curr_from AND :curr_to GROUP BY t.\"fecha_s\" ORDER BY t.\"fecha_s\"\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Movimientos de stock de un artículo?",
    "body": "```sql\nSELECT t.\"fecha_s\" AS \"Fecha\", t.\"tienda_salida\" AS \"Origen\", t.\"tienda_entrada\" AS \"Destino\", t.\"talla\" AS \"Talla\", t.\"unidades_s\" AS \"Unidades\", t.\"tipo\" AS \"Tipo\" FROM \"public\".\"ps_traspasos\" t JOIN \"public\".\"ps_articulos\" p ON t.\"codigo\" = p.\"codigo\" WHERE p.\"ccrefejofacm\" = 'REFERENCIA_AQUI' AND t.\"entrada\" = false AND t.\"tipo\" = 'Autoreposicion' ORDER BY t.\"fecha_s\" DESC LIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuántos artículos hay por temporada?",
    "body": "```sql\nSELECT t.\"temporada_tipo\" AS \"Temporada\", COUNT(p.\"reg_articulo\") AS \"Artículos\", SUM(CASE WHEN p.\"anulado\" = false THEN 1 ELSE 0 END) AS \"Activos\" FROM \"public\".\"ps_articulos\" p JOIN \"public\".\"ps_temporadas\" t ON p.\"num_temporada\" = t.\"reg_temporada\" GROUP BY t.\"temporada_tipo\" ORDER BY \"Artículos\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Stock por temporada de colección?",
    "body": "```sql\nSELECT p.\"clave_temporada\" AS \"Temporada\", COUNT(DISTINCT p.\"ccrefejofacm\") AS \"Referencias\", SUM(s.\"stock\") AS \"Unidades\", ROUND(SUM(s.\"stock\" * p.\"precio_coste\"), 2) AS \"Valor Coste\" FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" WHERE s.\"stock\" > 0 AND p.\"anulado\" = false GROUP BY p.\"clave_temporada\" ORDER BY \"Unidades\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ventas por temporada de origen del artículo?",
    "body": "```sql\nSELECT p.\"clave_temporada\" AS \"Temporada\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" WHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY p.\"clave_temporada\" ORDER BY \"Ventas Netas\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Rendimiento YTD por tienda con comparativa año anterior?",
    "body": "```sql\nSELECT v.\"tienda\" AS \"Tienda\", SUM(CASE WHEN v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to THEN v.\"total_si\" ELSE 0 END) AS \"Ventas Este Año\", SUM(CASE WHEN v.\"fecha_creacion\" BETWEEN :comp_from AND :comp_to THEN v.\"total_si\" ELSE 0 END) AS \"Ventas Año Anterior\" FROM \"public\".\"ps_ventas\" v WHERE v.\"tienda\" <> '99' AND (v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to OR v.\"fecha_creacion\" BETWEEN :comp_from AND :comp_to) GROUP BY v.\"tienda\" ORDER BY \"Ventas Este Año\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ticket medio por tienda?",
    "body": "```sql\nSELECT v.\"tienda\" AS \"Tienda\", COUNT(DISTINCT v.\"reg_ventas\") AS \"Tickets\", ROUND(SUM(v.\"total_si\") / NULLIF(COUNT(DISTINCT v.\"reg_ventas\"), 0), 2) AS \"Ticket Medio\" FROM \"public\".\"ps_ventas\" v WHERE v.\"tienda\" <> '99' AND v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY v.\"tienda\" ORDER BY \"Ticket Medio\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ventas por tienda del período de comparación?",
    "body": "```sql\nSELECT v.\"tienda\" AS \"label\", SUM(v.\"total_si\") AS \"value\" FROM \"public\".\"ps_ventas\" v WHERE v.\"tienda\" <> '99' AND v.\"fecha_creacion\" BETWEEN :comp_from AND :comp_to GROUP BY v.\"tienda\" ORDER BY \"value\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "DECISIONS.md",
    "heading": "Data / ETL",
    "body": "| ID | Binding rule |\n|----|--------------|\n| [D-001](docs/decisions/D-001-postgres-mirror.md) | Analytics queries hit a PostgreSQL mirror. Never touch the live 4D ERP from analytics paths. ETL is the only writer to the mirror. |\n| [D-003](docs/decisions/D-003-single-select-no-offset.md) | For 4D tables < 2M rows, use a single SELECT — never LIMIT/OFFSET (4D re-scans from row 0 at each offset). |\n| [D-004](docs/decisions/D-004-stock-sync-per-store.md) | Stock sync fetches one store at a time (`WHERE Tienda='X'`). 50 stores × ~80s. Don't fetch the full Exportaciones table. |\n| [D-015](docs/decisions/D-015-schema-from-4dc.md) | Schema discovery uses string extraction on `PowerShop.4DC` + live `_USER_VIEWS` / `_USER_COLUMNS` queries. Don't rely on PowerShop install file trees alone. |\n| [D-017](docs/decisions/D-017-signed-int16-stock.md) | Apply `decode_signed_int16_word()` ONLY to `Exportaciones.Stock1..Stock34` (and `CCStock.Stock1..Stock34`) — the type-3/length-2 columns. Never on Real (type-6) columns. |\n| [D-050](docs/decisions/D-050-upsert-batch-loss.md) | `upsert()` pre-filters NULL/NaN-PK rows, falls back to row-by-row SAVEPOINT inserts on batch failure, and raises if zero rows survive — never a quiet 0-row \"ok\". |\n| [D-051](docs/decisions/D-051-fetch-anomaly-guard.md) | `safe_fetch()` scans every fetch for decode-corruption-shaped rows and refetches once to discriminate transient corruption from real data; evidence goes to `etl_fetch_anomalies`, never the D-050 skip log. |",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "DECISIONS.md",
    "heading": "Dashboard App",
    "body": "| ID | Binding rule |\n|----|--------------|\n| [D-010](docs/decisions/D-010-custom-dashboard-generator.md) | Dashboard App is custom Next.js + Tremor (LLM generates a dashboard JSON spec). Don't try to retrofit Metabase / Evidence / ToolJet. |\n| [D-018](docs/decisions/D-018-agentic-tools.md) | `generate`/`modify`/`analyze` use a backend-controlled tool loop via OpenRouter `chat.completions`. Read-only SQL only. Tool catalog + limits in `dashboard/lib/llm-tools/runner.ts`. |\n| [D-019](docs/decisions/D-019-pluggable-llm-providers.md) | Dashboard LLM provider is `openrouter` or `cli` (selected by `DASHBOARD_LLM_PROVIDER`). CLI path uses argv-array spawn + JSON tool-step protocol. |\n| [D-022](docs/decisions/D-022-dashboard-redesign.md) | Dashboard chrome is token-driven (CSS variables on `<html>` data-attrs). New widgets/components go through the redesign tokens, not Tremor defaults. |\n| [D-026](docs/decisions/D-026-home-page-inicio.md) | `/inicio` is a read-only home — no chat, no save flow, no Analizar launcher. Filters are implicit via `CURRENT_DATE`/`DATE_TRUNC`. Not a user-pickable template. |\n| [D-027](docs/decisions/D-027-inicio-redesign.md) | `/` (root) renders the new home; dashboard list moved to `/paneles`. Home is bespoke React, not `DashboardRenderer`-driven. |\n| [D-032](docs/decisions/D-032-free-chat-tools.md) | Free-chat uses `FREE_CHAT_TOOLS` (11 inspection + `start_dashboard_generation` + `set_title` = 13). `set_title` is idempotent (`AND title IS NULL`). Full write tools in `FULL_DASHBOARD_TOOLS`. Handoff via `POST /api/conversations/:id/handoff-to-dashboard`. |\n| [D-036](docs/decisions/D-036-llm-context-centralization.md) | All dashboard LLM calls must go through `assembleRequest()` in `dashboard/lib/llm-context/`. No file outside that directory may import `llmComplete` or `runAgenticChat` directly; CI enforces this. |\n| [D-040](docs/decisions/D-040-context-log-files.md) | Per-turn context logs (exact payload sent to the LLM) live in files at `<DASHBOARD_CONTEXT_DIR>/<convId>/<turnId>.json` (bind mount); Postgres stores only the `conversation_turns.context_file` pointer. UI lazy-loads on expand; writes best-effort. |\n| [D-041](docs/decisions/D-041-e2e-required-for-features.md) | Every PR adding or modifying a user-facing dashboard surface must ship a Playwright e2e test asserting no error surface against seeded Postgres. PRs without one are not mergeable for those areas. |\n| [D-043](docs/decisions/D-043-cli-usage-metering-and-budget.md) | CLI-provider calls log real token/cost accounting (`--output-format json`, `total_cost_usd`) at every call site; `checkDailyBudget` applies to every provider, not just OpenRouter. |\n| [D-044](docs/decisions/D-044-mobile-breakpoint-and-pad-x-token.md) | Mobile breakpoint is Tailwind's `md:` (768px); Tailwind owns display/visibility only, inline styles own everything else; horizontal padding shrink goes through one `--pad-x` token declared unconditionally at `:root`. |\n| [D-045](docs/decisions/D-045-title-generation-contract.md) | Titles use the first user message, clamped to 100 chars; failures log, never throw. `buildSystemPrompt` is exhaustive over `LLM_FLOWS` — no silent fallback onto `chat`'s tools. |\n| [D-046](docs/decisions/D-046-cli-lean-mode-and-kill-switch.md) | CLI calls strip the harness (`dashboard.llm_cli_lean_mode`, default true); only vars-independent flows put `stable` on `--system-prompt` (`CLI_SYSTEM_PROMPT_SAFE_FLOWS`). `dashboard.llm_enabled` stops every LLM call at the two `assembleRequest`/`llmComplete` seams; `checkDailyBudget` runs once, pre-flight, in `assembleRequest`. |\n| [D-047](docs/decisions/D-047-diagnosable-failures.md) | Every route tree carries an `error.tsx` (+ root `global-error.tsx`); tool handlers log the real error object before returning the generic one; `/api/query` failures persist to `query_errors`. Container stdout dies on deploy — Postgres is the only durable trace. |\n| [D-048](docs/decisions/D-048-sales-by-size.md) | La talla de una v",
    "hasSql": false,
    "dialect": "n/a"
  }
];
