-- PostgreSQL DDL for the PowerShop Analytics mirror schema.
-- All tables use the ps_ prefix.
-- Run once to create tables; safe to re-run (IF NOT EXISTS).
--
-- Type conventions:
--   4D REAL PKs  → NUMERIC  (unbounded precision; NOT float8 — avoids binary-float
--                  artifacts on .99 suffix values like 10028816.641).
--                  ETL must insert PK values as Python Decimal (not float) to prevent
--                  precision loss before the value reaches PostgreSQL.
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
    reg_articulo     NUMERIC      PRIMARY KEY,
    codigo           TEXT,
    ccrefejofacm     TEXT,         -- "Referencia" — primary business identifier (e.g. "V26212484")
    descripcion      TEXT,
    codigo_barra     TEXT,
    num_familia      NUMERIC,
    num_departament  NUMERIC,
    num_color        NUMERIC,
    num_temporada    NUMERIC,
    num_marca        NUMERIC,
    num_proveedor    NUMERIC,
    precio_coste     NUMERIC(15,2),
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

CREATE TABLE IF NOT EXISTS ps_familias (
    reg_familia      NUMERIC      PRIMARY KEY,
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
    reg_departament  NUMERIC      PRIMARY KEY,
    clave            TEXT,
    depa_secc_fabr   TEXT,
    jo_iva           NUMERIC(5,2),
    presupuesto      NUMERIC(15,2),
    anulado          BOOLEAN
);

CREATE TABLE IF NOT EXISTS ps_colores (
    reg_color  NUMERIC  PRIMARY KEY,
    clave      TEXT,
    color      TEXT
);

CREATE TABLE IF NOT EXISTS ps_temporadas (
    reg_temporada    NUMERIC  PRIMARY KEY,
    clave            TEXT,
    temporada_tipo   TEXT,
    temporada_activ  BOOLEAN,
    inicio_ventas    DATE,
    fin_ventas       DATE,
    inicio_rebajas   DATE,
    fin_rebajas      DATE
);

CREATE TABLE IF NOT EXISTS ps_marcas (
    reg_marca          NUMERIC  PRIMARY KEY,
    clave              TEXT,
    marca_tratamien    TEXT,
    presupuesto        NUMERIC(15,2),
    descuento_compra   NUMERIC(5,2)
);

-- ============================================================
-- Masters / dimensions
-- ============================================================

CREATE TABLE IF NOT EXISTS ps_clientes (
    reg_cliente      NUMERIC  PRIMARY KEY,
    num_cliente      NUMERIC,
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
    reg_tienda     NUMERIC  PRIMARY KEY,
    codigo         TEXT,
    fecha_modifica DATE
);

CREATE TABLE IF NOT EXISTS ps_proveedores (
    reg_proveedor  NUMERIC  PRIMARY KEY,
    nombre         TEXT,
    nif            TEXT,
    pais           TEXT,
    f_modifica     DATE
);

CREATE TABLE IF NOT EXISTS ps_gc_comerciales (
    reg_comercial   NUMERIC  PRIMARY KEY,
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
    reg_ventas       NUMERIC      PRIMARY KEY,
    n_documento      NUMERIC,
    serie_v          INTEGER,
    tienda           TEXT,
    fecha_creacion   DATE,
    fecha_modifica   DATE,
    total_si         NUMERIC(15,2),  -- VAT-exclusive total (use for analytics)
    total            NUMERIC(15,2),  -- VAT-inclusive total (do not use for revenue)
    num_cliente      NUMERIC,
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
    reg_lineas          NUMERIC      PRIMARY KEY,
    num_ventas          NUMERIC,
    n_documento         NUMERIC,
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
    reg_pagos       NUMERIC      PRIMARY KEY,
    num_ventas      NUMERIC,
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
    reg_traspaso    NUMERIC  PRIMARY KEY,
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
    reg_albaran     NUMERIC      PRIMARY KEY,
    n_albaran       NUMERIC,
    num_cliente     NUMERIC,
    fecha_envio     DATE,
    fecha_valor     DATE,
    modifica        DATE,
    base1           NUMERIC(15,2),
    base2           NUMERIC(15,2),
    base3           NUMERIC(15,2),
    entregadas      NUMERIC(10,2),
    transportista   TEXT,
    num_comercial   NUMERIC,
    temporada       TEXT
);

