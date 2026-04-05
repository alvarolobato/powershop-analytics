#!/usr/bin/env python3
"""Push full semantic metadata to WrenAI: descriptions, aliases, knowledge, relationships.

Run after WrenAI is up and the PostgreSQL data source is connected:
    python3 scripts/wren-push-metadata.py [--url http://localhost:3000]
    python3 scripts/wren-push-metadata.py --validate  # validate SQL pairs against PostgreSQL

This script is idempotent — safe to re-run. Steps:
  1. Push model descriptions and display name aliases via GraphQL API
  2. Create relationships via GraphQL API
  3. Update column display names and descriptions directly in WrenAI's SQLite DB
  4. Populate knowledge (instructions + SQL pairs) in SQLite using merge strategy:
       - Source instructions: marked is_default=1, deleted+recreated on each run
       - User instructions: is_default=0 (created via UI), never touched by this script
       - SQL pairs: tracked by question text — only source pairs are updated
  5. Deploy (re-index embeddings in qdrant)
  6. Index instructions + SQL pairs in qdrant via AI service

Requires: the wren-ui container to be running (for GraphQL API + SQLite copy).
"""
import argparse
import json
import os
import shutil
import subprocess
import sqlite3
import sys
import tempfile
import urllib.request


def gql(url, query):
    req = urllib.request.Request(
        f"{url}/api/graphql",
        data=json.dumps({"query": query}).encode(),
        headers={"Content-Type": "application/json"},
    )
    resp = urllib.request.urlopen(req, timeout=60)
    return json.loads(resp.read())


# ═══════════════════════════════════════════════════════════════════════
# MODEL METADATA (descriptions + aliases) — pushed via GraphQL
# ═══════════════════════════════════════════════════════════════════════

MODEL_METADATA = {
    "ps_articulos": {
        "alias": "Producto",
        "desc": "Catálogo de productos y artículos. Referencia comercial = ccrefejofacm (mostrar como 'Referencia'). Prefijo M = mayorista, MA = material sin inventario.",
    },
    "ps_familias": {"alias": "Familia", "desc": "Familias/grupos de productos (jerarquía de clasificación)"},
    "ps_departamentos": {"alias": "Departamento", "desc": "Departamentos/secciones (nivel superior)"},
    "ps_colores": {"alias": "Color", "desc": "Catálogo de colores de producto"},
    "ps_temporadas": {"alias": "Temporada", "desc": "Temporadas y tipos (clasificación temporal)"},
    "ps_marcas": {"alias": "Marca", "desc": "Marcas de producto"},
    "ps_clientes": {"alias": "Cliente", "desc": "Clientes. num_cliente=0 son ventas anónimas de caja."},
    "ps_tiendas": {"alias": "Tienda", "desc": "Tiendas y puntos de venta. Código 99=almacén central, 97=tienda online."},
    "ps_proveedores": {"alias": "Proveedor", "desc": "Proveedores de mercancía"},
    "ps_gc_comerciales": {"alias": "Comercial", "desc": "Comerciales/agentes de ventas mayorista"},
    "ps_ventas": {
        "alias": "Venta",
        "desc": "Tickets de venta retail/TPV. USAR SIEMPRE total_si (sin IVA) para análisis. NUNCA total (con IVA). fecha_creacion = fecha de la venta.",
    },
    "ps_lineas_ventas": {
        "alias": "LineaVenta",
        "desc": "Líneas de venta (detalle por artículo). total_si=importe sin IVA. unidades=cantidad. codigo=artículo (join con Producto).",
    },
    "ps_pagos_ventas": {"alias": "PagoVenta", "desc": "Pagos por ticket. importe_cob=importe cobrado."},
    "ps_stock_tienda": {
        "alias": "StockTienda",
        "desc": "Stock por tienda y talla (normalizado). tienda=código (99=almacén, 97=online). stock=unidades.",
    },
    "ps_traspasos": {"alias": "Traspaso", "desc": "Traspasos de stock entre tiendas"},
    "ps_gc_albaranes": {"alias": "AlbaranMayorista", "desc": "Albaranes mayorista (entregas B2B). Importe neto=base1+base2+base3."},
    "ps_gc_lin_albarane": {"alias": "LineaAlbaranMayorista", "desc": "Líneas de albarán mayorista"},
    "ps_gc_facturas": {"alias": "FacturaMayorista", "desc": "Facturas mayorista. Importe neto=base1+base2+base3."},
    "ps_gc_lin_facturas": {"alias": "LineaFacturaMayorista", "desc": "Líneas de factura mayorista"},
    "ps_gc_pedidos": {"alias": "PedidoMayorista", "desc": "Pedidos mayorista"},
    "ps_gc_lin_pedidos": {"alias": "LineaPedidoMayorista", "desc": "Líneas de pedido mayorista"},
    "ps_compras": {"alias": "PedidoCompra", "desc": "Pedidos de compra a proveedores"},
    "ps_lineas_compras": {"alias": "LineaPedidoCompra", "desc": "Líneas de pedido de compra"},
    "ps_facturas": {"alias": "Factura", "desc": "Facturas de compra"},
    "ps_albaranes": {"alias": "AlbaranRecepcion", "desc": "Albaranes de recepción"},
    "ps_facturas_compra": {"alias": "FacturaCompra", "desc": "Facturas de compra a proveedores"},
}

# ═══════════════════════════════════════════════════════════════════════
# RELATIONSHIPS — pushed via GraphQL
# ═══════════════════════════════════════════════════════════════════════

RELATIONSHIPS = [
    ("ps_lineas_ventas", "num_ventas", "ps_ventas", "reg_ventas", "MANY_TO_ONE"),
    ("ps_pagos_ventas", "num_ventas", "ps_ventas", "reg_ventas", "MANY_TO_ONE"),
    ("ps_ventas", "tienda", "ps_tiendas", "codigo", "MANY_TO_ONE"),
    ("ps_ventas", "num_cliente", "ps_clientes", "reg_cliente", "MANY_TO_ONE"),
    ("ps_lineas_ventas", "codigo", "ps_articulos", "codigo", "MANY_TO_ONE"),
    ("ps_articulos", "num_familia", "ps_familias", "reg_familia", "MANY_TO_ONE"),
    ("ps_articulos", "num_departament", "ps_departamentos", "reg_departament", "MANY_TO_ONE"),
    ("ps_articulos", "num_color", "ps_colores", "reg_color", "MANY_TO_ONE"),
    ("ps_articulos", "num_temporada", "ps_temporadas", "reg_temporada", "MANY_TO_ONE"),
    ("ps_articulos", "num_marca", "ps_marcas", "reg_marca", "MANY_TO_ONE"),
    ("ps_stock_tienda", "codigo", "ps_articulos", "codigo", "MANY_TO_ONE"),
    ("ps_stock_tienda", "tienda", "ps_tiendas", "codigo", "MANY_TO_ONE"),
    ("ps_gc_lin_albarane", "n_albaran", "ps_gc_albaranes", "n_albaran", "MANY_TO_ONE"),
    ("ps_gc_lin_facturas", "num_factura", "ps_gc_facturas", "n_factura", "MANY_TO_ONE"),
    ("ps_gc_albaranes", "num_cliente", "ps_clientes", "reg_cliente", "MANY_TO_ONE"),
    ("ps_gc_facturas", "num_cliente", "ps_clientes", "reg_cliente", "MANY_TO_ONE"),
    ("ps_gc_albaranes", "num_comercial", "ps_gc_comerciales", "reg_comercial", "MANY_TO_ONE"),
    ("ps_gc_facturas", "num_comercial", "ps_gc_comerciales", "reg_comercial", "MANY_TO_ONE"),
    ("ps_lineas_compras", "num_pedido", "ps_compras", "reg_pedido", "MANY_TO_ONE"),
]

# ═══════════════════════════════════════════════════════════════════════
# COLUMN DISPLAY NAMES + DESCRIPTIONS — pushed via SQLite
# ═══════════════════════════════════════════════════════════════════════

