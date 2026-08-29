---
id: D-048
title: Sales-by-size is resolved via barcode, not a column
date: 2026-08-29
---

# D-048: Sales-by-size is resolved via barcode, not a column

*Decided: 2026-08-29*

**Context**: The owner asked the dashboard "I26101833 — de este artículo qué
talla se vende más" and it answered that sizes only exist in stock, not in
sales. He pushed back — sizes exist both in the warehouse and in sales.

Investigation confirmed both things at once: the dashboard's answer was an
accurate description of the PostgreSQL mirror, not of the underlying 4D ERP
— a data-pipeline gap, not a hallucination.

1. `ps_lineas_ventas` (`etl/schema/init.sql`, pre-D-048) had 14 columns and
   no size, because `etl/sync/ventas.py`'s `_SQL_LINEAS_BASE` selected only
   14 of the 159 columns `LineasVentas` actually has
   (`docs/schema-raw/4d_all_columns.json`, key `LineasVentas`).
2. `LineasVentas` itself has **no general size column** — its only
   "talla"-shaped field, `CCOPTallaOjo`, is optics-specific. Confirmed both
   in the raw column dump and the vendor view `LineasVentas_SQL` (157 cols,
   `docs/schema-raw/4d_views_schema.json`).
3. The size lives on `BarrasAsociado` (~63,756 rows), which maps additional
   EAN barcodes to an article — in practice, one row per (article, size)
   variant. This was already documented in `docs/architecture/
   stock-logistics.md` before this decision, though with a wrong column
   name (see "Documentation correction" below).
4. `LineasVentas` has a `CodigoAsociado` column (present in the view as
   `CODIGOASOCIADO`) whose name pairs with the `BarrasAsociado` table name.

**Decision**: Resolve size-on-sales via a barcode join, exposed as a
PostgreSQL view, `ps_lineas_ventas_talla` (`etl/schema/init.sql`):

```sql
SELECT ...
FROM ps_lineas_ventas lv
LEFT JOIN ps_barras_asociado ba ON lv.codigo_asociado = ba.codigo
```

Three columns needed for this were added to `ps_lineas_ventas` /
`etl/sync/ventas.py`'s `_SQL_LINEAS_BASE`: `codigo_asociado`, `num_articulo`,
`num_color`. `BarrasAsociado` is mirrored in full as a new table,
`ps_barras_asociado` (`etl/sync/barras_asociado.py`) — full refresh, not
delta: at ~64K rows the complexity of watermark tracking isn't worth it
(same call already made for `ps_tiendas`/`ps_proveedores`/
`ps_gc_comerciales`), even though `FModifica` exists on the live column
list and a delta *would* be possible in principle.

**The join key is a hypothesis, not a confirmed fact.** Neither this agent
nor the owner's environment could reach the live 4D server from this
sandbox, so `lv.codigo_asociado = ba.codigo` could not be verified against
real data before shipping. It is the strongest-evidence guess available:
`CodigoAsociado`'s name directly pairs with the `BarrasAsociado` table name
and its `Codigo` column, which is independently confirmed to be a
per-article-per-size EAN (see the `Articulos.CodigoBarra` vs.
`BarrasAsociado.Codigo` distinction below). It is still a guess.

