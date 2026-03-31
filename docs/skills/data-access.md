# Skill: Data Access (4D SQL & SOAP)

**Use when**: Connecting to 4D, running SQL queries, exploring the schema, or calling SOAP web services.

## 4D SQL via P4D

### Connection

```python
import p4d, os
conn = p4d.connect(
    host=os.environ['P4D_HOST'],
    port=int(os.environ['P4D_PORT']),
    user=os.environ.get('P4D_USER', ''),
    password=os.environ.get('P4D_PASSWORD', '')
)
```

### System tables

| Query | Purpose |
|-------|---------|
| `SELECT * FROM _USER_TABLES` | List all tables (name, id, flags) |
| `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, DATA_LENGTH FROM _USER_COLUMNS WHERE TABLE_NAME = 'X'` | Columns for table X |

### Gotchas

- **Always use VAT-exclusive fields**: `Ventas.TotalSI` not `Total`, `LineasVentas.PrecioNetoSI * Unidades` not `Total`, `GCFacturas.(Base1+Base2+Base3)` not `TotalFactura`. VAT is 23% PT mainland / 22% Madeira / 21% Spain -- it distorts comparisons across regions.
- **Primary keys are Real (float)**: Most tables use a Real field as PK with a `.99` suffix pattern (e.g. `RegArticulo = 534.99`). The `.99` is just a convention, not meaningful.
- **Article identifier mapping**: `Articulos.CCRefeJOFACM` = **Referencia** (e.g., "V26212484") -- this is the **primary business identifier**: what appears on labels, what staff know, what reports should display. `Articulos.Codigo` (text, internal code like "144880") is used by SOAP APIs. `Articulos.RegArticulo` (float PK like "10053347.99") = `CCStock.NumArticulo` = `LineasVentas.NumArticulo` (used for JOINs). `Articulos.Articulo` is the supplier/provider reference. `Articulos.CodigoBarra` is the EAN/barcode. **Note**: `LineasVentas` has `Codigo` (= `Articulos.Codigo`) but does NOT have `CCRefeJOFACM` -- you must JOIN with `Articulos` on `a.RegArticulo = lv.NumArticulo` to get the Referencia. Reports should always show Referencia (`CCRefeJOFACM`) as the primary SKU column, not Codigo.
- **Referencia prefix conventions**: Prefix `M` = wholesale/mayorista article. Prefix `MA` = **material** (bolsas, perchas, etc.) — no inventory tracked, no stock management, exclude from stock analysis and sales KPIs. When filtering for wholesale articles, use `LEFT(CCRefeJOFACM, 1) = 'M'` but be aware that MA articles are a subset that should often be excluded from business metrics.
- **CCStock has 582 columns**: Wide-format stock matrix. Query specific columns, not `SELECT *`.
- **Articulos has 379 columns**: Includes 15 price levels, 20 size slots, multilingual descriptions. Query specific columns.
- **Read-only**: Never issue modification statements. The CLI blocks them, but be careful in direct Python scripts too.
- **SQL dialect**: 4D SQL, not standard SQL. Some functions may differ. `LIMIT` works for row limiting.
- **Connection stability**: The SQL server was manually started; if 4D Server restarts, SQL may not come back without manual intervention.
- **PagosVentas fields**: `ImporteEnt` = "Importe Entregado" (physical amount handed over, e.g., a 20 EUR bill for a 5.99 EUR item) -- NOT useful for analytics. `ImporteCob` = "Importe Cobrado" (actual amount charged, includes VAT) -- use for payment analysis. `Ventas.TotalSI` = the real revenue number (VAT-exclusive), use for all revenue analytics. There is NO `ImporteSal` column. ~33 "Devolucion Vale" records have a POS bug in ImporteEnt that concatenates store codes, producing huge values -- this is not corruption, just an irrelevant field.
- **No TLS**: SQL connection is unencrypted. Only use on trusted networks.
- **p4d type 0 columns**: Some columns have type 0 (unknown to p4d). `SELECT *` on tables with these columns raises `Unrecognized 4D type: 0`. Always query specific columns or filter by `_USER_COLUMNS.DATA_TYPE` first.
- **p4d cursor.description returns bytes column names**: The p4d driver returns column names in `cursor.description` as `bytes` (e.g. `b'REGARTICULO'`), not `str`. If you iterate `cursor.description` to build dict keys, you'll get bytes keys that don't match any string-based mapping. The ETL's `safe_fetch()` in `etl/db/fourd.py` handles this with `_decode_column_name()`. If writing custom queries outside the ETL, always decode: `col_name.decode('utf-8') if isinstance(col_name, bytes) else col_name`.
- **Bytes in results**: Text fields may return `bytes` instead of `str` in Python 3.13+. Always decode: `v.decode('utf-8', errors='replace')`.
- **Column name case**: Column names are returned uppercase from queries (e.g. `CODIGO` not `Codigo`), but must be specified in original case in SQL statements.
- **Large table caution**: Tables like Tiendas (209 cols) with Picture/Blob columns can hang on `SELECT *`. Use explicit column lists.
- **Ventas.FechaDocumento is NULL for all records**: Never use this field for date filtering or delta sync. Use `FechaModifica` (max = today) or `FechaCreacion` instead.
- **LineasCompras does not exist**: The purchase order line table is `CCLineasCompr` (44K rows). It links to `Compras` via `NumPedido`, not a direct `NumCompra` field.
- **Exportaciones.TiendaCodigo format**: This field is `"tienda/articulo"` (e.g. `"104/169"`), not just a store code. The compound `(Codigo, TiendaCodigo)` is the natural PK for this table.
- **Ventas/LineasVentas/PagosVentas are NOT append-only**: 19–21% of historical records have been modified after creation (returns, TBAI corrections, payment flags). Always UPSERT by `FechaModifica` — never plain INSERT.
- **PKs are REAL floats**: Store PKs as `NUMERIC` in PostgreSQL, not `FLOAT8`, to avoid precision loss on the `.99` suffix pattern (e.g. `RegVentas = 10028816.641`).