# {model_alias: {source_column: (display_name, description)}}
COLUMN_META = {
    "Producto": {
        "reg_articulo": ("ID Artículo", "ID interno del artículo (PK)"),
        "codigo": ("Código", "Código interno de artículo"),
        "ccrefejofacm": ("Referencia", "Referencia comercial — identificador principal de negocio. M=mayorista, MA=material"),
        "descripcion": ("Descripción", "Descripción del artículo"),
        "codigo_barra": ("EAN", "Código de barras EAN"),
        "num_familia": ("Familia", "FK → Familia"),
        "num_departament": ("Departamento", "FK → Departamento"),
        "num_color": ("Color (FK)", "FK → Color"),
        "num_temporada": ("Temporada", "FK → Temporada"),
        "num_marca": ("Marca", "FK → Marca"),
        "num_proveedor": ("Proveedor", "FK → Proveedor"),
        "precio_coste": ("Precio Coste", "Precio de coste"),
        "pr_coste_ne": ("Coste Neto", "Precio de coste neto sin IVA"),
        "p_iva": ("% IVA", "Porcentaje de IVA"),
        "anulado": ("Anulado", "Artículo inactivo"),
        "fecha_creacion": ("Fecha Creación", "Fecha de creación"),
        "fecha_modifica": ("Última Modificación", "Última modificación"),
        "color": ("Color", "Color (texto)"),
        "clave_temporada": ("Clave Temporada", "Clave de temporada"),
        "modelo": ("Modelo", "Modelo del artículo"),
        "sexo": ("Género", "Género destinatario"),
    },
    "Venta": {
        "reg_ventas": ("ID Venta", "ID interno del ticket (PK)"),
        "n_documento": ("Nº Documento", "Número de ticket"),
        "serie_v": ("Serie", "Serie del documento"),
        "tienda": ("Tienda", "Código de tienda"),
        "fecha_creacion": ("Fecha", "Fecha de la venta"),
        "fecha_modifica": ("Última Modificación", "Última modificación"),
        "total_si": ("Importe Neto", "Importe SIN IVA — usar siempre para análisis"),
        "total": ("Importe Bruto", "Importe CON IVA — NO usar para comparar"),
        "num_cliente": ("Cliente", "Nº cliente (0=anónimo)"),
        "codigo_cajero": ("Código Cajero", "Código del cajero"),
        "cajero_nombre": ("Cajero", "Nombre del cajero"),
        "tipo_venta": ("Tipo Venta", "Tipo de venta"),
        "tipo_documento": ("Tipo Doc", "V=venta, D=devolución"),
        "forma": ("Forma Pago", "Forma de pago"),
        "entrada": ("Es Entrada", "Entrada (vs devolución)"),
        "pendiente": ("Pendiente", "Pendiente de cobro"),
        "pedido_web": ("Pedido Web", "ID pedido online"),
    },
    "LineaVenta": {
        "reg_lineas": ("ID Línea", "ID interno (PK)"),
        "num_ventas": ("ID Venta", "FK → Venta"),
        "n_documento": ("Nº Documento", "Número de ticket"),
        "mes": ("Período", "YYYYMM (ej: 202603)"),
        "tienda": ("Tienda", "Código de tienda"),
        "codigo": ("Código Artículo", "JOIN con Producto.codigo"),
        "descripcion": ("Descripción", "Descripción del artículo"),
        "unidades": ("Unidades", "Cantidad vendida"),
        "precio_neto_si": ("Precio Unitario", "Precio sin IVA"),
        "total_si": ("Importe Neto", "Importe línea sin IVA"),
        "precio_coste_ci": ("Coste Unitario", "Precio de coste"),
        "total_coste_si": ("Coste Total", "Coste total de la línea"),
        "fecha_creacion": ("Fecha", "Fecha de la venta"),
        "fecha_modifica": ("Última Modificación", "Última modificación"),
    },
    "PagoVenta": {
        "reg_pagos": ("ID Pago", "ID interno (PK)"),
        "num_ventas": ("ID Venta", "FK → Venta"),
        "forma": ("Forma Pago", "Forma de pago"),
        "codigo_forma": ("Código Forma", "Código forma pago"),
        "importe_cob": ("Importe", "Importe cobrado"),
        "fecha_creacion": ("Fecha", "Fecha del pago"),
        "fecha_modifica": ("Última Modificación", "Última modificación"),
        "tienda": ("Tienda", "Código de tienda"),
        "entrada": ("Es Entrada", "Entrada (vs devolución)"),
    },
    "StockTienda": {
        "codigo": ("Código Artículo", "Código de artículo"),
        "tienda_codigo": ("Clave Tienda/Artículo", "Clave compuesta"),
        "tienda": ("Tienda", "Código tienda (99=almacén, 97=online)"),
        "talla": ("Talla", "Talla del artículo"),
        "stock": ("Stock", "Unidades disponibles"),
        "cc_stock": ("Stock Central", "Stock almacén central"),
        "st_stock": ("Stock Total", "Stock total calculado"),
        "fecha_modifica": ("Última Actualización", "Última actualización"),
    },
    "Tienda": {
        "reg_tienda": ("ID Tienda", "ID interno (PK)"),
        "codigo": ("Código", "Código (99=almacén, 97=online)"),
        "fecha_modifica": ("Última Modificación", "Última modificación"),
    },
    "Cliente": {
        "reg_cliente": ("ID Cliente", "ID interno (PK)"),
        "num_cliente": ("Nº Cliente", "Número (0=anónimo)"),
        "nombre": ("Nombre", "Nombre del cliente"),
        "nif": ("NIF", "NIF/CIF"),
        "email": ("Email", "Email"),
        "codigo_postal": ("C.P.", "Código postal"),
        "poblacion": ("Población", "Ciudad"),
        "pais": ("País", "País"),
        "fecha_creacion": ("Fecha Alta", "Fecha de alta"),
        "fecha_modifica": ("Última Modificación", "Última modificación"),
        "ultima_compra_f": ("Última Compra", "Fecha última compra"),
    },
    "AlbaranMayorista": {
        "reg_albaran": ("ID Albarán", "ID interno (PK)"),
        "n_albaran": ("Nº Albarán", "Número de albarán"),
        "num_cliente": ("Cliente", "FK → Cliente"),
        "fecha_envio": ("Fecha Envío", "Fecha de envío"),
        "fecha_valor": ("Fecha Valor", "Fecha valor"),
        "modifica": ("Última Modificación", "Fecha modificación"),
        "base1": ("Base 1", "Base imponible 1 sin IVA"),
        "base2": ("Base 2", "Base imponible 2 sin IVA"),
        "base3": ("Base 3", "Base imponible 3 sin IVA"),
        "entregadas": ("Unidades", "Unidades entregadas"),
        "transportista": ("Transportista", "Transportista"),
        "num_comercial": ("Comercial", "FK → Comercial"),
        "temporada": ("Temporada", "Temporada"),
    },
    "FacturaMayorista": {
        "reg_factura": ("ID Factura", "ID interno (PK)"),
        "n_factura": ("Nº Factura", "Número de factura"),
        "fecha_factura": ("Fecha", "Fecha de factura"),
        "modifica": ("Última Modificación", "Fecha modificación"),
        "base1": ("Base 1", "Base imponible 1 sin IVA"),
        "base2": ("Base 2", "Base imponible 2 sin IVA"),
        "base3": ("Base 3", "Base imponible 3 sin IVA"),
        "num_cliente": ("Cliente", "FK → Cliente"),
        "num_comercial": ("Comercial", "FK → Comercial"),
        "abono": ("Es Abono", "Nota de crédito"),
        "total_factura": ("Total (IVA inc.)", "Total CON IVA — usar base1+2+3 para neto"),
    },
}

# ═══════════════════════════════════════════════════════════════════════
# KNOWLEDGE: Instructions (rules the LLM must follow)
# ═══════════════════════════════════════════════════════════════════════
# All source instructions get is_default=1 in SQLite — safe to update on each run.
# User-created instructions (via UI) have is_default=0 and are never touched.

