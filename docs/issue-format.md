# Issue and PR format

All GitHub issues in this project follow a single standard format. When creating issues, always use this template exactly.

> **Why this lives here, not in AGENTS.md:** the template + phasing rules are ~140 lines of reference that the planner reads once when decomposing work, but every Claude session in the repo doesn't need them in the always-loaded context chain. AGENTS.md keeps a short summary and links here.

## Issue template

```markdown
# <Feature name>

## Context
- **Problem**: <what's wrong / missing; why it matters>
- **Worktree**: <required: git worktree name for isolated execution, e.g. `wren-p1-compose`>
- **Scope**: <what is in / out of scope>
- **Constraints**: <perf, compatibility, no-breaking-changes, deps, etc.>
- **Repo touchpoints**: <files/dirs likely involved, commands, datasets impacted>
- **Definition of done**: <e.g., builds + tests pass; feature-specific checks>
- **How is it going to be tested**: <testing strategy and specific test cases>

## Tasks
- [ ] 1) <task title> (owner: agent)
  - **Change**: <precise behavior or code change>
  - **Files**: <exact file paths>
  - **Acceptance**: <how to verify; exact commands and expected output>
  - **Spec update**: mark done + update remaining tasks/context as needed

- [ ] 2) ... (owner: agent)

- [ ] N-1) Run all checks and fix issues (owner: agent)
  - **Change**: Run all tests, linting, type-checking, and formatting; fix any failures
  - **Files**: any files with issues
  - **Acceptance**: `docker compose run --rm etl python -m pytest && python -m ruff check etl/ && python -m mypy etl/`
  - **Spec update**: mark done

- [ ] N-1b) Copilot review (owner: agent, **one round only**)
  - **Change**: Request a Copilot review, address all feedback, then stop. Do **not** re-request Copilot.
  - **How**: `gh pr create`, then request Copilot review via REST API: `gh api repos/{owner}/{repo}/pulls/{PR#}/requested_reviewers --method POST -f 'reviewers[]=copilot-pull-request-reviewer[bot]'`. Poll for review: `gh api repos/{owner}/{repo}/pulls/{PR#}/reviews --jq '[.[] | {state, user: .user.login, body}]'`. Address all comments with inline replies.
  - **Acceptance**: Copilot review arrived, every comment has either a code change or a reply explaining why it does not apply. No second Copilot round.
  - **Spec update**: mark done

- [ ] N-1c) Opus review (owner: agent, **one round only, clean context**)
  - **Change**: Run a single Opus review of the PR **from a fresh context** (new session, no implementation history), address all feedback, then stop.
  - **How**: Start a new Claude Code session with no prior conversation about this PR and invoke the PR review flow on this PR number. Reply inline to every comment; apply the fixes that are correct.
  - **Acceptance**: Opus review completed; every comment has either a code change or a reply. No second Opus round.
  - **Spec update**: mark done

- [ ] N) Create commit (owner: agent)
  - **Change**: Stage all changes and create a descriptive commit
  - **Files**: none (git operation)
  - **Acceptance**: `git status` shows clean working tree; `git log -1` shows the new commit
  - **Spec update**: mark done

