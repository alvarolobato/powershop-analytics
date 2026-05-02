// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import InicioPage from "../inicio/page";
import type { HomeViewModel } from "@/lib/home-types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({}),
  usePathname: () => "/inicio",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    style,
    "aria-label": ariaLabel,
  }: {
    href: string;
    children: React.ReactNode;
    style?: React.CSSProperties;
    "aria-label"?: string;
  }) => (
    <a href={href} style={style} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Mock HomeViewModel fixture
// ---------------------------------------------------------------------------

const MOCK_DATA: HomeViewModel = {
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
    hourly: [null, null, null, null, null, null, null, null, 1200, 6500, 12200, 18420, null, null, null, null, null, null, null, null, null, null, null, null],
    hourlyYesterday: [0, 0, 0, 0, 0, 0, 0, 0, 1100, 5900, 10800, 16800, 22500, 28200, 33100, 35200, 35510, 35510, 35510, 35510, 35510, 35510, 35510, 35510],
  },
  periods: [
    { id: "hoy",    label: "Hoy",       value: 38420,   deltaPrev: 0.082,  prevLabel: "vs ayer",    deltaYoY: -0.114, yoyLabel: "vs lun 5 may 2025", spark: [1, 2, 3], sparkLabels: ["a"] },
    { id: "semana", label: "Semana",    value: 218400,  deltaPrev: -0.043, prevLabel: "vs sem ant", deltaYoY: -0.092, yoyLabel: "vs sem 18 2025",    spark: [1, 2, 3], sparkLabels: ["a"] },
    { id: "mes",    label: "Mes",       value: 134802,  deltaPrev: -0.189, prevLabel: "vs abril",   deltaYoY: -0.132, yoyLabel: "vs may 2025",       spark: [1, 2, 3], sparkLabels: ["a"] },
    { id: "anyo",   label: "Año (YTD)", value: 1842600, deltaPrev: 0.034,  prevLabel: "vs YTD",     deltaYoY: 0.034,  yoyLabel: "vs 2025",           spark: [1, 2, 3], sparkLabels: ["a"] },
  ],
  dailyTrend: [{ day: 1, actual: 8000, ly: 8500 }, { day: 2, actual: null, ly: 9000 }],
  topStores: [
    { code: "611", name: "Madrid Serrano", sales: 4920, delta: 0.082, spark: [1, 2, 3], status: "ok" },
    { code: "622", name: "Barcelona Diagonal", sales: 4180, delta: 0.041, spark: [1, 2, 3], status: "ok" },
    { code: "608", name: "Valencia Colón", sales: 3960, delta: -0.012, spark: [1, 2, 3], status: "ok" },
    { code: "637", name: "Sevilla Nervión", sales: 3740, delta: 0.024, spark: [1, 2, 3], status: "ok" },
    { code: "606", name: "Bilbao Gran Vía", sales: 3210, delta: -0.064, spark: [1, 2, 3], status: "watch" },
    { code: "612", name: "Málaga Larios", sales: 3080, delta: 0.018, spark: [1, 2, 3], status: "ok" },
    { code: "601", name: "Zaragoza Independ.", sales: 2820, delta: -0.142, spark: [1, 2, 3], status: "alert" },
    { code: "645", name: "A Coruña Real", sales: 2680, delta: 0.012, spark: [1, 2, 3], status: "ok" },
    { code: "157", name: "Granada Recogidas", sales: 2540, delta: -0.034, spark: [1, 2, 3], status: "ok" },
    { code: "632", name: "Murcia Trapería", sales: 2410, delta: 0.052, spark: [1, 2, 3], status: "ok" },
  ],
  alerts: [
    { sev: "crit", store: "97 — Toledo Centro", reason: "0€ ventas hoy", expected: "Lun-Vie", since: "hace 4h", action: "Llamar tienda" },
  ],
  opsRetail: [
    { id: "ticket", label: "Ticket medio", value: 26.55, format: "eur2", delta: 0.138 },
  ],
  opsWholesale: [
    { id: "fact", label: "Facturación", value: 84200, format: "eur", delta: 0.041 },
  ],
  health: { syncAge: "12 min", lastEtl: "11:30 · OK", anomalies: 2, rows: 1842600 },
};

function mockFetch(data: HomeViewModel, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(data),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InicioPage", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders the page container", () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<InicioPage />);
    expect(screen.getByTestId("inicio-page")).toBeInTheDocument();
  });

  it("shows the page header with H1 greeting", () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<InicioPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /Hola.*— esto es lo que pasa hoy/,
    );
  });

  it("shows the refresh button", () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<InicioPage />);
    expect(screen.getByTestId("refresh-btn")).toBeInTheDocument();
  });

  it("shows EN VIVO chip", () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<InicioPage />);
    expect(screen.getByText("EN VIVO")).toBeInTheDocument();
  });

  it("renders hero section after data loads", async () => {
    globalThis.fetch = mockFetch(MOCK_DATA);
    render(<InicioPage />);
    await waitFor(() => {
      expect(screen.getByTestId("hero-today")).toBeInTheDocument();
    });
  });

  it("renders period grid after data loads", async () => {
    globalThis.fetch = mockFetch(MOCK_DATA);
    render(<InicioPage />);
    await waitFor(() => {
      expect(screen.getByTestId("period-grid")).toBeInTheDocument();
    });
  });

  it("renders alerts panel after data loads", async () => {
    globalThis.fetch = mockFetch(MOCK_DATA);
    render(<InicioPage />);
    await waitFor(() => {
      expect(screen.getByTestId("alerts-panel")).toBeInTheDocument();
    });
  });

  it("renders daily trend chart after data loads", async () => {
    globalThis.fetch = mockFetch(MOCK_DATA);
    render(<InicioPage />);
    await waitFor(() => {
      expect(screen.getByTestId("daily-trend-chart")).toBeInTheDocument();
    });
  });

  it("renders operations retail section after data loads", async () => {
    globalThis.fetch = mockFetch(MOCK_DATA);
    render(<InicioPage />);
    await waitFor(() => {
      expect(screen.getByTestId("operations-row-retail")).toBeInTheDocument();
    });
  });

  it("renders top stores table after data loads", async () => {
    globalThis.fetch = mockFetch(MOCK_DATA);
    render(<InicioPage />);
    await waitFor(() => {
      expect(screen.getByTestId("top-stores-table")).toBeInTheDocument();
    });
  });

  it("renders health footer after data loads", async () => {
    globalThis.fetch = mockFetch(MOCK_DATA);
    render(<InicioPage />);
    await waitFor(() => {
      expect(screen.getByTestId("health-footer")).toBeInTheDocument();
    });
  });

  it("does NOT render chat sidebar", async () => {
    globalThis.fetch = mockFetch(MOCK_DATA);
    render(<InicioPage />);
    await waitFor(() => {
      expect(screen.getByTestId("hero-today")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("chat-sidebar")).not.toBeInTheDocument();
  });

  it("does NOT render save button", async () => {
    globalThis.fetch = mockFetch(MOCK_DATA);
    render(<InicioPage />);
    await waitFor(() => {
      expect(screen.getByTestId("hero-today")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /guardar/i })).not.toBeInTheDocument();
  });
});