INSTRUCTIONS = [
    # ── Revenue / Sales rules ──────────────────────────────────────────
    {
        "instruction": "Siempre usar el campo total_si (sin IVA) para análisis económico de ventas retail. NUNCA usar el campo total que incluye IVA. El IVA varía por región (23% Portugal continental, 22% Madeira, 21% España) y distorsiona las comparaciones entre tiendas.",
        "questions": [
            "¿Cuánto vendimos?",
            "¿Cuáles son las ventas netas?",
            "¿Cuál es la facturación?",
            "¿Cuántos ingresos tuvimos este mes?",
        ],
    },
    {
        "instruction": "El campo fecha_creacion en Venta y LineaVenta es la fecha de la venta (tipo DATE, formato YYYY-MM-DD). Para filtrar por fecha usar comparaciones simples: fecha_creacion >= '2026-03-24' AND fecha_creacion < '2026-03-31'. NUNCA hacer CAST a TIMESTAMP WITH TIME ZONE — el campo ya es DATE. El campo fecha_documento está vacío (NULL) en todos los registros de Ventas — NUNCA usarlo para filtrar.",
        "questions": [
            "¿Ventas de la semana pasada?",
            "¿Ventas de hoy?",
            "¿Ventas de este mes?",
            "¿Cuánto vendimos en marzo?",
        ],
    },
    {
        "instruction": "El campo mes en LineaVenta es un entero con formato YYYYMM (ej: 202603 = marzo 2026). Usar para filtrado rápido por período en vez de funciones de fecha: WHERE mes BETWEEN 202601 AND 202612. Es el filtro más eficiente para consultas de ventas por período.",
        "questions": [
            "¿Ventas del primer trimestre?",
            "¿Ventas de enero a marzo?",
            "¿Rendimiento del año 2025?",
        ],
    },
    {
        "instruction": "En la tabla Venta, el campo entrada indica si es venta (entrada=true) o devolución (entrada=false). Para calcular ventas netas siempre filtrar entrada=true y restar el importe de devoluciones. El campo tipo_documento contiene 'Ticket' para ventas POS normales. NO filtrar por tipo_documento='V' que no existe en el mirror.",
        "questions": [
            "¿Cuántas devoluciones hubo?",
            "¿Ventas netas sin devoluciones?",
            "¿Cuánto se devolvió este mes?",
            "¿Tasa de devolución?",
        ],
    },
    {
        "instruction": "Para excluir la tienda 99 (almacén central) del análisis retail, añadir WHERE tienda <> '99' en consultas de ventas por tienda. El almacén central no es una tienda física de venta al público. La tienda 97 es la tienda online con patrones diferentes.",
        "questions": [
            "¿Ventas por tienda?",
            "¿Qué tiendas venden más?",
            "¿Rendimiento de tiendas retail?",
            "¿Ranking de tiendas?",
        ],
    },
    {
        "instruction": "El ticket medio se calcula como: SUM(total_si) / COUNT(DISTINCT reg_ventas) de la tabla Venta. Usar siempre total_si (sin IVA). Filtrar entrada=true para excluir devoluciones del cálculo.",
        "questions": [
            "¿Cuál es el ticket medio?",
            "¿Cuánto gasta cada cliente de media?",
            "¿Valor medio por transacción?",
        ],
    },
    {
        "instruction": "Las ventas YTD (año hasta la fecha) se calculan con: WHERE fecha_creacion >= DATE_TRUNC('year', CURRENT_DATE) AND fecha_creacion <= CURRENT_DATE. Para comparar con el año anterior usar: WHERE fecha_creacion >= DATE_TRUNC('year', CURRENT_DATE) - INTERVAL '1 year' AND fecha_creacion <= CURRENT_DATE - INTERVAL '1 year'.",
        "questions": [
            "¿Ventas acumuladas del año?",
            "¿Comparativa año anterior?",
            "¿Crecimiento YTD?",
            "¿Ventas vs el año pasado?",
        ],
    },
    {
        "instruction": "La tendencia semanal se calcula iterando semanas hacia atrás desde hoy: WHERE fecha_creacion >= CURRENT_DATE - INTERVAL '7 days'. Para 12 semanas, usar rangos semanales. Excluir tienda 99 para análisis de retail. Usar total_si para importes.",
        "questions": [
            "¿Tendencia de ventas semanal?",
            "¿Últimas 12 semanas?",
            "¿Evolución semanal de ventas?",
        ],
    },

    # ── Wholesale rules ────────────────────────────────────────────────
    {
        "instruction": "Para facturación mayorista (canal B2B), el importe neto sin IVA se calcula como base1 + base2 + base3 de las tablas ps_gc_facturas o ps_gc_albaranes. NUNCA usar total_factura o total_albaran que incluyen IVA. Excluir notas de crédito con abono=true.",
        "questions": [
            "¿Cuánto facturamos en mayorista?",
            "¿Cuál es la facturación B2B?",
            "¿Ventas mayoristas del año?",
            "¿Ingresos del canal wholesale?",
        ],
    },
    {
        "instruction": "El canal mayorista sigue un flujo de documentos: Pedido (ps_gc_pedidos) → Albarán/nota de entrega (ps_gc_albaranes) → Factura (ps_gc_facturas) → Cobro (tabla cobros_facturas). Para métricas financieras usar facturas. Para métricas logísticas/operativas usar albaranes. Los cobros son deferred (30/60/90 días después de la factura).",
        "questions": [
            "¿Cuántos pedidos mayoristas?",
            "¿Estado de cobros B2B?",
            "¿Albaranes pendientes de facturar?",
        ],
    },
    {
        "instruction": "Los abonos mayoristas (ps_gc_albaranes con abono=true o ps_gc_facturas con abono=true) son notas de crédito por devoluciones. Para calcular facturación neta mayorista, excluirlos: WHERE abono = false.",
        "questions": [
            "¿Devoluciones de clientes mayoristas?",
            "¿Facturación neta mayorista?",
            "¿Cuántos abonos mayoristas?",
        ],
    },
    {
        "instruction": "La facturación mayorista por comercial se obtiene de ps_gc_facturas JOIN ps_gc_comerciales usando num_comercial = reg_comercial. Usar base1+base2+base3 para el importe neto. Excluir abono=true.",
        "questions": [
            "¿Facturación por comercial?",
            "¿Qué comercial vende más?",
            "¿Rendimiento de representantes de ventas?",
        ],
    },

    # ── Stock rules ────────────────────────────────────────────────────
    {
        "instruction": "Stock total de un artículo = stock en almacén central (ps_stock_tienda WHERE tienda='99') + stock en tiendas físicas (ps_stock_tienda WHERE tienda<>'99'). Tienda código 99 = almacén central, código 97 = tienda online, el resto son tiendas físicas. La tabla ps_stock_tienda contiene AMBOS: central y tiendas.",
        "questions": [
            "¿Cuánto stock tenemos?",
            "¿Stock total de un artículo?",
            "¿Qué stock hay en el almacén?",
            "¿Inventario total?",
        ],
    },
    {
        "instruction": "El stock puede ser negativo en la base de datos. Causas: timing gaps (venta antes de reponer), modo offline del TPV, ajustes manuales. Para análisis de valoración, filtrar WHERE stock > 0 o usar GREATEST(stock, 0). Para análisis de incidencias, filtrar WHERE stock < 0.",
        "questions": [
            "¿Artículos con stock negativo?",
            "¿Problemas de inventario?",
            "¿Valor del stock?",
        ],
    },
    {
        "instruction": "El valor del stock al coste se calcula como SUM(s.stock * p.precio_coste) del JOIN entre ps_stock_tienda y ps_articulos. precio_coste ya está sin IVA. Filtrar WHERE s.stock > 0 AND p.anulado = false para excluir negativos y artículos inactivos.",
        "questions": [
            "¿Cuál es el valor del inventario?",
            "¿Valor del stock al coste?",
            "¿Inversión en stock?",
        ],
    },
    {
        "instruction": "Stock por talla se obtiene de ps_stock_tienda donde cada fila tiene (codigo, tienda, talla, stock). Para ver stock por talla de un artículo: SELECT talla, SUM(stock) FROM ps_stock_tienda WHERE codigo='X' GROUP BY talla. Las tallas son texto libre (ej: 'S', 'M', 'L', '38', '39', 'U').",
        "questions": [
            "¿Stock por talla?",
            "¿Qué tallas quedan?",
            "¿Distribución de tallas en stock?",
        ],
    },
    {
        "instruction": "Dead stock (stock paralizado): artículos con stock alto pero sin ventas recientes. Identificar con: ps_stock_tienda con stock > X, cruzado con ps_lineas_ventas sin ventas en los últimos N meses. Stock de temporadas antiguas que no rota es el principal riesgo.",
        "questions": [
            "¿Stock sin rotación?",
            "¿Artículos encallados?",
            "¿Dead stock?",
            "¿Stock de temporadas pasadas?",
        ],
    },

    # ── Customer rules ─────────────────────────────────────────────────
    {
        "instruction": "En la tabla Venta, num_cliente=0 indica venta anónima (cliente no identificado). Para análisis de clientes identificados, siempre filtrar num_cliente > 0. Para calcular % de ventas anónimas: COUNT(CASE WHEN num_cliente=0 THEN 1 END) / COUNT(*) * 100.",
        "questions": [
            "¿Cuántos clientes únicos?",
            "¿Clientes identificados vs anónimos?",
            "¿Porcentaje de ventas anónimas?",
        ],
    },
    {
        "instruction": "Los clientes mayoristas tienen mayorista=true en ps_clientes. Los clientes retail tienen mayorista=false. Un mismo cliente puede aparecer en ambos canales. Para clientes activos retail: COUNT(DISTINCT num_cliente) FROM ps_ventas WHERE num_cliente > 0. Para activos mayoristas: COUNT(DISTINCT num_cliente) FROM ps_gc_albaranes.",
        "questions": [
            "¿Cuántos clientes mayoristas?",
            "¿Clientes activos retail?",
            "¿Cuántos clientes B2B?",
        ],
    },
    {
        "instruction": "Los top clientes retail se obtienen de ps_ventas agrupando por num_cliente y sumando total_si, filtrando num_cliente > 0 y entrada=true. Para identificarlos hacer JOIN con ps_clientes. La frecuencia de compra se calcula como COUNT(DISTINCT reg_ventas) por cliente.",
        "questions": [
            "¿Mejores clientes retail?",
            "¿Top clientes por compras?",
            "¿Clientes más fieles?",
            "¿Frecuencia de compra?",
        ],
    },

    # ── Payment rules ──────────────────────────────────────────────────
    {
        "instruction": "En pagos retail (ps_pagos_ventas), usar siempre importe_cob (importe cobrado) para análisis de revenue. NUNCA usar importe_ent (importe entregado/tendido) que representa el efectivo físico entregado por el cliente (puede incluir cambio). Para análisis de método de pago: campo forma o codigo_forma.",
        "questions": [
            "¿Ingresos por método de pago?",
            "¿Cuánto se cobró en efectivo?",
            "¿Desglose de formas de pago?",
        ],
    },
    {
        "instruction": "Para efectivo vs tarjeta: codigo_forma='01' (o similar) suele ser efectivo/metalico. Para desglose exacto JOIN con la tabla de formas de pago. Un ticket puede tener múltiples filas en ps_pagos_ventas (pagos divididos). SUM(importe_cob) por num_ventas = Venta.total.",
        "questions": [
            "¿Efectivo vs tarjeta?",
            "¿Mix de medios de pago?",
            "¿Cuánto se pagó con tarjeta?",
        ],
    },

    # ── Margin rules ───────────────────────────────────────────────────
    {
        "instruction": "Margen bruto retail = (total_si - total_coste_si) / total_si * 100. Campos en ps_lineas_ventas: total_si = ingreso sin IVA, total_coste_si = coste sin IVA. Para margen por artículo: GROUP BY codigo. Para margen por familia: JOIN con ps_articulos y ps_familias.",
        "questions": [
            "¿Margen bruto retail?",
            "¿Rentabilidad por familia?",
            "¿Margen por artículo?",
            "¿Qué departamento tiene mejor margen?",
        ],
    },
    {
        "instruction": "Para margen mayorista, usar ps_gc_lin_facturas: margen = (total - total_coste) / total * 100. El campo total en líneas de facturas mayoristas es el ingreso, total_coste es el coste. Para resumen por cliente o comercial hacer JOIN con ps_gc_facturas.",
        "questions": [
            "¿Margen mayorista?",
            "¿Rentabilidad canal B2B?",
            "¿Margen por comercial?",
        ],
    },
    {
        "instruction": "Productos con bajo margen (< 30%): (precio_coste / precio1) > 0.7 en ps_articulos, donde precio1 es PVP con IVA. Para un cálculo más preciso usar el margen realizado de ventas: (total_si - total_coste_si) / total_si en ps_lineas_ventas. Excluir artículos con anulado=true.",
        "questions": [
            "¿Productos con bajo margen?",
            "¿Artículos poco rentables?",
            "¿Qué artículos vender menos?",
        ],
    },

    # ── Product rules ──────────────────────────────────────────────────
    {
        "instruction": "El identificador de artículo visible para el usuario es la Referencia (campo ccrefejofacm en ps_articulos, mostrar como 'Referencia'). El campo 'codigo' es un código interno. Siempre incluir la Referencia y Descripción del artículo en los resultados. En ps_lineas_ventas el campo codigo es el código interno — hacer JOIN con ps_articulos para obtener la Referencia.",
        "questions": [
            "¿Qué artículos vendimos?",
            "¿Cuáles son los productos más vendidos?",
            "¿Top artículos?",
            "¿Referencia de un producto?",
        ],
    },
    {
        "instruction": "Los artículos cuya Referencia (ccrefejofacm) empieza por 'MA' son materiales (bolsas, perchas, envoltorios) que NO tienen seguimiento de inventario. Estos artículos están EXCLUIDOS A NIVEL DE ETL — no existen en las tablas PostgreSQL (ps_articulos ni en las tablas de líneas). NO es necesario filtrar 'MA%' en ninguna consulta SQL sobre el mirror PostgreSQL. Los que empiezan por 'M' (sin 'MA') son artículos mayoristas.",
        "questions": [
            "¿Cuántos artículos tenemos?",
            "¿Catálogo activo de productos?",
            "¿Artículos de venta?",
        ],
    },
    {
        "instruction": "Las ventas retail están en ps_ventas y ps_lineas_ventas. El canal mayorista B2B usa tablas separadas: ps_gc_albaranes, ps_gc_facturas y sus líneas. NUNCA mezclar datos retail y mayorista en la misma consulta a menos que se pida explícitamente una comparativa entre canales.",
        "questions": [
            "¿Ventas totales?",
            "¿Compara retail y mayorista?",
            "¿Cuál canal vende más?",
        ],
    },
    {
        "instruction": "Los artículos con prefijo M en la Referencia (ccrefejofacm LIKE 'M%') son artículos mayoristas. Para análisis de ventas retail puro, excluir estos artículos: JOIN ps_articulos ON lv.codigo = p.codigo WHERE p.ccrefejofacm NOT LIKE 'M%'. Para análisis mayorista puro, usar las tablas GC (ps_gc_albaranes, etc.).",
        "questions": [
            "¿Ventas retail puras?",
            "¿Artículos exclusivamente retail?",
            "¿Filtrar artículos mayoristas?",
        ],
    },
    {
        "instruction": "Los artículos inactivos tienen anulado=true en ps_articulos. Para análisis de catálogo activo: WHERE anulado = false. Para stock disponible: WHERE anulado = false AND stock > 0. Para historial de ventas incluir también artículos anulados (pueden tener ventas históricas).",
        "questions": [
            "¿Artículos activos?",
            "¿Cuántos productos en catálogo?",
            "¿Artículos discontinuados?",
        ],
    },

    # ── Date rules ────────────────────────────────────────────────────
    {
        "instruction": "PKs (claves primarias) en todas las tablas son NUMERIC(20,3) en PostgreSQL, no INTEGER ni FLOAT. Esto incluye reg_ventas, reg_lineas, reg_articulo, reg_cliente, etc. Son números con decimales heredados del sistema 4D (ej: 10028816.641). NO hacer aritmética con ellos — son identificadores opacos.",
        "questions": [
            "¿Cómo hacer JOIN entre tablas?",
            "¿Tipo de datos de IDs?",
        ],
    },
    {
        "instruction": "La tabla Tienda (ps_tiendas) solo tiene codigo, no tiene campo de nombre. Al consultar ventas por tienda, mostrar el código directamente. Códigos especiales: 99=almacén central (excluir de retail), 97=tienda online. El resto son códigos numéricos de tiendas físicas.",
        "questions": [
            "¿Nombre de las tiendas?",
            "¿Qué significa el código de tienda?",
            "¿Tiendas físicas vs online?",
        ],
    },

    # ── Data quality rules ─────────────────────────────────────────────
    {
        "instruction": "El campo fecha_documento en ps_ventas es NULL para todos los registros. NUNCA usarlo. Usar fecha_creacion para filtrar por fecha de venta. El campo fecha_modifica refleja la última modificación (incluye devoluciones y correcciones fiscales).",
        "questions": [
            "¿Qué campo de fecha usar?",
            "¿Por qué fecha_documento está vacío?",
        ],
    },
    {
        "instruction": "n_albaran y n_factura NO son únicos en las tablas mayoristas. Múltiples documentos pueden compartir el mismo número (series diferentes, correcciones). No asumir unicidad ni hacer filtros de unicidad basados solo en estos campos. En las tablas de líneas del mirror (ps_gc_lin_albarane, ps_gc_lin_facturas), los JOINs líneas→cabecera deben hacerse por n_albaran/num_factura (únicos campos disponibles), pero sin asumir que sean únicos. Para JOINs entre cabeceras, usar reg_albaran y reg_factura (PKs numéricas) donde estén disponibles.",
        "questions": [
            "¿Por qué hay duplicados en n_albaran?",
            "¿Cómo hacer JOIN entre albaranes y líneas?",
        ],
    },
    {
        "instruction": "Las temporadas y colecciones en ps_articulos usan el campo clave_temporada (texto, ej: 'PV26' = Primavera-Verano 2026). Para análisis de temporada, hacer JOIN con ps_temporadas usando num_temporada = reg_temporada. El campo temporada en albaranes mayoristas es texto libre.",
        "questions": [
            "¿Ventas por temporada?",
            "¿Stock de la temporada actual?",
            "¿Artículos de la colección?",
        ],
    },

    # ── Transfers / Stock movement rules ─────────────────────────────
    {
        "instruction": "Cada traspaso físico crea DOS filas en ps_traspasos: una de salida (entrada=false, tienda_salida rellena, unidades_s) y una de entrada (entrada=true, tienda_entrada rellena, unidades_e). Para analizar envíos usar entrada=false con unidades_s. Para analizar recepciones usar entrada=true con unidades_e. Ambas filas comparten el mismo número de documento.",
        "questions": [
            "¿Traspasos enviados por tienda?",
            "¿Cuántas unidades se traspasaron?",
            "¿Movimientos de stock entre tiendas?",
        ],
    },
    {
        "instruction": "La fórmula VFP (Verificación Física de Producto) para calcular el stock esperado: Entradas = devoluciones_retail + albaranes_compra + traspasos_entrada. Salidas = ventas_retail + traspasos_salida + envíos_mayoristas. Stock_esperado = Stock_inicial + Entradas - Salidas. Si stock_esperado != stock_actual = merma o error de inventario.",
        "questions": [
            "¿Cómo calcular el stock esperado?",
            "¿Merma de inventario?",
            "¿Movimiento neto de stock?",
        ],
    },

    # ── Pricing rules ─────────────────────────────────────────────────
    {
        "instruction": "En ps_articulos, precio_coste es el coste base sin IVA. El PVP con IVA es precio1 (o precio2, precio3 para tarifas alternativas). Para calcular margen estimado al catálogo: (precio1/(1+p_iva/100) - precio_coste) / (precio1/(1+p_iva/100)) * 100. El margen realizado en ventas es más preciso: usar total_si y total_coste_si de ps_lineas_ventas.",
        "questions": [
            "¿Margen estimado de un artículo?",
            "¿PVP sin IVA?",
            "¿Precio de coste de un artículo?",
        ],
    },
    {
        "instruction": "En ps_lineas_ventas, el precio de venta unitario sin IVA está en precio_neto_si. El descuento aplicado en el campo p_desc_g (porcentaje) o importe_descuento (importe). Para calcular el descuento medio: AVG(p_desc_g) FROM ps_lineas_ventas WHERE entrada=true. Un descuento alto indica outlet o rebajas.",
        "questions": [
            "¿Descuento medio aplicado?",
            "¿Precio de venta vs PVP?",
            "¿Nivel de descuentos?",
        ],
    },

    # ── Purchasing rules ──────────────────────────────────────────────
    {
        "instruction": "Las compras a proveedores están en ps_compras (pedidos) y ps_lineas_compras (líneas). Las recepciones de mercancía están en ps_albaranes. Las facturas de proveedor en ps_facturas_compra. Para análisis de compras por proveedor: JOIN ps_compras con ps_proveedores usando num_proveedor = reg_proveedor.",
        "questions": [
            "¿Compras a proveedores?",
            "¿Pedidos pendientes de recibir?",
            "¿Cuánto compramos al proveedor X?",
        ],
    },

    # ── Field location rules (prevent wrong-table references) ────────
    {
        "instruction": "El campo 'entrada' (boolean: true=venta, false=devolución) SOLO existe en la tabla Venta (ps_ventas), NO en LineaVenta (ps_lineas_ventas). Las columnas de LineaVenta son: reg_lineas, num_ventas, n_documento, mes, tienda, codigo, descripcion, unidades, precio_neto_si, total_si, precio_coste_ci, total_coste_si, fecha_creacion, fecha_modifica. NO tiene: entrada, tipo_documento, forma, num_cliente, cajero_nombre. Para filtrar devoluciones en consultas con LineaVenta, hacer JOIN con Venta y filtrar Venta.entrada.",
        "questions": [
            "¿Artículos más vendidos?",
            "¿Unidades vendidas por producto?",
            "¿Ventas por artículo sin devoluciones?",
        ],
    },
    {
        "instruction": "Cuando el usuario pide datos desglosados por tienda en columnas (tabla pivot/crosstab), NO generar CROSSTAB ni múltiples CASE WHEN por tienda. Generar una tabla plana con columnas (artículo, tienda, valor) agrupada por artículo y tienda. El usuario pivotará después. Ejemplo: SELECT p.ccrefejofacm AS \"Referencia\", p.descripcion AS \"Descripción\", lv.tienda AS \"Tienda\", SUM(lv.unidades) AS \"Unidades\" FROM ps_lineas_ventas lv JOIN ps_articulos p ON lv.codigo = p.codigo GROUP BY p.ccrefejofacm, p.descripcion, lv.tienda ORDER BY SUM(lv.unidades) DESC.",
        "questions": [
            "¿Ventas por tienda en columnas?",
            "¿Unidades por artículo y tienda?",
            "¿Desglose por tienda?",
            "¿Tabla con código de tienda?",
        ],
    },
    {
        "instruction": "Cuando el usuario pida un cuadro de mandos, dashboard, o resumen ejecutivo, genera UNA consulta SQL que combine las métricas con subqueries escalares. Ejemplo: SELECT (SELECT SUM(total_si) FROM ps_ventas WHERE fecha_creacion >= DATE_TRUNC('month', CURRENT_DATE)) AS ventas_mes, (SELECT COUNT(DISTINCT reg_ventas) FROM ps_ventas WHERE fecha_creacion >= DATE_TRUNC('month', CURRENT_DATE)) AS tickets_mes. NUNCA respondas con texto explicativo — siempre genera SQL.",
        "questions": [
            "¿Cuadro de mandos?",
            "¿Dashboard de ventas?",
            "¿Resumen ejecutivo?",
            "¿KPIs del mes?",
        ],
    },

    # ── Query safety rules (J: SQL review checklist) ──────────────────
    {
        "instruction": "NUNCA generar consultas sin filtro de fecha sobre tablas grandes: ps_ventas (900K filas), ps_lineas_ventas (1.7M filas), ps_stock_tienda (12M filas). Siempre incluir un rango de fechas explícito. Si el usuario no especifica período, usar 'este mes' (fecha_creacion >= DATE_TRUNC('month', CURRENT_DATE)). Para análisis histórico máximo, limitar a los últimos 2 años.",
        "questions": [
            "¿Ventas totales históricas?",
            "¿Todo el historial de ventas?",
            "¿Ventas de siempre?",
            "¿Consulta sin filtro de fecha?",
        ],
    },
    {
        "instruction": "Al hacer JOIN entre ps_ventas y ps_lineas_ventas (o cualquier JOIN cabecera→líneas), usar COUNT(DISTINCT v.reg_ventas) para contar tickets — NUNCA COUNT(*) sin DISTINCT. COUNT(*) cuenta una fila por artículo en el ticket (un ticket con 3 artículos = 3 filas en ps_lineas_ventas). Para totales monetarios de cabecera (total_si, descuento), usar ps_ventas directamente SIN JOIN con líneas — evita multiplicar la cabecera.",
        "questions": [
            "¿Cuántos tickets hay?",
            "¿Por qué se duplican los totales al hacer JOIN?",
            "¿Número de transacciones únicas?",
        ],
    },

    # ── Magnitude guardrails (H: order-of-magnitude checks) ───────────
    {
        "instruction": "GUARDIA DE MAGNITUD: Si el resultado de una consulta parece fuera de rango, revisar los filtros antes de presentarlo. Rangos esperados para esta cadena: ventas retail mensuales (toda la cadena) €200K-€3M; ticket medio retail €30-€250; stock total en unidades 20K-400K; valor del stock al coste €500K-€15M; artículos activos en catálogo 30K-60K; tiendas activas 30-80; albaranes mayoristas mensuales 50-2.000. Causas comunes de valores absurdos: olvidar entrada=true (incluye devoluciones con signo negativo), olvidar stock>0 (negativos inflan la suma), JOIN sin DISTINCT (multiplica filas), mezclar retail y mayorista.",
        "questions": [
            "¿El resultado parece correcto?",
            "¿Por qué el stock vale €1.000 millones?",
            "¿Cuál es el rango esperado de ventas?",
            "¿Los números parecen razonables?",
        ],
    },
]

