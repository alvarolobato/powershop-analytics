# Recetario SQL del espejo PostgreSQL

> Consultas listas para usar contra el **espejo PostgreSQL** (`ps_*`) que alimenta
> el dashboard y WrenAI. Todas usan **valores de ejemplo** — sustituye códigos y
> fechas según necesites.

> **Un solo dialecto.** Este fichero es PostgreSQL de principio a fin. Las tablas
> son las del espejo (`ps_ventas`, `ps_lineas_ventas`, `ps_articulos`…), nunca las
> del ERP 4D de origen (`Ventas`, `LineasVentas`, `Articulos`…), que no existen
> aquí y no se pueden consultar desde el dashboard. Si necesitas explorar el ERP
> origen —tablas de sistema `_USER_*`, dialecto 4D, catálogo de vistas `*_SQL`—
> eso es herramienta del ETL y vive en [docs/skills/4d-sql-dialect.md](skills/4d-sql-dialect.md)
> y [docs/skills/data-access.md](skills/data-access.md), fuera del alcance del modelo.
>
> Lo que el espejo **no** replica está listado en
> [§11 Datos que no están en el espejo](#11-datos-que-no-están-en-el-espejo).
> Si te piden algo de esa lista, dilo — no inventes una tabla.

## Reglas que cumple todo el recetario

1. **«Ventas» es siempre el NETO de devoluciones** ([D-057](decisions/D-057-ventas-netas-de-devoluciones.md)) —
   `COALESCE(SUM(x) FILTER (WHERE v.entrada), 0) - COALESCE(SUM(x) FILTER (WHERE NOT v.entrada), 0)`.
   El `COALESCE` en **cada** lado es obligatorio: sin él, un grupo sin
   devoluciones da `NULL` y se cae del ranking.
2. **Tienda `'99'` es el almacén, no una tienda.** Se excluye de todo análisis de
   retail (`v.tienda <> '99'`).
3. **Un artículo es modelo + COLOR**, no un SKU ([D-048](decisions/D-048-sales-by-size.md)).
   Para «top artículos» se agrupa por `LEFT(a.ccrefejofacm, LENGTH(a.ccrefejofacm) - 2)`;
   los dos últimos caracteres de la referencia son el color.
4. **Importes sin IVA** (`total_si`, `precio_neto_si`, `total_coste_si`). `total`
   lleva IVA y no se usa para facturación.
5. **Mayorista netea por `abono`**, no por `entrada`: `gf.abono IS TRUE` es el abono
   (devolución), `gf.abono IS NOT TRUE` la venta.
6. **`ps_traspasos` está anotado dos veces** (salida + entrada). Filtra un solo
   lado y descarta los tipos que no son movimiento real:
   `tr."tipo" = 'Autoreposicion'`.
7. **Fechas por marcador.** `:curr_from` / `:curr_to` (y `:comp_from` / `:comp_to`
   para el periodo de comparación) se expanden en tiempo de ejecución. No escribas
   `CURRENT_DATE` literal en una consulta guardada.
8. **Nunca `SELECT *`.** Enumera columnas y ponles alias en español.

## Índice

1. [Ventas retail](#1-ventas-retail)
2. [Mayorista](#2-mayorista)
3. [Stock](#3-stock)
4. [Clientes](#4-clientes)
5. [Cobros y formas de pago](#5-cobros-y-formas-de-pago)
6. [Márgenes](#6-márgenes)
7. [Traspasos entre tiendas](#7-traspasos-entre-tiendas)
8. [Filtro de prefijo M (mayorista vs retail)](#8-filtro-de-prefijo-m)
9. [Movimiento de stock de una tienda](#9-movimiento-de-stock-de-una-tienda)
10. [Avisos de calidad de dato](#10-avisos-de-calidad-de-dato)
11. [Datos que no están en el espejo](#11-datos-que-no-están-en-el-espejo)

---

## 1. Ventas retail

### Venta neta diaria de una tienda

```sql
SELECT v.fecha_creacion AS "Fecha",
       COUNT(*) FILTER (WHERE v.entrada) AS "Tickets",
       COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0) AS "Venta Neta"
FROM ps_ventas v
WHERE v.tienda = '154'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY v.fecha_creacion
ORDER BY v.fecha_creacion
```

### Venta neta mensual por tienda

```sql
SELECT t.identificador AS "Tienda",
       DATE_TRUNC('month', v.fecha_creacion)::date AS "Mes",
       COUNT(*) FILTER (WHERE v.entrada) AS "Tickets",
       COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0) AS "Venta Neta"
FROM ps_ventas v
JOIN ps_tiendas t ON t.codigo = v.tienda
WHERE v.tienda <> '99'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY t.identificador, DATE_TRUNC('month', v.fecha_creacion)
ORDER BY "Mes", "Venta Neta" DESC
```

### Top 20 artículos (modelo + color) por venta neta

```sql
SELECT LEFT(a.ccrefejofacm, LENGTH(a.ccrefejofacm) - 2) AS "Artículo",
       MIN(a.descripcion) AS "Descripción",
       COALESCE(SUM(lv.unidades) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(lv.unidades) FILTER (WHERE NOT v.entrada), 0) AS "Unidades",
       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS "Venta Neta"
FROM ps_lineas_ventas lv
JOIN ps_ventas v ON v.reg_ventas = lv.num_ventas
JOIN ps_articulos a ON a.codigo = lv.codigo
WHERE v.tienda <> '99'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
  AND LENGTH(COALESCE(a.ccrefejofacm, '')) > 2
GROUP BY 1
ORDER BY "Venta Neta" DESC
LIMIT 20
```

### Venta neta por familia

```sql
SELECT f.fami_grup_marc AS "Familia",
       COALESCE(SUM(lv.unidades) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(lv.unidades) FILTER (WHERE NOT v.entrada), 0) AS "Unidades",
       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS "Venta Neta"
FROM ps_lineas_ventas lv
JOIN ps_ventas v ON v.reg_ventas = lv.num_ventas
JOIN ps_articulos a ON a.codigo = lv.codigo
JOIN ps_familias f ON f.reg_familia = a.num_familia
WHERE v.tienda <> '99'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY f.fami_grup_marc
ORDER BY "Venta Neta" DESC
```

### Venta neta por departamento

```sql
SELECT d.depa_secc_fabr AS "Departamento",
       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS "Venta Neta"
FROM ps_lineas_ventas lv
JOIN ps_ventas v ON v.reg_ventas = lv.num_ventas
JOIN ps_articulos a ON a.codigo = lv.codigo
JOIN ps_departamentos d ON d.reg_departament = a.num_departament
WHERE v.tienda <> '99'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY d.depa_secc_fabr
ORDER BY "Venta Neta" DESC
```

### Venta neta por marca

```sql
SELECT m.marca_tratamien AS "Marca",
       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS "Venta Neta"
FROM ps_lineas_ventas lv
JOIN ps_ventas v ON v.reg_ventas = lv.num_ventas
JOIN ps_articulos a ON a.codigo = lv.codigo
JOIN ps_marcas m ON m.reg_marca = a.num_marca
WHERE v.tienda <> '99'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY m.marca_tratamien
ORDER BY "Venta Neta" DESC
```

### Venta neta por temporada

```sql
SELECT te.temporada_tipo AS "Temporada",
       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS "Venta Neta"
FROM ps_lineas_ventas lv
JOIN ps_ventas v ON v.reg_ventas = lv.num_ventas
JOIN ps_articulos a ON a.codigo = lv.codigo
JOIN ps_temporadas te ON te.reg_temporada = a.num_temporada
WHERE v.tienda <> '99'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY te.temporada_tipo
ORDER BY "Venta Neta" DESC
```

### Devoluciones por tienda y mes

```sql
SELECT t.identificador AS "Tienda",
       DATE_TRUNC('month', v.fecha_creacion)::date AS "Mes",
       COUNT(*) FILTER (WHERE NOT v.entrada) AS "Tickets Devolución",
       COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0) AS "Importe Devuelto",
       ROUND(100.0 * COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0)
             / NULLIF(COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0), 0), 2) AS "% sobre Bruto"
FROM ps_ventas v
JOIN ps_tiendas t ON t.codigo = v.tienda
WHERE v.tienda <> '99'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY t.identificador, DATE_TRUNC('month', v.fecha_creacion)
ORDER BY "Mes", "Importe Devuelto" DESC
```

### Patrón por día de la semana

```sql
SELECT TO_CHAR(v.fecha_creacion, 'ID') AS "Día ISO",
       TRIM(TO_CHAR(v.fecha_creacion, 'Day')) AS "Día",
       COUNT(*) FILTER (WHERE v.entrada) AS "Tickets",
       COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0) AS "Venta Neta"
FROM ps_ventas v
WHERE v.tienda <> '99'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY 1, 2
ORDER BY 1
```

### Distribución horaria

```sql
SELECT EXTRACT(HOUR FROM v.hora_creacion)::int AS "Hora",
       COUNT(*) FILTER (WHERE v.entrada) AS "Tickets",
       COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0) AS "Venta Neta"
FROM ps_ventas v
WHERE v.hora_creacion IS NOT NULL
  AND v.tienda <> '99'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY 1
ORDER BY 1
```

`hora_creacion` es NULL en las filas sincronizadas antes de que existiera la
columna; se rellena en el siguiente upsert de esa fila.

### Ticket medio por tienda

```sql
SELECT t.identificador AS "Tienda",
       COUNT(*) FILTER (WHERE v.entrada) AS "Tickets",
       COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0) AS "Venta Neta",
       ROUND((COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0)
            - COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0))
             / NULLIF(COUNT(*) FILTER (WHERE v.entrada), 0), 2) AS "Ticket Medio"
FROM ps_ventas v
JOIN ps_tiendas t ON t.codigo = v.tienda
WHERE v.tienda <> '99'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY t.identificador
ORDER BY "Ticket Medio" DESC
```

### Venta neta por talla

```sql
SELECT lv.talla AS "Talla",
       COALESCE(SUM(lv.unidades) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(lv.unidades) FILTER (WHERE NOT v.entrada), 0) AS "Unidades",
       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS "Venta Neta"
FROM ps_lineas_ventas lv
JOIN ps_ventas v ON v.reg_ventas = lv.num_ventas
WHERE lv.talla IS NOT NULL AND lv.talla <> ''
  AND v.tienda <> '99'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY lv.talla
ORDER BY "Unidades" DESC
```

La talla de una venta está en `ps_lineas_ventas.talla` (normalizada a MAYÚSCULAS
por el ETL). Nunca se deduce del código de barras ([D-048](decisions/D-048-sales-by-size.md)).

---

## 2. Mayorista

En este canal la devolución es la bandera `abono` de la cabecera, **no** `entrada`.

### Albaranes por cliente (neto de abonos)

```sql
SELECT c.nombre AS "Cliente",
       COUNT(DISTINCT ga.reg_albaran) AS "Albaranes",
       COALESCE(SUM(gl.unidades) FILTER (WHERE ga.abono IS NOT TRUE), 0)
     - COALESCE(SUM(gl.unidades) FILTER (WHERE ga.abono IS TRUE), 0) AS "Unidades Netas",
       COALESCE(SUM(gl.total) FILTER (WHERE ga.abono IS NOT TRUE), 0)
     - COALESCE(SUM(gl.total) FILTER (WHERE ga.abono IS TRUE), 0) AS "Importe Neto"
FROM ps_gc_lin_albarane gl
JOIN ps_gc_albaranes ga ON ga.reg_albaran = gl.num_albaran
JOIN ps_clientes c ON c.reg_cliente = ga.num_cliente
WHERE (CASE WHEN ga.fecha_envio >= DATE '2000-01-01' THEN ga.fecha_envio ELSE ga.fecha_valor END)
      BETWEEN :curr_from AND :curr_to
GROUP BY c.nombre
ORDER BY "Importe Neto" DESC
LIMIT 20
```

Dos trampas de esta tabla:

- La FK línea → cabecera es `num_albaran` → `reg_albaran`. `n_albaran` es el
  número visible del albarán y **no** es único: no lo uses para unir.
- **La fecha efectiva no es `fecha_envio` a secas.** Un albarán aún sin enviar
  lleva `NULL` o un centinela anterior al año 2000, y como `NULL >= fecha` es
  `NULL`, acotar por `fecha_envio` los descarta en silencio. Usa siempre
  `CASE WHEN fecha_envio >= DATE '2000-01-01' THEN fecha_envio ELSE fecha_valor END`.

### Facturación mensual (neta de abonos)

```sql
SELECT DATE_TRUNC('month', gf.fecha_factura)::date AS "Mes",
       COUNT(*) FILTER (WHERE gf.abono IS NOT TRUE) AS "Facturas",
       COALESCE(SUM(gf.total_factura) FILTER (WHERE gf.abono IS NOT TRUE), 0)
     - COALESCE(SUM(gf.total_factura) FILTER (WHERE gf.abono IS TRUE), 0) AS "Facturación Neta"
FROM ps_gc_facturas gf
WHERE gf.fecha_factura BETWEEN :curr_from AND :curr_to
GROUP BY 1
ORDER BY 1
```

### Top productos del canal mayorista

```sql
SELECT gl.codigo AS "Código",
       MIN(gl.descripcion) AS "Descripción",
       COALESCE(SUM(gl.unidades) FILTER (WHERE gf.abono IS NOT TRUE), 0)
     - COALESCE(SUM(gl.unidades) FILTER (WHERE gf.abono IS TRUE), 0) AS "Unidades",
       COALESCE(SUM(gl.total) FILTER (WHERE gf.abono IS NOT TRUE), 0)
     - COALESCE(SUM(gl.total) FILTER (WHERE gf.abono IS TRUE), 0) AS "Importe Neto"
FROM ps_gc_lin_facturas gl
JOIN ps_gc_facturas gf ON gf.reg_factura = gl.num_factura
WHERE gl.fecha_factura BETWEEN :curr_from AND :curr_to
GROUP BY gl.codigo
ORDER BY "Importe Neto" DESC
LIMIT 20
```

### Abonos (devoluciones) por cliente

```sql
SELECT c.nombre AS "Cliente",
       COUNT(*) AS "Abonos",
       SUM(gf.total_factura) AS "Importe Abonado"
FROM ps_gc_facturas gf
JOIN ps_clientes c ON c.reg_cliente = gf.num_cliente
WHERE gf.abono IS TRUE
  AND gf.fecha_factura BETWEEN :curr_from AND :curr_to
GROUP BY c.nombre
ORDER BY "Importe Abonado" DESC
LIMIT 20
```

### Facturación mayorista por familia

La línea de factura mayorista lleva sus propias FK de dimensión, así que no hace
falta pasar por `ps_articulos`.

```sql
SELECT f.fami_grup_marc AS "Familia",
       COALESCE(SUM(gl.total) FILTER (WHERE gf.abono IS NOT TRUE), 0)
     - COALESCE(SUM(gl.total) FILTER (WHERE gf.abono IS TRUE), 0) AS "Importe Neto"
FROM ps_gc_lin_facturas gl
JOIN ps_gc_facturas gf ON gf.reg_factura = gl.num_factura
JOIN ps_familias f ON f.reg_familia = gl.num_familia
WHERE gl.fecha_factura BETWEEN :curr_from AND :curr_to
GROUP BY f.fami_grup_marc
ORDER BY "Importe Neto" DESC
```

### Pedidos mayoristas pendientes de servir

> Correcta, pero hoy devuelve vacío en cualquier ventana reciente: **no hay ningún
> pedido abierto desde hace más de un año** (los 39 abiertos son antiguos, y los 8 de
> agosto de 2026 están todos cerrados). Medido en producción 2026-08-30.

```sql
SELECT c.nombre AS "Cliente",
       COUNT(*) AS "Pedidos Abiertos",
       SUM(gp.unidades) AS "Unidades Pedidas",
       SUM(gp.entregadas) AS "Unidades Entregadas",
       SUM(gp.pendientes) AS "Unidades Pendientes"
FROM ps_gc_pedidos gp
JOIN ps_clientes c ON c.reg_cliente = gp.num_cliente
WHERE gp.pedido_cerrado IS NOT TRUE
  AND gp.abono IS NOT TRUE
  AND gp.fecha_pedido BETWEEN :curr_from AND :curr_to
GROUP BY c.nombre
ORDER BY "Unidades Pendientes" DESC
LIMIT 20
```

---

## 3. Stock

El stock vive en **dos** tablas con claves distintas:

| Tabla | Grano | Une con |
|---|---|---|
| `ps_stock_central` | artículo (almacén central) | `num_articulo` → `ps_articulos.reg_articulo` |
| `ps_stock_tienda` | artículo + tienda + talla | `codigo` → `ps_articulos.codigo` |

### Stock del almacén central por artículo

```sql
SELECT a.ccrefejofacm AS "Referencia",
       a.descripcion AS "Descripción",
       sc.stock AS "Stock Central"
FROM ps_stock_central sc
JOIN ps_articulos a ON a.reg_articulo = sc.num_articulo
WHERE sc.stock > 0
ORDER BY sc.stock DESC
LIMIT 20
```

### Stock de una tienda por talla

```sql
SELECT a.ccrefejofacm AS "Referencia",
       a.descripcion AS "Descripción",
       st.talla AS "Talla",
       st.stock AS "Stock"
FROM ps_stock_tienda st
JOIN ps_articulos a ON a.codigo = st.codigo
WHERE st.tienda = '154'
  AND st.stock > 0
ORDER BY st.stock DESC
LIMIT 20
```

### Stock total de una referencia (central + tiendas)

```sql
SELECT 'Central' AS "Ubicación", COALESCE(SUM(sc.stock), 0) AS "Unidades"
FROM ps_stock_central sc
JOIN ps_articulos a ON a.reg_articulo = sc.num_articulo
WHERE a.ccrefejofacm = 'V26391168'
UNION ALL
SELECT st.tienda, SUM(st.stock)
FROM ps_stock_tienda st
JOIN ps_articulos a ON a.codigo = st.codigo
WHERE a.ccrefejofacm = 'V26391168'
GROUP BY st.tienda
ORDER BY 2 DESC
```

### Artículos sin stock en ningún sitio

```sql
SELECT a.ccrefejofacm AS "Referencia",
       a.descripcion AS "Descripción",
       a.precio1 AS "PVP"
FROM ps_articulos a
LEFT JOIN ps_stock_central sc ON sc.num_articulo = a.reg_articulo
WHERE a.anulado IS NOT TRUE
  AND a.precio1 > 0
  AND COALESCE(sc.stock, 0) = 0
  AND NOT EXISTS (
        SELECT 1 FROM ps_stock_tienda st
        WHERE st.codigo = a.codigo AND st.stock > 0)
ORDER BY a.ccrefejofacm
LIMIT 50
```

### Stock negativo (error de inventario)

```sql
SELECT a.ccrefejofacm AS "Referencia",
       a.descripcion AS "Descripción",
       st.tienda AS "Tienda",
       st.talla AS "Talla",
       st.stock AS "Stock"
FROM ps_stock_tienda st
JOIN ps_articulos a ON a.codigo = st.codigo
WHERE st.stock < 0
ORDER BY st.stock ASC
LIMIT 20
```

### Resumen de stock por tienda

```sql
SELECT t.identificador AS "Tienda",
       COUNT(DISTINCT st.codigo) AS "Referencias",
       SUM(st.stock) AS "Unidades"
FROM ps_stock_tienda st
JOIN ps_tiendas t ON t.codigo = st.tienda
WHERE st.stock > 0
GROUP BY t.identificador
ORDER BY "Unidades" DESC
```

---

## 4. Clientes

### Mejores clientes de retail por gasto neto

```sql
SELECT c.nombre AS "Cliente",
       COUNT(*) FILTER (WHERE v.entrada) AS "Compras",
       COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0) AS "Gasto Neto",
       MAX(v.fecha_creacion) AS "Última Compra"
FROM ps_ventas v
JOIN ps_clientes c ON c.reg_cliente = v.num_cliente
WHERE v.tienda <> '99'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY c.nombre
ORDER BY "Gasto Neto" DESC
LIMIT 50
```

### Frecuencia de compra

```sql
SELECT c.nombre AS "Cliente",
       COUNT(*) FILTER (WHERE v.entrada) AS "Visitas",
       MIN(v.fecha_creacion) AS "Primera Compra",
       MAX(v.fecha_creacion) AS "Última Compra",
       COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0) AS "Gasto Neto"
FROM ps_ventas v
JOIN ps_clientes c ON c.reg_cliente = v.num_cliente
WHERE v.tienda <> '99'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY c.nombre
HAVING COUNT(*) FILTER (WHERE v.entrada) > 1
ORDER BY "Visitas" DESC
LIMIT 50
```

### Clientes dados de alta en un periodo

```sql
SELECT c.nombre AS "Cliente",
       c.poblacion AS "Población",
       c.pais AS "País",
       c.fecha_creacion AS "Alta"
FROM ps_clientes c
WHERE c.fecha_creacion BETWEEN :curr_from AND :curr_to
ORDER BY c.fecha_creacion DESC
LIMIT 100
```

### Clientes únicos por tienda

```sql
SELECT t.identificador AS "Tienda",
       COUNT(DISTINCT v.num_cliente) AS "Clientes Únicos"
FROM ps_ventas v
JOIN ps_tiendas t ON t.codigo = v.tienda
WHERE v.num_cliente IS NOT NULL
  AND v.tienda <> '99'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY t.identificador
ORDER BY "Clientes Únicos" DESC
```

---

## 5. Cobros y formas de pago

Usa `importe_cob` («importe cobrado»): es lo que realmente se cobra.

### Cobros por forma de pago

```sql
SELECT pv.forma AS "Forma de Pago",
       COUNT(*) FILTER (WHERE pv.entrada) AS "Cobros",
       COALESCE(SUM(pv.importe_cob) FILTER (WHERE pv.entrada), 0)
     - COALESCE(SUM(pv.importe_cob) FILTER (WHERE NOT pv.entrada), 0) AS "Importe Neto"
FROM ps_pagos_ventas pv
WHERE pv.tienda <> '99'
  AND pv.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY pv.forma
ORDER BY "Importe Neto" DESC
```

### Mix de formas de pago por tienda

```sql
SELECT t.identificador AS "Tienda",
       pv.forma AS "Forma de Pago",
       COALESCE(SUM(pv.importe_cob) FILTER (WHERE pv.entrada), 0)
     - COALESCE(SUM(pv.importe_cob) FILTER (WHERE NOT pv.entrada), 0) AS "Importe Neto"
FROM ps_pagos_ventas pv
JOIN ps_tiendas t ON t.codigo = pv.tienda
WHERE pv.tienda <> '99'
  AND pv.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY t.identificador, pv.forma
ORDER BY t.identificador, "Importe Neto" DESC
```

### Efectivo frente al resto, día a día

```sql
SELECT pv.fecha_creacion AS "Fecha",
       COALESCE(SUM(pv.importe_cob) FILTER (WHERE pv.entrada AND pv.codigo_forma = '01'), 0)
     - COALESCE(SUM(pv.importe_cob) FILTER (WHERE NOT pv.entrada AND pv.codigo_forma = '01'), 0) AS "Efectivo",
       COALESCE(SUM(pv.importe_cob) FILTER (WHERE pv.entrada AND pv.codigo_forma <> '01'), 0)
     - COALESCE(SUM(pv.importe_cob) FILTER (WHERE NOT pv.entrada AND pv.codigo_forma <> '01'), 0) AS "Otras Formas",
       COALESCE(SUM(pv.importe_cob) FILTER (WHERE pv.entrada), 0)
     - COALESCE(SUM(pv.importe_cob) FILTER (WHERE NOT pv.entrada), 0) AS "Total"
FROM ps_pagos_ventas pv
WHERE pv.tienda <> '99'
  AND pv.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY pv.fecha_creacion
ORDER BY pv.fecha_creacion
```

`codigo_forma = '01'` suele ser metálico; confírmalo con los valores de
`pv.forma` antes de presentarlo como «efectivo».

---

## 6. Márgenes

Margen bruto = venta neta sin IVA − coste neto sin IVA. Ambos lados netean
devoluciones, o el margen sale inflado.

### Margen por artículo (retail)

```sql
SELECT LEFT(a.ccrefejofacm, LENGTH(a.ccrefejofacm) - 2) AS "Artículo",
       MIN(a.descripcion) AS "Descripción",
       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS "Venta Neta",
       COALESCE(SUM(lv.total_coste_si) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(lv.total_coste_si) FILTER (WHERE NOT v.entrada), 0) AS "Coste",
       (COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)
      - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0))
     - (COALESCE(SUM(lv.total_coste_si) FILTER (WHERE v.entrada), 0)
      - COALESCE(SUM(lv.total_coste_si) FILTER (WHERE NOT v.entrada), 0)) AS "Margen"
FROM ps_lineas_ventas lv
JOIN ps_ventas v ON v.reg_ventas = lv.num_ventas
JOIN ps_articulos a ON a.codigo = lv.codigo
WHERE v.tienda <> '99'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
  AND LENGTH(COALESCE(a.ccrefejofacm, '')) > 2
GROUP BY 1
ORDER BY "Margen" DESC
LIMIT 20
```

### Porcentaje de margen por familia

```sql
SELECT f.fami_grup_marc AS "Familia",
       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS "Venta Neta",
       ROUND(100.0 * ((COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)
                     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0))
                    - (COALESCE(SUM(lv.total_coste_si) FILTER (WHERE v.entrada), 0)
                     - COALESCE(SUM(lv.total_coste_si) FILTER (WHERE NOT v.entrada), 0)))
             / NULLIF(COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)
                    - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0), 0), 1) AS "Margen %"
FROM ps_lineas_ventas lv
JOIN ps_ventas v ON v.reg_ventas = lv.num_ventas
JOIN ps_articulos a ON a.codigo = lv.codigo
JOIN ps_familias f ON f.reg_familia = a.num_familia
WHERE v.tienda <> '99'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY f.fami_grup_marc
ORDER BY "Margen %" DESC
```

### Margen por tienda

```sql
SELECT t.identificador AS "Tienda",
       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS "Venta Neta",
       ROUND(100.0 * ((COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)
                     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0))
                    - (COALESCE(SUM(lv.total_coste_si) FILTER (WHERE v.entrada), 0)
                     - COALESCE(SUM(lv.total_coste_si) FILTER (WHERE NOT v.entrada), 0)))
             / NULLIF(COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)
                    - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0), 0), 1) AS "Margen %"
FROM ps_lineas_ventas lv
JOIN ps_ventas v ON v.reg_ventas = lv.num_ventas
JOIN ps_tiendas t ON t.codigo = v.tienda
WHERE v.tienda <> '99'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY t.identificador
ORDER BY "Margen %" DESC
```

### Margen del canal mayorista por producto

```sql
SELECT gl.codigo AS "Código",
       MIN(gl.descripcion) AS "Descripción",
       COALESCE(SUM(gl.total) FILTER (WHERE gf.abono IS NOT TRUE), 0)
     - COALESCE(SUM(gl.total) FILTER (WHERE gf.abono IS TRUE), 0) AS "Importe Neto",
       COALESCE(SUM(gl.total_coste) FILTER (WHERE gf.abono IS NOT TRUE), 0)
     - COALESCE(SUM(gl.total_coste) FILTER (WHERE gf.abono IS TRUE), 0) AS "Coste",
       ROUND(100.0 * ((COALESCE(SUM(gl.total) FILTER (WHERE gf.abono IS NOT TRUE), 0)
                     - COALESCE(SUM(gl.total) FILTER (WHERE gf.abono IS TRUE), 0))
                    - (COALESCE(SUM(gl.total_coste) FILTER (WHERE gf.abono IS NOT TRUE), 0)
                     - COALESCE(SUM(gl.total_coste) FILTER (WHERE gf.abono IS TRUE), 0)))
             / NULLIF(COALESCE(SUM(gl.total) FILTER (WHERE gf.abono IS NOT TRUE), 0)
                    - COALESCE(SUM(gl.total) FILTER (WHERE gf.abono IS TRUE), 0), 0), 1) AS "Margen %"
FROM ps_gc_lin_facturas gl
JOIN ps_gc_facturas gf ON gf.reg_factura = gl.num_factura
WHERE gl.fecha_factura BETWEEN :curr_from AND :curr_to
GROUP BY gl.codigo
ORDER BY "Importe Neto" DESC
LIMIT 20
```

### Artículos con margen teórico bajo (< 30 %)

Margen de tarifa, no de venta real: compara PVP contra coste en la ficha del
artículo.

```sql
SELECT a.ccrefejofacm AS "Referencia",
       a.descripcion AS "Descripción",
       a.precio1 AS "PVP",
       a.precio_coste AS "Coste",
       ROUND(100.0 * (a.precio1 - a.precio_coste) / NULLIF(a.precio1, 0), 1) AS "Margen %"
FROM ps_articulos a
WHERE a.anulado IS NOT TRUE
  AND a.precio1 > 0
  AND a.precio_coste > 0
  AND (a.precio1 - a.precio_coste) / a.precio1 < 0.3
ORDER BY "Margen %" ASC
LIMIT 50
```

---

## 7. Traspasos entre tiendas

Cada movimiento se anota dos veces: como salida (`NOT entrada`, con `unidades_s`
y `fecha_s`) y como entrada (`entrada`, con `unidades_e` y `fecha_e`). Filtra
**un solo lado**, nunca sumes los dos. `Apertura` e `Inventario Parcial` no son
movimientos reales de mercancía y se descartan.

### Volumen por ruta

```sql
SELECT tr.tienda_salida AS "Origen",
       tr.tienda_entrada AS "Destino",
       COUNT(*) AS "Movimientos",
       SUM(tr.unidades_s) AS "Unidades Enviadas"
FROM ps_traspasos tr
WHERE NOT tr.entrada
  AND tr."tipo" = 'Autoreposicion'
  AND tr.fecha_s BETWEEN :curr_from AND :curr_to
GROUP BY tr.tienda_salida, tr.tienda_entrada
ORDER BY "Unidades Enviadas" DESC
LIMIT 20
```

### Volumen por tipo de traspaso

```sql
SELECT tr.tipo AS "Tipo",
       tr.concepto AS "Concepto",
       COUNT(*) AS "Movimientos",
       SUM(tr.unidades_s) AS "Unidades"
FROM ps_traspasos tr
WHERE tr."tipo" = 'Autoreposicion'
  AND tr.fecha_s BETWEEN :curr_from AND :curr_to
GROUP BY tr.tipo, tr.concepto
ORDER BY "Movimientos" DESC
```

### Actividad diaria de traspasos

```sql
SELECT tr.fecha_s AS "Fecha",
       COUNT(*) AS "Movimientos",
       SUM(tr.unidades_s) AS "Unidades Enviadas"
FROM ps_traspasos tr
WHERE NOT tr.entrada
  AND tr."tipo" = 'Autoreposicion'
  AND tr.fecha_s BETWEEN :curr_from AND :curr_to
GROUP BY tr.fecha_s
ORDER BY tr.fecha_s
```

### Traspasos de una referencia concreta

```sql
SELECT tr.fecha_s AS "Fecha",
       tr.tienda_salida AS "Origen",
       tr.tienda_entrada AS "Destino",
       tr.talla AS "Talla",
       tr.unidades_s AS "Unidades",
       tr.tipo AS "Tipo",
       tr.concepto AS "Concepto"
FROM ps_traspasos tr
JOIN ps_articulos a ON a.codigo = tr.codigo
WHERE a.ccrefejofacm = 'V26391168'
  AND NOT tr.entrada
  AND tr."tipo" = 'Autoreposicion'
  AND tr.fecha_s BETWEEN :curr_from AND :curr_to
ORDER BY tr.fecha_s DESC
```

---

## 8. Filtro de prefijo M

Los códigos con prefijo **M** (`M12345`) son artículos del canal mayorista; el
resto son de retail.

### Artículos de retail con stock

```sql
SELECT a.ccrefejofacm AS "Referencia",
       a.descripcion AS "Descripción",
       a.precio1 AS "PVP",
       SUM(st.stock) AS "Unidades en Tienda"
FROM ps_articulos a
JOIN ps_stock_tienda st ON st.codigo = a.codigo
WHERE a.ccrefejofacm NOT LIKE 'M%'
  AND a.anulado IS NOT TRUE
  AND st.stock > 0
GROUP BY a.ccrefejofacm, a.descripcion, a.precio1
ORDER BY "Unidades en Tienda" DESC
LIMIT 50
```

### Artículos exclusivos de mayorista

```sql
SELECT a.codigo AS "Código",
       a.ccrefejofacm AS "Referencia",
       a.descripcion AS "Descripción",
       a.precio1 AS "PVP"
FROM ps_articulos a
WHERE a.ccrefejofacm LIKE 'M%'
  AND a.anulado IS NOT TRUE
ORDER BY a.codigo
LIMIT 50
```

### Venta retail excluyendo artículos de mayorista

```sql
SELECT DATE_TRUNC('month', v.fecha_creacion)::date AS "Mes",
       COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0)
     - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0) AS "Venta Neta Retail"
FROM ps_lineas_ventas lv
JOIN ps_ventas v ON v.reg_ventas = lv.num_ventas
JOIN ps_articulos a ON a.codigo = lv.codigo
WHERE a.ccrefejofacm NOT LIKE 'M%'
  AND v.tienda <> '99'
  AND v.fecha_creacion BETWEEN :curr_from AND :curr_to
GROUP BY 1
ORDER BY 1
```

### Líneas de albarán mayorista con artículos M

```sql
SELECT gl.n_albaran AS "Nº Albarán",
       gl.fecha_albaran AS "Fecha",
       gl.codigo AS "Código",
       gl.descripcion AS "Descripción",
       gl.unidades AS "Unidades",
       gl.total AS "Importe"
FROM ps_gc_lin_albarane gl
JOIN ps_articulos a ON gl.codigo = a.codigo
WHERE a.ccrefejofacm LIKE 'M%'
  AND gl.fecha_albaran BETWEEN :curr_from AND :curr_to
ORDER BY gl.fecha_albaran DESC
LIMIT 50
```

---

## 9. Movimiento de stock de una tienda

Con lo que hay en el espejo se cubren los dos movimientos que explican la mayor
parte de la variación de stock de una tienda: traspasos y ventas.

```
Entradas ≈ traspasos recibidos + devoluciones de clientes
Salidas  ≈ ventas + traspasos enviados
Neto     = Entradas − Salidas
```

Las **entradas de albarán de compra** (mercancía del proveedor) **no** están en
el espejo: `ps_albaranes` guarda sólo cabeceras, sin líneas ni unidades. Ver
[§11](#11-datos-que-no-están-en-el-espejo). El neto de abajo es, por tanto,
movimiento de tienda, no la ecuación completa de inventario.

```sql
SELECT
  (SELECT COALESCE(SUM(tr.unidades_e), 0)
     FROM ps_traspasos tr
    WHERE tr.tienda_entrada = '154' AND tr.entrada
      AND tr."tipo" = 'Autoreposicion'
      AND tr.fecha_e BETWEEN :curr_from AND :curr_to) AS "Traspasos Recibidos",
  (SELECT COALESCE(SUM(tr.unidades_s), 0)
     FROM ps_traspasos tr
    WHERE tr.tienda_salida = '154' AND NOT tr.entrada
      AND tr."tipo" = 'Autoreposicion'
      AND tr.fecha_s BETWEEN :curr_from AND :curr_to) AS "Traspasos Enviados",
  (SELECT COALESCE(SUM(lv.unidades) FILTER (WHERE v.entrada), 0)
     FROM ps_lineas_ventas lv
     JOIN ps_ventas v ON v.reg_ventas = lv.num_ventas
    WHERE v.tienda = '154'
      AND v.fecha_creacion BETWEEN :curr_from AND :curr_to) AS "Unidades Vendidas",
  (SELECT COALESCE(SUM(lv.unidades) FILTER (WHERE NOT v.entrada), 0)
     FROM ps_lineas_ventas lv
     JOIN ps_ventas v ON v.reg_ventas = lv.num_ventas
    WHERE v.tienda = '154'
      AND v.fecha_creacion BETWEEN :curr_from AND :curr_to) AS "Unidades Devueltas"
```

---

## 10. Avisos de calidad de dato

1. **Netea siempre.** Un `SUM(total_si)` sin `FILTER` mezcla ventas y
   devoluciones y da un número que no es ni bruto ni neto.
2. **`COALESCE` en los dos lados del neteo.** Sin él, un grupo sin devoluciones
   sale `NULL` y desaparece del `ORDER BY`.
3. **Excluye la tienda `'99'`** en retail: es el almacén.
4. **`total_si` para facturación**, `total` lleva IVA.
5. **`importe_cob`, no otro importe**, en `ps_pagos_ventas`.
6. **Un artículo es modelo + color.** Agrupar por `ccrefejofacm` entero
   multiplica las filas por el número de tallas.
7. **`ps_lineas_ventas.entrada` y `.talla`** existen desde 2026-08 y están vacías
   en las filas anteriores a la resincronización; el `JOIN` con `ps_ventas` sigue
   haciendo falta para atributos de cabecera (tienda, cliente, hora).
8. **`ps_lineas_ventas` no tiene FK de dimensión.** Para familia / marca /
   temporada / departamento hay que pasar por `ps_articulos` (`a.codigo = lv.codigo`).
   La línea **mayorista** sí las lleva.
9. **`n_albaran` no es único.** Une líneas y cabeceras por `num_albaran` →
   `reg_albaran` (y `num_factura` → `reg_factura`).
10. **`ps_articulos` no tiene columna `stock`.** El stock está en
    `ps_stock_central` / `ps_stock_tienda`.
11. **Nunca `SELECT *`.** Enumera columnas y ponles alias en español.

---

## 11. Datos que no están en el espejo

Estas preguntas **no se pueden responder** con las tablas `ps_*`. Si te las
hacen, dilo explícitamente en vez de inventar una tabla o una columna.

| Dato que falta | Dónde estaría | Qué NO se puede calcular |
|---|---|---|
| **Líneas de albarán de compra** (unidades recibidas del proveedor) | `ps_albaranes` sólo guarda cabeceras (`reg_albaran`, `fecha_recibido`, `num_pedido`, `num_proveedor`, `proveedor`) | Entradas de mercancía por artículo o talla; la ecuación completa de inventario |
| **Cobros de facturas mayoristas** | no hay tabla de cobros en el espejo | Importe cobrado / pendiente por factura, antigüedad de la deuda, riesgo vivo |
| **Vales y su canje** | no mirrored | Vales emitidos, canjeados, importe pendiente de canje |
| **Condiciones comerciales del cliente** (descuento `p_desc_g` / `PDescCom`, forma de pago, riesgo concedido, bloqueo financiero, marca de mayorista) | `ps_clientes` sólo trae identidad y contacto | Descuento aplicado por cliente, límite de crédito, segmentar clientes en «mayorista» vs «retail» desde la ficha |
| **Factura anulada** | `ps_gc_facturas` no replica `FacturaAnulada` | Excluir facturas anuladas del total mayorista |
| **Comercial asignado a una venta mayorista** | `ps_gc_facturas.num_comercial` y `ps_gc_albaranes.num_comercial` existen pero están **sin usar**: `0.000` en las 19.352 facturas, y sólo **4 de 52.148** albaranes tienen comercial (todos el mismo). `ps_gc_comerciales` sí tiene las 5 filas. | Ventas, márgenes o ranking por comercial; objetivos y comisiones |
| **Stock central por talla** | `ps_stock_central` es un total por artículo | Desglose de tallas del almacén central (sí lo hay por tienda en `ps_stock_tienda`) |
| **Provincia / dirección del cliente** | `ps_clientes` tiene `poblacion`, `codigo_postal` y `pais` | Análisis por provincia |
| **Esquema y catálogo del ERP 4D** (tablas de sistema `_USER_*`, vistas `*_SQL`) | sólo en el servidor 4D | Nada de esto es consultable desde el dashboard: es herramienta del ETL |

---
## LLM:rules

Reglas que gobiernan la traduccion de este recetario al espejo PostgreSQL.

```json
[
  {
    "instruction": "El recetario docs/sample-queries.md es PostgreSQL contra el espejo ps_* de principio a fin: se puede copiar tal cual a un widget. Nunca escribas una consulta contra las tablas del ERP 4D (Ventas, LineasVentas, Articulos, CCStock, Exportaciones, Traspasos, GCFacturas, o cualquier tabla sin prefijo ps_): no existen en PostgreSQL y el dashboard no puede ejecutarlas. Si una fuente de conocimiento te devuelve SQL de 4D, tradúcelo al espejo antes de usarlo.",
    "questions": [
      "puedo usar las consultas del recetario",
      "por que falla una consulta contra la tabla Ventas",
      "que dialecto uso"
    ]
  },
  {
    "instruction": "El espejo PostgreSQL NO replica todas las columnas de 4D. Diferencias que rompen traducciones ingenuas: ps_lineas_ventas SI tiene 'entrada', 'movimiento_caja' y 'talla' desde 2026-08 (vacias en filas anteriores a la resincronizacion); el JOIN con ps_ventas sigue haciendo falta para atributos de cabecera como tienda o cliente; ps_lineas_ventas NO tiene num_familia/num_marca/num_temporada/num_departament (hay que unir con ps_articulos por 'codigo' y de ahi a la dimension); ps_articulos NO tiene columna 'stock'. Antes de usar una columna, comprueba que existe.",
    "questions": [
      "ps_lineas_ventas tiene entrada",
      "como agrupo ventas por familia",
      "por que no encuentro la columna"
    ]
  },
  {
    "instruction": "Ruta de JOIN canonica para ventas retail por dimension de producto: ps_lineas_ventas lv -> ps_ventas v ON v.reg_ventas = lv.num_ventas (para 'entrada' y la fecha) -> ps_articulos a ON a.codigo = lv.codigo (para la referencia y las FK de dimension) -> ps_familias f ON f.reg_familia = a.num_familia (o ps_marcas.reg_marca, ps_temporadas.reg_temporada, ps_departamentos.reg_departament). Para la tienda: ps_tiendas t ON t.codigo = v.tienda, y muestra t.identificador, no el codigo.",
    "questions": [
      "como uno lineas de venta con familia",
      "join de ventas y articulos",
      "como saco el nombre de la tienda"
    ]
  },
  {
    "instruction": "En el canal mayorista la linea de factura ps_gc_lin_facturas SI lleva sus propias FK de dimension (num_familia, num_marca, num_departament, num_color, num_comercial) y su propia fecha_factura, asi que no hace falta unir con la cabecera para agrupar. Une con ps_gc_facturas solo cuando necesites la bandera 'abono' para netear.",
    "questions": [
      "como agrupo facturacion mayorista por familia",
      "necesito la cabecera de factura"
    ]
  },
  {
    "instruction": "Cuidado con las claves del mayorista: ps_gc_lin_albarane.num_albaran es la FK real a ps_gc_albaranes.reg_albaran, mientras que n_albaran es el numero visible del albaran y NO es unico. Une siempre por num_albaran -> reg_albaran. Lo mismo en ps_gc_lin_facturas: num_factura -> ps_gc_facturas.reg_factura.",
    "questions": [
      "como uno lineas y cabeceras de albaran",
      "n_albaran o num_albaran"
    ]
  },
  {
    "instruction": "ps_lineas_ventas.mes es un entero AAAAMM (202501) heredado de 4D y sirve para filtros de periodo rapidos. En PostgreSQL es igual de valido y mas legible filtrar por v.fecha_creacion con DATE_TRUNC; usa mes solo si te interesa el rendimiento sobre rangos largos. No mezcles mes con fecha_creacion en el mismo filtro sin comprobar que concuerdan.",
    "questions": [
      "que es la columna mes",
      "como filtro por periodo"
    ]
  },
  {
    "instruction": "El stock vive en dos tablas distintas del espejo: ps_stock_tienda (grano codigo + tienda + talla, columna 'stock') para tiendas retail, y ps_stock_central (grano num_articulo, columna 'stock') para el almacen central. ps_stock_central.num_articulo une con ps_articulos.reg_articulo; ps_stock_tienda.codigo une con ps_articulos.codigo. Ojo: son claves distintas, no las intercambies.",
    "questions": [
      "donde esta el stock",
      "stock central o de tienda",
      "como uno stock con articulos"
    ]
  },
  {
    "instruction": "ps_traspasos usa doble anotacion: cada movimiento aparece como salida (entrada = false, con unidades_s y fecha_s) y como entrada (entrada = true, con unidades_e y fecha_e). Para no duplicar, filtra un solo lado: usa NOT entrada con unidades_s/fecha_s para medir envios, o entrada con unidades_e/fecha_e para medir recepciones. Nunca sumes ambos.",
    "questions": [
      "como cuento traspasos",
      "por que salen unidades duplicadas",
      "unidades_s o unidades_e"
    ]
  },
  {
    "instruction": "Nunca hagas SELECT * en este dominio. En 4D las tablas son muy anchas (Articulos 379 columnas, CCStock 582) y en el espejo sigue siendo mala practica porque infla el payload del widget. Enumera siempre las columnas y ponles alias en espanol para el usuario final.",
    "questions": [
      "puedo hacer select *",
      "buenas practicas de consulta"
    ]
  }
]
```

## LLM:sql-pairs

<!--
PostgreSQL contra el espejo ps_*, NO SQL de 4D.

Estos 30 pares son la version compacta (una linea) del recetario de arriba.
Cada uno se ha comprobado con EXPLAIN contra el esquema real del espejo
(2026-08-29): 30/30 planifican sin error, asi que ninguna columna ni tabla
referenciada es inventada.

Todo importe o unidad agregada va NETO de devoluciones:
  COALESCE(SUM(x) FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(x) FILTER (WHERE NOT v."entrada"), 0)
En el canal mayorista el neteo usa la bandera "abono" en vez de "entrada".
-->

### ¿Cuánto hemos vendido cada día en una tienda concreta? (neto de devoluciones)
```sql
SELECT v."fecha_creacion" AS "Fecha", COUNT(*) FILTER (WHERE v."entrada") AS "Tickets", COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta" FROM "public"."ps_ventas" v WHERE v."tienda" = '154' AND v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY v."fecha_creacion" ORDER BY v."fecha_creacion"
```

### ¿Cuál es la venta neta mensual por tienda?
```sql
SELECT t."identificador" AS "Tienda", DATE_TRUNC('month', v."fecha_creacion")::date AS "Mes", COUNT(*) FILTER (WHERE v."entrada") AS "Tickets", COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta" FROM "public"."ps_ventas" v JOIN "public"."ps_tiendas" t ON t."codigo" = v."tienda" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY t."identificador", DATE_TRUNC('month', v."fecha_creacion") ORDER BY "Mes", "Venta Neta" DESC
```

### ¿Cuáles son los 20 productos con más facturación neta?
```sql
SELECT a."ccrefejofacm" AS "Referencia", a."descripcion" AS "Descripción", COALESCE(SUM(lv."unidades") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."unidades") FILTER (WHERE NOT v."entrada"), 0) AS "Unidades", COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON v."reg_ventas" = lv."num_ventas" JOIN "public"."ps_articulos" a ON a."codigo" = lv."codigo" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY a."ccrefejofacm", a."descripcion" ORDER BY "Venta Neta" DESC LIMIT 20
```

### ¿Cuánto vendemos por familia de producto?
```sql
SELECT f."fami_grup_marc" AS "Familia", COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta", COALESCE(SUM(lv."unidades") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."unidades") FILTER (WHERE NOT v."entrada"), 0) AS "Unidades" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON v."reg_ventas" = lv."num_ventas" JOIN "public"."ps_articulos" a ON a."codigo" = lv."codigo" JOIN "public"."ps_familias" f ON f."reg_familia" = a."num_familia" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY f."fami_grup_marc" ORDER BY "Venta Neta" DESC
```

### ¿Cuánto vendemos por marca?
```sql
SELECT m."marca_tratamien" AS "Marca", COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON v."reg_ventas" = lv."num_ventas" JOIN "public"."ps_articulos" a ON a."codigo" = lv."codigo" JOIN "public"."ps_marcas" m ON m."reg_marca" = a."num_marca" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY m."marca_tratamien" ORDER BY "Venta Neta" DESC
```

### ¿Cuánto vendemos por temporada?
```sql
SELECT te."temporada_tipo" AS "Temporada", COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON v."reg_ventas" = lv."num_ventas" JOIN "public"."ps_articulos" a ON a."codigo" = lv."codigo" JOIN "public"."ps_temporadas" te ON te."reg_temporada" = a."num_temporada" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY te."temporada_tipo" ORDER BY "Venta Neta" DESC
```

### ¿Cuánto vendemos por departamento?
```sql
SELECT d."depa_secc_fabr" AS "Departamento", COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON v."reg_ventas" = lv."num_ventas" JOIN "public"."ps_articulos" a ON a."codigo" = lv."codigo" JOIN "public"."ps_departamentos" d ON d."reg_departament" = a."num_departament" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY d."depa_secc_fabr" ORDER BY "Venta Neta" DESC
```

### ¿Cuánto importan las devoluciones por tienda este mes?
```sql
SELECT t."identificador" AS "Tienda", COUNT(*) FILTER (WHERE NOT v."entrada") AS "Tickets Devolución", SUM(v."total_si") FILTER (WHERE NOT v."entrada") AS "Importe Devuelto", ROUND(100.0 * SUM(v."total_si") FILTER (WHERE NOT v."entrada") / NULLIF(SUM(v."total_si") FILTER (WHERE v."entrada"), 0), 2) AS "% sobre Bruto" FROM "public"."ps_ventas" v JOIN "public"."ps_tiendas" t ON t."codigo" = v."tienda" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY t."identificador" ORDER BY "Importe Devuelto" DESC NULLS LAST
```

### ¿Qué día de la semana vendemos más?
```sql
SELECT TO_CHAR(v."fecha_creacion", 'ID') AS "Día ISO", TRIM(TO_CHAR(v."fecha_creacion", 'Day')) AS "Día", COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta" FROM "public"."ps_ventas" v WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY 1, 2 ORDER BY 1
```

### ¿Cómo se reparten las ventas por hora del día?
```sql
SELECT EXTRACT(HOUR FROM v."hora_creacion")::int AS "Hora", COUNT(*) FILTER (WHERE v."entrada") AS "Tickets", COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta" FROM "public"."ps_ventas" v WHERE v."hora_creacion" IS NOT NULL AND v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY 1 ORDER BY 1
```

### ¿Cuál es el ticket medio por tienda?
```sql
SELECT t."identificador" AS "Tienda", COUNT(*) FILTER (WHERE v."entrada") AS "Tickets", COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta", ROUND((COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0)) / NULLIF(COUNT(*) FILTER (WHERE v."entrada"), 0), 2) AS "Ticket Medio" FROM "public"."ps_ventas" v JOIN "public"."ps_tiendas" t ON t."codigo" = v."tienda" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY t."identificador" ORDER BY "Ticket Medio" DESC
```

### ¿Cuáles son los mejores clientes de retail por importe gastado?
```sql
SELECT c."nombre" AS "Cliente", COUNT(*) FILTER (WHERE v."entrada") AS "Compras", COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Gasto Neto", MAX(v."fecha_creacion") AS "Última Compra" FROM "public"."ps_ventas" v JOIN "public"."ps_clientes" c ON c."reg_cliente" = v."num_cliente" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY c."nombre" ORDER BY "Gasto Neto" DESC LIMIT 50
```

### ¿Cuántos clientes únicos compran en cada tienda?
```sql
SELECT t."identificador" AS "Tienda", COUNT(DISTINCT v."num_cliente") AS "Clientes Únicos" FROM "public"."ps_ventas" v JOIN "public"."ps_tiendas" t ON t."codigo" = v."tienda" WHERE v."num_cliente" IS NOT NULL AND v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY t."identificador" ORDER BY "Clientes Únicos" DESC
```

### ¿Cuánto se cobra por cada forma de pago?
```sql
SELECT pv."forma" AS "Forma de Pago", COUNT(*) FILTER (WHERE pv."entrada") AS "Cobros", COALESCE(SUM(pv."importe_cob") FILTER (WHERE pv."entrada"), 0) - COALESCE(SUM(pv."importe_cob") FILTER (WHERE NOT pv."entrada"), 0) AS "Importe Neto" FROM "public"."ps_pagos_ventas" pv WHERE pv."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY pv."forma" ORDER BY "Importe Neto" DESC
```

### ¿Cuál es el mix de formas de pago por tienda?
```sql
SELECT t."identificador" AS "Tienda", pv."forma" AS "Forma de Pago", COALESCE(SUM(pv."importe_cob") FILTER (WHERE pv."entrada"), 0) - COALESCE(SUM(pv."importe_cob") FILTER (WHERE NOT pv."entrada"), 0) AS "Importe Neto" FROM "public"."ps_pagos_ventas" pv JOIN "public"."ps_tiendas" t ON t."codigo" = pv."tienda" WHERE pv."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY t."identificador", pv."forma" ORDER BY t."identificador", "Importe Neto" DESC
```

### ¿Cuál es el margen bruto por producto en retail?
```sql
SELECT a."ccrefejofacm" AS "Referencia", a."descripcion" AS "Descripción", COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta", COALESCE(SUM(lv."total_coste_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_coste_si") FILTER (WHERE NOT v."entrada"), 0) AS "Coste", (COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0)) - (COALESCE(SUM(lv."total_coste_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_coste_si") FILTER (WHERE NOT v."entrada"), 0)) AS "Margen" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON v."reg_ventas" = lv."num_ventas" JOIN "public"."ps_articulos" a ON a."codigo" = lv."codigo" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY a."ccrefejofacm", a."descripcion" ORDER BY "Margen" DESC LIMIT 20
```

### ¿Cuál es el porcentaje de margen por familia?
```sql
SELECT f."fami_grup_marc" AS "Familia", COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta", ROUND(100.0 * ((COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0)) - (COALESCE(SUM(lv."total_coste_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_coste_si") FILTER (WHERE NOT v."entrada"), 0))) / NULLIF(COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0), 0), 1) AS "Margen %" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON v."reg_ventas" = lv."num_ventas" JOIN "public"."ps_articulos" a ON a."codigo" = lv."codigo" JOIN "public"."ps_familias" f ON f."reg_familia" = a."num_familia" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY f."fami_grup_marc" ORDER BY "Margen %" DESC
```

### ¿Cuál es el margen por tienda?
```sql
SELECT t."identificador" AS "Tienda", COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta", ROUND(100.0 * ((COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0)) - (COALESCE(SUM(lv."total_coste_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_coste_si") FILTER (WHERE NOT v."entrada"), 0))) / NULLIF(COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0), 0), 1) AS "Margen %" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON v."reg_ventas" = lv."num_ventas" JOIN "public"."ps_tiendas" t ON t."codigo" = v."tienda" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY t."identificador" ORDER BY "Margen %" DESC
```

### ¿Cuánto stock hay en el almacén central por producto?
```sql
SELECT a."ccrefejofacm" AS "Referencia", a."descripcion" AS "Descripción", sc."stock" AS "Stock Central" FROM "public"."ps_stock_central" sc JOIN "public"."ps_articulos" a ON a."reg_articulo" = sc."num_articulo" WHERE sc."stock" > 0 ORDER BY sc."stock" DESC LIMIT 50
```

### ¿Cuánto stock hay de una referencia en cada tienda y talla?
```sql
SELECT st."tienda" AS "Tienda", st."talla" AS "Talla", st."stock" AS "Stock" FROM "public"."ps_stock_tienda" st JOIN "public"."ps_articulos" a ON a."codigo" = st."codigo" WHERE a."ccrefejofacm" = 'V26391168' AND st."stock" <> 0 ORDER BY st."tienda", st."talla"
```

### ¿Qué stock total tiene cada tienda?
```sql
SELECT t."identificador" AS "Tienda", COUNT(DISTINCT st."codigo") AS "Referencias", SUM(st."stock") AS "Unidades" FROM "public"."ps_stock_tienda" st JOIN "public"."ps_tiendas" t ON t."codigo" = st."tienda" WHERE st."stock" > 0 GROUP BY t."identificador" ORDER BY "Unidades" DESC
```

### ¿Qué productos tienen stock negativo?
```sql
SELECT a."ccrefejofacm" AS "Referencia", a."descripcion" AS "Descripción", st."tienda" AS "Tienda", st."talla" AS "Talla", st."stock" AS "Stock" FROM "public"."ps_stock_tienda" st JOIN "public"."ps_articulos" a ON a."codigo" = st."codigo" WHERE st."stock" < 0 ORDER BY st."stock" ASC LIMIT 50
```

### ¿Cuánto facturamos a mayoristas por mes? (neto de abonos)
```sql
SELECT DATE_TRUNC('month', gf."fecha_factura")::date AS "Mes", COALESCE(SUM(gf."total_factura") FILTER (WHERE gf."abono" IS NOT TRUE), 0) - COALESCE(SUM(gf."total_factura") FILTER (WHERE gf."abono" IS TRUE), 0) AS "Facturación Neta" FROM "public"."ps_gc_facturas" gf WHERE gf."fecha_factura" BETWEEN :curr_from AND :curr_to GROUP BY 1 ORDER BY 1
```

### ¿Cuáles son los mejores clientes mayoristas?
```sql
SELECT c."nombre" AS "Cliente", COALESCE(SUM(gf."total_factura") FILTER (WHERE gf."abono" IS NOT TRUE), 0) - COALESCE(SUM(gf."total_factura") FILTER (WHERE gf."abono" IS TRUE), 0) AS "Facturación Neta" FROM "public"."ps_gc_facturas" gf JOIN "public"."ps_clientes" c ON c."reg_cliente" = gf."num_cliente" WHERE gf."fecha_factura" BETWEEN :curr_from AND :curr_to GROUP BY c."nombre" ORDER BY "Facturación Neta" DESC LIMIT 30
```

### ¿Qué productos se venden más en el canal mayorista?
```sql
SELECT gl."codigo" AS "Código", gl."descripcion" AS "Descripción", SUM(gl."unidades") AS "Unidades", SUM(gl."total") AS "Importe" FROM "public"."ps_gc_lin_facturas" gl WHERE gl."fecha_factura" BETWEEN :curr_from AND :curr_to GROUP BY gl."codigo", gl."descripcion" ORDER BY "Importe" DESC LIMIT 20
```

### ¿Cuál es el margen del canal mayorista por producto?
```sql
SELECT gl."codigo" AS "Código", gl."descripcion" AS "Descripción", SUM(gl."total") AS "Importe", SUM(gl."total_coste") AS "Coste", SUM(gl."total") - SUM(gl."total_coste") AS "Margen", ROUND(100.0 * (SUM(gl."total") - SUM(gl."total_coste")) / NULLIF(SUM(gl."total"), 0), 1) AS "Margen %" FROM "public"."ps_gc_lin_facturas" gl WHERE gl."fecha_factura" BETWEEN :curr_from AND :curr_to GROUP BY gl."codigo", gl."descripcion" ORDER BY "Margen" DESC LIMIT 20
```

### ¿Cuántas unidades se traspasan entre tiendas y por qué ruta?
```sql
SELECT tr."tienda_salida" AS "Origen", tr."tienda_entrada" AS "Destino", COUNT(*) AS "Movimientos", SUM(tr."unidades_s") AS "Unidades Enviadas" FROM "public"."ps_traspasos" tr WHERE tr."fecha_s" BETWEEN :curr_from AND :curr_to AND NOT tr."entrada" AND tr."tipo" = 'Autoreposicion' GROUP BY tr."tienda_salida", tr."tienda_entrada" ORDER BY "Unidades Enviadas" DESC LIMIT 20
```

### ¿Qué tipos de traspaso se usan más?
```sql
SELECT tr."tipo" AS "Tipo", tr."concepto" AS "Concepto", COUNT(*) AS "Movimientos", SUM(tr."unidades_s") AS "Unidades" FROM "public"."ps_traspasos" tr WHERE tr."fecha_s" BETWEEN :curr_from AND :curr_to GROUP BY tr."tipo", tr."concepto" ORDER BY "Movimientos" DESC
```

### ¿Cuánto vendemos en retail excluyendo los artículos de mayorista (prefijo M)?
```sql
SELECT DATE_TRUNC('month', v."fecha_creacion")::date AS "Mes", COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta Retail" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON v."reg_ventas" = lv."num_ventas" WHERE lv."codigo" NOT LIKE 'M%' AND v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY 1 ORDER BY 1
```
