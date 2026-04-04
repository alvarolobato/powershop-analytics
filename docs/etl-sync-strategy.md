# ETL Sync Strategy — 4D to PostgreSQL

> Validated against real data on 2026-03-30. Row counts and date ranges reflect live production data at that point.

This document defines the sync strategy for each table in the ETL pipeline from 4D to the PostgreSQL mirror used by WrenAI. For each table it records: row count, available delta fields, PK, sync method, and any gotchas discovered by direct query.

---

## Key findings

- **Ventas/LineasVentas/PagosVentas are NOT append-only.** 19–21% of historical records have `FechaModifica > FechaCreacion`, caused by returns, TBAI fiscal corrections, and payment flag updates. All three tables require **UPSERT by `FechaModifica`**.
- **`FechaDocumento` is NULL for all records in Ventas.** Never use it as a delta field. Use `FechaModifica` or `FechaCreacion`.
- **`LineasCompras` does not exist.** The correct table name is `CCLineasCompr` (44K rows). Links to `Compras` via `NumPedido`.
- **`Exportaciones.TiendaCodigo`** has the format `"tienda/articulo"` (e.g. `"104/169"`), not just a store code. The compound PK is `(Codigo, TiendaCodigo)`.
- **PKs are REAL (float) with `.99` suffix** (e.g. `RegVentas = 10028816.641`). Store as `NUMERIC` in PostgreSQL, not `FLOAT8`, to avoid precision loss.
- **Referencia prefix `MA` = material (no inventory).** Articles whose `CCRefeJOFACM` starts with `MA` are materials (bolsas, perchas, etc.) — no stock tracking, no inventory management. Exclude from stock analysis and sales KPIs. `M` (non-MA) = wholesale. No prefix = retail.
- **MA articles (materials) excluded at ETL level.** Articles whose `CCRefeJOFACM` starts with `'MA'` are filtered from the 4D extraction query in `sync_articulos` (`WHERE LEFT(CCRefeJOFACM, 2) <> 'MA'`). After each full sync, a cascade cleanup step also removes MA-linked rows from line-item tables (`ps_lineas_ventas`, `ps_stock_tienda`, `ps_gc_lin_albarane`, `ps_gc_lin_facturas`) using `get_ma_article_codes()` in `etl/sync/articulos.py`. This eliminates the need for `MA%` filtering in all downstream queries and WrenAI instructions.
- **All 41K Articulos have `FechaModifica >= 2025-03-26`** due to a batch update. Delta sync is ineffective; use full refresh.
- **GCLinAlbarane and GCLinFacturas have no modification timestamp.** Delta is derived from the parent header's `Modifica` field via a parent-join strategy.

### Learnings from first production sync (2026-03-31)

- **NUMERIC(20,3) not (20,2)** for PKs. Some 4D PKs have 3 decimal places (e.g. `RegCliente = 4.152, 4.153`). Scale 2 rounded them and caused duplicate-key violations.
- **4D SQL `!=` not supported** — use `<>`. This broke `get_queryable_columns()` and all tables using it (Compras, Facturas, Albaranes, FacturasCompra).
- **Exportaciones needs progressive sync by store** — single 2M-row fetch OOMs. Fetch per-store (`WHERE Tienda = 'X'`): 50 stores × ~41K rows × ~80s = ~67 min total. Each store normalizes to ~247K rows (6 tallas avg).
- **Single-query is still correct for tables <2M rows** — Ventas (911K, 16 min), LineasVentas (1.7M, 30 min), PagosVentas (965K, 14 min) all completed with single-fetch. LIMIT/OFFSET is never correct for 4D (re-scans from row 0 at each offset).
- **GCLinAlbarane missing columns**: `NumComercial` and `Mes` don't exist in GCLinAlbarane (they do in GCLinFacturas). Column lists must be verified per table.
- **GCAlbaranes has `Unidades` not `Entregadas`** — column name mismatch from the architecture docs.
- **n_albaran/n_factura are NOT unique** — multiple documents can share the same number (different series). UNIQUE indexes and FK constraints on these fail.
- **NUL byte padding** in 4D text fields — fixed-length fields come with `\x00` padding.
- **p4d cursor.description returns bytes** — column names are `b'REGARTICULO'`, not str.
- **TRUNCATE CASCADE needed** when FK constraints exist between full-refresh tables.
- **Full initial load time**: ~2.5 hours total (Ventas chain ~60 min, GC chain ~50 min, Stock ~67 min, rest ~15 min).