### CLI usage

```bash
ps sql tables                          # List all tables
ps sql describe Articulos              # Show columns
ps sql query "SELECT * FROM Tiendas"   # Run query
ps sql sample Ventas 3                 # Sample rows
ps sql count LineasVentas              # Row count
```

## SOAP via zeep

### Connection

```python
from zeep import Client
client = Client(os.environ['SOAP_WSDL'])
```

### Naming conventions

- `WS_JS_*` -- Returns JSON strings. First params typically (int session/company_id, string auth_token, ...)
- `WS_FF_*` -- Franchise/partner integration, returns structured arrays
- `WS_TO_*` -- "Tienda Online" (online store/e-commerce)
- `WS_RFID_*` -- RFID inventory operations
- `_I` suffix -- Iterative/improved version of same endpoint

### Auth endpoints

- `WS_PWC_login` / `WS_PWC_login2` -- Main authentication
- `WS_JS_PSListAutenticar` -- List authentication

### Per-Store Stock (the key pattern)

Per-store stock is available via **two methods**:

#### Method 1: SQL via `Exportaciones` table (discovered from legacy VFP app)

The `Exportaciones` table contains per-store, per-article stock with per-size breakdown.

```sql
-- Get stock for a specific store
SELECT *
FROM Exportaciones
WHERE CAST(Tienda AS INT) = 152
  AND CCStock <> 0
```

Key columns: `Tienda` (store code), `Codigo` (article code), `CCStock` (total stock), `Stock1..Stock17` (per-size stock).

This method is faster for bulk queries (all articles in a store at once) and does not require SOAP authentication.

**Note**: This table was used by the legacy VFP application (2014-2018). Verify the table still exists and is populated in the current schema.

#### Method 2: SOAP via `WS_JS_StockTiendas` (confirmed working)

```python
from zeep import Client
import json

client = Client('http://YOUR_4D_SERVER_IP:8080/4DWSDL')

# Query stock for one or more articles (by Articulos.Codigo, NOT NumArticulo/RegArticulo)
codes = ['144880', '144588', '144844']
result = client.service.WS_JS_StockTiendas(Entrada1=json.dumps(codes))

status = json.loads(result.Salida1)  # {"error":"","codigos_no_validos":[]}
data   = json.loads(result.Salida2)  # array of articles

# Structure of each article in data:
# {
#   "codigo": "144880",
#   "tiendas": [
#     {
#       "codigo_tienda": "644",
#       "id_tienda": "HELLIN",
#       "direccion": "C/ GRAN VIA 32",
#       "poblacion": "HELLIN",
#       "provincia": "",
#       "postal": "",
#       "pais": "ESPANA",
#       "b2c": false,
#       "b2b": true,
#       "cloud": true,
#       "prioridad": 0,
#       "stock": [
#         {"talla": "38", "stock": 1},
#         {"talla": "40", "stock": 0},
#         ...
#       ]
#     },
#     ...
#   ]
# }

# To get total stock in a specific store:
for art in data:
    for tienda in art['tiendas']:
        store_total = sum(s['stock'] for s in tienda['stock'])
        if store_total > 0:
            print(f"Store {tienda['codigo_tienda']}: {store_total} units")
```

**Important notes:**
- The input codes must be `Articulos.Codigo` (internal numeric codes like "144880"), NOT the article reference (`Articulo` field like "BOBA") or barcode (`CodigoBarra`).
- To map between identifiers: `SELECT Codigo, Articulo, CodigoBarra, RegArticulo FROM Articulos WHERE Codigo = 'XXXX'`
- `CCStock.NumArticulo` corresponds to `Articulos.RegArticulo` (the float PK with .99 suffix).
- Store code 99 is the central warehouse (company headquarters).
- Store code 97 is the online store.
- Negative stock values can appear (returns pending, adjustments).
- The API returns all ~51 stores for every article, even those with zero stock.

### Other Stock SOAP Methods

| Method | Input | Output | Notes |
|--------|-------|--------|-------|
| `WS_JS_StockTiendas` | `Entrada1`: JSON array of Codigo values | Per-store, per-size stock for all stores | **Primary method** -- no auth needed |
| `WS_JS_StockTiendasEAN` | `Entrada1`: JSON array of EAN codes | Same as above but by barcode | Untested |
| `WS_JS_GetStockTiendas` | `Entrada1`, `Entrada2` | Per-store stock | Requires auth (returns "Acceso no autorizado") |
| `WS_JS_DesgloseStockTienda` | `Entrada1`: article, `Entrada2`: store | Stock breakdown for one article in one store | May require auth |
| `WS_JS_GetStock` | `Entrada1` | Total stock | Untested |

### Gotchas

- All params named `Entrada1`, `Entrada2`, etc. -- no documentation
- Many methods require a session token as first parameter
- `WS_JS_StockTiendas` does NOT require auth -- it works without a session token
- WSDL: `http://YOUR_4D_SERVER_IP:8080/4DWSDL`
