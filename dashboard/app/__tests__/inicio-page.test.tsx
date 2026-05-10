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
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
  usePathname: () => "/inicio",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/WeeklySummaryButton", () => ({
  default: () => <button data-testid="weekly-summary-btn">✦ Resumen semanal</button>,
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
  asOfDate: "2026-05-04",
  maxAvailableDate: "2026-05-04",
  hero: {
    todayValue: 38420,
    forecastEOD: 38420,
    todayPace: 0,
    vsYesterday: 0.082,
    vsLY: -0.114,
    yesterday: 35510,
    lastYear: 43370,
    comparisonCutoffHour: null,
    yesterdayCutoff: null,
    lastYearCutoff: null,
    status: "on-pace",
    // Empty arrays — mirror has only date granularity (no time-of-day).
    hourly: [],
    hourlyComparison: [],
    comparisonLabel: "Lunes anterior",
  },
  periods: [
    { id: "hoy",    label: "Hoy",       value: 38420,   deltaPrev: 0.082,  prevLabel: "vs ayer",    deltaYoY: -0.114, yoyLabel: "vs lun 5 may 2025", spark: [1, 2, 3], sparkLabels: ["a"] },
    { id: "semana", label: "Semana",    value: 218400,  deltaPrev: -0.043, prevLabel: "vs sem ant", deltaYoY: -0.092, yoyLabel: "vs sem 18 2025",    spark: [1, 2, 3], sparkLabels: ["a"] },
    { id: "mes",    label: "Mes",       value: 134802,  deltaPrev: -0.189, prevLabel: "vs abril",   deltaYoY: -0.132, yoyLabel: "vs may 2025",       spark: [1, 2, 3], sparkLabels: ["a"] },
    { id: "anyo",   label: "Año (YTD)", value: 1842600, deltaPrev: 0.034,  prevLabel: "vs YTD",     deltaYoY: 0.034,  yoyLabel: "vs 2025",           spark: [1, 2, 3], sparkLabels: ["a"] },
  ],
  dailyTrend: [{ day: 1, actual: 8000, ly: 8500 }, { day: 2, actual: null, ly: 9000 }],
  topStores: [
    { code: "611", name: "Valencia Alcantara", sales: 4920, delta: 0.082, spark: [1, 2, 3], status: "ok" },
    { code: "608", name: "Montijo", sales: 3960, delta: -0.012, spark: [1, 2, 3], status: "ok" },
    { code: "601", name: "Badajoz", sales: 2820, delta: -0.142, spark: [1, 2, 3], status: "alert" },
  ],
  inactiveStores: [],
  opsRetail: [
    { id: "ticket", label: "Ticket medio", value: 26.55, format: "eur2", delta: 0 },
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

  it("shows the weekly summary button in the page header", () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<InicioPage />);
    expect(screen.getByTestId("weekly-summary-btn")).toBeInTheDocument();
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

  it("does NOT render the alerts panel (removed in retail-only redesign)", async () => {
    globalThis.fetch = mockFetch(MOCK_DATA);
    render(<InicioPage />);
    await waitFor(() => {
      expect(screen.getByTestId("daily-trend-chart")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("alerts-panel")).not.toBeInTheDocument();
  });

  it("does NOT render the wholesale operations row", async () => {
    globalThis.fetch = mockFetch(MOCK_DATA);
    render(<InicioPage />);
    await waitFor(() => {
      expect(screen.getByTestId("operations-row-retail")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("operations-row-mayorista")).not.toBeInTheDocument();
  });

  it("renders the date navigator with the as-of date", async () => {
    globalThis.fetch = mockFetch(MOCK_DATA);
    render(<InicioPage />);
    await waitFor(() => {
      expect(screen.getByTestId("date-navigator")).toBeInTheDocument();
    });
    expect(screen.getByTestId("date-input")).toHaveValue("2026-05-04");
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

  it("renders the WeeklySummaryButton in the page header", () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<InicioPage />);
    expect(screen.getByTestId("weekly-summary-btn")).toBeInTheDocument();
    expect(screen.getByTestId("weekly-summary-btn")).toHaveTextContent("Resumen semanal");
  });
});
