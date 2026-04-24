import { describe, it, expect } from "vitest";
import { interactionLineClass } from "@/lib/interaction-line-class";

describe("interactionLineClass", () => {
  it("returns blue mono class for tool_call", () => {
    expect(interactionLineClass("tool_call")).toContain("blue");
  });

  it("returns emerald class for tool_result", () => {
    expect(interactionLineClass("tool_result")).toContain("emerald");
  });

  it("returns red class for error", () => {
    expect(interactionLineClass("error")).toContain("red");
  });

  it("returns content class for assistant_text", () => {
    expect(interactionLineClass("assistant_text")).toContain("content");
  });

  it("returns italic class for phase", () => {
    expect(interactionLineClass("phase")).toContain("italic");
  });

  it("returns italic class for meta", () => {
    expect(interactionLineClass("meta")).toContain("italic");
  });

  it("returns italic class for undefined kind", () => {
    expect(interactionLineClass(undefined)).toContain("italic");
  });
});
