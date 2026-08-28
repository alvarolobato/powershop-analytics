/**
 * Bridges the app's existing bare `console.*` call sites (118 of them,
 * no logger module) onto the OTel Logs API, without rewriting any of them.
 *
 * Design constraints (see docs/decisions/D-052-dashboard-otel-sdk.md):
 *  - Must never swallow or reorder console output — developers still need
 *    stdout locally and `docker logs` in prod. The original console method
 *    always runs first, synchronously, exactly as before.
 *  - Must never recurse or deadlock if the exporter itself logs. We never
 *    install a DiagConsoleLogger (see sdk.ts), so the OTel SDK's internal
 *    diagnostics don't feed back through console.*; a re-entrancy guard on
 *    top of that means even a bug elsewhere can't cause infinite recursion
 *    through this bridge specifically.
 *  - Must be bounded — the actual bounding (queue size, batch export) is the
 *    BatchLogRecordProcessor's job (sdk.ts); this module's only extra
 *    responsibility is to never throw and never block the console call.
 */

import { format } from "node:util";
import { SeverityNumber, type Logger } from "@opentelemetry/api-logs";

type ConsoleMethod = "debug" | "info" | "log" | "warn" | "error";

const SEVERITY_BY_METHOD: Record<ConsoleMethod, { number: SeverityNumber; text: string }> = {
  debug: { number: SeverityNumber.DEBUG, text: "DEBUG" },
  info: { number: SeverityNumber.INFO, text: "INFO" },
  log: { number: SeverityNumber.INFO, text: "INFO" },
  warn: { number: SeverityNumber.WARN, text: "WARN" },
  error: { number: SeverityNumber.ERROR, text: "ERROR" },
};

const METHODS = Object.keys(SEVERITY_BY_METHOD) as ConsoleMethod[];

interface BridgeState {
  originals: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>>;
  inBridge: boolean;
  installed: boolean;
}

const state: BridgeState = { originals: {}, inBridge: false, installed: false };

/**
 * Patch `console.{debug,info,log,warn,error}` to also emit an OTel log
 * record via `logger`. Idempotent — calling twice (e.g. Next.js dev-mode
 * hot reload re-running instrumentation.ts) is a no-op the second time.
 */
export function installConsoleBridge(logger: Logger): void {
  if (state.installed) return;

  for (const method of METHODS) {
    // Store the exact original function reference (no `.bind()`) so that
    // repeated install/uninstall cycles (dev-mode hot reload, tests) restore
    // the *same* identity each time instead of compounding an extra bound
    // wrapper layer on every cycle.
    const original = console[method];
    state.originals[method] = original;

    console[method] = (...args: unknown[]) => {
      // Always emit the real console output first and unconditionally —
      // this must happen regardless of what the bridge below does.
      original.apply(console, args);

      // Re-entrancy guard: if formatting/emitting itself ends up calling a
      // patched console method (directly, or transitively through logging
      // inside the OTel SDK/exporter), skip the bridge instead of recursing.
      if (state.inBridge) return;

      state.inBridge = true;
      try {
        const severity = SEVERITY_BY_METHOD[method];
        logger.emit({
          severityNumber: severity.number,
          severityText: severity.text,
          body: safeFormat(args),
          attributes: { "log.source": "console" },
        });
      } catch {
        // Fail-open: a logs-pipeline problem must never affect app behavior
        // or (via a thrown error) the console call the app actually made.
      } finally {
        state.inBridge = false;
      }
    };
  }

  state.installed = true;
}

/** Restore the original console methods. Used by tests. */
export function uninstallConsoleBridge(): void {
  for (const method of METHODS) {
    const original = state.originals[method];
    if (original) console[method] = original;
  }
  state.originals = {};
  state.installed = false;
  state.inBridge = false;
}

function safeFormat(args: unknown[]): string {
  try {
    return format(...args);
  } catch {
    return "[console-bridge] unformattable log arguments";
  }
}