# ═══════════════════════════════════════════════════════════════════════
# KNOWLEDGE: SQL Pairs (example question → SQL for RAG)
# ═══════════════════════════════════════════════════════════════════════
# All SQL is valid PostgreSQL against ps_* mirror tables.
# Source pairs are tracked by question text — on update, pairs with matching
# questions are deleted and re-inserted. User pairs with different questions survive.

SQL_PAIRS = [
    # ── Retail sales ───────────────────────────────────────────────────
    (
        "¿Cuáles son los 10 artículos más vendidos por cantidad?",
        'SELECT p."ccrefejofacm" AS "Referencia", p."descripcion" AS "Descripción", SUM(lv."unidades") AS "Unidades Vendidas" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo" WHERE lv."entrada" = true GROUP BY p."ccrefejofacm", p."descripcion" ORDER BY "Unidades Vendidas" DESC LIMIT 10',
    ),
    (
        "¿Cuáles son las ventas netas por tienda este mes?",
        'SELECT v."tienda" AS "Tienda", SUM(v."total_si") AS "Ventas Netas", COUNT(DISTINCT v."reg_ventas") AS "Tickets" FROM "public"."ps_ventas" v WHERE v."fecha_creacion" >= DATE_TRUNC(\'month\', CURRENT_DATE) AND v."entrada" = true AND v."tienda" <> \'99\' GROUP BY v."tienda" ORDER BY "Ventas Netas" DESC',
    ),
    (
        "¿Cuáles son las ventas de la semana pasada por tienda?",
        'SELECT v."tienda" AS "Tienda", SUM(v."total_si") AS "Ventas Netas", COUNT(DISTINCT v."reg_ventas") AS "Tickets" FROM "public"."ps_ventas" v WHERE v."fecha_creacion" >= CURRENT_DATE - INTERVAL \'7 days\' AND v."entrada" = true AND v."tienda" <> \'99\' GROUP BY v."tienda" ORDER BY "Ventas Netas" DESC',
    ),
    (
        "¿Cuál es el ticket medio?",
        'SELECT ROUND(SUM("total_si") / COUNT(DISTINCT "reg_ventas"), 2) AS "Ticket Medio" FROM "public"."ps_ventas" WHERE "entrada" = true AND "tienda" <> \'99\' AND "fecha_creacion" >= DATE_TRUNC(\'month\', CURRENT_DATE)',
    ),
    (
        "¿Cuántas devoluciones hubo este mes?",
        'SELECT COUNT(*) AS "Devoluciones", ABS(SUM("total_si")) AS "Importe Devuelto" FROM "public"."ps_ventas" WHERE "entrada" = false AND "fecha_creacion" >= DATE_TRUNC(\'month\', CURRENT_DATE)',
    ),
    (
        "¿Cuáles son las ventas de hoy?",
        'SELECT v."tienda" AS "Tienda", SUM(v."total_si") AS "Ventas Netas", COUNT(DISTINCT v."reg_ventas") AS "Tickets" FROM "public"."ps_ventas" v WHERE v."fecha_creacion" = CURRENT_DATE AND v."entrada" = true AND v."tienda" <> \'99\' GROUP BY v."tienda" ORDER BY "Ventas Netas" DESC',
    ),
    (
        "¿Cuánto vendimos ayer?",
        'SELECT SUM("total_si") AS "Ventas Netas", COUNT(DISTINCT "reg_ventas") AS "Tickets" FROM "public"."ps_ventas" WHERE "fecha_creacion" = CURRENT_DATE - INTERVAL \'1 day\' AND "entrada" = true',
    ),
    (
        "¿Ventas netas acumuladas del año (YTD) comparadas con el año anterior?",
        'SELECT \'Este año\' AS "Período", SUM("total_si") AS "Ventas Netas", COUNT(DISTINCT "reg_ventas") AS "Tickets" FROM "public"."ps_ventas" WHERE "fecha_creacion" >= DATE_TRUNC(\'year\', CURRENT_DATE) AND "fecha_creacion" <= CURRENT_DATE AND "entrada" = true UNION ALL SELECT \'Año anterior\' AS "Período", SUM("total_si") AS "Ventas Netas", COUNT(DISTINCT "reg_ventas") AS "Tickets" FROM "public"."ps_ventas" WHERE "fecha_creacion" >= DATE_TRUNC(\'year\', CURRENT_DATE) - INTERVAL \'1 year\' AND "fecha_creacion" <= CURRENT_DATE - INTERVAL \'1 year\' AND "entrada" = true',
    ),
    (
        "¿Ventas mensuales por tienda en el año actual?",
        'SELECT DATE_TRUNC(\'month\', v."fecha_creacion") AS "Mes", v."tienda" AS "Tienda", SUM(v."total_si") AS "Ventas Netas", COUNT(DISTINCT v."reg_ventas") AS "Tickets" FROM "public"."ps_ventas" v WHERE v."fecha_creacion" >= DATE_TRUNC(\'year\', CURRENT_DATE) AND v."entrada" = true AND v."tienda" <> \'99\' GROUP BY DATE_TRUNC(\'month\', v."fecha_creacion"), v."tienda" ORDER BY "Mes", v."tienda"',
    ),
    (
        "¿Cuántas unidades vendimos la semana pasada?",
        'SELECT SUM(lv."unidades") AS "Unidades" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON lv."num_ventas" = v."reg_ventas" WHERE v."fecha_creacion" >= CURRENT_DATE - INTERVAL \'7 days\' AND v."entrada" = true',
    ),
    (
        "¿Ventas por día de la semana?",
        'SELECT TO_CHAR(v."fecha_creacion", \'Day\') AS "Día", EXTRACT(DOW FROM v."fecha_creacion") AS "Num Día", SUM(v."total_si") AS "Ventas Netas", COUNT(DISTINCT v."reg_ventas") AS "Tickets" FROM "public"."ps_ventas" v WHERE v."fecha_creacion" >= CURRENT_DATE - INTERVAL \'90 days\' AND v."entrada" = true AND v."tienda" <> \'99\' GROUP BY TO_CHAR(v."fecha_creacion", \'Day\'), EXTRACT(DOW FROM v."fecha_creacion") ORDER BY EXTRACT(DOW FROM v."fecha_creacion")',
    ),

    # ── Products ───────────────────────────────────────────────────────
    (
        "¿Cuáles son los 10 artículos más vendidos por importe?",
        'SELECT p."ccrefejofacm" AS "Referencia", p."descripcion" AS "Descripción", SUM(lv."total_si") AS "Importe Neto", SUM(lv."unidades") AS "Unidades" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo" WHERE lv."entrada" = true GROUP BY p."ccrefejofacm", p."descripcion" ORDER BY "Importe Neto" DESC LIMIT 10',
    ),
    (
        "¿Qué familias de producto venden más?",
        'SELECT fm."fami_grup_marc" AS "Familia", SUM(lv."total_si") AS "Ventas Netas", SUM(lv."unidades") AS "Unidades" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo" JOIN "public"."ps_familias" fm ON p."num_familia" = fm."reg_familia" WHERE lv."entrada" = true GROUP BY fm."fami_grup_marc" ORDER BY "Ventas Netas" DESC',
    ),
    (
        "¿Ventas por departamento?",
        'SELECT d."depa_secc_fabr" AS "Departamento", SUM(lv."total_si") AS "Ventas Netas", SUM(lv."unidades") AS "Unidades" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo" JOIN "public"."ps_departamentos" d ON p."num_departament" = d."reg_departament" WHERE lv."entrada" = true GROUP BY d."depa_secc_fabr" ORDER BY "Ventas Netas" DESC',
    ),
    (
        "¿Ventas por temporada de la colección?",
        'SELECT p."clave_temporada" AS "Temporada", SUM(lv."total_si") AS "Ventas Netas", SUM(lv."unidades") AS "Unidades", COUNT(DISTINCT p."ccrefejofacm") AS "Artículos" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo" WHERE lv."entrada" = true GROUP BY p."clave_temporada" ORDER BY "Ventas Netas" DESC',
    ),
    (
        "¿Ventas por marca?",
        'SELECT m."marca" AS "Marca", SUM(lv."total_si") AS "Ventas Netas", SUM(lv."unidades") AS "Unidades" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo" JOIN "public"."ps_marcas" m ON p."num_marca" = m."reg_marca" WHERE lv."entrada" = true GROUP BY m."marca" ORDER BY "Ventas Netas" DESC',
    ),
    (
        "¿Cuántos artículos activos hay en el catálogo?",
        'SELECT COUNT(*) AS "Total Artículos", SUM(CASE WHEN "ccrefejofacm" IS NULL OR "ccrefejofacm" NOT LIKE \'M%\' THEN 1 ELSE 0 END) AS "Retail", SUM(CASE WHEN "ccrefejofacm" LIKE \'M%\' THEN 1 ELSE 0 END) AS "Mayorista" FROM "public"."ps_articulos" WHERE "anulado" = false',
    ),

    # ── Stock ──────────────────────────────────────────────────────────
    (
        "¿Cuál es el stock total por tienda?",
        'SELECT s."tienda" AS "Tienda", SUM(s."stock") AS "Stock Total", COUNT(DISTINCT s."codigo") AS "Artículos" FROM "public"."ps_stock_tienda" s WHERE s."stock" > 0 GROUP BY s."tienda" ORDER BY "Stock Total" DESC',
    ),
    (
        "¿Qué artículos tienen más stock en el almacén central?",
        'SELECT s."codigo" AS "Código", p."ccrefejofacm" AS "Referencia", p."descripcion" AS "Descripción", SUM(s."stock") AS "Stock" FROM "public"."ps_stock_tienda" s JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo" WHERE s."tienda" = \'99\' AND s."stock" > 0 GROUP BY s."codigo", p."ccrefejofacm", p."descripcion" ORDER BY "Stock" DESC LIMIT 20',
    ),
    (
        "¿Cuál es el valor del stock al coste?",
        'SELECT SUM(s."stock" * p."precio_coste") AS "Valor al Coste", SUM(s."stock") AS "Unidades Totales", COUNT(DISTINCT s."codigo") AS "Referencias" FROM "public"."ps_stock_tienda" s JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo" WHERE s."stock" > 0 AND p."anulado" = false',
    ),
    (
        "¿Stock por artículo y talla?",
        'SELECT s."codigo" AS "Código", p."ccrefejofacm" AS "Referencia", s."talla" AS "Talla", SUM(s."stock") AS "Stock" FROM "public"."ps_stock_tienda" s JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo" WHERE s."stock" > 0 GROUP BY s."codigo", p."ccrefejofacm", s."talla" ORDER BY p."ccrefejofacm", s."talla"',
    ),
    (
        "¿Artículos con stock negativo?",
        'SELECT s."codigo" AS "Código", p."ccrefejofacm" AS "Referencia", s."tienda" AS "Tienda", s."talla" AS "Talla", s."stock" AS "Stock" FROM "public"."ps_stock_tienda" s JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo" WHERE s."stock" < 0 ORDER BY s."stock" ASC LIMIT 50',
    ),
    (
        "¿Stock por familia de producto?",
        'SELECT fm."fami_grup_marc" AS "Familia", SUM(s."stock") AS "Unidades", ROUND(SUM(s."stock" * p."precio_coste"), 2) AS "Valor Coste" FROM "public"."ps_stock_tienda" s JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo" JOIN "public"."ps_familias" fm ON p."num_familia" = fm."reg_familia" WHERE s."stock" > 0 AND p."anulado" = false GROUP BY fm."fami_grup_marc" ORDER BY "Unidades" DESC',
    ),
    (
        "¿Artículos con stock pero sin ventas recientes (dead stock)?",
        'SELECT p."ccrefejofacm" AS "Referencia", p."descripcion" AS "Descripción", SUM(s."stock") AS "Stock", p."clave_temporada" AS "Temporada" FROM "public"."ps_stock_tienda" s JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo" WHERE s."stock" > 10 AND p."anulado" = false AND p."codigo" NOT IN (SELECT DISTINCT lv."codigo" FROM "public"."ps_lineas_ventas" lv WHERE lv."fecha_creacion" >= CURRENT_DATE - INTERVAL \'90 days\' AND lv."entrada" = true) GROUP BY p."ccrefejofacm", p."descripcion", p."clave_temporada" ORDER BY "Stock" DESC LIMIT 30',
    ),
    (
        "¿Top artículos vendidos con su stock actual?",
        'SELECT p."ccrefejofacm" AS "Referencia", p."descripcion" AS "Descripción", SUM(lv."unidades") AS "Unidades Vendidas", COALESCE(SUM(s."stock"), 0) AS "Stock Actual" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo" LEFT JOIN "public"."ps_stock_tienda" s ON lv."codigo" = s."codigo" WHERE lv."fecha_creacion" >= CURRENT_DATE - INTERVAL \'30 days\' AND lv."entrada" = true GROUP BY p."ccrefejofacm", p."descripcion" ORDER BY "Unidades Vendidas" DESC LIMIT 20',
    ),

    # ── Wholesale ──────────────────────────────────────────────────────
    (
        "¿Cuál es la facturación mayorista por comercial?",
        'SELECT c."comercial" AS "Comercial", COUNT(DISTINCT f."reg_factura") AS "Facturas", SUM(f."base1" + f."base2" + f."base3") AS "Facturación Neta" FROM "public"."ps_gc_facturas" f JOIN "public"."ps_gc_comerciales" c ON f."num_comercial" = c."reg_comercial" WHERE f."abono" = false GROUP BY c."comercial" ORDER BY "Facturación Neta" DESC',
    ),
    (
        "¿Facturación mayorista mensual del año actual?",
        'SELECT DATE_TRUNC(\'month\', f."fecha_factura") AS "Mes", COUNT(DISTINCT f."reg_factura") AS "Facturas", SUM(f."base1" + f."base2" + f."base3") AS "Importe Neto" FROM "public"."ps_gc_facturas" f WHERE f."fecha_factura" >= DATE_TRUNC(\'year\', CURRENT_DATE) AND f."abono" = false GROUP BY DATE_TRUNC(\'month\', f."fecha_factura") ORDER BY "Mes"',
    ),
    (
        "¿Cuáles son los principales clientes mayoristas por facturación?",
        'SELECT c."nombre" AS "Cliente", COUNT(DISTINCT f."reg_factura") AS "Facturas", SUM(f."base1" + f."base2" + f."base3") AS "Facturación Neta" FROM "public"."ps_gc_facturas" f JOIN "public"."ps_clientes" c ON f."num_cliente" = c."reg_cliente" WHERE f."abono" = false GROUP BY c."nombre" ORDER BY "Facturación Neta" DESC LIMIT 20',
    ),
    (
        "¿Cuántos albaranes mayoristas se enviaron este mes?",
        'SELECT COUNT(*) AS "Albaranes", SUM("entregadas") AS "Unidades", SUM("base1" + "base2" + "base3") AS "Importe Neto" FROM "public"."ps_gc_albaranes" WHERE "fecha_envio" >= DATE_TRUNC(\'month\', CURRENT_DATE) AND "abono" = false',
    ),
    (
        "¿Notas de crédito mayoristas (abonos) del año?",
        'SELECT c."nombre" AS "Cliente", COUNT(*) AS "Abonos", SUM(a."base1" + a."base2" + a."base3") AS "Total Abonado" FROM "public"."ps_gc_albaranes" a JOIN "public"."ps_clientes" c ON a."num_cliente" = c."reg_cliente" WHERE a."abono" = true AND a."fecha_envio" >= DATE_TRUNC(\'year\', CURRENT_DATE) GROUP BY c."nombre" ORDER BY "Total Abonado" DESC LIMIT 20',
    ),
    (
        "¿Productos más vendidos en canal mayorista?",
        'SELECT p."ccrefejofacm" AS "Referencia", p."descripcion" AS "Descripción", SUM(lf."unidades") AS "Unidades", SUM(lf."total") AS "Importe" FROM "public"."ps_gc_lin_facturas" lf JOIN "public"."ps_articulos" p ON lf."codigo" = p."codigo" WHERE lf."unidades" > 0 GROUP BY p."ccrefejofacm", p."descripcion" ORDER BY "Unidades" DESC LIMIT 20',
    ),

    # ── Customers ─────────────────────────────────────────────────────
    (
        "¿Cuáles son los mejores clientes retail por compras?",
        'SELECT c."nombre" AS "Cliente", COUNT(DISTINCT v."reg_ventas") AS "Compras", SUM(v."total_si") AS "Total Gastado" FROM "public"."ps_ventas" v JOIN "public"."ps_clientes" c ON v."num_cliente" = c."reg_cliente" WHERE v."num_cliente" > 0 AND v."entrada" = true AND v."fecha_creacion" >= DATE_TRUNC(\'year\', CURRENT_DATE) GROUP BY c."nombre" ORDER BY "Total Gastado" DESC LIMIT 20',
    ),
    (
        "¿Cuántos clientes únicos compraron este mes?",
        'SELECT COUNT(DISTINCT "num_cliente") AS "Clientes Identificados", SUM(CASE WHEN "num_cliente" = 0 THEN 1 ELSE 0 END) AS "Tickets Anónimos", COUNT(*) AS "Total Tickets" FROM "public"."ps_ventas" WHERE "fecha_creacion" >= DATE_TRUNC(\'month\', CURRENT_DATE) AND "entrada" = true',
    ),
    (
        "¿Nuevos clientes registrados este año?",
        'SELECT COUNT(*) AS "Nuevos Clientes", SUM(CASE WHEN "mayorista" = false THEN 1 ELSE 0 END) AS "Retail", SUM(CASE WHEN "mayorista" = true THEN 1 ELSE 0 END) AS "Mayoristas" FROM "public"."ps_clientes" WHERE "fecha_creacion" >= DATE_TRUNC(\'year\', CURRENT_DATE)',
    ),
    (
        "¿Frecuencia de compra de clientes?",
        'SELECT CASE WHEN compras = 1 THEN \'1 compra\' WHEN compras BETWEEN 2 AND 3 THEN \'2-3 compras\' WHEN compras BETWEEN 4 AND 10 THEN \'4-10 compras\' ELSE \'Más de 10\' END AS "Segmento", COUNT(*) AS "Clientes" FROM (SELECT "num_cliente", COUNT(DISTINCT "reg_ventas") AS compras FROM "public"."ps_ventas" WHERE "num_cliente" > 0 AND "entrada" = true AND "fecha_creacion" >= DATE_TRUNC(\'year\', CURRENT_DATE) GROUP BY "num_cliente") t GROUP BY 1 ORDER BY 2 DESC',
    ),

    # ── Payments ───────────────────────────────────────────────────────
    (
        "¿Ingresos por método de pago este mes?",
        'SELECT p."forma" AS "Forma de Pago", COUNT(*) AS "Transacciones", SUM(p."importe_cob") AS "Importe Cobrado" FROM "public"."ps_pagos_ventas" p WHERE p."fecha_creacion" >= DATE_TRUNC(\'month\', CURRENT_DATE) AND p."entrada" = true GROUP BY p."forma" ORDER BY "Importe Cobrado" DESC',
    ),
    (
        "¿Mix de formas de pago por tienda?",
        'SELECT p."tienda" AS "Tienda", p."forma" AS "Forma de Pago", COUNT(*) AS "Transacciones", SUM(p."importe_cob") AS "Importe" FROM "public"."ps_pagos_ventas" p WHERE p."fecha_creacion" >= DATE_TRUNC(\'month\', CURRENT_DATE) AND p."entrada" = true AND p."tienda" <> \'99\' GROUP BY p."tienda", p."forma" ORDER BY p."tienda", "Importe" DESC',
    ),
    (
        "¿Efectivo vs tarjeta por tienda?",
        'SELECT p."tienda" AS "Tienda", SUM(CASE WHEN p."codigo_forma" = \'01\' THEN p."importe_cob" ELSE 0 END) AS "Efectivo", SUM(CASE WHEN p."codigo_forma" <> \'01\' THEN p."importe_cob" ELSE 0 END) AS "Tarjeta/Otro", SUM(p."importe_cob") AS "Total" FROM "public"."ps_pagos_ventas" p WHERE p."fecha_creacion" >= DATE_TRUNC(\'month\', CURRENT_DATE) AND p."entrada" = true AND p."tienda" <> \'99\' GROUP BY p."tienda" ORDER BY "Total" DESC',
    ),
    (
        "¿Evolución diaria de ingresos por forma de pago?",
        'SELECT p."fecha_creacion" AS "Fecha", p."forma" AS "Forma de Pago", SUM(p."importe_cob") AS "Importe" FROM "public"."ps_pagos_ventas" p WHERE p."fecha_creacion" >= CURRENT_DATE - INTERVAL \'30 days\' AND p."entrada" = true GROUP BY p."fecha_creacion", p."forma" ORDER BY p."fecha_creacion", p."forma"',
    ),

    # ── Margins ────────────────────────────────────────────────────────
    (
        "¿Margen bruto por familia de producto?",
        'SELECT fm."fami_grup_marc" AS "Familia", SUM(lv."total_si") AS "Ventas Netas", SUM(lv."total_coste_si") AS "Coste Total", ROUND((SUM(lv."total_si") - SUM(lv."total_coste_si")) / NULLIF(SUM(lv."total_si"), 0) * 100, 1) AS "Margen %" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo" JOIN "public"."ps_familias" fm ON p."num_familia" = fm."reg_familia" WHERE lv."entrada" = true AND lv."total_si" > 0 GROUP BY fm."fami_grup_marc" ORDER BY "Margen %" DESC',
    ),
    (
        "¿Margen bruto por tienda?",
        'SELECT lv."tienda" AS "Tienda", SUM(lv."total_si") AS "Ventas Netas", SUM(lv."total_coste_si") AS "Coste Total", ROUND((SUM(lv."total_si") - SUM(lv."total_coste_si")) / NULLIF(SUM(lv."total_si"), 0) * 100, 1) AS "Margen %" FROM "public"."ps_lineas_ventas" lv WHERE lv."entrada" = true AND lv."total_si" > 0 AND lv."tienda" <> \'99\' GROUP BY lv."tienda" ORDER BY "Margen %" DESC',
    ),
    (
        "¿Productos con bajo margen (menos del 30%)?",
        'SELECT p."ccrefejofacm" AS "Referencia", p."descripcion" AS "Descripción", SUM(lv."total_si") AS "Ventas Netas", ROUND((SUM(lv."total_si") - SUM(lv."total_coste_si")) / NULLIF(SUM(lv."total_si"), 0) * 100, 1) AS "Margen %" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo" WHERE lv."entrada" = true AND lv."total_si" > 0 GROUP BY p."ccrefejofacm", p."descripcion" HAVING (SUM(lv."total_si") - SUM(lv."total_coste_si")) / NULLIF(SUM(lv."total_si"), 0) < 0.30 ORDER BY "Margen %" ASC LIMIT 30',
    ),
    (
        "¿Margen bruto por departamento?",
        'SELECT d."depa_secc_fabr" AS "Departamento", SUM(lv."total_si") AS "Ventas Netas", SUM(lv."total_coste_si") AS "Coste Total", ROUND((SUM(lv."total_si") - SUM(lv."total_coste_si")) / NULLIF(SUM(lv."total_si"), 0) * 100, 1) AS "Margen %" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo" JOIN "public"."ps_departamentos" d ON p."num_departament" = d."reg_departament" WHERE lv."entrada" = true AND lv."total_si" > 0 GROUP BY d."depa_secc_fabr" ORDER BY "Margen %" DESC',
    ),
    (
        "¿Margen mayorista por comercial?",
        'SELECT c."comercial" AS "Comercial", SUM(lf."total") AS "Ingreso", SUM(lf."total_coste") AS "Coste", ROUND((SUM(lf."total") - SUM(lf."total_coste")) / NULLIF(SUM(lf."total"), 0) * 100, 1) AS "Margen %" FROM "public"."ps_gc_lin_facturas" lf JOIN "public"."ps_gc_facturas" f ON lf."num_factura" = f."n_factura" JOIN "public"."ps_gc_comerciales" c ON f."num_comercial" = c."reg_comercial" WHERE lf."total" > 0 GROUP BY c."comercial" ORDER BY "Margen %" DESC',
    ),

    # ── Transfers ──────────────────────────────────────────────────────
    (
        "¿Volumen de traspasos por ruta?",
        'SELECT t."tienda_salida" AS "Tienda Origen", t."tienda_entrada" AS "Tienda Destino", COUNT(*) AS "Traspasos", SUM(t."unidades_s") AS "Unidades" FROM "public"."ps_traspasos" t WHERE t."entrada" = false AND t."fecha_s" >= DATE_TRUNC(\'year\', CURRENT_DATE) GROUP BY t."tienda_salida", t."tienda_entrada" ORDER BY "Unidades" DESC LIMIT 20',
    ),
    (
        "¿Traspasos diarios de stock?",
        'SELECT t."fecha_s" AS "Fecha", COUNT(*) AS "Traspasos", SUM(t."unidades_s") AS "Unidades" FROM "public"."ps_traspasos" t WHERE t."entrada" = false AND t."fecha_s" >= CURRENT_DATE - INTERVAL \'30 days\' GROUP BY t."fecha_s" ORDER BY t."fecha_s"',
    ),
    (
        "¿Movimientos de stock de un artículo?",
        'SELECT t."fecha_s" AS "Fecha", t."tienda_salida" AS "Origen", t."tienda_entrada" AS "Destino", t."talla" AS "Talla", t."unidades_s" AS "Unidades", t."tipo" AS "Tipo" FROM "public"."ps_traspasos" t JOIN "public"."ps_articulos" p ON t."codigo" = p."codigo" WHERE p."ccrefejofacm" = \'REFERENCIA_AQUI\' AND t."entrada" = false ORDER BY t."fecha_s" DESC LIMIT 50',
    ),

    # ── Seasonal / Collections ─────────────────────────────────────────
    (
        "¿Cuántos artículos hay por temporada?",
        'SELECT t."temporada_tipo" AS "Temporada", COUNT(p."reg_articulo") AS "Artículos", SUM(CASE WHEN p."anulado" = false THEN 1 ELSE 0 END) AS "Activos" FROM "public"."ps_articulos" p JOIN "public"."ps_temporadas" t ON p."num_temporada" = t."reg_temporada" GROUP BY t."temporada_tipo" ORDER BY "Artículos" DESC',
    ),
    (
        "¿Stock por temporada de colección?",
        'SELECT p."clave_temporada" AS "Temporada", COUNT(DISTINCT p."ccrefejofacm") AS "Referencias", SUM(s."stock") AS "Unidades", ROUND(SUM(s."stock" * p."precio_coste"), 2) AS "Valor Coste" FROM "public"."ps_stock_tienda" s JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo" WHERE s."stock" > 0 AND p."anulado" = false GROUP BY p."clave_temporada" ORDER BY "Unidades" DESC',
    ),
    (
        "¿Ventas por temporada de origen del artículo?",
        'SELECT p."clave_temporada" AS "Temporada", SUM(lv."total_si") AS "Ventas Netas", SUM(lv."unidades") AS "Unidades" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo" WHERE lv."entrada" = true AND lv."fecha_creacion" >= DATE_TRUNC(\'year\', CURRENT_DATE) GROUP BY p."clave_temporada" ORDER BY "Ventas Netas" DESC',
    ),

    # ── Store performance ──────────────────────────────────────────────
    (
        "¿Rendimiento YTD por tienda con comparativa año anterior?",
        'SELECT v."tienda" AS "Tienda", SUM(CASE WHEN v."fecha_creacion" >= DATE_TRUNC(\'year\', CURRENT_DATE) THEN v."total_si" ELSE 0 END) AS "Ventas Este Año", SUM(CASE WHEN v."fecha_creacion" >= DATE_TRUNC(\'year\', CURRENT_DATE) - INTERVAL \'1 year\' AND v."fecha_creacion" < DATE_TRUNC(\'year\', CURRENT_DATE) AND v."fecha_creacion" <= CURRENT_DATE - INTERVAL \'1 year\' THEN v."total_si" ELSE 0 END) AS "Ventas Año Anterior" FROM "public"."ps_ventas" v WHERE v."entrada" = true AND v."tienda" <> \'99\' AND v."fecha_creacion" >= DATE_TRUNC(\'year\', CURRENT_DATE) - INTERVAL \'1 year\' GROUP BY v."tienda" ORDER BY "Ventas Este Año" DESC',
    ),
    (
        "¿Ticket medio por tienda?",
        'SELECT v."tienda" AS "Tienda", COUNT(DISTINCT v."reg_ventas") AS "Tickets", ROUND(SUM(v."total_si") / NULLIF(COUNT(DISTINCT v."reg_ventas"), 0), 2) AS "Ticket Medio" FROM "public"."ps_ventas" v WHERE v."entrada" = true AND v."tienda" <> \'99\' AND v."fecha_creacion" >= DATE_TRUNC(\'month\', CURRENT_DATE) GROUP BY v."tienda" ORDER BY "Ticket Medio" DESC',
    ),
]

