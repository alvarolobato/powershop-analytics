// TODO(#454-followup): Replace this mock with real PostgreSQL aggregation.
// See issue: feat(home): replace /api/home mock with real PostgreSQL aggregation

import { NextResponse } from "next/server";
import type { HomeViewModel } from "@/lib/home-types";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Deterministic mock data (matches the spec values from issue #454 / design
// handoff). This will be replaced with real SQL aggregation in a follow-up.
// ---------------------------------------------------------------------------

const MOCK: HomeViewModel = {
  asOf: "lun 04 may · 11:42",
  hero: {
    todayValue: 38420,
    forecastEOD: 39800,
    todayPace: 0.062,
    vsYesterday: 0.082,
    vsLY: -0.114,
    yesterday: 35510,
    lastYear: 43370,
    status: "on-pace",
    hourly: [
      null, null, null, null, null, null, null, null,
      1200, 6500, 12200, 18420,
      null, null, null, null, null, null, null, null,
      null, null, null, null,
    ],
    hourlyYesterday: [
      0, 0, 0, 0, 0, 0, 0, 0,
      1100, 5900, 10800, 16800, 22500, 28200, 33100, 35200,
      35510, 35510, 35510, 35510, 35510, 35510, 35510, 35510,
    ],
  },
  periods: [
    {
      id: "hoy",
      label: "Hoy",
      value: 38420,
      deltaPrev: 0.082,
      prevLabel: "vs ayer",
      deltaYoY: -0.114,
      yoyLabel: "vs lun 5 may 2025",
      spark: [29200, 31100, 33800, 28900, 35510, 30200, 38420],
      sparkLabels: ["mar", "mié", "jue", "vie", "sáb", "dom", "hoy"],
    },
    {
      id: "semana",
      label: "Semana",
      value: 218400,
      deltaPrev: -0.043,
      prevLabel: "vs sem ant",
      deltaYoY: -0.092,
      yoyLabel: "vs sem 18 2025",
      spark: [195400, 210800, 228180, 232400, 205100, 218400],
      sparkLabels: ["s14", "s15", "s16", "s17", "s18", "s19"],
    },
    {
      id: "mes",
      label: "Mes",
      value: 134802,
      deltaPrev: -0.189,
      prevLabel: "vs abril",
      deltaYoY: -0.132,
      yoyLabel: "vs may 2025",
      spark: [142100, 148300, 159200, 166217, 134802],
      sparkLabels: ["ene", "feb", "mar", "abr", "may"],
    },
    {
      id: "anyo",
      label: "Año (YTD)",
      value: 1842600,
      deltaPrev: 0.034,
      prevLabel: "vs YTD 2025",
      deltaYoY: 0.034,
      yoyLabel: "vs 2025 mismo tramo",
      spark: [320100, 389200, 415300, 477200, 134802],
      sparkLabels: ["ene", "feb", "mar", "abr", "may"],
    },
  ],
  dailyTrend: (() => {
    const arr: HomeViewModel["dailyTrend"] = [];
    for (let i = 1; i <= 31; i++) {
      const base = 8000 + Math.sin(i / 3.5) * 1800 + (i < 5 ? 4000 : 0);
      const isWeekend = i % 7 === 0 || i % 7 === 6;
      const ly = base * (1.05 + Math.cos(i / 4) * 0.08) * (isWeekend ? 1.4 : 1);
      const actual = i <= 4 ? base * (isWeekend ? 1.5 : 1) * 0.92 : null;
      arr.push({ day: i, actual, ly });
    }
    return arr;
  })(),
  topStores: [
    { code: "611", name: "Madrid Serrano",      sales: 4920, delta:  0.082, spark: [3900,4100,4500,3800,4400,4300,4920], status: "ok" },
    { code: "622", name: "Barcelona Diagonal",  sales: 4180, delta:  0.041, spark: [3700,3900,4000,3850,4020,4100,4180], status: "ok" },
    { code: "608", name: "Valencia Colón",      sales: 3960, delta: -0.012, spark: [4000,4100,3950,4050,3900,4010,3960], status: "ok" },
    { code: "637", name: "Sevilla Nervión",     sales: 3740, delta:  0.024, spark: [3500,3650,3700,3550,3680,3620,3740], status: "ok" },
    { code: "606", name: "Bilbao Gran Vía",     sales: 3210, delta: -0.064, spark: [3450,3500,3380,3420,3300,3260,3210], status: "watch" },
    { code: "612", name: "Málaga Larios",       sales: 3080, delta:  0.018, spark: [2900,2950,3000,2920,3050,3010,3080], status: "ok" },
    { code: "601", name: "Zaragoza Independ.",  sales: 2820, delta: -0.142, spark: [3300,3250,3100,3000,2950,2880,2820], status: "alert" },
    { code: "645", name: "A Coruña Real",       sales: 2680, delta:  0.012, spark: [2600,2650,2620,2640,2660,2670,2680], status: "ok" },
    { code: "157", name: "Granada Recogidas",   sales: 2540, delta: -0.034, spark: [2700,2680,2620,2580,2570,2560,2540], status: "ok" },
    { code: "632", name: "Murcia Trapería",     sales: 2410, delta:  0.052, spark: [2200,2280,2320,2350,2380,2390,2410], status: "ok" },
  ],
  alerts: [
    { sev: "crit", store: "97 — Toledo Centro",       reason: "0€ ventas hoy · ayer 1.245€", expected: "Lun-Vie operativa", since: "hace 4h",   action: "Llamar tienda" },
    { sev: "crit", store: "804 — Outlet San Fernando", reason: "0€ ventas hoy · ayer 1.890€", expected: "L-D operativa",    since: "hace 4h",   action: "Llamar tienda" },
    { sev: "warn", store: "601 — Zaragoza Independ.",  reason: "Ventas −14,2% · margen 27,8%", expected: "Media red 61%",  since: "3 días",     action: "Revisar descuentos" },
    { sev: "warn", store: "606 — Bilbao Gran Vía",     reason: "Ventas −6,4% vs ayer",         expected: "Promedio +2%",   since: "hoy",        action: "Comparar familias" },
    { sev: "info", store: "159 — Vigo Príncipe",       reason: "Cerrada por reforma",           expected: "Reapertura 12 may", since: "hace 6 días", action: "Ignorar" },
  ],
  opsRetail: [
    { id: "ticket",  label: "Ticket medio",   value: 26.55,    format: "eur2", delta:  0.138 },
    { id: "tickets", label: "Tickets",        value: 5077,     format: "int",  delta: -0.287 },
    { id: "margen",  label: "Margen",         value: 0.612,    format: "pct",  delta: -0.012 },
    { id: "devolu",  label: "Devoluciones",   value: 12522.50, format: "eur",  delta:  0.083, inverted: true },
    { id: "conver",  label: "Conversión",     value: 0.184,    format: "pct",  delta:  0.006 },
  ],
  opsWholesale: [
    { id: "fact",  label: "Facturación",        value: 84200,   format: "eur", delta:  0.041 },
    { id: "pend",  label: "Pedidos pendientes", value: 47,      format: "int", delta:  0.064, sub: "€312k valor" },
    { id: "stock", label: "Valor stock",        value: 2228214, format: "eur", delta: -0.018 },
    { id: "rotac", label: "Rotación",           value: 4.2,     format: "x",   delta:  0.08,  suffix: "x/año" },
  ],
  health: {
    syncAge: "12 min",
    lastEtl: "11:30 · OK",
    anomalies: 2,
    rows: 1842600,
  },
};

export async function GET() {
  return NextResponse.json(MOCK);
}
