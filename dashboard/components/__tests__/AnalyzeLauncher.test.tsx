// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import AnalyzeLauncher from "../AnalyzeLauncher";

beforeEach(() => {
  mockPush.mockReset();
  vi.resetAllMocks();
});

describe("AnalyzeLauncher", () => {
  it("renders the launch button", () => {
    render(<AnalyzeLauncher />);
    expect(screen.getByTestId("analyze-launcher")).toBeInTheDocument();
  });

  it("returns null when hidden=true", () => {
    const { container } = render(<AnalyzeLauncher hidden />);
    expect(container.firstChild).toBeNull();
  });

  it("navigates to k_url after successful conversation creation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ k_url: "/k/conv-123" }),
    }));

    render(<AnalyzeLauncher dashboardId={42} />);
    fireEvent.click(screen.getByTestId("analyze-launcher"));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/k/conv-123");
    });
  });

  it("logs error when conversation creation fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));

    render(<AnalyzeLauncher dashboardId={42} />);
    fireEvent.click(screen.getByTestId("analyze-launcher"));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });
    consoleSpy.mockRestore();
  });
});
