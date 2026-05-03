// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { EnumSelect, PROVIDER_OPTIONS } from "../EnumSelect";

describe("EnumSelect", () => {
  it("renders each option label", () => {
    render(
      <EnumSelect value="cli" onChange={() => {}} options={PROVIDER_OPTIONS} />,
    );
    expect(screen.getByText(/Claude Code CLI/)).toBeInTheDocument();
    expect(screen.getByText(/OpenRouter/)).toBeInTheDocument();
  });

  it("calls onChange with the selected value", () => {
    const onChange = vi.fn();
    render(
      <EnumSelect value="cli" onChange={onChange} options={PROVIDER_OPTIONS} />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "openrouter" } });
    expect(onChange).toHaveBeenCalledWith("openrouter");
  });
});
