---
id: D-046
title: CLI calls run lean by default, and one switch stops every LLM call
date: 2026-08-28
---

# D-046: CLI calls run lean by default, and one switch stops every LLM call

*Decided: 2026-08-28*

**Context**: Two separate gaps, fixed together because the second was found
while auditing for the first.

**Gap 1 — CLI harness overhead.** `claude -p` is an agent harness, not a bare
completion endpoint. Invoked with defaults it prepends its own Claude Code
system prompt, the full built-in tool catalog, discovered CLAUDE.md/AGENTS.md
files, MCP server definitions, and user/project settings to EVERY call —
measured elsewhere (same technique, different repo) at 25,664 → 167 input
tokens for an identical trivial task, 17.4x, $0.017628 → $0.001011. None of
that harness context is useful here: the dashboard supplies its own domain
prompt, and the agentic protocol has the SERVER execute tools (the model only
emits a JSON envelope naming them — `AGENTIC_PROTOCOL_INSTRUCTION` in
`claude-code.ts`), so Claude's own tools are never invoked whether or not the
harness that would offer them is present.

**Gap 2 — no master kill switch.** Nothing in this codebase could say "stop
every LLM call" in one place. `dashboard.agentic_tools_enabled` stops the
tool-calling loop for generate/modify/analyze, but a flow with that switch
off still makes a single-shot call instead of no call — and chat, suggest,
gap, and the weekly review never went through that switch at all. "Turn the
AI off" had no honest single answer.

**Decision**:

**Lean CLI invocation** (`dashboard.llm_cli_lean_mode`, default **true**):

- Every CLI invocation (single-shot and agentic) prepends `CLI_LEAN_ARGS` —
  `--disable-slash-commands`, `--strict-mcp-config`, `--setting-sources ""`
  — when the switch is on.
- For the single-shot path, the flow's domain **stable** system-prompt block
  additionally goes on `--system-prompt`, REPLACING the harness default —
  this is where the win comes from; the shim alone (agentic path, or a
  single-shot call with nothing safe to put there) still strips the harness
  via `CLI_LEAN_ARGS` but doesn't get the cache-anchoring benefit.
- `CLI_SAFETY_ARGS` (`--tools ""`, `--no-session-persistence`) stays
  UNCONDITIONAL — never gated behind `cliLeanMode`. It disables Claude's
  built-in tools against prompts that carry free-form user chat text and
  LLM-generated SQL; a debug toggle must never be able to re-open a
  code-execution path. `leanArgs()` in `claude-code.ts` returns
  `CLI_SAFETY_ARGS` alone when lean mode is off, `CLI_SAFETY_ARGS +
  CLI_LEAN_ARGS + --system-prompt <content>` when it's on.
- Lean mode off restores the full harness as an escape hatch: `--system-prompt`
  is never emitted (it would REPLACE the harness default, defeating the
  point of the escape hatch), and the domain content is instead layered on
  top of the harness via `--append-system-prompt` so it's never silently
  dropped either way.
- `--bare` was considered and rejected: it forces `ANTHROPIC_API_KEY` auth
  and never reads the OAuth credentials file the launchd sync maintains
  (D-025) — under this project's OAuth single-refresher arrangement that
  would break authentication outright, not just skip a cost optimization.

**Audit before wiring — what `buildSystemPrompt(flow, vars).stable` actually
contains.** Putting per-call data on `--system-prompt` would be worse than
not optimizing at all: unlike stdin, that flag (and `--append-system-prompt`)
is the one channel meant to be call-invariant, since it's what the CLI's own
prompt cache anchors to. Every case in `lib/llm-context/system-prompt.ts`'s
`buildSystemPrompt` switch was read end to end:

| Flow | `stable` reads `vars`? | Verdict |
|---|---|---|
| `generate` | No — fixed role header + static knowledge | SAFE |
| `modify` | No — `vars.currentSpec` correctly goes into `volatile`, never `stable` | SAFE |
| `chat` | No — `buildFreeChatContext()` takes no arguments | SAFE |
| `title` | No — a fixed instruction string | SAFE |
| `summary` | No — falls through to the switch's `default: { stable: "" }` | SAFE |
| `analyze` | **Yes** — embeds `vars.serializedData` (the dashboard's real data) and `vars.dashboardId` straight into `stable`, with no `volatile` split at all | NOT SAFE |
| `weekly` | **Yes** — embeds `vars.queryResults`, `vars.reviewedWeekDescription`, `vars.generationMode` into `stable` | NOT SAFE |
| `suggest` | **Yes** — embeds `vars.role` and `vars.existingDashboards` | NOT SAFE |
| `gap` | **Yes** — embeds `vars.existingDashboards` | NOT SAFE |

`generate`/`modify` were the flows expected to be offenders going in (they
carry a dashboard spec) — they turned out to be the two that were already
correctly designed. The real offenders (`analyze`, `weekly`, `suggest`,
`gap`) were not obvious from the flow names.

Splitting those four into a genuine stable/volatile shape is real surgery on
business-critical prompts (weekly review, dashboard analysis) and is out of
scope here. Instead: `CLI_SYSTEM_PROMPT_SAFE_FLOWS` in `lib/llm-client.ts`
allow-lists exactly the five safe flows for `--system-prompt` routing; the
other four keep their full stable+volatile content in stdin exactly as
before this change, benefiting from `CLI_LEAN_ARGS` (harness stripped) but
not from the domain-block caching. Nothing routes per-call data onto a
call-invariant flag. `lib/__tests__/llm-client-cli-system-prompt-safe.test.ts`
asserts the stable/vars-independence invariant for every flow in the safe
set (`chat` is verified by inspection instead of by test — its own
`buildFreeChatContext()` uses a runtime `require()` that doesn't resolve
under vitest, a pre-existing quirk unrelated to this change) — a flow that
starts interpolating `vars` into `stable` fails this test immediately,
before it could leak data onto the flag. The only other symptom of that
regression would be a worse CLI cache-hit rate, which nothing else would
catch.

**Master kill switch** (`dashboard.llm_enabled`, default **true**): with it
false, the process makes zero model calls.

- Enforced at the two seams every LLM call in the dashboard passes through
  (D-036): the top of `llmComplete` (single-shot), and the top of
  `assembleRequest`'s agentic branch (`lib/llm-enabled.ts`,
  `assertLlmEnabled()`). CI forbids importing `llmComplete`/`runAgenticChat`
  anywhere else, so these two cover the entire surface by construction —
  no scheduler or background pass in this codebase calls either function
  outside `assembleRequest`, so there is no third seam to add.
- Fails OPEN if the config loader is unavailable — a build context or a
  missing schema file must not silently disable the product.
- `LlmDisabledError` is wired into `classifyGuardError`
  (`llm-guard-response.ts`) as 503 `LLM_DISABLED` — that error code already
  existed in `lib/errors.ts`, reserved with no producer; this is its first
  producer, and every route already using `guardErrorResponse`/
  `buildLlmErrorPayload` picks it up automatically.
- Read fresh via the memoized `getSystemConfig()` loader on every call, so
  flipping it in `/admin/config` takes effect on the next call — no restart
  needed for interactive paths.

**Budget-gate collapse.** `checkDailyBudget()` used to be called
individually at the top of 8 functions in `lib/llm.ts` — one per flow —
*deliberately* kept outside `assembleRequest` so a new flow would be forced
to add its own call. That comment's intent didn't survive contact with
reality: nothing enforced the "forced," it was just as easy to forget as any
other manual convention, and two real call paths (`title` generation in
`lib/conversations.ts`, chat turns in `lib/turn-background.ts`) bypassed the
cap entirely because they call `assembleRequest` directly and were never
among the 8. This decision supersedes that placement: `checkDailyBudget()`
now runs once, pre-flight, at the very top of `assembleRequest` — before
either the agentic or single-shot branch — covering every caller of
`assembleRequest` by construction, `title`/chat included.

Placement matters: it is NOT inside `llmComplete`, and NOT per-call inside
the agentic branch. An agentic dashboard-generation run can make several
tool-round model calls; checking the budget on every one of them would let a
run that crosses the cap mid-flight die after N rounds with the spend
already incurred and a half-built spec on the floor. Checking once before
either path starts preserves the original fail-before-any-spend semantics
while still collapsing 8 call sites (now 0) to 1.

**Alternatives rejected**:
- *Fix `analyze`/`weekly`/`suggest`/`gap` to genuinely split stable/volatile
  instead of excluding them.* Correct long-term, but real surgery on
  business-critical prompt content outside the scope of a CLI-overhead
  change; tracked as a follow-up, not attempted here.
- *Gate `CLI_SAFETY_ARGS` behind `cliLeanMode` too, for a simpler single
  toggle.* Rejected — security controls must not be a debug knob's side
  effect.
- *Set the daily budget check inside `llmComplete` per call (agentic
  included, via the CLI/OpenRouter driver level).* Rejected — see the
  mid-run-death scenario above.

**Rationale**: Both changes close a gap: lean mode closes an unnecessary
per-call cost; the audit closes it correctly instead of shipping a
plausible-looking token-savings win that quietly leaked per-call dashboard
data onto a persistent flag. The kill switch closes the "silently
incomplete" gap in every prior attempt at an AI on/off control, using the
same architectural invariant (D-036's single seam) that already existed for
a different reason.

**See**: `dashboard/lib/llm-provider/cli/claude-code.ts` (`leanArgs`,
`CLI_LEAN_ARGS`, `CLI_SAFETY_ARGS`), `dashboard/lib/llm-client.ts`
(`CLI_SYSTEM_PROMPT_SAFE_FLOWS`, the CLI branch of `llmComplete`),
`dashboard/lib/llm-enabled.ts`, `dashboard/lib/llm-context/assemble.ts`,
`dashboard/lib/llm-guard-response.ts`, `dashboard/lib/llm.ts`,
`config/schema.yaml` (`dashboard.llm_cli_lean_mode`,
`dashboard.llm_enabled`), [D-036](D-036-llm-context-centralization.md),
[D-043](D-043-cli-usage-metering-and-budget.md).