CREATE TABLE IF NOT EXISTS ps_gc_lin_albarane (
    reg_linea        NUMERIC      PRIMARY KEY,
    n_albaran        NUMERIC,   -- FK → ps_gc_albaranes.n_albaran (not reg_albaran)
    num_albaran      NUMERIC,
    codigo           TEXT,
    articulo         TEXT,
    descripcion      TEXT,
    color            TEXT,
    fecha_albaran    DATE,
    unidades         NUMERIC(10,2),
    precio_neto      NUMERIC(15,2),
    total            NUMERIC(15,2),
    num_cliente      NUMERIC,
    num_familia      NUMERIC,
    num_departament  NUMERIC,
    num_temporada    NUMERIC,
    num_marca        NUMERIC,
    num_color        NUMERIC,
    num_comercial    NUMERIC,
    mes              INTEGER
);

CREATE TABLE IF NOT EXISTS ps_gc_facturas (
    reg_factura     NUMERIC      PRIMARY KEY,
    n_factura       NUMERIC,
    fecha_factura   DATE,
    modifica        DATE,
    base1           NUMERIC(15,2),
    base2           NUMERIC(15,2),
    base3           NUMERIC(15,2),
    num_cliente     NUMERIC,
    num_comercial   NUMERIC,
    abono           BOOLEAN,
    total_factura   NUMERIC(15,2)
);

CREATE TABLE IF NOT EXISTS ps_gc_lin_facturas (
    reg_linea        NUMERIC      PRIMARY KEY,
    num_factura      NUMERIC,   -- FK → ps_gc_facturas.n_factura (asymmetric naming)
    codigo           TEXT,
    descripcion      TEXT,
    unidades         NUMERIC(10,2),
    precio_neto      NUMERIC(15,2),
    total            NUMERIC(15,2),
    total_coste      NUMERIC(15,2),
    p_iva            NUMERIC(5,2),
    fecha_factura    DATE,
    num_cliente      NUMERIC,
    num_familia      NUMERIC,
    num_departament  NUMERIC,
    num_marca        NUMERIC,
    num_color        NUMERIC,
    num_comercial    NUMERIC,
    mes              INTEGER
);

CREATE TABLE IF NOT EXISTS ps_gc_pedidos (
    reg_pedido       NUMERIC      PRIMARY KEY,
    n_pedido         NUMERIC,
    fecha_pedido     DATE,
    modifica         DATE,
    num_cliente      NUMERIC,
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
    reg_linea      NUMERIC      PRIMARY KEY,
    num_pedido     NUMERIC,
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
    reg_pedido       NUMERIC  PRIMARY KEY,
    fecha_pedido     DATE,
    fecha_recibido   DATE,
    modificada       DATE,
    num_proveedor    NUMERIC
);

-- CCLineasCompr in 4D (NOT LineasCompras — that table does not exist).
-- Links to Compras via NumPedido, and to Tiendas via NumTienda.
CREATE TABLE IF NOT EXISTS ps_lineas_compras (
    reg_linea_compra  NUMERIC  PRIMARY KEY,
    num_pedido        NUMERIC,
    num_tienda        NUMERIC,
    fecha             DATE,
    num_articulo      NUMERIC
);

CREATE TABLE IF NOT EXISTS ps_facturas (
    reg_factura     NUMERIC  PRIMARY KEY,
    fecha_factura   DATE,
    fecha_modifica  DATE
);

CREATE TABLE IF NOT EXISTS ps_albaranes (
    reg_albaran    NUMERIC  PRIMARY KEY,
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
