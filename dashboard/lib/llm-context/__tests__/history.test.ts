/**
 * Unit tests for history flattening — including tool-result preservation across
 * turns (flattenStoredMessage / formatToolCallsForHistory).
 */

import { describe, it, expect } from "vitest";
import {
  flattenStoredMessage,
  formatToolCallsForHistory,
} from "../history";
import type { ToolCallRecord } from "@/lib/conversation-types";

describe("flattenStoredMessage", () => {
  it("extracts text from a user message object", () => {
    expect(flattenStoredMessage({ role: "user", content: { text: "hola" } })).toEqual({
      role: "user",
      content: "hola",
    });
  });

  it("extracts text from a plain-string content (legacy rows)", () => {
    expect(flattenStoredMessage({ role: "assistant", content: "respuesta" })).toEqual({
      role: "assistant",
      content: "respuesta",
    });
  });

  it("skips standalone tool-role rows (tool context lives on the assistant turn)", () => {
    expect(
      flattenStoredMessage({
        role: "tool",
        content: { tool_call_id: "c1", tool_name: "execute_query", content: "…" },
      }),
    ).toBeNull();
  });

  it("returns null for an empty assistant message", () => {
    expect(flattenStoredMessage({ role: "assistant", content: { text: "" } })).toBeNull();
  });

  it("folds the assistant's tool calls into the turn so results persist across turns", () => {
    const toolCalls: ToolCallRecord[] = [
      {
        id: "c1",
        name: "execute_query",
        arguments: { sql: "SELECT SUM(total) FROM ps_ventas WHERE fecha = CURRENT_DATE" },
        result: '{"rows":[{"sum":12345.67}]}',
        success: true,
      },
    ];
    const flat = flattenStoredMessage({
      role: "assistant",
      content: { text: "Ayer vendisteis 12.345,67 €.", tool_calls: toolCalls },
    });
    expect(flat).not.toBeNull();
    expect(flat!.role).toBe("assistant");
    // Tool block appears BEFORE the final text so the model sees what was queried.
    expect(flat!.content).toContain("execute_query");
    expect(flat!.content).toContain("SELECT SUM(total)");
    expect(flat!.content).toContain("12345.67");
    expect(flat!.content).toContain("Ayer vendisteis 12.345,67 €.");
    expect(flat!.content.indexOf("execute_query")).toBeLessThan(
      flat!.content.indexOf("Ayer vendisteis"),
    );
  });

  it("preserves tool context even when the assistant produced no final text", () => {
    const flat = flattenStoredMessage({
      role: "assistant",
      content: {
        tool_calls: [
          { id: "c1", name: "list_ps_tables", arguments: {}, result: "ps_ventas, ps_clientes", success: true },
        ],
      },
    });
    expect(flat).not.toBeNull();
    expect(flat!.content).toContain("list_ps_tables");
    expect(flat!.content).toContain("ps_ventas");
  });
});

describe("formatToolCallsForHistory", () => {
  it("returns empty string for no tool calls", () => {
    expect(formatToolCallsForHistory([])).toBe("");
  });

  it("marks failed tool calls", () => {
    const block = formatToolCallsForHistory([
      { id: "c1", name: "execute_query", arguments: { sql: "SELECT 1" }, result: "boom", success: false },
    ]);
    expect(block).toContain("[error]");
    expect(block).toContain("execute_query");
  });

  it("truncates very long tool results to keep only the interesting part", () => {
    const huge = "x".repeat(5000);
    const block = formatToolCallsForHistory([
      { id: "c1", name: "execute_query", arguments: {}, result: huge, success: true },
    ]);
    // Far smaller than the raw 5000-char result.
    expect(block.length).toBeLessThan(1200);
    expect(block).toContain("chars)");
  });
});
