# AI Factory — PowerShop Analytics

> Autonomous AI-driven development pipeline. The product evolves continuously with minimal human input, using Claude as the primary AI engine and GitHub Actions as the orchestration layer.

## Inspiration

Inspired by [elastic/ai-github-actions-playground](https://github.com/elastic/ai-github-actions-playground) — Elastic's "AI Software Engineering Factory" where 70+ GitHub Actions workflows autonomously manage the full software engineering lifecycle. Their system uses GitHub Copilot + Gemini. Ours uses **Claude** (via Claude Code GitHub Action + OpenRouter API).

## Philosophy

```
Human sets direction (issues, labels, comments)
  → AI discovers work (scheduled audits, detectors)
  → AI plans work (/plan command)
  → AI executes work (Claude Code creates PRs)
  → AI reviews work (Claude PR review)
  → AI fixes feedback (auto-address review comments)
  → CI validates (tests, lint, build)
  → Human approves merge (or auto-merge for low-risk)
  → Auto-deploy (Docker Hub + production update)
  → Loop
```

### Key Differences from Elastic's Approach

| Aspect | Elastic (Peek) | PowerShop Analytics |
|--------|----------------|---------------------|
| Primary AI | GitHub Copilot SWE Agent | Claude Code (via `anthropic/claude-code-action`) |
| Secondary AI | Google Gemini (deep research) | Claude API via OpenRouter (already in stack) |
| Product | Browser-only React dashboard | Full-stack: ETL + PostgreSQL + WrenAI + Dashboard |
| Deployment | Static site (GitHub Pages) | Docker Compose (self-hosted) |
| Reusable actions | `elastic/ai-github-actions` | Custom workflows (this repo) |
| Scale | 70+ workflows, large team | ~20 workflows, solo/small team |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  DISCOVERY LAYER (scheduled)                                     │
│                                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ ETL Health    │ │ Dashboard    │ │ SQL Pair Validator       │ │
│  │ Monitor       │ │ Quality      │ │ (weekly)                 │ │
│  │ (daily)       │ │ Auditor      │ │                          │ │
│  │               │ │ (weekly)     │ │                          │ │
│  └──────┬───────┘ └──────┬───────┘ └────────────┬─────────────┘ │
│         │                │                       │               │
│  ┌──────┴───────┐ ┌──────┴───────┐ ┌────────────┴─────────────┐ │
│  │ Bug Hunter    │ │ Security     │ │ Feature Ideas Generator  │ │
│  │ (daily)       │ │ Auditor      │ │ (weekly)                 │ │
│  │               │ │ (weekly)     │ │                          │ │
│  └──────┬───────┘ └──────┬───────┘ └────────────┬─────────────┘ │
│         │                │                       │               │
│         ▼                ▼                       ▼               │
│                    GitHub Issues                                  │
│                    (auto-created)                                 │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│  TRIAGE LAYER (event-driven)                                     │
│                                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ Issue Triage  │ │ Duplicate    │ │ Project Summary          │ │
│  │ (on open)     │ │ Detector     │ │ (daily digest)           │ │
│  │ + labeling    │ │ (on open)    │ │                          │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│  EXECUTION LAYER (issue → PR)                                    │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ Claude Code Worker                                           ││
│  │  - Triggered by: label `ai-work` on issue                   ││
│  │  - Or: `/ai` comment on issue                                ││
│  │  - Or: `/plan` comment (planning only)                       ││
│  │  - Creates branch, implements, commits, opens PR             ││
│  └──────────────────────────────────┬───────────────────────────┘│
└─────────────────────────────────────┼───────────────────────────┘
                                      │
┌─────────────────────────────────────▼───────────────────────────┐
│  PR LIFECYCLE LAYER (event-driven)                               │
│                                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ Claude PR     │ │ Address      │ │ CI Failure               │ │
│  │ Review        │ │ Review       │ │ Investigator             │ │
│  │ (on PR open)  │ │ Feedback     │ │ (on check failure)       │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
│                                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ PR Labeler    │ │ Merge        │ │ Stale PR Closer          │ │
│  │ (size/risk)   │ │ Conflict     │ │ (weekly)                 │ │
│  │               │ │ Resolver     │ │                          │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
└─────────────────────────┬───────────────────────────────────────┘
                          │ merge
┌─────────���───────────────▼───────────────────────────────────────┐
│  DEPLOYMENT LAYER (on merge to main)                             │
│                                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ CI Pipeline   │ │ Docker Build │ │ Auto-Release             │ │
│  │ (lint+test+   │ │ & Push       │ │ (weekly or on label)     │ │
│  │  build)       │ │ (beta tag)   │ │                          │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ Production Deploy (on release)                               ││
│  │  - Push versioned Docker images                              ││
│  │  - Notify via issue comment or webhook                       ││
│  └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Human Steering Mechanisms

Humans stay in control without doing the grunt work:

| Mechanism | How it works |
|-----------|-------------|
| **Issue creation** | Human creates issue → AI triages, plans, implements |
| **Labels** | `ai-work` = AI should implement; `ai-blocked` = needs human input; `no-ai` = human-only |
| **`/plan` command** | Comment `/plan` on any issue → Claude analyzes and posts implementation plan |
| **`/ai` command** | Comment `/ai <instruction>` on issue → Claude executes the instruction |
| **PR review** | Human can approve, request changes, or comment — AI responds to feedback |
| **Priority labels** | `p0-critical`, `p1-high`, `p2-medium`, `p3-low` — AI processes highest priority first |
| **Milestone** | Group issues into milestones for phased delivery |
| **`no-pr-review` label** | Skip AI review on specific PRs |
| **PR control panel** | Checkbox toggles in PR body to enable/disable specific AI behaviors |

## Workflow Catalog

### Discovery Agents (Scheduled)

| # | Workflow | Schedule | What it does |
|---|---------|----------|-------------|
| 1 | `etl-health-monitor` | Daily 08:00 | Connects to PostgreSQL, checks row counts vs expected, checks watermark freshness, reports anomalies |
| 2 | `dashboard-quality-auditor` | Weekly Wed | Builds dashboard app, runs tests, checks for TypeScript errors, reviews component quality |
| 3 | `sql-pair-validator` | Weekly Mon | Runs all 52+ SQL pairs against PostgreSQL, reports failures as issues |
| 4 | `bug-hunter` | Daily 11:00 | Analyzes codebase for bugs, anti-patterns, potential issues |
| 5 | `security-auditor` | Weekly Fri | Checks for dependency vulnerabilities, credential leaks, OWASP issues |
| 6 | `feature-ideas` | Weekly Thu | Analyzes product, suggests feature ideas based on codebase and existing issues |
| 7 | `docs-patrol` | Weekly Tue | Checks docs are up to date, finds stale references, missing documentation |
| 8 | `dependency-review` | Weekly Mon | Check for outdated dependencies, suggest updates |
| 9 | `stale-issues` | Weekly Fri | Close/label stale issues and PRs |

### Triage Agents (Event-driven)

| # | Workflow | Trigger | What it does |
|---|---------|---------|-------------|
| 10 | `issue-triage` | Issue opened | Labels, categorizes, checks for duplicates, assigns priority |
| 11 | `project-summary` | Daily 09:00 | Creates daily digest issue: open PRs, recent merges, stale items, blockers |

### Execution Agents (Issue → PR)

| # | Workflow | Trigger | What it does |
|---|---------|---------|-------------|
| 12 | `claude-code-worker` | Label `ai-work` added | Claude Code reads issue, creates branch, implements, opens PR |
| 13 | `plan-command` | `/plan` comment on issue | Claude analyzes issue, posts structured implementation plan |
| 14 | `ai-command` | `/ai` comment on issue | Claude executes the instruction in the comment |

### PR Lifecycle Agents (Event-driven)

| # | Workflow | Trigger | What it does |
|---|---------|---------|-------------|
| 15 | `pr-review` | PR opened/updated | Claude reviews code: bugs, security, style, correctness |
| 16 | `address-pr-feedback` | Review submitted | Auto-fix simple review comments (typos, imports, formatting) |
| 17 | `ci-failure-investigator` | Check suite failed | Diagnose CI failure, post analysis, attempt fix |
| 18 | `pr-labeler` | PR opened | Auto-label by size (S/M/L/XL) and risk level |

### Deployment Agents (On merge/release)

| # | Workflow | Trigger | What it does |
|---|---------|---------|-------------|
| 19 | `auto-release` | Weekly or `release` label | Creates GitHub release with changelog, bumps version |
| 20 | `deploy-docker` | Release published | Builds and pushes Docker images (ETL + Dashboard) |
| 21 | `deploy-notify` | Release published | Posts deployment notification to configured channel |

## Implementation Plan

### Phase 1: Foundation (Issues #F1-#F3)
Core infrastructure: Claude Code GitHub Action setup, secrets, base workflow patterns.

### Phase 2: PR Lifecycle (Issues #F4-#F7)
AI-powered PR review, feedback handling, CI investigation, labeling.

### Phase 3: Issue Lifecycle (Issues #F8-#F11)
Issue triage, `/plan` and `/ai` commands, Claude Code worker.

### Phase 4: Discovery Agents (Issues #F12-#F17)
Scheduled auditors: ETL health, dashboard quality, SQL validation, bug hunting, security, docs.

### Phase 5: Deployment Automation (Issues #F18-#F20)
Auto-release, Docker push, production deployment notification.

### Phase 6: Refinement (Issues #F21-#F22)
Project summary, feature ideas generator, stale issue management.

## Secrets Required

| Secret | Purpose |
|--------|---------|
| `ANTHROPIC_API_KEY` | Claude Code GitHub Action authentication |
| `DOCKERHUB_USERNAME` | Docker Hub push |
| `DOCKERHUB_TOKEN` | Docker Hub push |
| `OPENROUTER_API_KEY` | Claude API via OpenRouter (for custom prompts) |

## Key Design Decisions

### D-011: Claude Code as primary AI agent (not Copilot)
**Context**: Elastic uses GitHub Copilot SWE Agent. We need to choose our AI engine.
**Decision**: Use Claude via `anthropic/claude-code-action` GitHub Action for code generation and `claude-code` CLI for local development.
**Rationale**: Claude is already our LLM for WrenAI and Dashboard App. Single vendor simplifies. Claude Code Action is production-ready and supports CLAUDE.md context files which we already maintain.

### D-012: Custom workflows instead of reusable action library
**Context**: Elastic has `elastic/ai-github-actions` with reusable workflow templates.
**Decision**: Build workflows directly in this repo. Extract to reusable library later if needed.
**Rationale**: We have ~20 workflows vs their 70+. Premature extraction adds complexity. Keep it simple until patterns stabilize.

### D-013: Human-in-the-loop for merges (initially)
**Context**: Could enable full auto-merge for AI PRs.
**Decision**: Start with human approval required for merge. Add auto-merge for low-risk PRs (docs, deps) after trust is established.
**Rationale**: Safety first. The product handles business data. Build trust incrementally.

### D-014: Label-driven execution
**Context**: How should AI agents know which issues to work on?
**Decision**: Label `ai-work` triggers Claude Code worker. Label `ai-blocked` pauses. Priority labels control order.
**Rationale**: Simple, visible, controllable. Human adds label = human approves AI work. Easy to audit.

## References

- [elastic/ai-github-actions-playground](https://github.com/elastic/ai-github-actions-playground) — Elastic's AI factory (70+ workflows, Copilot + Gemini)
- [anthropic/claude-code-action](https://github.com/anthropic/claude-code-action) — Official Claude Code GitHub Action
- [AGENTS.md](../AGENTS.md) — Project agent guidelines (Claude Code context)
- [ARCHITECTURE.md](../ARCHITECTURE.md) — System architecture