# ─────────────────────────────────────────────────────────────────────────
# Index of source question texts — used for the merge strategy on sql_pairs
# ─────────────────────────────────────────────────────────────────────────
SOURCE_QUESTIONS = {question for question, _sql in SQL_PAIRS}


def validate_sql_pairs(dsn: str) -> None:
    """Validate all SQL pairs by executing them against the PostgreSQL mirror.

    Checks:
    1. SQL executes without error (syntax, table/column names, joins)
    2. Query returns at least 1 row with non-NULL first value (warns if not — may be no
       data for current period, but worth flagging)
    3. Prints the first result value so you can spot-check magnitude visually
    """
    try:
        import psycopg2
    except ImportError:
        print("psycopg2 not installed. Run: pip install psycopg2-binary")
        sys.exit(1)

    print(f"\n═══ Validating {len(SQL_PAIRS)} SQL pairs against PostgreSQL ═══")
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("SET statement_timeout = '60s'")

    passed = failed = warned = 0
    for question, sql in SQL_PAIRS:
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
                rows = cur.fetchmany(3)
                col_names = [d[0] for d in cur.description] if cur.description else []

            if not rows:
                print(f"  WARN {question[:68]}")
                print(f"       (0 rows — no data for current period?)")
                warned += 1
            else:
                first_val = rows[0][0]
                if first_val is None:
                    print(f"  WARN {question[:68]}")
                    print(f"       (first value is NULL)")
                    warned += 1
                else:
                    n_cols = len(col_names)
                    n_rows = len(rows)
                    suffix = f" → {first_val}" if n_rows == 1 and n_cols <= 3 else f" ({n_rows}+ rows × {n_cols} cols)"
                    print(f"  OK  {question[:68]}{suffix}")
                    passed += 1
        except Exception as e:
            print(f"  ERR {question[:70]}")
            print(f"      {e}")
            failed += 1

    conn.close()
    print(f"\nResult: {passed} OK, {warned} warnings, {failed} failed")
    if failed:
        sys.exit(1)


