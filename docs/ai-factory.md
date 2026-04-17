# AI Factory — User Guide

> The AI Factory is an autonomous development pipeline for PowerShop Analytics. It uses Claude (via GitHub Actions) to discover work, plan implementations, write code, review PRs, and manage deployments. This guide explains **how humans use it**.

## What the AI Factory Does For You

You describe what you want in an issue; the factory implements it, reviews it, and prepares it for deployment. You stay in control through labels, comments, and merge approvals — but you don't write boilerplate, triage bugs, or chase stale PRs.

```
You:   "Add a health check endpoint to the ETL service"   (open an issue)
You:   label it "ai-work"
AI:    triages, plans, creates a branch, implements, opens a PR, runs tests
AI:    reviews the PR, posts inline comments, fixes any CI failures
You:   approve and merge
AI:    weekly auto-release bundles your change into a new version
AI:    Docker images are pushed, production notification issue created
```

Your total effort: **~15 minutes per day** reviewing the daily project summary, labeling issues, and merging PRs.

## Getting Started

### 1. One-time setup

Add these secrets to the repository (`Settings → Secrets and variables → Actions`):

| Secret | Required | Purpose |
|--------|----------|---------|
| `ANTHROPIC_API_KEY` | **Yes** | Powers all AI workflows (Claude Code Action) |
| `DOCKERHUB_USERNAME` | For releases | Pushes Docker images |
| `DOCKERHUB_TOKEN` | For releases | Pushes Docker images |
| `OPENROUTER_API_KEY` | Optional | Used by WrenAI and Dashboard App (existing secret) |

Once `ANTHROPIC_API_KEY` is set, the factory activates automatically. Scheduled workflows start running on their cron, and event-driven workflows respond to issues/PRs/comments.

### 2. Verify it works

Open the **Actions** tab and manually trigger **AI Factory Test** (`workflow_dispatch`). You should see Claude respond within a minute.

## How You Interact With the Factory

Four mechanisms cover 95% of your day-to-day use.

### a) Open an issue

Write what you want. The more specific the issue, the better the result.

**Good issue:**
> **Title**: Add `/api/health` endpoint to dashboard returning ETL sync status
>
> **Body**: Create `dashboard/app/api/health/route.ts` that queries the `watermark` table and returns `{ status: "ok" | "stale", last_sync: timestamp }`. Stale if last_sync > 48 hours old. Include a Vitest test.

**Bad issue:**
> Make the dashboard better

When a new issue is opened, the **Issue Triage** workflow runs automatically — it labels the issue by component, priority, category, and checks for duplicates.

### b) Use labels to steer the AI

| Label | Meaning |
|-------|---------|
| `ai-work` | Start autonomous implementation. The AI Worker picks this up, creates a branch, implements the change, runs tests, and opens a PR. |
| `ai-blocked` | The AI hit a blocker and needs human input. Check the issue comments. |
| `ai-in-progress` | The worker is currently running (auto-set). |
| `ai-planned` | The `/plan` command has posted an implementation plan (auto-set). |
| `no-ai` | Human-only. Factory will not touch this issue. |
| `no-pr-review` | **Stop automated Opus/Copilot PR reviews** on this PR. Use when you only want **address-feedback** to clear inline comments, then **`ai-awaiting-owner`** when done. Does **not** block you from merging. |
| `ai-ready-for-review` | **Automation queue only** — another AI PR review (Opus/Copilot pipeline) is scheduled or pending. This does **not** mean “ready for you”; it often means the bot is still working. |
| `ai-awaiting-owner` | **Your cue** — automated review rounds are finished (or capped). The PR is **ready for your review and merge** (subject to CI being green). |
| `auto-merge` | Merge automatically when CI passes and review approves *(reserved for future use)*. |
| `p0-critical` → `p3-low` | Priority — the factory processes higher priorities first. |

**When is a PR ready for you to review and merge?**

1. Look for **`ai-awaiting-owner`** on the PR — the factory applies this when automated Opus passes are complete (or the legacy cap of two Opus runs is hit). That is the clearest signal.
2. Do **not** treat **`ai-ready-for-review`** as “ready for human” — it means the automation pipeline may still run another AI review.
3. Always confirm **CI is green** (and resolve any `ai-blocked` / failing checks) before merging.