**Verification command, not a guess dressed as fact**: `ps sql
verify-talla-join [articulo] [dias]` (`cli/commands/sql.sh`) runs read-only
queries against the live 4D server and prints:
- The `Articulos`/`BarrasAsociado` rows for one article (default
  `I26101833`, the owner's own example) — its size options.
- Recent `LineasVentas` rows for that article, including `CodigoAsociado`
  and `Codigo`.
- Match-rate coverage for **both** candidate keys — `CodigoAsociado =
  BarrasAsociado.Codigo` (implemented) and `Codigo = BarrasAsociado.Codigo`
  (the alternative hypothesis: the sale line's own code is already the
  size-specific barcode) — for that one article.
- The same two match rates across a population window (default 60 days,
  every article that has at least one `BarrasAsociado` row).
- A sanity check that `LineasVentas.NumArticulo` and the pre-existing
  `Codigo`-based join select the same line set for the article (a mismatch
  would mean `NumArticulo` is sparsely populated, undermining the whole
  approach).

Run it once against production and read the printed guidance: whichever
candidate's match rate is higher (ideally close to 100%) is the real join
key. If `Codigo = BarrasAsociado.Codigo` wins, swap the `ON` clause in
`ps_lineas_ventas_talla`.

**Coverage caveat, surfaced rather than hidden**: not every sale line will
resolve a size — `codigo_asociado` may be unpopulated on older lines, or the
barcode may not appear in `BarrasAsociado` for some reason. The view carries
a `talla_resolucion` column (`'ok'` / `'sin_codigo_asociado'` /
`'sin_match'`) on every row, so a `GROUP BY talla` naturally shows the
unresolved bucket instead of silently under-counting. The dashboard rule
(`docs/etl-sync-strategy.md`, `## LLM:rules`) and the two new SQL pairs
(`docs/dashboard/sql-pairs.md`) require checking that bucket before
presenting a "most-sold size" answer as complete — a partial join that looks
complete is worse than the honest "no puedo" the dashboard gave before.

**Why not `Cubo`**: `Cubo` also carries a size matrix — `IdeTalla1..34`
(size labels) and `VTalla1..34` (the `V` prefix matches this table's sales
prefix: `VUnidadesVenta`, `VVentasSI`, `VUnidadesNeto`, `VTicketsVenta`), the
same 34-slot wide pattern the ETL already unpivots for `Exportaciones`. It
was not chosen because it is **completely undocumented** in this repo and
carries `NivelElegido` / `CalculoEnUso` / `CodigoValor` columns suggesting
its grain (what exactly a "slot" aggregates — per store? per period? per
some configurable dimension?) is configurable and unknown — a materially
riskier unknown than the barcode-join hypothesis above, which at least rests
on a table (`BarrasAsociado`) whose purpose is independently documented and
whose grain (one row per article+size) is clear. `Cubo` remains a
documented alternative for a future agent to investigate if
`verify-talla-join` shows the barcode join doesn't work.

**Documentation correction**: `docs/architecture/stock-logistics.md` and
`docs/schema-discovery.md` both described a `CodigoBarra` column on
`BarrasAsociado`. That column does **not exist** — confirmed against
`docs/schema-raw/4d_all_columns.json` and `4d_views_schema.json`
(`BarrasAsociado_SQL` view, 10 columns: `AuxCodigo`, `Codigo`, `FModifica`,
`HModifica`, `IDAPIRfid`, `NTalla`, `NumArticulo`, `RegBarras`, `SKU`,
`Talla`). The real barcode column is `Codigo`. The likely origin of the
error: `Articulos` genuinely has a `CodigoBarra` column (the article's
single *default* barcode, already mirrored as `ps_articulos.codigo_barra`
via `etl/sync/articulos.py`) — a different column, on a different table,
with a different grain (one per article, not one per article+size). Both
docs are corrected as part of this decision.

**What remains unverified after this PR** (all settled by running `ps sql
verify-talla-join` against production, which this sandbox cannot reach):
- Whether `lv.codigo_asociado = ba.codigo` or `lv.codigo = ba.codigo` is the
  real join key (see above).
- Whether `LineasVentas.NumArticulo` is populated on older sale lines, or
  only recently — a sparse `NumArticulo` would undermine `num_articulo`-based
  joins even though the ETL now mirrors it.
- The live `DATA_TYPE` of `BarrasAsociado.NTalla` and `RegBarras` — no
  `_USER_COLUMNS` type dump exists for this table in
  `docs/schema-raw/`. `n_talla` is stored generously as
  `NUMERIC(10,2)` to tolerate either an int or a real; `reg_barras` is
  assumed to follow the same Real-`.99`-suffix convention as every other
  `Reg*` PK in this schema (a very well-established pattern here, but not
  independently re-verified for this specific table).

**Alternatives rejected**:
- `Cubo` — see "Why not `Cubo`" above.
- Guessing the join key and shipping it as settled fact — rejected per the
  owner's explicit instruction: neither this agent nor the owner's
  environment can reach the live 4D server, so an unconfirmed assumption
  must be verifiable in one command, not asserted.

**Rationale**: This makes "which size sells most" answerable today with the
best available evidence, while making every unconfirmed assumption
mechanically checkable in one read-only command instead of buried in
conversation context that the next agent would have to rediscover (see
`docs/skills/agent-efficiency.md`).

**See**: `etl/sync/barras_asociado.py`, `etl/sync/ventas.py`
(`_SQL_LINEAS_BASE`, `_LINEAS_MAPPING`), `etl/schema/init.sql`
(`ps_barras_asociado`, `ps_lineas_ventas_talla`, migration for
`ps_lineas_ventas`'s three new columns), `cli/commands/sql.sh`
(`verify-talla-join`), `docs/etl-sync-strategy.md` (`## LLM:rules`),
`docs/dashboard/sql-pairs.md`, `docs/architecture/sales.md`,
`docs/architecture/stock-logistics.md`, `docs/schema-discovery.md`.