# ═══════════════════════════════════════════════════════════════════════
# CROSS-VALIDATION: compare same metric from different data paths (I)
# ═══════════════════════════════════════════════════════════════════════
# These queries compute the same business metric two ways and compare.
# Discrepancies reveal JOIN errors, filter gaps, or ETL issues.
# Run with: ps wren crosscheck

CROSS_VALIDATIONS = [
    (
        "Retail sales: ps_ventas.total_si vs SUM(ps_lineas_ventas.total_si) YTD",
        """
        SELECT
            (SELECT SUM(total_si) FROM ps_ventas
             WHERE fecha_creacion >= DATE_TRUNC('year', CURRENT_DATE)
               AND entrada = true) AS ventas_cabecera,
            (SELECT SUM(lv.total_si) FROM ps_lineas_ventas lv
             JOIN ps_ventas v ON lv.num_ventas = v.reg_ventas
             WHERE v.fecha_creacion >= DATE_TRUNC('year', CURRENT_DATE)
               AND v.entrada = true) AS ventas_lineas
        """,
        "Should match within ~1% (rounding on line-level splits)",
    ),
    (
        "Retail tickets: COUNT in ps_ventas vs COUNT(DISTINCT num_ventas) in ps_lineas_ventas (this month)",
        """
        SELECT
            (SELECT COUNT(*) FROM ps_ventas
             WHERE fecha_creacion >= DATE_TRUNC('month', CURRENT_DATE)
               AND entrada = true) AS tickets_ventas,
            (SELECT COUNT(DISTINCT lv.num_ventas) FROM ps_lineas_ventas lv
             JOIN ps_ventas v ON lv.num_ventas = v.reg_ventas
             WHERE v.fecha_creacion >= DATE_TRUNC('month', CURRENT_DATE)
               AND v.entrada = true) AS tickets_lineas
        """,
        "Should match exactly (every sale header has at least 1 line)",
    ),
    (
        "Stock total units: SUM(ps_stock_tienda.stock) retail vs SUM(ps_articulos.stock)",
        """
        SELECT
            (SELECT SUM(stock) FROM ps_stock_tienda
             WHERE tienda <> '99' AND stock > 0) AS stock_tiendas_retail,
            (SELECT SUM(st_stock) FROM ps_stock_tienda
             WHERE tienda <> '99') AS stock_tiendas_ststock,
            (SELECT SUM(stock) FROM ps_articulos
             WHERE anulado = false AND stock > 0) AS stock_articulos
        """,
        "stock_tiendas_retail ≈ stock_tiendas_ststock (same source, different columns). "
        "stock_articulos is a denormalized total (retail+central) — expect it to be larger.",
    ),
    (
        "Wholesale invoices: ps_gc_facturas header vs ps_gc_lin_facturas lines YTD",
        """
        SELECT
            (SELECT SUM(base1 + COALESCE(base2,0) + COALESCE(base3,0))
             FROM ps_gc_facturas
             WHERE fecha_factura >= DATE_TRUNC('year', CURRENT_DATE)
               AND abono = false) AS facturas_cabecera,
            (SELECT SUM(lf.total)
             FROM ps_gc_lin_facturas lf
             JOIN ps_gc_facturas f ON lf.num_factura = f.n_factura
             WHERE f.fecha_factura >= DATE_TRUNC('year', CURRENT_DATE)
               AND f.abono = false) AS facturas_lineas
        """,
        "Should match within ~2% (header bases may exclude minor rounding vs line totals)",
    ),
    (
        "Stock value at cost: ps_stock_tienda × ps_articulos.precio_coste",
        """
        SELECT
            SUM(s.stock * a.precio_coste) AS valor_coste_tiendas,
            COUNT(DISTINCT s.codigo) AS articulos_en_stock
        FROM ps_stock_tienda s
        JOIN ps_articulos a ON s.codigo = a.codigo
        WHERE s.stock > 0 AND a.anulado = false AND s.tienda <> '99'
        """,
        "Expected range: €500K–€15M. Flag if outside this range — likely a JOIN or filter issue.",
    ),
]