**Waiting without clicking:** If you add **`no-pr-review`** (no Opus/Copilot), the **watchdog** re-dispatches **AI Address PR Feedback** on a cooldown until the PR reaches **`ai-awaiting-owner`**, unless you opted out with **`no-address-feedback`**. PRs that never get **`no-pr-review`** will not auto-handoff unless you run the full review pipeline or add that label yourself.

### What is running right now?

GitHub does not show “this PR’s bot job” on the PR page directly. Use:

1. **Actions** → filter by **AI Address PR Feedback** or **AI PR Review** → open **In progress** runs.
2. CLI (repo root, `gh` authenticated):
   ```bash
   gh run list --workflow "AI Address PR Feedback" --limit 8 --json status,conclusion,displayTitle,url
   gh run list --workflow "AI PR Review" --limit 8 --json status,conclusion,displayTitle,url
   ```
   Only **one** address-feedback and **one** Opus PR review run at a time (global concurrency), so other PRs **queue** — a quiet PR may simply be waiting its turn.

### c) Use slash commands in comments

Comment on any issue (not PR) with one of these:

**`/plan`** — Claude analyzes the issue, reads the codebase, and posts a structured implementation plan. Use this **before** labeling `ai-work` if you want to review the approach first.

```
/plan
```

Response includes: analysis, files to modify, implementation steps, testing strategy, risk assessment, complexity estimate.

**`/ai <instruction>`** — Claude executes a direct instruction. Restricted to `OWNER` / `MEMBER` / `COLLABORATOR`.

```
/ai investigate why the ETL fails on Sundays and report back

/ai add retry logic to etl/sync/ventas.py with exponential backoff

/ai research what indexes we're missing on ps_lineas_ventas
```

For code-change instructions, Claude creates a branch and opens a PR. For investigation instructions, Claude posts findings as an issue comment.

### d) Review and merge PRs

When the AI opens a PR:

1. The **Claude PR Review** workflow runs automatically and posts a review (inline comments + approval or changes-requested).
2. CI runs (lint, tests, build) — same as any other PR.
3. If you request changes, the **Address PR Feedback** workflow attempts to auto-fix simple comments (typos, imports, lint, small logic fixes). Complex feedback gets a reply explaining why it's being skipped.
4. When you're happy, you merge. Auto-merge for trusted categories is disabled initially; you always click the button.

## The Daily Project Summary

Every weekday at 09:00 UTC, the factory creates a **Project Summary** issue titled `[project-summary] Project Summary — {date}`. It's your morning dashboard.

It includes:
- **Open PRs** with CI/review status
- **Merged yesterday** — what shipped
- **AI activity** — in-progress and blocked issues
- **Stale items** — PRs and issues needing attention
- **Easy pickings** — well-defined issues ready for `ai-work`
- **Health** — latest release, CI status

The previous day's summary is closed automatically. Read this, label a few issues `ai-work`, close anything resolved, and you're done.

## What Runs and When

### Event-driven (reacts immediately)

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| **Issue Triage** | Issue opened | Labels component/priority/category, checks for duplicates |
| **Plan** | `/plan` comment | Posts implementation plan |
| **AI Command** | `/ai` comment | Executes direct instruction |
| **AI Worker** | `ai-work` label added | Implements issue end-to-end, opens PR |
| **PR Review** | PR opened/updated | Posts AI code review |
| **Address Feedback** | Review with changes-requested | Auto-fixes simple comments |
| **PR Labeler** | PR opened/updated | Adds `size-*` and `risk-*` labels |
| **Deploy Notify** | Release published | Creates deployment checklist issue |

### Scheduled (runs on cron)

| Workflow | Schedule | What it does |
|----------|----------|-------------|
| **Project Summary** | Weekdays 09:00 | Daily digest (your morning briefing) |
| **ETL Health Monitor** | Weekdays 08:00 | Checks ETL code/schema/sync for issues |
| **Bug Hunter** | Weekdays 11:00 | Scans recently changed files for bugs |
| **SQL Pair Validator** | Monday 10:00 | Validates WrenAI SQL pairs against schema |
| **Docs Patrol** | Tuesday 14:00 | Checks docs are accurate and current |
| **Dashboard Audit** | Wednesday 14:00 | Builds + tests dashboard, reviews quality |
| **Feature Ideas** | Thursday 14:00 | Brainstorms 3-5 actionable ideas |
| **Security Audit** | Friday 10:00 | Dependency + source security scan |
| **Stale Manager** | Friday 16:00 | Closes stale issues/PRs |
| **Auto Release** | Sunday 20:00 | Creates weekly release with changelog |

