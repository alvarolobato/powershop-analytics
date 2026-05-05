// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TopStoresTable } from "../TopStoresTable";
import type { HomeViewModel } from "@/lib/home-types";

const STORES: HomeViewModel["topStores"] = [
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
];

describe("TopStoresTable", () => {
  it("renders all 10 store rows", () => {
    render(<TopStoresTable stores={STORES} />);
    expect(screen.getByTestId("top-stores-table")).toBeInTheDocument();
    STORES.forEach((s) => {
      expect(screen.getByTestId(`store-row-${s.code}`)).toBeInTheDocument();
    });
  });

  it("renders store names", () => {
    render(<TopStoresTable stores={STORES} />);
    expect(screen.getByText("Madrid Serrano")).toBeInTheDocument();
    expect(screen.getByText("Murcia Trapería")).toBeInTheDocument();
  });

  it("renders store codes with accent color", () => {
    render(<TopStoresTable stores={STORES} />);
    expect(screen.getByText("611")).toBeInTheDocument();
    expect(screen.getByText("601")).toBeInTheDocument();
  });

  it("renders heat bars for all stores", () => {
    render(<TopStoresTable stores={STORES} />);
    STORES.forEach((s) => {
      expect(screen.getByTestId(`heat-bar-${s.code}`)).toBeInTheDocument();
    });
  });

  it("heat bar width is proportional to sales (max store has widest)", () => {
    render(<TopStoresTable stores={STORES} />);
    const maxStore = STORES[0]; // Madrid Serrano with 4920 is first
    const maxHeatBar = screen.getByTestId(`heat-bar-${maxStore.code}`);
    const style = maxHeatBar.getAttribute("style") ?? "";
    // Width should be the largest: 100 * 0.7 = 70px
    expect(style).toContain("70");
  });

  it("renders sequential rank numbers", () => {
    render(<TopStoresTable stores={STORES} />);
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("shows status dot color for 'alert' store (red)", () => {
    render(<TopStoresTable stores={STORES} />);
    const row = screen.getByTestId("store-row-601");
    const dot = row.querySelector('[title="Estado: alert"]');
    expect(dot?.getAttribute("style")).toContain("var(--down)");
  });

  it("shows status dot color for 'watch' store (yellow)", () => {
    render(<TopStoresTable stores={STORES} />);
    const row = screen.getByTestId("store-row-606");
    const dot = row.querySelector('[title="Estado: watch"]');
    expect(dot?.getAttribute("style")).toContain("var(--warn)");
  });

  describe("inactive stores section", () => {
    const INACTIVE: HomeViewModel["inactiveStores"] = [
      { code: "104", name: "Funchal", lastSaleDate: "2020-09-30" },
      { code: "152", name: "Lisboa antigua", lastSaleDate: "2016-12-31" },
    ];

    it("does NOT render the toggle when there are no inactive stores", () => {
      render(<TopStoresTable stores={STORES} inactiveStores={[]} />);
      expect(screen.queryByTestId("inactive-stores-section")).not.toBeInTheDocument();
    });

    it("renders the 'Ver tiendas inactivas' toggle when there are inactive stores", () => {
      render(<TopStoresTable stores={STORES} inactiveStores={INACTIVE} />);
      expect(screen.getByTestId("inactive-stores-section")).toBeInTheDocument();
      expect(screen.getByText(/Ver tiendas inactivas \(2\)/)).toBeInTheDocument();
    });

    it("inactive list is collapsed initially", () => {
      render(<TopStoresTable stores={STORES} inactiveStores={INACTIVE} />);
      expect(screen.queryByText("Funchal")).not.toBeInTheDocument();
    });

    it("expands the list on toggle click and shows last sale date", () => {
      render(<TopStoresTable stores={STORES} inactiveStores={INACTIVE} />);
      fireEvent.click(screen.getByText(/Ver tiendas inactivas/));
      expect(screen.getByText("Funchal")).toBeInTheDocument();
      expect(screen.getByText(/últ. 2020-09-30/)).toBeInTheDocument();
    });
  });
});
