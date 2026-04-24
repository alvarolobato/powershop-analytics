// Realistic retail dashboard data mirroring Powershop's "Ventas Retail" panel.
// Numbers are consistent with the real screenshots (€134.802,42 netos, 5.077 tickets, etc.)

const SALES_KPIS = [
  {
    id: "netas",
    label: "Ventas Netas",
    value: 134802.42,
    format: "eur",
    delta: -0.189,
    comparison: 166217.09,
    spark: [7100, 6400, 8900, 7200, 5100, 6800, 4200, 5400, 3900, 4100, 5200, 4800, 5100, 3400],
    anomaly: true,
  },
  {
    id: "tickets",
    label: "Tickets",
    value: 5077,
    format: "int",
    delta: -0.287,
    comparison: 7119,
    spark: [280, 300, 320, 410, 280, 360, 220, 310, 180, 200, 260, 240, 260, 180],
    anomaly: true,
  },
  {
    id: "ticket-medio",
    label: "Ticket Medio",
    value: 26.55,
    format: "eur",
    delta: 0.138,
    comparison: 23.33,
    spark: [22, 23, 24, 22, 26, 24, 27, 25, 28, 27, 25, 26, 26, 27],
  },
  {
    id: "devoluciones",
    label: "Devoluciones",
    value: 12522.50,
    format: "eur",
    delta: 0.083,
    comparison: 11563.21,
    spark: [900, 820, 700, 1100, 950, 840, 1080, 920, 990, 1020, 880, 1050, 1120, 960],
    warn: true,
    inverted: true,
  },
];

const SALES_BY_STORE = [
  { store: "611", value: 10492, flag: "top" },
  { store: "622", value: 9180 },
  { store: "608", value: 9090 },
  { store: "637", value: 8995 },
  { store: "606", value: 8520 },
  { store: "612", value: 8100 },
  { store: "601", value: 7160 },
  { store: "645", value: 6940 },
  { store: "157", value: 6710 },
  { store: "632", value: 6520 },
  { store: "623", value: 6360 },
  { store: "644", value: 6180 },
  { store: "636", value: 6100 },
  { store: "602", value: 6080 },
  { store: "641", value: 5880 },
  { store: "153", value: 5220 },
  { store: "154", value: 4740 },
  { store: "159", value: 4120 },
  { store: "804", value: 3640 },
  { store: "97",  value: 3480, flag: "low" },
];

// Weekly trend — sharp dip matches the -18.9% KPI drop
const WEEKLY_TREND = [
  { date: "30 mar", actual: 14014, previous: 15230 },
  { date: "01 abr", actual: 18220, previous: 17140 },
  { date: "03 abr", actual: 22100, previous: 21880 },
  { date: "05 abr", actual: 26800, previous: 28500 },
  { date: "07 abr", actual: 30100, previous: 36200 },
  { date: "09 abr", actual: 34200, previous: 42100 },
  { date: "11 abr", actual: 38100, previous: 48900 },
  { date: "13 abr", actual: 42100, previous: 52100 },
  { date: "15 abr", actual: 38400, previous: 50800 },
  { date: "17 abr", actual: 30900, previous: 45300 },
  { date: "19 abr", actual: 22400, previous: 38100 },
  { date: "21 abr", actual: 16200, previous: 31400 },
];

const PAYMENT_MIX = [
  { label: "Tarjeta", value: 62.4, color: "var(--accent)" },
  { label: "Efectivo", value: 18.1, color: "var(--accent-2)" },
  { label: "Bizum",    value: 11.3, color: "#f59e0b" },
  { label: "Financ.",  value: 5.2,  color: "#ec4899" },
  { label: "Vale",     value: 3.0,  color: "#34d399" },
];

const MARGIN_BY_STORE = [
  { store: "159", pct: 85.2 }, { store: "97", pct: 72.4 }, { store: "804", pct: 69.1 },
  { store: "641", pct: 66.8 }, { store: "632", pct: 65.2 }, { store: "645", pct: 64.3 },
  { store: "612", pct: 63.1 }, { store: "602", pct: 62.4 }, { store: "154", pct: 61.8 },
  { store: "636", pct: 61.2 }, { store: "611", pct: 60.7 }, { store: "153", pct: 60.1 },
  { store: "157", pct: 59.6 }, { store: "642", pct: 58.8 }, { store: "606", pct: 58.2 },
  { store: "608", pct: 57.4 }, { store: "623", pct: 56.9 }, { store: "637", pct: 55.3 },
  { store: "622", pct: 52.1 }, { store: "601", pct: 27.8, flag: "low" },
];

const TOP_ARTICLES = [
  { ref: "V26100765", desc: "AMERICANA 2 BUTTONS",         family: "AMERICANA", units: 40, net: 1641.46, margin: 58.6 },
  { ref: "V26200812", desc: "JERSEY C/LAZOS EN MANGAS",    family: "PUNTO",     units: 37, net: 1488.22, margin: 62.1 },
  { ref: "V26100221", desc: "PANTALON SARJA 5 BOLSILLOS",  family: "PANTALON",  units: 34, net: 1402.80, margin: 54.3 },
  { ref: "V26100402", desc: "BLUSA DOBLE RAYA",            family: "BLUSA",     units: 31, net: 1288.15, margin: 66.4 },
  { ref: "V26200105", desc: "VESTIDO M/CORTA C/COLLAR",    family: "VESTIDO",   units: 29, net: 1201.00, margin: 60.2 },
  { ref: "V26100660", desc: "BUFANDA ESTAMPADA",           family: "ACCESORIOS",units: 28, net: 1122.34, margin: 71.8 },
  { ref: "V26100744", desc: "ABRIGO REVERSIBLE PELO LISO", family: "ABRIGO",    units: 24, net: 1084.90, margin: 48.2 },
  { ref: "V26200311", desc: "CAMISETA ESTAMPADA MOTOS",    family: "CAMISETA",  units: 22, net: 902.15,  margin: 63.5 },
];

const INSIGHTS = [
  { kind: "down",  title: "Tickets cayeron 28,7%", body: "Mayor caída en tiendas 804, 159, 97 — coincide con Semana Santa fuera de calendario este año." },
  { kind: "up",    title: "Ticket medio +13,8%",   body: "Subida del ticket compensa parcialmente la caída de afluencia. AMERICANA y ABRIGO lideran." },
  { kind: "warn",  title: "Margen 601 en alerta",  body: "27,8% vs media 61,5%. Revisar descuentos aplicados en PANTALON." },
];

window.DATA = {
  SALES_KPIS, SALES_BY_STORE, WEEKLY_TREND, PAYMENT_MIX, MARGIN_BY_STORE, TOP_ARTICLES, INSIGHTS,
};
