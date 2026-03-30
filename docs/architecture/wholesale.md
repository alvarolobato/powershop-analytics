# Wholesale / Gestion Comercial Domain

> Wholesale orders, delivery notes, invoices, and sales representatives.

## Entity Relationship Diagram

```mermaid
erDiagram
    GCPedidos {
        float RegPedido PK "Order record ID"
        float NPedido "Order number"
        date FechaPedido "Order date"
        float NumCliente FK "-> Clientes.RegCliente"
        text Cliente "Customer name (denorm)"
        float NumComercial FK "-> GCComerciales"
        text Comercial "Sales rep name (denorm)"
        float TotalPedido "Order total"
        float ImporteBruto "Gross amount"
        float Unidades "Total units"
        float Entregadas "Units delivered"
        float Pendientes "Units pending"
        text FormaPago "Payment method"
        int Tarifa "Price list used"
        boolean LlevaIva "Subject to VAT"
        boolean LlevaRE "Subject to surcharge"
        text Temporada "Season name"
        float NumTemporada FK "-> CCOPTempTipo"
        text TiendaAlmacen "Warehouse/store"
        boolean PedidoCerrado "Order closed"
        boolean Abono "Is credit note"
        boolean Presupuesto "Is quote"
    }

    GCLinPedidos {
        float RegLinea PK "Line record ID"
        float NumPedido FK "-> GCPedidos.RegPedido"
        float NumArticulo FK "-> Articulos.RegArticulo"
        text Codigo "Article code (denorm)"
        text Descripcion "Description (denorm)"
        float PrecioBruto "Gross unit price"
        float PrecioNeto "Net unit price"
        float Unidades "Qty ordered"
        float Entregadas "Qty delivered"
        float Total "Line total"
        float PIva "VAT %"
        float NumFamilia FK "-> FamiGrupMarc"
        float NumDepartament FK "-> DepaSeccFabr"
        float NumTemporada FK "-> CCOPTempTipo"
        float NumMarca FK "-> CCOPMarcTrat"
    }

    GCAlbaranes {
        float RegAlbaran PK "Delivery note record ID"
        float NAlbaran "Delivery note number"
        date FechaEnvio "Shipping date"
        float NumCliente FK "-> Clientes.RegCliente"
        text Cliente "Customer name (denorm)"
        float NumComercial FK "-> GCComerciales"
        text Comercial "Sales rep (denorm)"
        text Transportista "Carrier name"
        float TotalAlbaran "Total amount"
        float ImporteBruto "Gross amount"
        float Unidades "Total units"
        text FormaPago "Payment method"
        int Tarifa "Price list used"
        int SerieF "Invoice series"
        boolean LlevaIva "Subject to VAT"
        boolean Abono "Is credit note"
        boolean Deposito "Is deposit/consignment"
        text TiendaAlmacen "Warehouse/store"
        text Temporada "Season name"
    }

    GCLinAlbarane {
        float RegLinea PK "Line record ID"
        float NumAlbaran FK "-> GCAlbaranes.RegAlbaran"
        float NumArticulo FK "-> Articulos.RegArticulo"
        text Codigo "Article code"
        text Descripcion "Description"
        float PrecioBruto "Gross unit price"
        float PrecioNeto "Net unit price"
        float Unidades "Qty shipped"
        float Total "Line total"
        float PIva "VAT %"
        float NumCliente FK "-> Clientes"
        float NumFamilia FK "-> FamiGrupMarc"
        float NumDepartament FK "-> DepaSeccFabr"
        float NumTemporada FK "-> CCOPTempTipo"
        float NumMarca FK "-> CCOPMarcTrat"
        float NumColor FK "-> CCOPColores"
        float NumComercial FK "-> GCComerciales"
        int Mes "YYYYMM period"
    }

    GCFacturas {
        float RegFactura PK "Invoice record ID"
        float NFactura "Invoice number"
        date FechaFactura "Invoice date"
        int SerieFVM "Invoice series"
        float NumCliente FK "-> Clientes.RegCliente"
        text Cliente "Customer name (denorm)"
        float NumComercial FK "-> GCComerciales"
        text Comercial "Sales rep (denorm)"
        float TotalFactura "Invoice total"
        float ImporteBruto "Gross amount"
        float Unidades "Total units"
        text FormaPago "Payment method"
        boolean LlevaIva "Subject to VAT"
        boolean Abono "Is credit note"
        boolean CobrosGenerado "Collections generated"
        text Exportado "Export status"
        text Vencimientos "Due dates"
    }

    GCLinFacturas {
        float RegLinea PK "Line record ID"
        float NumFactura FK "-> GCFacturas.RegFactura"
        float NumArticulo FK "-> Articulos.RegArticulo"
        text Codigo "Article code"
        text Descripcion "Description"
        float PrecioBruto "Gross price"
        float PrecioNeto "Net price"
        float Unidades "Quantity"
        float Total "Line total"
        float TotalCoste "Cost total"
        float PIva "VAT %"
        float NumCliente FK "-> Clientes"
        float NumFamilia FK "-> FamiGrupMarc"
        float NumDepartament FK "-> DepaSeccFabr"
        float NumMarca FK "-> CCOPMarcTrat"
        float NumColor FK "-> CCOPColores"
        float NumComercial FK "-> GCComerciales"
        int Mes "YYYYMM period"
    }

    GCComerciales {
        float RegComercial PK "Sales rep record ID"
        text Comercial "Name"
        text CIF "Tax ID"
        text ZonaComercial "Commercial zone"
        float Comision1 "Commission rate 1"
        float Comision2 "Commission rate 2"
        text FormaPago "Payment method"
        text email "Email"
        text Movil "Mobile"
    }

    GCPedidos ||--o{ GCLinPedidos : "RegPedido -> NumPedido"
    GCAlbaranes ||--o{ GCLinAlbarane : "RegAlbaran -> NumAlbaran"
    GCFacturas ||--o{ GCLinFacturas : "RegFactura -> NumFactura"
    GCPedidos }o--|| GCComerciales : "NumComercial"
    GCAlbaranes }o--|| GCComerciales : "NumComercial"
    GCFacturas }o--|| GCComerciales : "NumComercial"
```