---

## Sync strategies by table

### Ventas domain (retail POS)

| Table | Rows | PK | Delta field | Strategy |
|-------|------|----|-------------|---------|
| Ventas | 911,619 | `RegVentas` | `FechaModifica` (max = today) | UPSERT delta |
| LineasVentas | 1,689,796 | `RegLineas` | `FechaModifica` (max = today) | UPSERT delta |
| PagosVentas | 964,971 | `RegPagos` | `FechaModifica` (max = today) | UPSERT delta |

**Daily volume:** ~454 Ventas + ~897 LineasVentas new/modified per day.

```sql
-- Delta pattern for all three tables
SELECT ... FROM Ventas WHERE FechaModifica > :last_sync
-- → UPSERT INTO ps_ventas ON CONFLICT (reg_ventas) DO UPDATE SET ...
```

**Why UPSERT and not INSERT?**
- 177,530 Ventas records modified since 2025-01-01 (19% of total)
- 356,505 LineasVentas records modified since 2025-01-01 (21% of total)
- 188,859 PagosVentas records modified since 2025-01-01 (20% of total)

**FK chain:** `LineasVentas.NumVentas` → `Ventas.RegVentas`, `PagosVentas.NumVentas` → `Ventas.RegVentas`

---

### Stock domain

| Table | Rows | PK | Delta field | Strategy |
|-------|------|----|-------------|---------|
| Exportaciones | 2,058,201 | `(Codigo, TiendaCodigo)` compound | `FechaModifica` (some NULLs for zero-stock articles) | UPSERT delta + normalize |
| Traspasos | 262,689 | `RegTraspaso` | `FechaS` (send date) | Append-only by `FechaS` |

**Exportaciones normalization:** The source table is wide-format (Talla1..Talla34 + Stock1..Stock34 per row). ETL must expand each row into `(codigo, tienda_codigo, talla, stock)` tuples. Target table: `ps_stock_tienda`.

`TiendaCodigo` format: `"104/169"` = store 104 / article 169. The compound `(Codigo, TiendaCodigo)` is the natural PK — verified by row count.

**Traspasos:** Only 153 rows since 2025-01-01 (mostly historical log). No `FechaModifica`. Records appear immutable once created. Append-only by `FechaS`. Initial load covers all 262K rows.

---

### Wholesale domain (Gestión Comercial)

| Table | Rows | PK | Delta field | Strategy |
|-------|------|----|-------------|---------|
| GCAlbaranes | 48,948 | `RegAlbaran` | `Modifica` (max = today, ~19/day) | UPSERT delta |
| GCLinAlbarane | 1,016,290 | `RegLinea` | **None** — derive from parent | Delete+reinsert via parent |
| GCFacturas | 18,060 | `RegFactura` | `Modifica` (all 18K populated) | UPSERT delta |
| GCLinFacturas | 974,742 | `RegLinea` | **None** — derive from parent | Delete+reinsert via parent |
| GCPedidos | 101 | `RegPedido` | `Modifica` (available) | Full refresh (trivially small) |
| GCLinPedidos | 2,645 | `RegLinea` | None | Full refresh (trivially small) |

**Parent-join delta pattern for lines:**
```sql
-- Fetch lines for recently modified delivery notes
SELECT * FROM GCLinAlbarane
WHERE NAlbaran IN (
    SELECT NAlbaran FROM GCAlbaranes WHERE Modifica > :last_sync
)
-- → DELETE FROM ps_gc_lin_albarane WHERE n_albaran = ANY(:changed_ids)
-- → INSERT INTO ps_gc_lin_albarane ...
```

