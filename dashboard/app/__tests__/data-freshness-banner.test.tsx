// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DataFreshnessBanner } from "@/components/DataFreshnessBanner";
import type { DataHealthResponse } from "@/app/api/data-health/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FRESH_RESPONSE: DataHealthResponse = {
  tables: [
    {
      name: "ps_ventas",
      lastSync: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      isStale: false,
    },
  ],
  overallStale: false,
  stalestTable: null,
};

const STALE_RESPONSE: DataHealthResponse = {
  tables: [
    {
      name: "ps_ventas",
      lastSync: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      isStale: true,
    },
  ],
  overallStale: true,
  stalestTable: {
    name: "ps_ventas",
    lastSync: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
  },
};

function mockFetchWith(data: DataHealthResponse | null, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(ok ? data : { error: "Server error" }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DataFreshnessBanner", () => {
  const originalFetch = globalThis.fetch;
  const originalSessionStorage = globalThis.sessionStorage;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Clear sessionStorage mock between tests
    const store: Record<string, string> = {};
    Object.defineProperty(globalThis, "sessionStorage", {
      value: {
        getItem: vi.fn((key: string) => store[key] ?? null),
        setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
        removeItem: vi.fn((key: string) => { delete store[key]; }),
        clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
      },
      writable: true,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "sessionStorage", {
      value: originalSessionStorage,
      writable: true,
    });
  });

  it("does not render banner when data is fresh", async () => {
    globalThis.fetch = mockFetchWith(FRESH_RESPONSE);
    render(<DataFreshnessBanner />);

    await waitFor(() => {
      expect(screen.queryByTestId("data-freshness-banner")).not.toBeInTheDocument();
    });
  });

  it("renders banner when data is stale", async () => {
    globalThis.fetch = mockFetchWith(STALE_RESPONSE);
    render(<DataFreshnessBanner />);

    await waitFor(() => {
      expect(screen.getByTestId("data-freshness-banner")).toBeInTheDocument();
    });
    // ps_ventas appears in both the main message and the detail list
    expect(screen.getAllByText(/ps_ventas/).length).toBeGreaterThan(0);
  });

  it("does not render banner on API error (graceful fallback)", async () => {
    globalThis.fetch = mockFetchWith(null, false);
    render(<DataFreshnessBanner />);

    await waitFor(() => {
      // Banner should not appear
      expect(screen.queryByTestId("data-freshness-banner")).not.toBeInTheDocument();
    });
  });

  it("does not render banner when fetch throws", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    render(<DataFreshnessBanner />);

    await waitFor(() => {
      expect(screen.queryByTestId("data-freshness-banner")).not.toBeInTheDocument();
    });
  });

  it("dismisses banner when X button is clicked", async () => {
    globalThis.fetch = mockFetchWith(STALE_RESPONSE);
    render(<DataFreshnessBanner />);

    await waitFor(() => {
      expect(screen.getByTestId("data-freshness-banner")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("banner-dismiss"));

    expect(screen.queryByTestId("data-freshness-banner")).not.toBeInTheDocument();
    expect(globalThis.sessionStorage.setItem).toHaveBeenCalledWith(
      "data-health-dismissed",
      "1"
    );
  });

  it("does not show banner and skips fetch when sessionStorage has dismiss flag", async () => {
    // Pre-set dismissed flag
    (globalThis.sessionStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue("1");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    render(<DataFreshnessBanner />);

    await waitFor(() => {
      // Even with stale data, banner should not show
      expect(screen.queryByTestId("data-freshness-banner")).not.toBeInTheDocument();
    });
    // Fetch should not be called when already dismissed
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts fetch on unmount", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");

    // Keep the fetch pending so the component is still waiting when we unmount
    let resolveFetch!: () => void;
    globalThis.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = () =>
            resolve({ ok: true, json: () => Promise.resolve(FRESH_RESPONSE) } as Response);
        })
    );

    const { unmount } = render(<DataFreshnessBanner />);

    // Wait for the effect to start (fetch called) before unmounting
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    unmount();

    expect(abortSpy).toHaveBeenCalled();

    // Resolve after unmount to avoid unhandled-rejection noise
    resolveFetch();
  });

  it("collapses and expands the detail list", async () => {
    globalThis.fetch = mockFetchWith(STALE_RESPONSE);
    render(<DataFreshnessBanner />);

    await waitFor(() => {
      expect(screen.getByTestId("data-freshness-banner")).toBeInTheDocument();
    });

    // ps_ventas detail should be visible initially
    expect(screen.getAllByText(/ps_ventas/).length).toBeGreaterThan(0);

    // Collapse
    fireEvent.click(screen.getByTestId("banner-collapse-toggle"));

    // After collapse, the detail list should be hidden
    // The main message still shows ps_ventas, but the detail <li> should be gone
    const items = screen.queryAllByRole("listitem");
    expect(items).toHaveLength(0);

    // Expand again
    fireEvent.click(screen.getByTestId("banner-collapse-toggle"));
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });
});