## Wholesale Document Flow

```mermaid
flowchart LR
    PED["GCPedidos\n(Orders)\n101 rows"]
    ALB["GCAlbaranes\n(Delivery Notes)\n48,823 rows"]
    FAC["GCFacturas\n(Invoices)\n18,060 rows"]
    COB["CobrosFacturas\n(Collections)\n12,459 rows"]

    PED -->|"fulfill"| ALB
    ALB -->|"invoice"| FAC
    FAC -->|"collect"| COB
```

## Table Descriptions

| Table | Rows | Columns | Description |
|-------|------|---------|-------------|
| **GCPedidos** | 101 | 124 | Wholesale purchase orders from B2B customers. Contains order totals, VAT breakdown, payment terms, season, and delivery dates. |
| **GCLinPedidos** | 2,645 | 240 | Order line items. One row per article per order with pricing, quantities ordered/delivered. |
| **GCAlbaranes** | 48,823 | 163 | Wholesale delivery notes (albaranes). Documents for goods shipped to wholesale customers with transport and fiscal data. |
| **GCLinAlbarane** | 1,013,799 | 139 | Delivery note line items. The largest wholesale table -- one row per article per shipment. |
| **GCFacturas** | 18,060 | 185 | Wholesale invoices with full fiscal data, payment terms, and collection status. |
| **GCLinFacturas** | 974,742 | 63 | Invoice line items with article, pricing, cost, and period data. |
| **GCComerciales** | 5 | 50 | Sales representatives/commercial agents. Commission structures and contact info. |

## Supporting Tables

| Table | Rows | Description |
|-------|------|-------------|
| GCContactos | 5 | Additional contacts for wholesale clients |
| GCTransporte | 9 | Transport/carrier definitions |
| GCGestionIncidencias | 37 | Incident management for wholesale |
| GCIncidencias | 5 | Incident type records |
| GCTiposIncidencias | 1 | Incident type definitions |
| DivisionPedido | 1,922 | Order split/allocation records |
| DivisionAlbaran | 2,511 | Delivery note split records |

## Empty / Unused Tables

| Table | Description |
|-------|-------------|
| GCPedidoTipo | Order type definitions |
| GCAsignaciones | Stock assignments to orders |
| GCCondicionesFactura | Special invoice conditions |
| GCSistemaComisiones | Commission system rules |
| GCZonasCom | Commercial zone definitions |

## Notes

- The wholesale flow follows a standard document chain: **Order -> Delivery Note -> Invoice -> Collection**.
- **GCLinAlbarane** (1M+ rows) is the primary source for wholesale sales analytics, carrying full product classification (family, department, season, brand, color) denormalized for reporting.
- **GCLinFacturas** closely mirrors GCLinAlbarane but at the invoice level. Both carry `Mes` (YYYYMM) for period filtering.
- All header tables (GCPedidos, GCAlbaranes, GCFacturas) link to `Clientes` via `NumCliente` and to `GCComerciales` via `NumComercial`.
- **GCLinPedidos** has 240 columns (the widest line table), likely due to size-level detail columns (quantities per size slot).

## ETL Sync Strategy

> Validated against production data 2026-03-30.

| Table | Rows | Delta field | Strategy |
|-------|------|-------------|---------|
| GCAlbaranes | 48,948 | `Modifica` (~19 modified/day, ~833/month) | UPSERT delta |
| GCLinAlbarane | 1,016,290 | **None** | Delete+reinsert via parent `Modifica` |
| GCFacturas | 18,060 | `Modifica` (all rows populated) | UPSERT delta |
| GCLinFacturas | 974,742 | **None** | Delete+reinsert via parent `Modifica` |
| GCPedidos | 101 | `Modifica` | Full refresh (trivially small) |
| GCLinPedidos | 2,645 | None | Full refresh (trivially small) |

**Lines delta pattern** (no modification timestamp on line tables):
```sql
-- Fetch lines for recently changed delivery notes
SELECT * FROM GCLinAlbarane
WHERE NAlbaran IN (SELECT NAlbaran FROM GCAlbaranes WHERE Modifica > :last_sync)
-- → DELETE + INSERT in PostgreSQL for those NAlbaran values
```

**FK corrections (important):**
- `GCLinAlbarane.NAlbaran` → `GCAlbaranes.NAlbaran` (not RegAlbaran — these are different fields)
- `GCLinFacturas.NumFactura` → `GCFacturas.NFactura` (note asymmetric naming)

See [etl-sync-strategy.md](../etl-sync-strategy.md) for the full sync plan.
