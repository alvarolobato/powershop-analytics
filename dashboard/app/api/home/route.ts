/**
 * GET /api/home[?date=YYYY-MM-DD]
 *
 * Returns the HomeViewModel rendered by /inicio. All values come from
 * real PostgreSQL aggregation against the ps_* mirror tables; nothing
 * is fabricated.
 *
 * Scope: retail-only. Wholesale is intentionally excluded — `/inicio` is
 * the retail business overview.
 *
 * As-of date semantics:
 * - If `?date=YYYY-MM-DD` is supplied and falls within the available
 *   mirror range, that date is used as the as-of pivot.
 * - Otherwise we fall back to MAX(fecha_creacion) FROM ps_ventas, which
 *   is "the last business day with recorded retail sales".
 *
 * Limitations:
 * - ps_ventas has only date granularity (no time-of-day), so the hero's
 *   `hourly` / `hourlyYesterday` arrays are returned empty. HeroToday
 *   detects this and renders a daily-resolution layout instead.
 * - The "store name" comes from the new `ps_tiendas.identificador` field
 *   (4D `Tiendas.IdentificadorTienda`). When empty, we fall back to
 *   `poblacion`, then to "Tienda {codigo}".
 */

import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/db";
import type { HomeViewModel, Metric } from "@/lib/home-types";

export const dynamic = "force-dynamic";

const MONTHS_ES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];
const DAYS_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeRatio(num_: number, den: number): number {
  if (!den) return 0;
  return num_ / den - 1;
}

function fmtAsOf(d: Date): string {
  // Render in Europe/Madrid regardless of host TZ.
  const fmt = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday").replace(".", "");
  const dd = get("day");
  const mon = get("month").replace(".", "");
  const hh = get("hour");
  const mm = get("minute");
  return `${wd} ${dd} ${mon} · ${hh}:${mm}`;
}

function fmtSyncAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 6) / 10;
  if (h < 48) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} d`;
}

function statusFromDelta(delta: number): "ok" | "watch" | "alert" {
  if (delta <= -0.10) return "alert";
  if (delta <= -0.04) return "watch";
  return "ok";
}

function dateLabelEs(d: Date): string {
  return `${DAYS_ES[d.getDay()]} ${d.getDate()} ${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
}

/** Choose a display label for a store: identificador → poblacion → "Tienda {codigo}". */
function storeName(identificador: unknown, poblacion: unknown, codigo: string): string {
  const id = (identificador ?? "").toString().trim();
  if (id) return id;
  const pob = (poblacion ?? "").toString().trim();
  if (pob) return pob;
  return `Tienda ${codigo}`;
}

