"use client";

/**
 * Shared body for the App Router's per-segment `error.tsx` boundaries.
 *
 * Before these existed, only /admin/config had a boundary: every other route
 * fell back to Next's bare, unstyled "Error 500" with nothing on screen to
 * report. This renders the failure through the app's own ErrorDisplay, so the
 * visitor gets the same surface (including "Detalles técnicos" and a copyable
 * reference) they already get for a failed API call.
 *
 * `error.digest` is Next's opaque server-side hash for the throw. It is the
 * only correlation handle available here — a client-side render throw never
 * reaches the server — so it is threaded into `requestId` to reuse
 * ErrorDisplay's existing copy affordance rather than inventing a second one.
 * When there is no digest the error came from the browser, and `client-render`
 * says so honestly instead of implying a server trace exists to go looking for.
 *
 * Note this makes failures legible, not observable: `console.error` here runs
 * in the visitor's browser. Shipping them to the operator needs a reporting
 * endpoint, deliberately out of scope for this change.
 */

import { useEffect } from "react";
import ErrorDisplay from "@/components/ErrorDisplay";
import type { ApiErrorResponse } from "@/lib/errors";

export interface RouteErrorProps {
  /** The error Next.js caught, with its optional server-side digest. */
  error: Error & { digest?: string };
  /** Next's retry callback — re-renders the segment. */
  reset: () => void;
  /** Route tag used in the browser console line, e.g. "/paneles". */
  scope: string;
  /** Heading shown above the error, in Spanish. */
  title: string;
  /** Fallback message when the throw carried none. */
  fallbackMessage: string;
}

export default function RouteError({
  error,
  reset,
  scope,
  title,
  fallbackMessage,
}: RouteErrorProps) {
  useEffect(() => {
    console.error(`[${scope}] Page error:`, error);
  }, [error, scope]);

  const structured: ApiErrorResponse = {
    error: error.message || fallbackMessage,
    code: "UNKNOWN",
    details: error.digest ? `digest: ${error.digest}` : undefined,
    timestamp: new Date().toISOString(),
    requestId: error.digest ?? "client-render",
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <ErrorDisplay error={structured} title={title} onRetry={reset} />
    </div>
  );
}