def cross_validate(dsn: str) -> None:
    """Run cross-validation queries to check data consistency across tables.

    Compares the same business metric computed from different data paths.
    Discrepancies reveal JOIN errors, filter gaps, or ETL sync issues.
    """
    try:
        import psycopg2
    except ImportError:
        print("psycopg2 not installed. Run: pip install psycopg2-binary")
        sys.exit(1)

    print(f"\n═══ Cross-validating {len(CROSS_VALIDATIONS)} metric pairs ═══\n")
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("SET statement_timeout = '120s'")

    issues = 0
    for name, sql, note in CROSS_VALIDATIONS:
        print(f"  ── {name}")
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
                rows = cur.fetchall()
                col_names = [d[0] for d in cur.description]

            if not rows:
                print(f"     WARN: no rows returned")
                issues += 1
            else:
                row = rows[0]
                for col, val in zip(col_names, row):
                    print(f"     {col}: {val}")

                # Auto-detect discrepancies: if two numeric cols, compare them
                numeric_vals = [(c, v) for c, v in zip(col_names, row)
                                if isinstance(v, (int, float)) and v is not None]
                if len(numeric_vals) == 2:
                    (c1, v1), (c2, v2) = numeric_vals
                    if v1 and v2:
                        ratio = abs(v1 - v2) / max(abs(v1), abs(v2))
                        if ratio > 0.05:
                            print(f"     ⚠ MISMATCH: {c1}={v1:,.2f} vs {c2}={v2:,.2f} "
                                  f"({ratio*100:.1f}% difference)")
                            issues += 1
                        else:
                            print(f"     ✓ within {ratio*100:.2f}% tolerance")
            print(f"     note: {note}\n")
        except Exception as e:
            print(f"     ERR: {e}\n")
            issues += 1

    conn.close()
    print(f"Cross-validation complete. Issues found: {issues}")
    if issues:
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Push full semantic metadata to WrenAI")
    parser.add_argument("--url", default="http://localhost:3000", help="WrenAI UI URL")
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Validate SQL pairs by executing against PostgreSQL (requires POSTGRES_DSN env var)",
    )
    parser.add_argument(
        "--crosscheck",
        action="store_true",
        help="Run cross-validation queries to check data consistency (requires POSTGRES_DSN env var)",
    )
    args = parser.parse_args()
    url = args.url

    if args.validate:
        dsn = os.environ.get("POSTGRES_DSN", "postgresql://postgres:change_me@localhost:5432/powershop")
        validate_sql_pairs(dsn)
        return

    if args.crosscheck:
        dsn = os.environ.get("POSTGRES_DSN", "postgresql://postgres:change_me@localhost:5432/powershop")
        cross_validate(dsn)
        return

    # ── 1. GraphQL: Model metadata ──────────────────────────────────
    print("═══ Step 1: Model descriptions + aliases (GraphQL) ═══")
    data = gql(url, "{ listModels { id displayName fields { id displayName referenceName } } }")
    models = {}
    for m in data["data"]["listModels"]:
        name = m["displayName"].replace("public.", "")
        models[name] = {"id": m["id"], "fields": {f["referenceName"]: f["id"] for f in m["fields"]}}

    for name, meta in MODEL_METADATA.items():
        if name not in models:
            continue
        mid = models[name]["id"]
        desc = meta["desc"].replace('"', '\\"')
        alias = meta["alias"]
        gql(url, f'mutation {{ updateModelMetadata(where: {{id: {mid}}}, data: {{displayName: "{alias}", description: "{desc}"}}) }}')
        print(f"  OK {name} -> {alias}")

    # ── 2. GraphQL: Relationships ───────────────────────────────────
    print("\n═══ Step 2: Relationships (GraphQL) ═══")
    # Re-fetch models with new aliases
    data = gql(url, "{ listModels { id displayName fields { id displayName referenceName } } }")
    models_by_alias = {}
    for m in data["data"]["listModels"]:
        alias = m["displayName"]
        table = None
        for t, meta in MODEL_METADATA.items():
            if meta["alias"] == alias:
                table = t
                break
        if not table:
            table = alias.replace("public.", "")
        models_by_alias[table] = {"id": m["id"], "fields": {f["referenceName"]: f["id"] for f in m["fields"]}}

    created = skipped = 0
    for from_m, from_f, to_m, to_f, rtype in RELATIONSHIPS:
        if from_m not in models_by_alias or to_m not in models_by_alias:
            continue
        fm = models_by_alias[from_m]
        tm = models_by_alias[to_m]
        if from_f not in fm["fields"] or to_f not in tm["fields"]:
            continue
        mutation = (
            f"mutation {{ createRelation(data: {{"
            f"fromModelId: {fm['id']}, fromColumnId: {fm['fields'][from_f]}, "
            f"toModelId: {tm['id']}, toColumnId: {tm['fields'][to_f]}, "
            f"type: {rtype}}}) }}"
        )
        resp = gql(url, mutation)
        if "errors" not in str(resp):
            created += 1
            print(f"  OK {from_m}.{from_f} -> {to_m}.{to_f}")
        else:
            skipped += 1  # Already exists
    print(f"  Created: {created}, Skipped: {skipped}")

    # ── 3. SQLite: Column display names + descriptions ──────────────
    print("\n═══ Step 3: Column metadata (SQLite) ═══")
    tmpdir = tempfile.mkdtemp()
    db_path = os.path.join(tmpdir, "db.sqlite3")

    subprocess.run(
        ["docker", "compose", "cp", "wren-ui:/app/data/db.sqlite3", db_path],
        check=True, capture_output=True,
    )
    print("  Copied SQLite DB from container")

    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row

    # Map alias -> model_id
    alias_to_id = {}
    for row in db.execute("SELECT id, display_name FROM model"):
        alias_to_id[row["display_name"]] = row["id"]

    col_updated = 0
    for alias, columns in COLUMN_META.items():
        mid = alias_to_id.get(alias)
        if not mid:
            continue
        for row in db.execute("SELECT id, source_column_name, properties FROM model_column WHERE model_id = ?", (mid,)):
            col_name = row["source_column_name"]
            if col_name in columns:
                display, desc = columns[col_name]
                props = json.loads(row["properties"]) if row["properties"] else {}
                props["description"] = desc
                db.execute(
                    "UPDATE model_column SET display_name = ?, properties = ? WHERE id = ?",
                    (display, json.dumps(props), row["id"]),
                )
                col_updated += 1
    print(f"  Updated {col_updated} column metadata entries")

    # ── 4. SQLite: Instructions (knowledge rules) — merge strategy ──
    print("\n═══ Step 4: Instructions / Knowledge (SQLite) — merge strategy ═══")
    project_id = db.execute("SELECT id FROM project LIMIT 1").fetchone()["id"]

    # Delete only source-managed instructions (is_default=1).
    # User-created instructions (is_default=0, created via WrenAI UI) are preserved.
    deleted = db.execute(
        "DELETE FROM instruction WHERE project_id = ? AND is_default = 1",
        (project_id,),
    ).rowcount
    for inst in INSTRUCTIONS:
        db.execute(
            "INSERT INTO instruction (project_id, instruction, questions, is_default) VALUES (?, ?, ?, 1)",
            (project_id, inst["instruction"], json.dumps(inst["questions"])),
        )
    user_count = db.execute(
        "SELECT COUNT(*) FROM instruction WHERE project_id = ? AND is_default = 0",
        (project_id,),
    ).fetchone()[0]
    print(f"  Deleted {deleted} old source instructions (is_default=1)")
    print(f"  Inserted {len(INSTRUCTIONS)} source instructions")
    print(f"  Preserved {user_count} user instructions (is_default=0)")

    # ── 5. SQLite: SQL Pairs (example queries for RAG) — merge strategy
    print("\n═══ Step 5: SQL Pairs / Examples (SQLite) — merge strategy ═══")
    # For sql_pair there is no is_default field. Use question text to track source pairs.
    # Delete ALL pairs (including duplicates) whose question matches any source question.
    # User pairs with different questions survive.
    total_before = db.execute(
        "SELECT COUNT(*) FROM sql_pair WHERE project_id = ?", (project_id,)
    ).fetchone()[0]
    if SOURCE_QUESTIONS:
        placeholders = ",".join("?" for _ in SOURCE_QUESTIONS)
        params = [project_id, *SOURCE_QUESTIONS]
        source_deleted = db.execute(
            f"DELETE FROM sql_pair WHERE project_id = ? AND question IN ({placeholders})",
            params,
        ).rowcount
    else:
        source_deleted = 0
    user_pairs_kept = total_before - source_deleted

    for question, sql in SQL_PAIRS:
        db.execute(
            "INSERT INTO sql_pair (project_id, sql, question) VALUES (?, ?, ?)",
            (project_id, sql, question),
        )
    print(f"  Deleted {source_deleted} old source SQL pairs")
    print(f"  Inserted {len(SQL_PAIRS)} source SQL pairs")
    print(f"  Preserved {user_pairs_kept} user SQL pairs")

    db.commit()
    db.close()

    # Copy DB back
    subprocess.run(
        ["docker", "compose", "cp", db_path, "wren-ui:/app/data/db.sqlite3"],
        check=True, capture_output=True,
    )
    print("  Copied SQLite DB back to container")
    shutil.rmtree(tmpdir)

    # ── 6. Restart wren-ui + Deploy ─────────────────────────────────
    print("\n═══ Step 6: Restart + Deploy ═══")
    subprocess.run(["docker", "compose", "restart", "wren-ui"], check=True, capture_output=True)
    print("  Restarted wren-ui")

    import time
    time.sleep(15)

    result = gql(url, "mutation { deploy(force: true) }")
    status = result["data"]["deploy"]["status"]
    print(f"  Deploy: {status}")

    if status != "SUCCESS":
        print(f"  Error: {result['data']['deploy'].get('error', 'unknown')}", file=sys.stderr)
        sys.exit(1)

    # ── 7. Index instructions + SQL pairs into qdrant via AI service ─
    # NOTE: We do NOT delete the entire qdrant collection before re-indexing.
    # Doing so would remove user-created instructions/SQL pairs from the retrieval
    # index — breaking the "preserve user knowledge" promise. We POST only source
    # entries using stable integer IDs (1..N). The AI service upserts by ID, so
    # re-running this step simply updates the source entries without touching
    # entries at higher IDs that belong to user-created knowledge.
    print("\n═══ Step 7: Index instructions + SQL pairs (AI service) ═══")
    ai_url = url.replace(":3000", ":5555")  # AI service on port 5555

    ai_instructions = [
        {"id": str(i + 1), "instruction": inst["instruction"], "questions": inst["questions"]}
        for i, inst in enumerate(INSTRUCTIONS)
    ]
    try:
        req = urllib.request.Request(
            f"{ai_url}/v1/instructions",
            data=json.dumps({"id": "push_instructions", "instructions": ai_instructions, "mdl_hash": "current"}).encode(),
            headers={"Content-Type": "application/json"},
        )
        resp = urllib.request.urlopen(req, timeout=60)
        print(f"  Indexed {len(ai_instructions)} source instructions in qdrant (user instructions preserved)")
    except Exception as e:
        print(f"  Instructions indexing failed: {e}")

    time.sleep(5)

    ai_pairs = [
        {"id": str(i + 1), "question": q, "sql": s}
        for i, (q, s) in enumerate(SQL_PAIRS)
    ]
    try:
        req = urllib.request.Request(
            f"{ai_url}/v1/sql-pairs",
            data=json.dumps({"id": "push_sql_pairs", "sql_pairs": ai_pairs, "mdl_hash": "current"}).encode(),
            headers={"Content-Type": "application/json"},
        )
        resp = urllib.request.urlopen(req, timeout=60)
        print(f"  Indexed {len(ai_pairs)} source SQL pairs in qdrant (user SQL pairs preserved)")
    except Exception as e:
        print(f"  SQL pairs indexing failed: {e}")

    print("\nDone. WrenAI semantic model fully configured.")
    print(f"  Models: {len(MODEL_METADATA)} with descriptions")
    print(f"  Columns: {col_updated} with display names + descriptions")
    print(f"  Relations: {created} created")
    print(f"  Instructions: {len(INSTRUCTIONS)} source (user instructions preserved)")
    print(f"  SQL Pairs: {len(SQL_PAIRS)} source (user SQL pairs preserved)")


if __name__ == "__main__":
    main()