export async function GET(req: NextRequest) {
  try {
    // ─────────────────────────────────────────────────────────────────────
    // Resolve as-of date: ?date=YYYY-MM-DD wins (if valid + in range),
    // otherwise the most recent day with retail sales in the mirror.
    // ─────────────────────────────────────────────────────────────────────
    const requested = req.nextUrl.searchParams.get("date");
    const requestedClean =
      requested && ISO_DATE_RE.test(requested) ? requested : null;

    const pivotRow = await query(
      `SELECT
         (SELECT MAX(fecha_creacion) FROM ps_ventas
           WHERE entrada=true AND tienda<>'99')::text AS max_synced,
         (SELECT MIN(fecha_creacion) FROM ps_ventas
           WHERE entrada=true AND tienda<>'99')::text AS min_synced,
         (NOW() AT TIME ZONE 'Europe/Madrid')::date::text AS today_madrid,
         NOW() AS now_utc`,
    );
    const maxSyncedStr = String(pivotRow.rows[0][0] ?? "");
    const minAvailStr = String(pivotRow.rows[0][1] ?? "");
    const todayMadrid = String(pivotRow.rows[0][2] ?? "");
    const nowUtcIso = String(pivotRow.rows[0][3] ?? "");

    // Default as-of (when no ?date= supplied) is the most recent fully
    // synced day so KPIs aren't dominated by a potentially-stale today.
    // BUT the navigator cap (`maxAvailableDate`) goes up to today_madrid
    // so the user can still scroll forward to days the ETL hasn't caught
    // up with yet — those days show honest zeros instead of a stuck arrow.
    let asOfDate = maxSyncedStr;
    if (requestedClean) {
      if (minAvailStr && requestedClean < minAvailStr) asOfDate = minAvailStr;
      else if (todayMadrid && requestedClean > todayMadrid) asOfDate = todayMadrid;
      else asOfDate = requestedClean;
    }
    const maxAvailableDate = todayMadrid || maxSyncedStr || asOfDate;

    const [y, m, d] = asOfDate.split("-").map((s) => parseInt(s, 10));
    const asOfDateObj = new Date(y, m - 1, d);
    const lastYearSameDay = new Date(y - 1, m - 1, d);

    // asOf header: most recent successful sales-domain sync (for staleness).
    const watermarkRow = await query(
      `SELECT
         MAX(last_sync_at) FILTER (WHERE status = 'ok') AS max_ok,
         MAX(last_sync_at)                              AS max_any
       FROM etl_watermarks
       WHERE table_name IN ('ventas','lineas_ventas')`,
    );
    const maxSyncOk = watermarkRow.rows[0][0] as string | null;
    const maxSyncAny = watermarkRow.rows[0][1] as string | null;
    const asOfHeader = fmtAsOf(
      new Date(maxSyncOk ?? maxSyncAny ?? nowUtcIso),
    );

    // ─────────────────────────────────────────────────────────────────────
    // Run aggregations in parallel.
    // ─────────────────────────────────────────────────────────────────────
    const [
      heroRow,
      hourlyTodayRow,
      hourlyYesterdayRow,
      periodHoyRow,
      periodSemanaRow,
      periodMesRow,
      periodAnyoRow,
      hoySpark7Row,
      semanaSpark6Row,
      mesSpark5Row,
      anyoSpark5Row,
      dailyTrendRow,
      storesRow,
      storesSparkRow,
      opsRetailRow,
      retailMonthRow,
      etlRunRow,
      anomaliesRow,
      lastWatermarkRow,
    ] = await Promise.all([
      // Hero today / yesterday / LY same day
      query(
        `SELECT
           COALESCE(SUM(CASE WHEN fecha_creacion = $1::date           THEN total_si END), 0) AS hoy,
           COALESCE(SUM(CASE WHEN fecha_creacion = ($1::date - INTERVAL '1 day')::date THEN total_si END), 0) AS ayer,
           COALESCE(SUM(CASE WHEN fecha_creacion = ($1::date - INTERVAL '1 year')::date THEN total_si END), 0) AS hace_un_anyo
         FROM ps_ventas
         WHERE entrada = true AND tienda <> '99'
           AND fecha_creacion BETWEEN ($1::date - INTERVAL '1 year' - INTERVAL '7 days')::date AND $1::date`,
        [asOfDate],
      ),

      // Hero hourly (cumulative through hour) for the as-of day. NULL
      // values for hours that have no rows AND no preceding rows. Once
      // ps_ventas.hora_creacion is fully backfilled, this drives the
      // intraday curve in HeroToday. When hora_creacion is NULL on every
      // row (pre-backfill), the cumulative is 0 across all hours and the
      // route falls back to empty arrays so the hero shows the
      // "Sin granularidad horaria" panel.
      query(
        `WITH hours AS (
           SELECT generate_series(0, 23) AS h
         ),
         per_hour AS (
           SELECT EXTRACT(HOUR FROM hora_creacion)::int AS h,
                  SUM(total_si)::numeric AS s
           FROM ps_ventas
           WHERE entrada = true AND tienda <> '99'
             AND fecha_creacion = $1::date
             AND hora_creacion IS NOT NULL
           GROUP BY EXTRACT(HOUR FROM hora_creacion)
         )
         SELECT h.h,
                COALESCE(SUM(p.s) OVER (ORDER BY h.h), 0)::numeric AS cumul,
                EXISTS (SELECT 1 FROM per_hour) AS has_data
         FROM hours h LEFT JOIN per_hour p ON p.h = h.h
         ORDER BY h.h`,
        [asOfDate],
      ),

      // Hero hourly cumulative for the day before the as-of day.
      query(
        `WITH hours AS (
           SELECT generate_series(0, 23) AS h
         ),
         per_hour AS (
           SELECT EXTRACT(HOUR FROM hora_creacion)::int AS h,
                  SUM(total_si)::numeric AS s
           FROM ps_ventas
           WHERE entrada = true AND tienda <> '99'
             AND fecha_creacion = ($1::date - INTERVAL '1 day')::date
             AND hora_creacion IS NOT NULL
           GROUP BY EXTRACT(HOUR FROM hora_creacion)
         )
         SELECT h.h,
                COALESCE(SUM(p.s) OVER (ORDER BY h.h), 0)::numeric AS cumul,
                EXISTS (SELECT 1 FROM per_hour) AS has_data
         FROM hours h LEFT JOIN per_hour p ON p.h = h.h
         ORDER BY h.h`,
        [asOfDate],
      ),

      // Period: hoy
      query(
        `SELECT
           COALESCE(SUM(CASE WHEN fecha_creacion = $1::date           THEN total_si END), 0) AS hoy,
           COALESCE(SUM(CASE WHEN fecha_creacion = ($1::date - INTERVAL '1 day')::date THEN total_si END), 0) AS ayer,
           COALESCE(SUM(CASE WHEN fecha_creacion = ($1::date - INTERVAL '1 year')::date THEN total_si END), 0) AS lyear
         FROM ps_ventas
         WHERE entrada = true AND tienda <> '99'
           AND fecha_creacion BETWEEN ($1::date - INTERVAL '1 year' - INTERVAL '2 days')::date AND $1::date`,
        [asOfDate],
      ),

      // Period: semana
      query(
        `SELECT
           COALESCE(SUM(CASE WHEN fecha_creacion >= DATE_TRUNC('week', $1::date)::date
                              AND fecha_creacion <= $1::date THEN total_si END), 0) AS curr,
           COALESCE(SUM(CASE WHEN fecha_creacion >= DATE_TRUNC('week', ($1::date - INTERVAL '1 week'))::date
                              AND fecha_creacion <  DATE_TRUNC('week', $1::date)::date THEN total_si END), 0) AS prev,
           COALESCE(SUM(CASE WHEN fecha_creacion >= DATE_TRUNC('week', ($1::date - INTERVAL '1 year'))::date
                              AND fecha_creacion <= ($1::date - INTERVAL '1 year')::date THEN total_si END), 0) AS lyear
         FROM ps_ventas
         WHERE entrada = true AND tienda <> '99'
           AND fecha_creacion >= ($1::date - INTERVAL '1 year' - INTERVAL '2 weeks')::date
           AND fecha_creacion <= $1::date`,
        [asOfDate],
      ),

      // Period: mes
      query(
        `SELECT
           COALESCE(SUM(CASE WHEN fecha_creacion >= DATE_TRUNC('month', $1::date)::date
                              AND fecha_creacion <= $1::date THEN total_si END), 0) AS curr,
           COALESCE(SUM(CASE WHEN fecha_creacion >= DATE_TRUNC('month', $1::date - INTERVAL '1 month')::date
                              AND fecha_creacion <  DATE_TRUNC('month', $1::date)::date THEN total_si END), 0) AS prev,
           COALESCE(SUM(CASE WHEN fecha_creacion >= DATE_TRUNC('month', $1::date - INTERVAL '1 year')::date
                              AND fecha_creacion <= ($1::date - INTERVAL '1 year')::date THEN total_si END), 0) AS lyear
         FROM ps_ventas
         WHERE entrada = true AND tienda <> '99'
           AND fecha_creacion >= ($1::date - INTERVAL '1 year' - INTERVAL '2 months')::date
           AND fecha_creacion <= $1::date`,
        [asOfDate],
      ),

      // Period: año YTD
      query(
        `SELECT
           COALESCE(SUM(CASE WHEN fecha_creacion >= DATE_TRUNC('year', $1::date)::date
                              AND fecha_creacion <= $1::date THEN total_si END), 0) AS curr,
           COALESCE(SUM(CASE WHEN fecha_creacion >= DATE_TRUNC('year', $1::date - INTERVAL '1 year')::date
                              AND fecha_creacion <= ($1::date - INTERVAL '1 year')::date THEN total_si END), 0) AS lyear
         FROM ps_ventas
         WHERE entrada = true AND tienda <> '99'
           AND fecha_creacion >= ($1::date - INTERVAL '2 years')::date
           AND fecha_creacion <= $1::date`,
        [asOfDate],
      ),

      // Hoy spark: last 7 days
      query(
        `SELECT day::date AS day, COALESCE(SUM(v.total_si), 0)::numeric AS value
         FROM generate_series(($1::date - INTERVAL '6 days')::date, $1::date, '1 day') day
         LEFT JOIN ps_ventas v
           ON v.fecha_creacion = day::date
          AND v.entrada = true AND v.tienda <> '99'
         GROUP BY day ORDER BY day`,
        [asOfDate],
      ),

      // Semana spark: 6 ISO weeks ending this week
      query(
        `WITH weeks AS (
           SELECT week_start FROM generate_series(
             DATE_TRUNC('week', $1::date - INTERVAL '5 weeks')::date,
             DATE_TRUNC('week', $1::date)::date,
             '1 week'
           ) week_start
         )
         SELECT w.week_start::date AS week_start,
                EXTRACT(WEEK FROM w.week_start)::int AS iso_week,
                COALESCE(SUM(v.total_si), 0)::numeric AS value
         FROM weeks w
         LEFT JOIN ps_ventas v
           ON v.fecha_creacion >= w.week_start
          AND v.fecha_creacion <  (w.week_start + INTERVAL '1 week')::date
          AND v.entrada = true AND v.tienda <> '99'
         GROUP BY w.week_start ORDER BY w.week_start`,
        [asOfDate],
      ),

      // Mes spark: last 5 months
      query(
        `WITH months AS (
           SELECT month_start FROM generate_series(
             DATE_TRUNC('month', $1::date - INTERVAL '4 months')::date,
             DATE_TRUNC('month', $1::date)::date,
             '1 month'
           ) month_start
         )
         SELECT m.month_start::date AS month_start,
                EXTRACT(MONTH FROM m.month_start)::int AS mon,
                COALESCE(SUM(v.total_si), 0)::numeric AS value
         FROM months m
         LEFT JOIN ps_ventas v
           ON v.fecha_creacion >= m.month_start
          AND v.fecha_creacion <  (m.month_start + INTERVAL '1 month')::date
          AND v.entrada = true AND v.tienda <> '99'
         GROUP BY m.month_start ORDER BY m.month_start`,
        [asOfDate],
      ),

      // Año spark: cumulative YTD by month for current year
      query(
        `WITH months AS (
           SELECT month_start FROM generate_series(
             DATE_TRUNC('year', $1::date)::date,
             DATE_TRUNC('month', $1::date)::date,
             '1 month'
           ) month_start
         )
         SELECT m.month_start::date AS month_start,
                EXTRACT(MONTH FROM m.month_start)::int AS mon,
                COALESCE(SUM(v.total_si), 0)::numeric AS value
         FROM months m
         LEFT JOIN ps_ventas v
           ON v.fecha_creacion >= m.month_start
          AND v.fecha_creacion <  (m.month_start + INTERVAL '1 month')::date
          AND v.entrada = true AND v.tienda <> '99'
         GROUP BY m.month_start ORDER BY m.month_start`,
        [asOfDate],
      ),

      // Daily trend: current month + same days LY
      query(
        `WITH days AS (
           SELECT generate_series(
             DATE_TRUNC('month', $1::date)::date,
             (DATE_TRUNC('month', $1::date) + INTERVAL '1 month' - INTERVAL '1 day')::date,
             '1 day'
           )::date AS day
         )
         SELECT EXTRACT(DAY FROM d.day)::int AS day_num,
                COALESCE((SELECT SUM(v.total_si) FROM ps_ventas v
                          WHERE v.entrada=true AND v.tienda<>'99'
                            AND v.fecha_creacion = d.day), 0)::numeric AS actual,
                COALESCE((SELECT SUM(v.total_si) FROM ps_ventas v
                          WHERE v.entrada=true AND v.tienda<>'99'
                            AND v.fecha_creacion = (d.day - INTERVAL '1 year')::date), 0)::numeric AS ly,
                d.day > $1::date AS is_future
         FROM days d
         ORDER BY d.day`,
        [asOfDate],
      ),

      // ALL stores for the as-of date (sorted by sales DESC), with name
      // resolved from ps_tiendas.identificador / poblacion. LEFT JOIN so
      // stores with zero sales today still appear.
      query(
        `SELECT t.codigo,
                t.identificador,
                t.poblacion,
                COALESCE(s.sales, 0)::numeric AS sales,
                COALESCE(avg7.avg7, 0)::numeric AS avg7
         FROM ps_tiendas t
         LEFT JOIN (
           SELECT tienda, SUM(total_si) AS sales
           FROM ps_ventas
           WHERE entrada=true AND tienda<>'99' AND fecha_creacion = $1::date
           GROUP BY tienda
         ) s ON s.tienda = t.codigo
         LEFT JOIN (
           SELECT tienda, AVG(daily_total)::numeric AS avg7
           FROM (
             SELECT tienda, fecha_creacion, SUM(total_si) AS daily_total
             FROM ps_ventas
             WHERE entrada=true AND tienda<>'99'
               AND fecha_creacion >= ($1::date - INTERVAL '7 days')::date
               AND fecha_creacion <  $1::date
             GROUP BY tienda, fecha_creacion
           ) per_day
           GROUP BY tienda
         ) avg7 ON avg7.tienda = t.codigo
         WHERE t.codigo <> '99'
         ORDER BY COALESCE(s.sales, 0) DESC, t.codigo`,
        [asOfDate],
      ),

      // 7-day spark per store (all stores, last 7 days)
      query(
        `WITH days AS (
           SELECT generate_series(($1::date - INTERVAL '6 days')::date, $1::date, '1 day')::date AS day
         )
         SELECT t.codigo, d.day,
                COALESCE((SELECT SUM(v.total_si) FROM ps_ventas v
                          WHERE v.entrada=true
                            AND v.tienda = t.codigo
                            AND v.fecha_creacion = d.day), 0)::numeric AS sales
         FROM ps_tiendas t CROSS JOIN days d
         WHERE t.codigo <> '99'
         ORDER BY t.codigo, d.day`,
        [asOfDate],
      ),

      // Retail ops: tickets, gross, devoluciones for as-of date
      query(
        `SELECT
           COUNT(DISTINCT CASE WHEN entrada=true THEN reg_ventas END)::int AS tickets,
           COALESCE(SUM(CASE WHEN entrada=true THEN total_si END), 0)::numeric AS gross,
           COALESCE(SUM(CASE WHEN entrada=false THEN ABS(total_si) END), 0)::numeric AS devolu
         FROM ps_ventas
         WHERE tienda<>'99' AND fecha_creacion = $1::date`,
        [asOfDate],
      ),

      // Retail ops: month margin
      query(
        `SELECT
           COALESCE(SUM(lv.total_si), 0)::numeric AS rev,
           COALESCE(SUM(lv.total_coste_si), 0)::numeric AS cost
         FROM ps_lineas_ventas lv
         JOIN ps_ventas v ON lv.num_ventas = v.reg_ventas
         WHERE v.entrada=true AND lv.tienda<>'99' AND lv.total_si > 0
           AND lv.fecha_creacion >= DATE_TRUNC('month', $1::date)::date
           AND lv.fecha_creacion <= $1::date`,
        [asOfDate],
      ),

      // ETL latest run
      query(
        `SELECT id, status, started_at, finished_at, total_rows_synced
         FROM etl_sync_runs
         ORDER BY id DESC LIMIT 1`,
      ),

      // ETL anomalies
      query(
        `SELECT COUNT(*)::int AS n FROM etl_watermarks WHERE status <> 'ok'`,
      ),

      // ETL most recent watermark
      query(
        `SELECT MAX(last_sync_at) AS last FROM etl_watermarks`,
      ),
    ]);

    // ─────────────────────────────────────────────────────────────────────
    // Hero
    // ─────────────────────────────────────────────────────────────────────
    const todayValue = num(heroRow.rows[0][0]);
    const yesterday = num(heroRow.rows[0][1]);
    const lastYear = num(heroRow.rows[0][2]);

    // Build hourly cumulative arrays from the per-hour query. When the
    // mirror has no time-of-day data for either day (rows where
    // hora_creacion IS NULL), we return empty arrays so HeroToday falls
    // back to its "Sin granularidad horaria" pane.
    const todayHasHourly = hourlyTodayRow.rows.length > 0
      && (hourlyTodayRow.rows[0][2] === true || hourlyTodayRow.rows[0][2] === "t");
    const yesterdayHasHourly = hourlyYesterdayRow.rows.length > 0
      && (hourlyYesterdayRow.rows[0][2] === true || hourlyYesterdayRow.rows[0][2] === "t");

    // For the as-of day mask hours after the current hour as `null` when
    // the as-of date IS today_madrid (the day is still in progress).
    // For past days, every hour is in the past, so no masking.
    const isAsOfToday = asOfDate === todayMadrid;
    const madridHourFmt = new Intl.DateTimeFormat("es-ES", {
      timeZone: "Europe/Madrid",
      hour: "2-digit",
      hour12: false,
    });
    const currentHourMadrid = parseInt(madridHourFmt.format(new Date(nowUtcIso)), 10);

    const hourlyToday: (number | null)[] = todayHasHourly
      ? hourlyTodayRow.rows.map((r) => {
          const h = num(r[0]);
          const cumul = num(r[1]);
          if (isAsOfToday && h > currentHourMadrid) return null;
          return cumul;
        })
      : [];

    const hourlyYesterdayArr: number[] = yesterdayHasHourly
      ? hourlyYesterdayRow.rows.map((r) => num(r[1]))
      : [];

    const hero: HomeViewModel["hero"] = {
      todayValue,
      forecastEOD: todayValue,
      todayPace: 0,
      vsYesterday: safeRatio(todayValue, yesterday),
      vsLY: safeRatio(todayValue, lastYear),
      yesterday,
      lastYear,
      status: "on-pace",
      hourly: hourlyToday,
      hourlyYesterday: hourlyYesterdayArr,
    };

    // ─────────────────────────────────────────────────────────────────────
    // Periods
    // ─────────────────────────────────────────────────────────────────────
    const periodHoyCurr = num(periodHoyRow.rows[0][0]);
    const periodHoyPrev = num(periodHoyRow.rows[0][1]);
    const periodHoyLY = num(periodHoyRow.rows[0][2]);
    const semCurr = num(periodSemanaRow.rows[0][0]);
    const semPrev = num(periodSemanaRow.rows[0][1]);
    const semLY = num(periodSemanaRow.rows[0][2]);
    const mesCurr = num(periodMesRow.rows[0][0]);
    const mesPrev = num(periodMesRow.rows[0][1]);
    const mesLY = num(periodMesRow.rows[0][2]);
    const anyoCurr = num(periodAnyoRow.rows[0][0]);
    const anyoLY = num(periodAnyoRow.rows[0][1]);

    const hoySpark = hoySpark7Row.rows.map((r) => num(r[1]));
    const hoySparkLabels = hoySpark7Row.rows.map((r) => {
      const [yy, mm, dd] = String(r[0]).split("-").map((s) => parseInt(s, 10));
      return DAYS_ES[new Date(yy, mm - 1, dd).getDay()];
    });
    const semSpark = semanaSpark6Row.rows.map((r) => num(r[2]));
    const semSparkLabels = semanaSpark6Row.rows.map((r) => `s${num(r[1])}`);
    const mesSpark = mesSpark5Row.rows.map((r) => num(r[2]));
    const mesSparkLabels = mesSpark5Row.rows.map((r) => MONTHS_ES[num(r[1]) - 1] || "");
    const anyoSpark = anyoSpark5Row.rows.map((r) => num(r[2]));
    const anyoSparkLabels = anyoSpark5Row.rows.map((r) => MONTHS_ES[num(r[1]) - 1] || "");

    const periods: HomeViewModel["periods"] = [
      {
        id: "hoy",
        label: "Hoy",
        value: periodHoyCurr,
        deltaPrev: safeRatio(periodHoyCurr, periodHoyPrev),
        prevLabel: "vs ayer",
        deltaYoY: periodHoyLY > 0 ? safeRatio(periodHoyCurr, periodHoyLY) : null,
        yoyLabel: `vs ${dateLabelEs(lastYearSameDay)}`,
        spark: hoySpark,
        sparkLabels: hoySparkLabels,
      },
      {
        id: "semana",
        label: "Semana",
        value: semCurr,
        deltaPrev: safeRatio(semCurr, semPrev),
        prevLabel: "vs sem ant",
        deltaYoY: semLY > 0 ? safeRatio(semCurr, semLY) : null,
        yoyLabel: `vs sem ${asOfDateObj.getFullYear() - 1}`,
        spark: semSpark,
        sparkLabels: semSparkLabels,
      },
      {
        id: "mes",
        label: "Mes",
        value: mesCurr,
        deltaPrev: safeRatio(mesCurr, mesPrev),
        prevLabel: "vs mes ant",
        deltaYoY: mesLY > 0 ? safeRatio(mesCurr, mesLY) : null,
        yoyLabel: `vs ${MONTHS_ES[asOfDateObj.getMonth()]} ${asOfDateObj.getFullYear() - 1}`,
        spark: mesSpark,
        sparkLabels: mesSparkLabels,
      },
      {
        id: "anyo",
        // For YTD the natural "previous" comparison IS year-over-year
        // (there is no distinct previous-period concept), so deltaPrev
        // and deltaYoY share the same value.
        label: "Año (YTD)",
        value: anyoCurr,
        deltaPrev: anyoLY > 0 ? safeRatio(anyoCurr, anyoLY) : 0,
        prevLabel: `vs YTD ${asOfDateObj.getFullYear() - 1}`,
        deltaYoY: anyoLY > 0 ? safeRatio(anyoCurr, anyoLY) : null,
        yoyLabel: `vs ${asOfDateObj.getFullYear() - 1} mismo tramo`,
        spark: anyoSpark,
        sparkLabels: anyoSparkLabels,
      },
    ];

    // ─────────────────────────────────────────────────────────────────────
    // Daily trend
    // ─────────────────────────────────────────────────────────────────────
    const dailyTrend: HomeViewModel["dailyTrend"] = dailyTrendRow.rows.map((r) => {
      const dayNum = num(r[0]);
      const actualVal = num(r[1]);
      const lyVal = num(r[2]);
      const isFuture = r[3] === true || r[3] === "t";
      return {
        day: dayNum,
        actual: isFuture ? null : actualVal,
        ly: lyVal,
      };
    });

    // ─────────────────────────────────────────────────────────────────────
    // All stores
    // ─────────────────────────────────────────────────────────────────────
    const sparkByStore: Record<string, number[]> = {};
    for (const r of storesSparkRow.rows) {
      const code = String(r[0]);
      if (!sparkByStore[code]) sparkByStore[code] = [];
      sparkByStore[code].push(num(r[2]));
    }
    const topStores: HomeViewModel["topStores"] = storesRow.rows.map((r) => {
      const code = String(r[0]);
      const identificador = r[1];
      const poblacion = r[2];
      const sales = num(r[3]);
      const avg7 = num(r[4]);
      // Δ vs the same store's own 7-day average (excluding the as-of day).
      const delta = avg7 > 0 ? sales / avg7 - 1 : 0;
      return {
        code,
        name: storeName(identificador, poblacion, code),
        sales,
        delta,
        spark: sparkByStore[code] ?? [],
        status: statusFromDelta(delta),
      };
    });

    // ─────────────────────────────────────────────────────────────────────
    // Retail ops
    // ─────────────────────────────────────────────────────────────────────
    const tickets = num(opsRetailRow.rows[0][0]);
    const gross = num(opsRetailRow.rows[0][1]);
    const devolu = num(opsRetailRow.rows[0][2]);
    const ticketMedio = tickets > 0 ? gross / tickets : 0;
    const monthRev = num(retailMonthRow.rows[0][0]);
    const monthCost = num(retailMonthRow.rows[0][1]);
    const margenPct = monthRev > 0 ? (monthRev - monthCost) / monthRev : 0;

    const opsRetail: Metric[] = [
      { id: "ticket", label: "Ticket medio", value: ticketMedio, format: "eur2", delta: 0 },
      { id: "tickets", label: "Tickets", value: tickets, format: "int", delta: 0 },
      { id: "margen", label: "Margen mes", value: margenPct, format: "pct", delta: 0 },
      { id: "devolu", label: "Devoluciones", value: devolu, format: "eur", delta: 0, inverted: true },
    ];

    // ─────────────────────────────────────────────────────────────────────
    // Health
    // ─────────────────────────────────────────────────────────────────────
    const lastWatermark = lastWatermarkRow.rows[0][0] as string | null;
    const lastWatermarkDate = lastWatermark ? new Date(lastWatermark) : null;
    const syncAgeSec = lastWatermarkDate
      ? (Date.now() - lastWatermarkDate.getTime()) / 1000
      : Number.NaN;

    const lastEtlStatus = etlRunRow.rows.length > 0
      ? String(etlRunRow.rows[0][1])
      : "—";
    const lastEtlStarted = etlRunRow.rows.length > 0
      ? new Date(String(etlRunRow.rows[0][2]))
      : null;
    const lastEtlTimeFmt = new Intl.DateTimeFormat("es-ES", {
      timeZone: "Europe/Madrid",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const lastEtlLabel = lastEtlStarted
      ? `${lastEtlTimeFmt.format(lastEtlStarted)} · ${lastEtlStatus}`
      : "—";
    const totalRows = etlRunRow.rows.length > 0 ? num(etlRunRow.rows[0][4]) : 0;

    const health: HomeViewModel["health"] = {
      syncAge: fmtSyncAge(syncAgeSec),
      lastEtl: lastEtlLabel,
      anomalies: num(anomaliesRow.rows[0][0]),
      rows: totalRows,
    };

    const payload: HomeViewModel = {
      asOf: asOfHeader,
      asOfDate,
      maxAvailableDate,
      hero,
      periods,
      dailyTrend,
      topStores,
      opsRetail,
      health,
    };

    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to load home view model", details: message },
      { status: 500 },
    );
  }
}
