/**
 * Shared types for widget components.
 */

/** Query result format returned by the /api/query endpoint. */
export interface WidgetData {
  columns: string[];
  rows: unknown[][];
}

/** Standard empty-state message. */
export const EMPTY_MESSAGE = "Sin datos";
