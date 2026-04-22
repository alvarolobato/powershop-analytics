/**
 * OpenAI-format tool definitions for OpenRouter chat.completions.
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const DASHBOARD_AGENTIC_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "validate_query",
      description:
        "Validate a read-only SQL string: syntax policy, optional cost estimate (EXPLAIN), and static SQL lint hints. Does not return row data.",
      parameters: {
        type: "object",
        properties: {
          sql: { type: "string", description: "Single SELECT/WITH/EXPLAIN statement, no semicolons." },
        },
        required: ["sql"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "execute_query",
      description:
        "Execute a read-only SELECT/WITH against the PostgreSQL mirror. Results are capped (rows/columns/chars).",
      parameters: {
        type: "object",
        properties: {
          sql: { type: "string", description: "Single SELECT or WITH query only." },
        },
        required: ["sql"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explain_query",
      description:
        "Return PostgreSQL JSON plan for EXPLAIN (FORMAT JSON) without ANALYZE (does not execute the query).",
      parameters: {
        type: "object",
        properties: {
          sql: { type: "string", description: "Single SELECT or WITH query only." },
        },
        required: ["sql"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_ps_tables",
      description: "List public mirror tables whose names start with ps_.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "describe_ps_table",
      description: "Describe columns for a single ps_* table (information_schema).",
      parameters: {
        type: "object",
        properties: {
          table: { type: "string", description: "Table name including ps_ prefix." },
        },
        required: ["table"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dashboards",
      description: "List saved dashboards (id, name, short description, updated_at).",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows (default 30, max 100)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_dashboard_spec",
      description: "Load the JSON spec for a saved dashboard by numeric id.",
      parameters: {
        type: "object",
        properties: {
          dashboard_id: { type: "integer" },
        },
        required: ["dashboard_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_dashboard_queries",
      description:
        "List all SQL strings embedded in a saved dashboard (widget paths, labels, sql text).",
      parameters: {
        type: "object",
        properties: {
          dashboard_id: { type: "integer" },
        },
        required: ["dashboard_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_dashboard_widget_raw_values",
      description:
        "Execute the primary SQL for one widget of a saved dashboard. For kpi_row pass kpi_item_index. Date tokens (:curr_from, etc.) are substituted from optional date_range (ISO YYYY-MM-DD) or default last 30 days UTC.",
      parameters: {
        type: "object",
        properties: {
          dashboard_id: { type: "integer" },
          widget_index: { type: "integer", description: "0-based index in spec.widgets" },
          kpi_item_index: {
            type: "integer",
            description: "Required for kpi_row primary sql; 0-based item index.",
          },
          date_range: {
            type: "object",
            properties: {
              curr_from: { type: "string" },
              curr_to: { type: "string" },
              comp_from: { type: "string" },
              comp_to: { type: "string" },
            },
          },
        },
        required: ["dashboard_id", "widget_index"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_dashboard_all_widget_status",
      description:
        "Run read-only validation + cost check + SQL lint on every SQL string in a saved dashboard; does not execute full queries.",
      parameters: {
        type: "object",
        properties: {
          dashboard_id: { type: "integer" },
        },
        required: ["dashboard_id"],
      },
    },
  },
];