All scheduled workflows support manual triggering via `workflow_dispatch`. All follow the **"silence is golden"** principle — they only create issues when they find something genuinely worth reporting.

## Architecture Overview

```
Human direction (issues, labels, /plan, /ai)
  ↓
Discovery Layer — scheduled audits create issues
  ↓
Triage Layer — auto-label, deduplicate, prioritize
  ↓
Execution Layer — Claude Code: issue → branch → PR
  ↓
PR Lifecycle — AI review → address feedback → CI
  ↓
Deployment Layer — auto-release → Docker push → notify
  ↓
Loop — discovery finds new work
```

The factory is organized as six layers, each with specific workflows. See the [workflow catalog](#what-runs-and-when) above for the complete list.

## Common Scenarios

### "I want the AI to fix this bug"
1. Open an issue describing the bug with reproduction steps
2. *(Optional)* Comment `/plan` to preview the approach
3. Add label `ai-work`
4. Review the resulting PR, merge when ready

### "I want to investigate something without writing code"
Comment on any issue (or open a new one):
```
/ai check which ps_* tables are missing indexes and report back
```

### "I want to temporarily disable AI on a PR"
Add the `no-pr-review` label.

### "An AI-generated PR has a bug"
Leave a review comment describing the problem. The **Address Feedback** workflow will attempt to fix it. For complex changes, the AI will reply explaining why it can't auto-fix, and you can use `/ai` in the issue to give more specific direction.

### "I want to stop a running AI Worker"
Cancel the workflow run in the Actions tab. The `ai-in-progress` label won't be removed automatically — remove it manually.

### "I don't want the AI touching this issue at all"
Add the `no-ai` label before opening.

## Troubleshooting

**The AI Worker created a PR but it's wrong.** Close the PR, add more detail to the issue (acceptance criteria, file paths, examples), remove `ai-in-progress`/`ai-blocked`, and re-label `ai-work`.

**A workflow failed with an auth error.** Check that `ANTHROPIC_API_KEY` is set as a repository secret (not environment secret) and hasn't expired.

**The AI keeps making the same mistake.** Update the relevant project documentation (`AGENTS.md`, `docs/skills/*.md`, or `CLAUDE.md`). The Claude Code Action reads these automatically, so fixes there propagate to every workflow.

**Too many AI-generated issues cluttering the backlog.** The **Stale Manager** closes AI issues after 21 days of inactivity. You can also use `gh issue list --label "ai-bug" --search "no:assignee"` to triage in bulk.

**Rate limits or cost concerns.** Disable specific scheduled workflows by setting their cron to a future date, or by adding `if: false` to the job. Re-enable when needed.

## Limits and Safety

- **Read-only SQL policy**: Every AI-generated SQL is validated against the project's read-only rule. `INSERT`/`UPDATE`/`DELETE`/`DROP`/`ALTER`/`CREATE`/`TRUNCATE` are never allowed against the source ERP.
- **No credentials in code**: The PR Review workflow explicitly checks for leaked secrets.
- **Human-in-the-loop merges**: Every AI-generated PR requires explicit human approval to merge. There is no auto-merge yet.
- **Author-association gates**: Sensitive workflows (`/ai` command, worker) only respond to `OWNER` / `MEMBER` / `COLLABORATOR`.
- **Fork safety**: `pull_request_target` workflows guard against running untrusted PR code with access to secrets.

## Related Documentation

- [AGENTS.md](../AGENTS.md) — Project agent guidelines (read by all AI workflows)
- [ARCHITECTURE.md](../ARCHITECTURE.md) — System architecture
- [DECISIONS-AND-CHANGES.md](../DECISIONS-AND-CHANGES.md) — Decision log (including AI Factory decisions D-011 through D-014)
- [docs/skills/](skills/) — Domain-specific skill docs that workflows consult