**FK corrections (important):**
- `GCLinAlbarane.NAlbaran` → `GCAlbaranes.NAlbaran` (not RegAlbaran — these are different fields)
- `GCLinFacturas.NumFactura` → `GCFacturas.NFactura` (note asymmetric naming)

**GCAlbaranes daily volume:** ~19 modified/day, ~833/month. Lines delta is lightweight.

---

### Products & catalog domain

| Table | Rows | Strategy | Reason |
|-------|------|---------|--------|
| Articulos | 41,264 | Full refresh nightly | All records have FechaModifica >= 2025-03-26 (batch update renders delta useless) |
| FamiGrupMarc | 78 | Full refresh | Trivially small |
| DepaSeccFabr | 10 | Full refresh | Trivially small |
| CCOPColores | 99 | Full refresh | Trivially small |
| CCOPTempTipo | 69 | Full refresh | Trivially small |
| CCOPMarcTrat | ~147 | Full refresh | Trivially small |

**Articulos column selection:** Do NOT use `SELECT *`. The table has 379 columns including BLOB/PICTURE types (DATA_TYPE 12 and 18) that slow queries significantly. Select only the ~30–40 needed columns explicitly.

---

### Master/dimension tables

| Table | Rows | PK | Delta | Strategy |
|-------|------|----|-------|---------|
| Clientes | 27,568 | `RegCliente` | `FechaModifica` | Full refresh (small enough, simpler) |
| Tiendas | 51 | `RegTienda` | `FechaModifica` | Full refresh |
| Proveedores | 519 | — (verify `RegProveedor`) | `FModifica` | Full refresh |
| GCComerciales | 5 | `RegComercial` | — | Full refresh |

---

### Purchasing & invoicing domain

| Table | Rows | PK | Delta | Strategy |
|-------|------|----|-------|---------|
| Compras | 2,700 | `RegPedido` | `Modificada` | Full refresh |
| CCLineasCompr | 44,425 | `RegLineaCompra` | `Fecha` | Full refresh |
| Facturas | 2,357 | `RegFactura` (verify) | `FechaModifica` | Full refresh |
| Albaranes | 3,672 | `RegAlbaran` (verify) | `Modificada` | Full refresh |
| FacturasCompra | 3,884 | — (verify) | `FechaFactura` | Full refresh |

**Important:** `LineasCompras` does not exist as a table. The line items for purchase orders are in `CCLineasCompr`. It links to `Compras` via `NumPedido` (not a direct `NumCompra` field), and to `Tiendas` via `NumTienda`.

---

## Nightly execution order

Tables must be synced in topological order (dimensions before facts):

1. Catalog: Articulos, FamiGrupMarc, CCOPColores, CCOPTempTipo, DepaSeccFabr
2. Masters: Tiendas, Clientes, Proveedores, GCComerciales
3. Stock: Exportaciones
4. Retail: Ventas → LineasVentas → PagosVentas
5. Wholesale: GCAlbaranes → GCLinAlbarane | GCFacturas → GCLinFacturas | GCPedidos → GCLinPedidos
6. Purchasing: Compras → CCLineasCompr → Facturas → Albaranes → FacturasCompra
7. Movements: Traspasos

## Watermarks

The ETL service stores last-sync timestamps in a `etl_watermarks` table in PostgreSQL:

```sql
CREATE TABLE etl_watermarks (
    table_name   TEXT PRIMARY KEY,
    last_sync_at TIMESTAMPTZ NOT NULL,
    rows_synced  INTEGER,
    status       TEXT DEFAULT 'ok',
    error_msg    TEXT,
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);
```

On first run (no watermark), use `datetime(2014, 1, 1)` as the default `since` date to load all historical data.

---

## Implementation

See GitHub issues #1–#19 for the implementation plan. Issues are tagged `[infra]`, `[etl]`, `[wren]`, and `[docs]`.

Key files (to be created):
- `etl/` — Python ETL package
- `docker-compose.yml` — Full stack (PostgreSQL + ETL + WrenAI)
- `wren/mdl/` — WrenAI semantic model definitions
