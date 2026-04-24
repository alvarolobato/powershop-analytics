DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_stat_statements not available — skipping (enable shared_preload_libraries to activate)';
END
$$;

-- PostgreSQL DDL for the PowerShop Analytics mirror schema.
-- All tables use the ps_ prefix.
-- Run once to create tables; safe to re-run (IF NOT EXISTS).
--
-- Type conventions:
--   4D REAL PKs  → NUMERIC(20,3)  (3 decimal places — some PKs like RegCliente and
--                  RegVentas have 3-decimal-place values (e.g. 4.152, 4.153).
--                  Using scale 2 would round them and cause duplicate-key collisions.
--                  NOT float8 — avoids binary-float precision artifacts.
--                  ETL must insert PK values as Python Decimal (not float) to prevent
--                  precision loss before the value reaches PostgreSQL.
--   4D REAL FKs  → NUMERIC(20,3)  (same precision as the referenced PK)
--   Dates        → DATE
--   Times        → TIME
--   Text         → TEXT
--   Amounts      → NUMERIC(15,2)
--   Boolean      → BOOLEAN
--   Integer counts → INTEGER

-- ============================================================
-- Catalog
-- ============================================================

CREATE TABLE IF NOT EXISTS ps_articulos (
    reg_articulo     NUMERIC(20,3) PRIMARY KEY,
    codigo           TEXT,
    ccrefejofacm     TEXT,         -- "Referencia" — primary business identifier (e.g. "V26212484")
    descripcion      TEXT,
    codigo_barra     TEXT,
    num_familia      NUMERIC(20,3),
    num_departament  NUMERIC(20,3),
    num_color        NUMERIC(20,3),
    num_temporada    NUMERIC(20,3),
    num_marca        NUMERIC(20,3),
    num_proveedor    NUMERIC(20,3),
    precio_coste     NUMERIC(15,2),
    precio1          NUMERIC(15,2),  -- PVP tarifa 1 (4D Articulos.Precio1)
    pr_coste_ne      NUMERIC(15,2),
    p_iva            NUMERIC(5,2),
    anulado          BOOLEAN,
    fecha_creacion   DATE,
    fecha_modifica   DATE,
    color            TEXT,
    clave_temporada  TEXT,
    modelo           TEXT,
    sexo             TEXT
);

-- Mirrors created before precio1 existed: CREATE TABLE IF NOT EXISTS does not add columns.
ALTER TABLE ps_articulos ADD COLUMN IF NOT EXISTS precio1 NUMERIC(15, 2);

CREATE TABLE IF NOT EXISTS ps_familias (
    reg_familia      NUMERIC(20,3) PRIMARY KEY,
    clave            TEXT,
    fami_grup_marc   TEXT,
    coeficiente1     NUMERIC(8,4),
    coeficiente2     NUMERIC(8,4),
    cuenta_ventas    TEXT,
    presupuesto      NUMERIC(15,2),
    anulado          BOOLEAN,
    serie_tallas     TEXT,
    clave_seccion    TEXT
);

CREATE TABLE IF NOT EXISTS ps_departamentos (
    reg_departament  NUMERIC(20,3) PRIMARY KEY,
    clave            TEXT,
    depa_secc_fabr   TEXT,
    jo_iva           NUMERIC(5,2),
    presupuesto      NUMERIC(15,2),
    anulado          BOOLEAN
);

CREATE TABLE IF NOT EXISTS ps_colores (
    reg_color  NUMERIC(20,3) PRIMARY KEY,
    clave      TEXT,
    color      TEXT
);

CREATE TABLE IF NOT EXISTS ps_temporadas (
    reg_temporada    NUMERIC(20,3) PRIMARY KEY,
    clave            TEXT,
    temporada_tipo   TEXT,
    temporada_activ  BOOLEAN,
    inicio_ventas    DATE,
    fin_ventas       DATE,
    inicio_rebajas   DATE,
    fin_rebajas      DATE
);

CREATE TABLE IF NOT EXISTS ps_marcas (
    reg_marca          NUMERIC(20,3) PRIMARY KEY,
    clave              TEXT,
    marca_tratamien    TEXT,
    presupuesto        NUMERIC(15,2),
    descuento_compra   NUMERIC(5,2)
);

-- ============================================================
-- Masters / dimensions
-- ============================================================

CREATE TABLE IF NOT EXISTS ps_clientes (
    reg_cliente      NUMERIC(20,3) PRIMARY KEY,
    num_cliente      NUMERIC(20,3),
    nombre           TEXT,
    nif              TEXT,
    email            TEXT,
    codigo_postal    TEXT,
    poblacion        TEXT,
    pais             TEXT,
    fecha_creacion   DATE,
    fecha_modifica   DATE,
    ultima_compra_f  DATE
);

CREATE TABLE IF NOT EXISTS ps_tiendas (
    reg_tienda     NUMERIC(20,3) PRIMARY KEY,
    codigo         TEXT,
    fecha_modifica DATE
);

CREATE TABLE IF NOT EXISTS ps_proveedores (
    reg_proveedor  NUMERIC(20,3) PRIMARY KEY,
    nombre         TEXT,
    nif            TEXT,
    pais           TEXT,
    f_modifica     DATE
);

CREATE TABLE IF NOT EXISTS ps_gc_comerciales (
    reg_comercial   NUMERIC(20,3) PRIMARY KEY,
    comercial       TEXT,
    cif             TEXT,
    zona_comercial  TEXT,
    comision1       NUMERIC(5,2),
    comision2       NUMERIC(5,2),
    email           TEXT,
    movil           TEXT
);

-- ============================================================
-- Retail sales (Ventas domain)
-- All three tables require UPSERT — 19–21% of records are
-- modified after creation (returns, TBAI corrections, etc.).
-- ============================================================

CREATE TABLE IF NOT EXISTS ps_ventas (
    reg_ventas       NUMERIC(20,3) PRIMARY KEY,
    n_documento      NUMERIC(20,3),
    serie_v          INTEGER,
    tienda           TEXT,
    fecha_creacion   DATE,
    fecha_modifica   DATE,
    total_si         NUMERIC(15,2),  -- VAT-exclusive total (use for analytics)
    total            NUMERIC(15,2),  -- VAT-inclusive total (do not use for revenue)
    num_cliente      NUMERIC(20,3),
    codigo_cajero    TEXT,
    cajero_nombre    TEXT,
    tipo_venta       TEXT,
    tipo_documento   TEXT,
    forma            TEXT,
    entrada          BOOLEAN,
    pendiente        BOOLEAN,
    pedido_web       TEXT
);

CREATE TABLE IF NOT EXISTS ps_lineas_ventas (
    reg_lineas          NUMERIC(20,3) PRIMARY KEY,
    num_ventas          NUMERIC(20,3),
    n_documento         NUMERIC(20,3),
    mes                 INTEGER,
    tienda              TEXT,
    codigo              TEXT,
    descripcion         TEXT,
    unidades            NUMERIC(10,2),
    precio_neto_si      NUMERIC(15,2),  -- VAT-exclusive unit price
    total_si            NUMERIC(15,2),  -- VAT-exclusive line total
    precio_coste_ci     NUMERIC(15,2),
    total_coste_si      NUMERIC(15,2),
    fecha_creacion      DATE,
    fecha_modifica      DATE
);

CREATE TABLE IF NOT EXISTS ps_pagos_ventas (
    reg_pagos       NUMERIC(20,3) PRIMARY KEY,
    num_ventas      NUMERIC(20,3),
    forma           TEXT,
    codigo_forma    TEXT,
    importe_cob     NUMERIC(15,2),  -- "Importe Cobrado" — actual charged amount (use this)
    fecha_creacion  DATE,
    fecha_modifica  DATE,
    tienda          TEXT,
    entrada         BOOLEAN
);

-- ============================================================
-- Stock
-- ============================================================

-- Normalised per-(article, store, size) stock.
-- Source: Exportaciones wide-format table (Talla1..Talla34 × Stock1..Stock34).
-- Compound PK because TiendaCodigo has format "store/article" (e.g. "104/169").
CREATE TABLE IF NOT EXISTS ps_stock_tienda (
    codigo          TEXT            NOT NULL,
    tienda_codigo   TEXT            NOT NULL,  -- format: "store_code/article_code"
    tienda          TEXT,
    talla           TEXT            NOT NULL,
    stock           INTEGER,
    cc_stock        NUMERIC(15,2),
    st_stock        NUMERIC(15,2),
    fecha_modifica  DATE,
    PRIMARY KEY (codigo, tienda_codigo, talla)
);

-- Transfer movements between stores (append-only by fecha_s).
CREATE TABLE IF NOT EXISTS ps_traspasos (
    reg_traspaso    NUMERIC(20,3) PRIMARY KEY,
    codigo          TEXT,
    descripcion     TEXT,
    talla           TEXT,
    unidades_s      NUMERIC(10,2),
    unidades_e      NUMERIC(10,2),
    tienda_salida   TEXT,
    tienda_entrada  TEXT,
    fecha_s         DATE,
    fecha_e         DATE,
    tipo            TEXT,
    concepto        TEXT,
    entrada         BOOLEAN
);

-- ============================================================
-- Wholesale (Gestión Comercial — GC* tables)
-- ============================================================

-- GCLinAlbarane and GCLinFacturas have no modification timestamp.
-- Delta is derived from the parent header's Modifica field.

CREATE TABLE IF NOT EXISTS ps_gc_albaranes (
    reg_albaran     NUMERIC(20,3) PRIMARY KEY,
    n_albaran       NUMERIC(20,3),
    num_cliente     NUMERIC(20,3),
    fecha_envio     DATE,
    fecha_valor     DATE,
    modifica        DATE,
    base1           NUMERIC(15,2),
    base2           NUMERIC(15,2),
    base3           NUMERIC(15,2),
    entregadas      NUMERIC(10,2),
    transportista   TEXT,
    num_comercial   NUMERIC(20,3),
    temporada       TEXT,
    abono           BOOLEAN
);

CREATE TABLE IF NOT EXISTS ps_gc_lin_albarane (
    reg_linea        NUMERIC(20,3) PRIMARY KEY,
    n_albaran        NUMERIC(20,3),   -- FK → ps_gc_albaranes.n_albaran (not reg_albaran)
    num_albaran      NUMERIC(20,3),
    codigo           TEXT,
    articulo         TEXT,
    descripcion      TEXT,
    color            TEXT,
    fecha_albaran    DATE,
    unidades         NUMERIC(10,2),
    precio_neto      NUMERIC(15,2),
    total            NUMERIC(15,2),
    num_cliente      NUMERIC(20,3),
    num_familia      NUMERIC(20,3),
    num_departament  NUMERIC(20,3),
    num_temporada    NUMERIC(20,3),
    num_marca        NUMERIC(20,3),
    num_color        NUMERIC(20,3),
    num_comercial    NUMERIC(20,3),
    mes              INTEGER
);

CREATE TABLE IF NOT EXISTS ps_gc_facturas (
    reg_factura     NUMERIC(20,3) PRIMARY KEY,
    n_factura       NUMERIC(20,3),
    fecha_factura   DATE,
    modifica        DATE,
    base1           NUMERIC(15,2),
    base2           NUMERIC(15,2),
    base3           NUMERIC(15,2),
    num_cliente     NUMERIC(20,3),
    num_comercial   NUMERIC(20,3),
    abono           BOOLEAN,
    total_factura   NUMERIC(15,2)
);

CREATE TABLE IF NOT EXISTS ps_gc_lin_facturas (
    reg_linea        NUMERIC(20,3) PRIMARY KEY,
    num_factura      NUMERIC(20,3),   -- FK → ps_gc_facturas.n_factura (asymmetric naming)
    codigo           TEXT,
    descripcion      TEXT,
    unidades         NUMERIC(10,2),
    precio_neto      NUMERIC(15,2),
    total            NUMERIC(15,2),
    total_coste      NUMERIC(15,2),
    p_iva            NUMERIC(5,2),
    fecha_factura    DATE,
    num_cliente      NUMERIC(20,3),
    num_familia      NUMERIC(20,3),
    num_departament  NUMERIC(20,3),
    num_marca        NUMERIC(20,3),
    num_color        NUMERIC(20,3),
    num_comercial    NUMERIC(20,3),
    mes              INTEGER
);

CREATE TABLE IF NOT EXISTS ps_gc_pedidos (
    reg_pedido       NUMERIC(20,3) PRIMARY KEY,
    n_pedido         NUMERIC(20,3),
    fecha_pedido     DATE,
    modifica         DATE,
    num_cliente      NUMERIC(20,3),
    comercial        TEXT,
    total_pedido     NUMERIC(15,2),
    unidades         NUMERIC(10,2),
    entregadas       NUMERIC(10,2),
    pendientes       NUMERIC(10,2),
    temporada        TEXT,
    pedido_cerrado   BOOLEAN,
    abono            BOOLEAN
);

CREATE TABLE IF NOT EXISTS ps_gc_lin_pedidos (
    reg_linea      NUMERIC(20,3) PRIMARY KEY,
    num_pedido     NUMERIC(20,3),
    codigo         TEXT,
    descripcion    TEXT,
    unidades       NUMERIC(10,2),
    entregadas     NUMERIC(10,2),
    precio_neto    NUMERIC(15,2),
    total          NUMERIC(15,2),
    fecha_pedido   DATE
);

-- ============================================================
-- Purchasing & invoicing
-- Note: "LineasCompras" does not exist — the correct table is
-- CCLineasCompr, mapped here as ps_lineas_compras.
-- ============================================================

CREATE TABLE IF NOT EXISTS ps_compras (
    reg_pedido       NUMERIC(20,3) PRIMARY KEY,
    fecha_pedido     DATE,
    fecha_recibido   DATE,
    modificada       DATE,
    num_proveedor    NUMERIC
);

-- CCLineasCompr in 4D (NOT LineasCompras — that table does not exist).
-- Links to Compras via NumPedido, and to Tiendas via NumTienda.
CREATE TABLE IF NOT EXISTS ps_lineas_compras (
    reg_linea_compra  NUMERIC(20,3) PRIMARY KEY,
    num_pedido        NUMERIC(20,3),
    num_tienda        NUMERIC(20,3),
    fecha             DATE,
    num_articulo      NUMERIC
);

CREATE TABLE IF NOT EXISTS ps_facturas (
    reg_factura     NUMERIC(20,3) PRIMARY KEY,
    fecha_factura   DATE,
    fecha_modifica  DATE
);

CREATE TABLE IF NOT EXISTS ps_albaranes (
    reg_albaran    NUMERIC(20,3) PRIMARY KEY,
    fecha_recibido DATE,
    modificada     DATE
);

-- ps_facturas_compra: no reg_* PK found in 4D; strategy is full-refresh only
-- (TRUNCATE ... RESTART IDENTITY + INSERT).  The surrogate key is for internal
-- reference only and is reset on each load — never used as a join key.
CREATE TABLE IF NOT EXISTS ps_facturas_compra (
    id             INTEGER  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha_factura  DATE,
    fecha_valor    DATE
);

-- ============================================================
-- Dashboard App
-- ============================================================

CREATE TABLE IF NOT EXISTS dashboards (
    id           SERIAL       PRIMARY KEY,
    name         TEXT         NOT NULL,
    description  TEXT,
    spec         JSONB        NOT NULL,
    created_at   TIMESTAMPTZ  DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

-- Add analyze chat messages column if it doesn't exist (migration-safe)
ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS chat_messages_analyze JSONB DEFAULT '[]'::jsonb;

-- Add modify chat messages column if it doesn't exist (migration-safe)
ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS chat_messages_modify JSONB DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS dashboard_versions (
    id            SERIAL       PRIMARY KEY,
    dashboard_id  INTEGER      NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    spec          JSONB        NOT NULL,
    prompt        TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS llm_usage (
    id                  SERIAL        PRIMARY KEY,
    endpoint            TEXT          NOT NULL,
    model               TEXT          NOT NULL,
    prompt_tokens       INTEGER       NOT NULL DEFAULT 0,
    completion_tokens   INTEGER       NOT NULL DEFAULT 0,
    total_tokens        INTEGER       NOT NULL DEFAULT 0,
    estimated_cost_usd  NUMERIC(10,6) NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Weekly reviews (Dashboard App — weekly business review)
-- ============================================================

CREATE TABLE IF NOT EXISTS weekly_reviews (
    id          SERIAL      PRIMARY KEY,
    week_start  DATE        NOT NULL,
    content     JSONB       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_weekly_reviews_week ON weekly_reviews (week_start DESC);

-- Weekly review v2: versioning + analysis window (additive for existing installs)
ALTER TABLE weekly_reviews ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE weekly_reviews ADD COLUMN IF NOT EXISTS generation_mode TEXT NOT NULL DEFAULT 'initial';
ALTER TABLE weekly_reviews ADD COLUMN IF NOT EXISTS supersedes_review_id INTEGER;
ALTER TABLE weekly_reviews ADD COLUMN IF NOT EXISTS window_start DATE;
ALTER TABLE weekly_reviews ADD COLUMN IF NOT EXISTS window_end DATE;

UPDATE weekly_reviews
SET window_start = COALESCE(window_start, week_start),
    window_end = COALESCE(window_end, (week_start + INTERVAL '6 days')::date)
WHERE window_start IS NULL OR window_end IS NULL;

ALTER TABLE weekly_reviews ALTER COLUMN window_start SET NOT NULL;
ALTER TABLE weekly_reviews ALTER COLUMN window_end SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'weekly_reviews_generation_mode_check'
  ) THEN
    ALTER TABLE weekly_reviews
      ADD CONSTRAINT weekly_reviews_generation_mode_check
      CHECK (generation_mode IN ('initial', 'refresh_data', 'alternate_angle'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'weekly_reviews_supersedes_fk'
  ) THEN
    ALTER TABLE weekly_reviews
      ADD CONSTRAINT weekly_reviews_supersedes_fk
      FOREIGN KEY (supersedes_review_id) REFERENCES weekly_reviews(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Assign deterministic revision numbers per week before the unique index (existing rows may share revision=1).
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY week_start ORDER BY created_at NULLS LAST, id) AS rn
  FROM weekly_reviews
)
UPDATE weekly_reviews wr
SET revision = ranked.rn
FROM ranked
WHERE wr.id = ranked.id
  AND wr.revision IS DISTINCT FROM ranked.rn;

CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_reviews_week_revision
  ON weekly_reviews (week_start, revision);

-- Action tracking for weekly reviews (per revision)
CREATE TABLE IF NOT EXISTS weekly_review_actions (
    id            SERIAL       PRIMARY KEY,
    review_id     INTEGER      NOT NULL REFERENCES weekly_reviews(id) ON DELETE CASCADE,
    action_key    TEXT         NOT NULL,
    priority      TEXT         NOT NULL CHECK (priority IN ('alta', 'media', 'baja')),
    owner_role    TEXT         NOT NULL DEFAULT '',
    owner_name    TEXT         NOT NULL DEFAULT '',
    due_date      DATE         NOT NULL,
    expected_impact TEXT       NOT NULL DEFAULT '',
    status        TEXT         NOT NULL DEFAULT 'pendiente'
      CHECK (status IN ('pendiente', 'en_curso', 'hecha', 'descartada')),
    last_update   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (review_id, action_key)
);
CREATE INDEX IF NOT EXISTS idx_weekly_review_actions_review ON weekly_review_actions (review_id);

-- ============================================================
-- ETL control
-- ============================================================

CREATE TABLE IF NOT EXISTS etl_watermarks (
    table_name   TEXT        PRIMARY KEY,
    last_sync_at TIMESTAMPTZ NOT NULL,
    rows_synced  INTEGER,
    status       TEXT        DEFAULT 'ok',
    error_msg    TEXT,
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS etl_sync_runs (
    id                SERIAL       PRIMARY KEY,
    trigger           TEXT         NOT NULL,
    started_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    finished_at       TIMESTAMPTZ,
    duration_ms       INTEGER,
    status            TEXT         NOT NULL DEFAULT 'running',
    tables_ok         INTEGER,
    tables_failed     INTEGER,
    total_tables      INTEGER,
    total_rows_synced INTEGER
);

ALTER TABLE etl_sync_runs ADD COLUMN IF NOT EXISTS total_tables INTEGER;

CREATE TABLE IF NOT EXISTS etl_sync_run_tables (
    id               SERIAL       PRIMARY KEY,
    run_id           INTEGER      NOT NULL REFERENCES etl_sync_runs(id) ON DELETE CASCADE,
    table_name       TEXT         NOT NULL,
    started_at       TIMESTAMPTZ,
    finished_at      TIMESTAMPTZ,
    duration_ms      INTEGER,
    status           TEXT         NOT NULL DEFAULT 'ok',
    rows_synced      INTEGER,
    sync_method      TEXT,
    rows_total_after INTEGER,
    watermark_from   TIMESTAMPTZ,
    watermark_to     TIMESTAMPTZ,
    error_msg        TEXT
);

ALTER TABLE etl_sync_run_tables ADD COLUMN IF NOT EXISTS watermark_from TIMESTAMPTZ;
ALTER TABLE etl_sync_run_tables ADD COLUMN IF NOT EXISTS watermark_to   TIMESTAMPTZ;
ALTER TABLE etl_sync_run_tables ADD COLUMN IF NOT EXISTS error_msg      TEXT;

-- Transport channel: dashboard writes a row here; ETL polls and picks it up.
CREATE TABLE IF NOT EXISTS etl_manual_trigger (
    id           SERIAL       PRIMARY KEY,
    requested_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    status       TEXT         NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'picked_up')),
    picked_up_at TIMESTAMPTZ,
    run_id       INTEGER      REFERENCES etl_sync_runs(id) ON DELETE SET NULL,
    -- Issue #398: allow the dashboard/CLI to request a force re-sync for a
    -- subset of tables (or the full pipeline) by clearing watermarks before
    -- the next run picks them up. Defaults keep the historical "incremental"
    -- semantics when these columns are absent from the INSERT.
    force_full   BOOLEAN      NOT NULL DEFAULT FALSE,
    force_tables TEXT[]       NOT NULL DEFAULT '{}',
    -- Audit column: identifies who requested the sync (e.g. client IP, 'dashboard', 'cli').
    triggered_by TEXT
);

-- Forward-compat: if an older DB already has the table without the new
-- columns, add them in place. IF NOT EXISTS makes this idempotent.
ALTER TABLE etl_manual_trigger ADD COLUMN IF NOT EXISTS force_full   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE etl_manual_trigger ADD COLUMN IF NOT EXISTS force_tables TEXT[]  NOT NULL DEFAULT '{}';
ALTER TABLE etl_manual_trigger ADD COLUMN IF NOT EXISTS triggered_by TEXT;

-- Unique: at most one pending trigger row at a time (supports ON CONFLICT idempotency).
CREATE UNIQUE INDEX IF NOT EXISTS idx_etl_manual_trigger_single_pending
    ON etl_manual_trigger (status) WHERE status = 'pending';

-- Supports frequent polling/claim of the oldest pending manual trigger.
CREATE INDEX IF NOT EXISTS idx_etl_manual_trigger_pending_requested_at
    ON etl_manual_trigger (requested_at, id)
    WHERE status = 'pending';

-- ============================================================
-- LLM usage tracking (Dashboard App)
-- ============================================================

CREATE TABLE IF NOT EXISTS llm_usage (
    id                  SERIAL        PRIMARY KEY,
    endpoint            TEXT          NOT NULL,
    model               TEXT          NOT NULL,
    prompt_tokens       INTEGER       NOT NULL,
    completion_tokens   INTEGER       NOT NULL,
    total_tokens        INTEGER       NOT NULL,
    estimated_cost_usd  NUMERIC(12,6) NOT NULL,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at ON llm_usage(created_at);

-- Dashboard App — per tool call telemetry (agentic LLM)
CREATE TABLE IF NOT EXISTS llm_tool_calls (
    id                  SERIAL        PRIMARY KEY,
    tool_name           TEXT          NOT NULL,
    endpoint            TEXT          NOT NULL,
    request_id          TEXT,
    status              TEXT          NOT NULL CHECK (status IN ('ok', 'error')),
    latency_ms          INTEGER       NOT NULL,
    payload_in_bytes    INTEGER,
    payload_out_bytes   INTEGER,
    error_code          TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_llm_tool_calls_created_at ON llm_tool_calls(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_tool_calls_endpoint_tool ON llm_tool_calls(endpoint, tool_name);

ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS llm_provider TEXT NOT NULL DEFAULT 'openrouter';
ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS llm_driver TEXT;
ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS request_id TEXT;

CREATE INDEX IF NOT EXISTS idx_llm_usage_endpoint_request_id
    ON llm_usage (endpoint, request_id)
    WHERE request_id IS NOT NULL;

ALTER TABLE llm_tool_calls ADD COLUMN IF NOT EXISTS llm_provider TEXT NOT NULL DEFAULT 'openrouter';
ALTER TABLE llm_tool_calls ADD COLUMN IF NOT EXISTS llm_driver TEXT;

-- ============================================================
-- Unique constraints required by wholesale FK targets
-- (n_albaran and n_factura are not PKs but are used as FK targets)
-- ============================================================

-- n_albaran and n_factura are NOT unique (multiple albaranes/facturas can share
-- the same document number across different series or corrections).
CREATE INDEX IF NOT EXISTS idx_alb_nalbaran ON ps_gc_albaranes(n_albaran);
CREATE INDEX IF NOT EXISTS idx_fac_nfactura  ON ps_gc_facturas(n_factura);

-- ============================================================
-- Indexes
-- ============================================================

-- FK indexes (JOIN acceleration)
CREATE INDEX IF NOT EXISTS idx_lv_num_ventas   ON ps_lineas_ventas(num_ventas);
CREATE INDEX IF NOT EXISTS idx_pv_num_ventas   ON ps_pagos_ventas(num_ventas);
CREATE INDEX IF NOT EXISTS idx_lv_codigo       ON ps_lineas_ventas(codigo);

-- Date indexes (delta queries, time filters)
CREATE INDEX IF NOT EXISTS idx_ventas_fecha_mod ON ps_ventas(fecha_modifica);
CREATE INDEX IF NOT EXISTS idx_lv_fecha_mod     ON ps_lineas_ventas(fecha_modifica);
CREATE INDEX IF NOT EXISTS idx_lv_mes           ON ps_lineas_ventas(mes);

-- Store indexes (per-store analytics)
CREATE INDEX IF NOT EXISTS idx_ventas_tienda ON ps_ventas(tienda);
CREATE INDEX IF NOT EXISTS idx_lv_tienda     ON ps_lineas_ventas(tienda);

-- Stock indexes
CREATE INDEX IF NOT EXISTS idx_stock_codigo ON ps_stock_tienda(codigo);
CREATE INDEX IF NOT EXISTS idx_stock_tienda ON ps_stock_tienda(tienda);

-- Wholesale FK indexes
-- Dashboard indexes
CREATE INDEX IF NOT EXISTS idx_dashboard_versions_dashboard_id ON dashboard_versions(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_updated_at ON dashboards(updated_at);

CREATE INDEX IF NOT EXISTS idx_gla_nalbaran   ON ps_gc_lin_albarane(n_albaran);
CREATE INDEX IF NOT EXISTS idx_gla_codigo     ON ps_gc_lin_albarane(codigo);
CREATE INDEX IF NOT EXISTS idx_glf_numfactura ON ps_gc_lin_facturas(num_factura);
CREATE INDEX IF NOT EXISTS idx_glf_codigo     ON ps_gc_lin_facturas(codigo);

-- ============================================================
-- Foreign key constraints (idempotent, NOT VALID DEFERRABLE)
-- NOT VALID: skips validation of existing rows (safe for pre-loaded data).
-- DEFERRABLE INITIALLY DEFERRED: checked at transaction end, not per-statement.
-- ============================================================

DO $$
BEGIN
  -- Retail sales
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lv_ventas') THEN
    ALTER TABLE ps_lineas_ventas ADD CONSTRAINT fk_lv_ventas
      FOREIGN KEY (num_ventas) REFERENCES ps_ventas(reg_ventas)
      NOT VALID DEFERRABLE INITIALLY DEFERRED;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pv_ventas') THEN
    ALTER TABLE ps_pagos_ventas ADD CONSTRAINT fk_pv_ventas
      FOREIGN KEY (num_ventas) REFERENCES ps_ventas(reg_ventas)
      NOT VALID DEFERRABLE INITIALLY DEFERRED;
  END IF;

  -- Product hierarchy
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_art_familia') THEN
    ALTER TABLE ps_articulos ADD CONSTRAINT fk_art_familia
      FOREIGN KEY (num_familia) REFERENCES ps_familias(reg_familia)
      NOT VALID DEFERRABLE INITIALLY DEFERRED;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_art_depto') THEN
    ALTER TABLE ps_articulos ADD CONSTRAINT fk_art_depto
      FOREIGN KEY (num_departament) REFERENCES ps_departamentos(reg_departament)
      NOT VALID DEFERRABLE INITIALLY DEFERRED;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_art_color') THEN
    ALTER TABLE ps_articulos ADD CONSTRAINT fk_art_color
      FOREIGN KEY (num_color) REFERENCES ps_colores(reg_color)
      NOT VALID DEFERRABLE INITIALLY DEFERRED;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_art_temp') THEN
    ALTER TABLE ps_articulos ADD CONSTRAINT fk_art_temp
      FOREIGN KEY (num_temporada) REFERENCES ps_temporadas(reg_temporada)
      NOT VALID DEFERRABLE INITIALLY DEFERRED;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_art_marca') THEN
    ALTER TABLE ps_articulos ADD CONSTRAINT fk_art_marca
      FOREIGN KEY (num_marca) REFERENCES ps_marcas(reg_marca)
      NOT VALID DEFERRABLE INITIALLY DEFERRED;
  END IF;

  -- Wholesale: n_albaran and n_factura are NOT unique in the parent tables
  -- (multiple docs can share a number across series), so FK constraints are
  -- not possible.  The indexes on these columns (above) still accelerate JOINs.

  -- Purchasing
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lc_compras') THEN
    ALTER TABLE ps_lineas_compras ADD CONSTRAINT fk_lc_compras
      FOREIGN KEY (num_pedido) REFERENCES ps_compras(reg_pedido)
      NOT VALID DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- ============================================================
-- ANALYZE (update planner statistics after initial load)
-- ============================================================

ANALYZE ps_articulos;
ANALYZE ps_familias;
ANALYZE ps_departamentos;
ANALYZE ps_colores;
ANALYZE ps_temporadas;
ANALYZE ps_marcas;
ANALYZE ps_clientes;
ANALYZE ps_tiendas;
ANALYZE ps_proveedores;
ANALYZE ps_gc_comerciales;
ANALYZE ps_ventas;
ANALYZE ps_lineas_ventas;
ANALYZE ps_pagos_ventas;
ANALYZE ps_stock_tienda;
ANALYZE ps_traspasos;
ANALYZE ps_gc_albaranes;
ANALYZE ps_gc_lin_albarane;
ANALYZE ps_gc_facturas;
ANALYZE ps_gc_lin_facturas;
ANALYZE ps_gc_pedidos;
ANALYZE ps_gc_lin_pedidos;
ANALYZE ps_compras;
ANALYZE ps_lineas_compras;
ANALYZE ps_facturas;
ANALYZE ps_albaranes;
ANALYZE ps_facturas_compra;
ANALYZE etl_watermarks;
ANALYZE dashboards;
ANALYZE dashboard_versions;
ANALYZE llm_usage;
ANALYZE etl_sync_runs;
ANALYZE etl_sync_run_tables;
ANALYZE etl_manual_trigger;
ANALYZE llm_usage;
