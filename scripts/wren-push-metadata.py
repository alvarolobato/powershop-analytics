#!/usr/bin/env python3
"""Push semantic model metadata (descriptions, aliases, relationships) to WrenAI.

Run after WrenAI is up and the PostgreSQL data source is connected:
    python3 scripts/wren-push-metadata.py [--url http://localhost:3000]

This script is idempotent — safe to re-run. It will overwrite existing
descriptions and aliases, re-create relationships, and redeploy.
"""
import argparse
import json
import sys
import urllib.request


def gql(url, query):
    req = urllib.request.Request(
        f"{url}/api/graphql",
        data=json.dumps({"query": query}).encode(),
        headers={"Content-Type": "application/json"},
    )
    resp = urllib.request.urlopen(req, timeout=60)
    return json.loads(resp.read())


# ── Model descriptions (Spanish) ────────────────────────────────────────────
MODEL_METADATA = {
    "ps_articulos": {
        "alias": "Producto",
        "desc": "Catálogo de productos y artículos. Referencia comercial = ccrefejofacm. Prefijo M = mayorista, MA = material sin inventario.",
    },
    "ps_familias": {"alias": "Familia", "desc": "Familias/grupos de productos (jerarquía de clasificación)"},
    "ps_departamentos": {"alias": "Departamento", "desc": "Departamentos/secciones (clasificación de nivel superior)"},
    "ps_colores": {"alias": "Color", "desc": "Catálogo de colores de producto"},
    "ps_temporadas": {"alias": "Temporada", "desc": "Temporadas y tipos (clasificación temporal de colecciones)"},
    "ps_marcas": {"alias": "Marca", "desc": "Marcas y tratamientos de producto"},
    "ps_clientes": {"alias": "Cliente", "desc": "Clientes. num_cliente=0 son ventas anónimas de caja."},
    "ps_tiendas": {"alias": "Tienda", "desc": "Tiendas y puntos de venta. Código 99=almacén central, 97=tienda online."},
    "ps_proveedores": {"alias": "Proveedor", "desc": "Proveedores de mercancía"},
    "ps_gc_comerciales": {"alias": "Comercial", "desc": "Comerciales/agentes de ventas mayorista"},
    "ps_ventas": {
        "alias": "Venta",
        "desc": "Tickets de venta retail/TPV. USAR SIEMPRE total_si (sin IVA) para análisis económico. NUNCA usar total (con IVA). fecha_creacion = fecha de la venta.",
    },
    "ps_lineas_ventas": {
        "alias": "LineaVenta",
        "desc": "Líneas de venta (detalle por artículo). total_si = importe sin IVA. unidades = cantidad. codigo = código de artículo (join con Producto.codigo).",
    },
    "ps_pagos_ventas": {"alias": "PagoVenta", "desc": "Pagos por ticket. importe_cob = importe cobrado."},
    "ps_stock_tienda": {
        "alias": "StockTienda",
        "desc": "Stock por tienda y talla (normalizado). codigo = artículo, tienda = código tienda (99=almacén, 97=online). stock = unidades disponibles.",
    },
    "ps_traspasos": {"alias": "Traspaso", "desc": "Traspasos de stock entre tiendas y regularizaciones"},
    "ps_gc_albaranes": {
        "alias": "AlbaranMayorista",
        "desc": "Albaranes mayorista (entregas B2B). Importe neto sin IVA = base1+base2+base3. NUNCA usar total_albaran.",
    },
    "ps_gc_lin_albarane": {"alias": "LineaAlbaranMayorista", "desc": "Líneas de albarán mayorista (detalle por artículo y tallas)"},
    "ps_gc_facturas": {
        "alias": "FacturaMayorista",
        "desc": "Facturas mayorista. Importe neto sin IVA = base1+base2+base3. NUNCA usar total_factura.",
    },
    "ps_gc_lin_facturas": {"alias": "LineaFacturaMayorista", "desc": "Líneas de factura mayorista"},
    "ps_gc_pedidos": {"alias": "PedidoMayorista", "desc": "Pedidos mayorista"},
    "ps_gc_lin_pedidos": {"alias": "LineaPedidoMayorista", "desc": "Líneas de pedido mayorista"},
    "ps_compras": {"alias": "PedidoCompra", "desc": "Pedidos de compra a proveedores"},
    "ps_lineas_compras": {"alias": "LineaPedidoCompra", "desc": "Líneas de pedido de compra"},
    "ps_facturas": {"alias": "Factura", "desc": "Facturas de compra"},
    "ps_albaranes": {"alias": "AlbaranRecepcion", "desc": "Albaranes de recepción de mercancía"},
    "ps_facturas_compra": {"alias": "FacturaCompra", "desc": "Facturas de compra a proveedores"},
}

# ── Relationships ────────────────────────────────────────────────────────────
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


def main():
    parser = argparse.ArgumentParser(description="Push metadata to WrenAI")
    parser.add_argument("--url", default="http://localhost:3000", help="WrenAI UI URL")
    args = parser.parse_args()
    url = args.url

    # Get models and fields
    data = gql(url, "{ listModels { id displayName fields { id displayName referenceName } } }")
    models = {}
    for m in data["data"]["listModels"]:
        name = m["displayName"].replace("public.", "")
        models[name] = {"id": m["id"], "fields": {f["referenceName"]: f["id"] for f in m["fields"]}}

    # 1. Push descriptions and aliases
    print("── Pushing model metadata ──")
    for name, meta in MODEL_METADATA.items():
        if name not in models:
            continue
        mid = models[name]["id"]
        desc = meta["desc"].replace('"', '\\"')
        alias = meta["alias"]
        gql(url, f'mutation {{ updateModelMetadata(where: {{id: {mid}}}, data: {{displayName: "{alias}", description: "{desc}"}}) }}')
        print(f"  ✓ {name} → {alias}")

    # 2. Create relationships (skip if already exists — createRelation is not idempotent so errors are expected)
    print("\n── Creating relationships ──")
    created = 0
    skipped = 0
    for from_m, from_f, to_m, to_f, rtype in RELATIONSHIPS:
        if from_m not in models or to_m not in models:
            print(f"  ✗ {from_m}.{from_f} → {to_m}.{to_f}: model not found")
            continue
        if from_f not in models[from_m]["fields"] or to_f not in models[to_m]["fields"]:
            print(f"  ✗ {from_m}.{from_f} → {to_m}.{to_f}: field not found")
            continue

        mutation = (
            f"mutation {{ createRelation(data: {{"
            f"fromModelId: {models[from_m]['id']}, "
            f"fromColumnId: {models[from_m]['fields'][from_f]}, "
            f"toModelId: {models[to_m]['id']}, "
            f"toColumnId: {models[to_m]['fields'][to_f]}, "
            f"type: {rtype}"
            f"}}) }}"
        )
        resp = gql(url, mutation)
        if "errors" in str(resp):
            skipped += 1
        else:
            created += 1
            print(f"  ✓ {from_m}.{from_f} → {to_m}.{to_f}")

    print(f"  Created: {created}, Skipped (already exist): {skipped}")

    # 3. Deploy
    print("\n── Deploying ──")
    result = gql(url, "mutation { deploy(force: true) }")
    status = result["data"]["deploy"]["status"]
    print(f"  Deploy: {status}")

    if status != "SUCCESS":
        print(f"  Error: {result['data']['deploy'].get('error', 'unknown')}", file=sys.stderr)
        sys.exit(1)

    print("\n✓ Done. WrenAI semantic model updated and deployed.")


if __name__ == "__main__":
    main()