## Additional Context
<append-only notes: discoveries, links, decisions, gotchas found during execution>
```

## Worktree workflow

Each issue specifies a **worktree name**. Before starting work:
```bash
git worktree add ../<repo>-<worktree-name> -b <worktree-name>
cd ../<repo>-<worktree-name>
```
Work in the worktree. When done, PR is merged and worktree is removed:
```bash
git worktree remove ../<repo>-<worktree-name>
```

## PR and review policy

Every PR gets **exactly two review rounds, in order, each run only once**:

1. **One Copilot review** (bot).
2. **One Opus review**, started from a **clean context** (fresh Claude Code session with no prior history about this PR or its implementation).

After each round: address every comment with either a code change or an inline reply, then move on. **Do not re-request the same reviewer.** Iterating "until there are no comments" is no longer the policy — it was too much. If a later round surfaces a genuinely blocking issue, use judgement and escalate to the human owner rather than looping. See [D-021](decisions/D-021-two-review-rounds.md).

Rules:
- Every piece of work goes through a PR, even solo work.
- **Round 1 — Copilot.** Request via the REST API:
  ```bash
  gh api repos/{owner}/{repo}/pulls/{PR#}/requested_reviewers \
    --method POST -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
  ```
  Do NOT use `gh pr review --request copilot` (doesn't work) or `gh pr edit --add-reviewer copilot` (can't resolve bot users). The REST API with `copilot-pull-request-reviewer[bot]` is the only working CLI method.
  - **From GitHub Actions**, the default `GITHUB_TOKEN` **cannot** assign `copilot-pull-request-reviewer[bot]` — the API returns 200 but with an empty `requested_reviewers` array. Workflows must use a PAT stored in the repo secret `COPILOT_PAT` (fine-grained PAT, scope `Pull requests: Read and write`). Pattern:
    ```bash
    GH_TOKEN="$COPILOT_PAT" gh api repos/{owner}/{repo}/pulls/{PR#}/requested_reviewers \
      --method POST -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
    ```
    Always verify the response contains `Copilot` in `requested_reviewers` before claiming the review was requested.
  - Poll for the review: `gh api repos/{owner}/{repo}/pulls/{PR#}/reviews --jq '[.[] | {state, user: .user.login, body}]'`.
  - Address every comment with a code change or inline reply. **One round only — do not re-request Copilot.**
- **Round 2 — Opus, clean context.** Start a new Claude Code session (no prior conversation about this PR or the branch) and run the PR review flow on this PR number. Reply inline to every comment; apply the correct fixes. **One round only — do not re-request Opus.**
- **Merge** after both rounds are done and every comment has a change or a reply. Unresolved disagreement → flag to the human owner; don't start a third round to paper over it.

## Phase labels and execution order

Issues are labelled by phase: `phase-1`, `phase-2`, ..., `phase-6`.

**Execution rules for unattended agents:**
- Phase 1 is sequential: P1-A then P1-B.
- Phases 2+3 sync issues are independent of each other — run in batches of 2-3 after P1-B merges. Each sync issue only creates `etl/sync/<module>.py` + tests. **None touch `etl/main.py`** — P4 owns that file.
- Phase 4 (scheduler) wires all sync modules into `main.py` and runs the first full data load. Requires all sync PRs merged.
- Phase 5 (WrenAI MDL) requires P4 complete (data must be in PostgreSQL).
- Phase 6 (docs) requires P5 complete.

## Planner phasing rules (mandatory for all decompositions)

These rules apply to **every** planning session, not just the ETL epic above. The planner must apply them before finalising any sub-issue decomposition.

### Q1 — When to produce phases (trigger conditions)

Phases are **mandatory** when any two sub-issues share any of the following:

1. **Shared source file** — the same path appears in the `Files:` section of two sub-issues (especially `dashboard/lib/*.ts`, `dashboard/components/`, `etl/schema/init.sql`, shared hooks/types).
2. **Shared DB table** — any two sub-issues `CREATE`, `ALTER`, or heavily write to the same table. Schema DDL is the highest-risk overlap.
3. **Shared HTTP route family** — any two sub-issues add or modify routes under the same prefix (e.g. `/api/conversations/*`).
4. **Producer/consumer dependency** — one sub-issue defines a shape that another reads. Classic chain: data layer → API route → UI component. The consumer cannot correctly implement against a shape that isn't merged yet.

When **none** of the above apply, sub-issues may run in parallel.

### Q2 — Serialisation unit

**Phase = a batch of sub-issues that share no files, tables, or contracts.** Within a phase, sub-issues run concurrently (existing worker behaviour). Between phases: all PRs from phase N must be **merged and `main` must be green** before any phase N+1 sub-issue receives `ai-work`.

Phase N+1 sub-issues are created with the `ai-task` label but **without** `ai-work`. The owner adds `ai-work` once all phase N PRs are merged.

### Q3 — Enforcement rule for the planner

After listing sub-issues, the planner must:

1. For each pair (A, B) assigned to the same phase: check all four Q1 conditions:
   - **File overlap**: is `Files(A) ∩ Files(B)` non-empty (string intersection on the `Files:` lines)?
   - **DB table overlap**: do both touch (CREATE/ALTER/write) the same table?
   - **Route prefix overlap**: do both add or modify routes under the same HTTP prefix?
   - **Producer/consumer chain**: does A define a shape or contract that B reads?
2. If **any** of the above is true: move B to the next phase; document the reason in the plan comment.
3. Include a **dependency table** in the plan comment showing which sub-issues are in each phase and the reason for any serialisation.

### Phase labeling

- Use `phase-1`, `phase-2`, ... labels on sub-issues to indicate which batch they belong to.
- In the plan comment, include a dependency table with columns: Phase | Sub-issue | Files | Reason for phase assignment.
