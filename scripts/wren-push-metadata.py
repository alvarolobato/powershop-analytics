#!/usr/bin/env python3
"""Push full semantic metadata to WrenAI: descriptions, aliases, knowledge, relationships.

Run after WrenAI is up and the PostgreSQL data source is connected:
    python3 scripts/wren-push-metadata.py [--url http://localhost:3000]

This script is idempotent — safe to re-run. Steps:
  1. Push model descriptions and display name aliases via GraphQL API
  2. Create relationships via GraphQL API
  3. Update column display names and descriptions directly in WrenAI's SQLite DB
  4. Populate knowledge (instructions + SQL pairs) in SQLite
  5. Deploy (re-index embeddings in qdrant)

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

INSTRUCTIONS = [
    {
        "instruction": "Siempre usar el campo total_si (sin IVA) para análisis económico de ventas retail. NUNCA usar el campo total que incluye IVA. El IVA varía por región (23% Portugal, 22% Madeira, 21% España) y distorsiona las comparaciones.",
        "questions": ["¿Cuánto vendimos?", "¿Cuáles son las ventas netas?", "¿Cuál es la facturación?"],
    },
    {
        "instruction": "Para facturación mayorista (canal B2B), el importe neto sin IVA se calcula como base1 + base2 + base3 de las tablas GCFacturas o GCAlbaranes. NUNCA usar total_factura o total_albaran que incluyen IVA.",
        "questions": ["¿Cuánto facturamos en mayorista?", "¿Cuál es la facturación B2B?"],
    },
    {
        "instruction": "El identificador de artículo visible para el usuario es la Referencia (campo ccrefejofacm en Producto, mostrar como 'Referencia'). El campo 'codigo' es un código interno que el usuario no reconoce. Siempre incluir la Referencia y Descripción del artículo en los resultados.",
        "questions": ["¿Qué artículos vendimos?", "¿Cuáles son los productos más vendidos?"],
    },
    {
        "instruction": "Las ventas retail están en las tablas Venta y LineaVenta. El canal mayorista B2B usa tablas separadas: AlbaranMayorista, FacturaMayorista y sus líneas. NUNCA mezclar datos retail y mayorista en la misma consulta a menos que se pida explícitamente una comparativa.",
        "questions": ["¿Cuánto vendimos en total?", "Compara retail y mayorista"],
    },
    {
        "instruction": "Stock total de un artículo = suma del stock en todas las tiendas (tabla StockTienda). Tienda código 99 = almacén central, código 97 = tienda online, el resto son tiendas físicas.",
        "questions": ["¿Cuánto stock tenemos?", "¿Qué stock hay en el almacén?"],
    },
    {
        "instruction": "Los artículos cuya Referencia (ccrefejofacm) empieza por 'MA' son materiales (bolsas, perchas) que NO tienen seguimiento de inventario. Excluirlos de análisis de stock y ventas a menos que se pidan explícitamente.",
        "questions": ["¿Cuántos artículos tenemos?", "¿Cuál es nuestro catálogo activo?"],
    },
    {
        "instruction": "El campo fecha_creacion en Venta es la fecha de la venta. El campo fecha_documento está vacío (NULL) en todos los registros — NUNCA usarlo.",
        "questions": ["¿Ventas de la semana pasada?", "¿Ventas de hoy?"],
    },
    {
        "instruction": "El ticket medio se calcula como: SUM(total_si) / COUNT(DISTINCT reg_ventas) de la tabla Venta. Usar siempre total_si (sin IVA).",
        "questions": ["¿Cuál es el ticket medio?", "¿Cuánto gasta cada cliente de media?"],
    },
]

# ═══════════════════════════════════════════════════════════════════════
# KNOWLEDGE: SQL Pairs (example question → SQL for RAG)
# ═══════════════════════════════════════════════════════════════════════

SQL_PAIRS = [
    (
        "¿Cuáles son los 10 artículos más vendidos por cantidad?",
        'SELECT p."ccrefejofacm" AS "Referencia", p."descripcion" AS "Descripción", SUM(lv."unidades") AS "Unidades Vendidas" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo" GROUP BY p."ccrefejofacm", p."descripcion" ORDER BY "Unidades Vendidas" DESC LIMIT 10',
    ),
    (
        "¿Cuáles son las ventas netas por tienda este mes?",
        'SELECT v."tienda" AS "Tienda", SUM(v."total_si") AS "Ventas Netas" FROM "public"."ps_ventas" v WHERE v."fecha_creacion" >= DATE_TRUNC(\'month\', CURRENT_DATE) GROUP BY v."tienda" ORDER BY "Ventas Netas" DESC',
    ),
    (
        "¿Cuál es el ticket medio?",
        'SELECT SUM("total_si") / COUNT(DISTINCT "reg_ventas") AS "Ticket Medio" FROM "public"."ps_ventas"',
    ),
    (
        "¿Cuál es el stock total por tienda?",
        'SELECT s."tienda" AS "Tienda", SUM(s."stock") AS "Stock Total" FROM "public"."ps_stock_tienda" s GROUP BY s."tienda" ORDER BY "Stock Total" DESC',
    ),
    (
        "¿Cuántas unidades vendimos la semana pasada?",
        'SELECT SUM(lv."unidades") AS "Unidades" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON lv."num_ventas" = v."reg_ventas" WHERE v."fecha_creacion" >= CURRENT_DATE - INTERVAL \'7 days\'',
    ),
    (
        "¿Cuál es la facturación mayorista por comercial?",
        'SELECT c."comercial" AS "Comercial", SUM(f."base1" + f."base2" + f."base3") AS "Facturación Neta" FROM "public"."ps_gc_facturas" f JOIN "public"."ps_gc_comerciales" c ON f."num_comercial" = c."reg_comercial" GROUP BY c."comercial" ORDER BY "Facturación Neta" DESC',
    ),
    (
        "¿Qué familias de producto venden más?",
        'SELECT fm."fami_grup_marc" AS "Familia", SUM(lv."total_si") AS "Ventas Netas", SUM(lv."unidades") AS "Unidades" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo" JOIN "public"."ps_familias" fm ON p."num_familia" = fm."reg_familia" GROUP BY fm."fami_grup_marc" ORDER BY "Ventas Netas" DESC',
    ),
    (
        "¿Cuántas devoluciones hubo este mes?",
        'SELECT COUNT(*) AS "Devoluciones" FROM "public"."ps_ventas" WHERE "tipo_documento" = \'D\' AND "fecha_creacion" >= DATE_TRUNC(\'month\', CURRENT_DATE)',
    ),
]


def main():
    parser = argparse.ArgumentParser(description="Push full semantic metadata to WrenAI")
    parser.add_argument("--url", default="http://localhost:3000", help="WrenAI UI URL")
    args = parser.parse_args()
    url = args.url

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
        print(f"  ✓ {name} → {alias}")

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
            print(f"  ✓ {from_m}.{from_f} → {to_m}.{to_f}")
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

    # Map alias → model_id
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

    # ── 4. SQLite: Instructions (knowledge rules) ───────────────────
    print("\n═══ Step 4: Instructions / Knowledge (SQLite) ═══")
    project_id = db.execute("SELECT id FROM project LIMIT 1").fetchone()["id"]

    # Clear existing instructions and re-insert
    db.execute("DELETE FROM instruction WHERE project_id = ?", (project_id,))
    for inst in INSTRUCTIONS:
        db.execute(
            "INSERT INTO instruction (project_id, instruction, questions, is_default) VALUES (?, ?, ?, 0)",
            (project_id, inst["instruction"], json.dumps(inst["questions"])),
        )
    print(f"  Inserted {len(INSTRUCTIONS)} instructions")

    # ── 5. SQLite: SQL Pairs (example queries for RAG) ──────────────
    print("\n═══ Step 5: SQL Pairs / Examples (SQLite) ═══")
    db.execute("DELETE FROM sql_pair WHERE project_id = ?", (project_id,))
    for question, sql in SQL_PAIRS:
        db.execute(
            "INSERT INTO sql_pair (project_id, sql, question) VALUES (?, ?, ?)",
            (project_id, sql, question),
        )
    print(f"  Inserted {len(SQL_PAIRS)} SQL pairs")

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

    print("\n✅ Done. WrenAI semantic model fully configured.")
    print(f"   Models: {len(MODEL_METADATA)} with descriptions")
    print(f"   Columns: {col_updated} with display names + descriptions")
    print(f"   Relations: {created} created")
    print(f"   Instructions: {len(INSTRUCTIONS)}")
    print(f"   SQL Pairs: {len(SQL_PAIRS)}")


if __name__ == "__main__":
    main()
