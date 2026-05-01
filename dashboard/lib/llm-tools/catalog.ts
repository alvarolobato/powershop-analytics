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
      name: "validate_dashboard_spec",
      description:
        "Validate a candidate dashboard JSON spec before emitting it as the final answer. Runs Zod structural validation and SQL heuristic lint on every widget. Returns { ok, errors[], warnings[], hint }. Call this on every generate/modify task and only emit the final JSON when ok=true.",
      parameters: {
        type: "object",
        properties: {
          spec: {
            type: "object",
            description:
              "Candidate dashboard spec (the same JSON you would emit as the final answer).",
            additionalProperties: true,
          },
        },
        required: ["spec"],
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
  {
    type: "function",
    function: {
      name: "apply_dashboard_modification",
      description:
        "Call this tool EXACTLY ONCE at the end of a dashboard modification task, after validate_dashboard_spec returns ok=true. " +
        "Pass the fully updated dashboard spec and a 2–4 sentence Spanish change_summary describing what you changed. " +
        "The tool stages the spec in a request-scoped side-channel; the route persists it after you return. " +
        "After this tool returns { ok: true, applied: true }, write your final assistant message as a friendly Spanish reply to the user (≤ 4 sentences) describing the change. " +
        "NEVER emit the JSON spec as your final answer — it MUST go through this tool.",
      parameters: {
        type: "object",
        properties: {
          spec: {
            type: "object",
            description: "The fully updated dashboard spec (byte-for-byte the same object that validate_dashboard_spec just approved with ok=true).",
            additionalProperties: true,
          },
          change_summary: {
            type: "string",
            description: "2–4 sentences in Spanish summarising what you changed in the dashboard. Max 1000 characters.",
          },
        },
        required: ["spec", "change_summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_dashboard_analysis",
      description:
        "Call this tool EXACTLY ONCE at the end of a dashboard analysis task. " +
        "Pass the full markdown analysis body and a brief_summary (≤ 500 chars, Spanish). " +
        "The tool stages the analysis; the route persists it. " +
        "After this tool returns { ok: true, applied: true }, write your final assistant message as a friendly Spanish chat reply to the user (≤ 4 sentences). " +
        "NEVER emit the analysis markdown as your final answer — it MUST go through this tool.",
      parameters: {
        type: "object",
        properties: {
          analysis_markdown: {
            type: "string",
            description: "The full analysis in markdown format (Spanish). Max 30 KB.",
          },
          brief_summary: {
            type: "string",
            description: "1–2 sentences in Spanish summarising the key finding. Max 500 characters.",
          },
        },
        required: ["analysis_markdown", "brief_summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_weekly_review",
      description:
        "Call this tool EXACTLY ONCE at the end of a weekly review generation task. " +
        "Pass the complete review JSON object (matching ReviewLlmOutputSchema) and a brief_summary (≤ 500 chars, Spanish). " +
        "The tool validates the review, stages it in a request-scoped side-channel, and the route persists it. " +
        "After this tool returns { ok: true, applied: true }, write your final assistant message as a friendly Spanish reply to the user (≤ 4 sentences) describing the key conclusions. " +
        "NEVER emit the review JSON as your final answer — it MUST go through this tool.",
      parameters: {
        type: "object",
        properties: {
          review: {
            type: "object",
            description: "The complete weekly review JSON object matching the ReviewLlmOutputSchema.",
            additionalProperties: true,
          },
          brief_summary: {
            type: "string",
            description: "1–2 sentences in Spanish summarising the key conclusions. Max 500 characters.",
          },
        },
        required: ["review", "brief_summary"],
      },
    },
  },
];
