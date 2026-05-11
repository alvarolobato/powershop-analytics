# Pending Workflow Changes

This file tracks workflow YAML changes that have been designed by the AI Worker
but cannot be committed directly (D-029: the worker must not write to
`.github/workflows/`). Each entry includes the complete YAML and instructions
for the human owner to commit it.

---

## 1. File-overlap dispatch guard — `ai-worker.yml` implement job

**Issue**: #586  
**Parent**: #570 (prevent contract-regression cascades)  
**Status**: ⚠️ Pending human commit

### Where to add

In `.github/workflows/ai-worker.yml`, in the `implement` job, add this step
**immediately after** the `Update labels — implementation started` step
(after line ~422, before the `Implement sub-task` step that uses
`anthropics/claude-code-action@v1`).

### What it does

Before the worker starts implementing a sub-task, this step checks whether any
other open sub-issue (carrying both `ai-in-progress` and `ai-task` labels)
touches the same files as the current sub-issue. If an overlap is found, the
worker defers instead of proceeding — it posts a comment, adds `ai-blocked` +
`ai-auto-retry`, and exits 0 so the watchdog can retry once the blocking issue
clears.

This prevents the conversations-cascade pattern (issues #536–#540) where
5 workers ran concurrently on issues that all shared `dashboard/lib/conversations.ts`.

**Failure mode**: fail-open. If the guard itself errors (API timeout, parse
failure, etc.), it logs a warning and allows the implement step to continue.

### YAML step to add

```yaml
      - name: File-overlap dispatch guard
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          # Not using set -e — guard is fail-open; errors log and proceed.
          set -uo pipefail

          DEFERRED=false

          # Extract file paths from the "## Files to change" section of an issue body.
          # Reads body text from stdin; outputs one path per line.
          # File paths are expected in backtick-quoted form: `path/to/file`
          extract_files() {
            awk '
              /^## Files/{f=1; next}
              f && /^## /{exit}
              f && /^[-*]/{
                line = $0
                gsub(/^[-*][ \t]+/, "", line)
                if (substr(line,1,1) == "`") {
                  sub(/`/, "", line); sub(/`.*/, "", line)
                } else {
                  sub(/[ \t].*/, "", line)
                }
                if (length(line) > 0) print line
              }
            '
          }

          run_guard() {
            local current_body="" current_files="" in_progress="" count=0

            current_body=$(gh issue view "$ISSUE_NUMBER" --json body --jq '.body') || return 1
            current_files=$(printf '%s' "$current_body" | extract_files)

            if [ -z "$current_files" ]; then
              echo "Guard: no Files: section in #$ISSUE_NUMBER — skipping."
              return 0
            fi

            echo "Guard: files in this issue:"
            echo "$current_files"

            in_progress=$(gh issue list \
              --repo "${{ github.repository }}" \
              --state open \
              --search "label:ai-in-progress label:ai-task" \
              --limit 50 \
              --json number,body \
              | jq --argjson n "$ISSUE_NUMBER" '[.[] | select(.number != $n)]') || return 1

            count=$(printf '%s' "$in_progress" | jq 'length')
            if [ "$count" -eq 0 ]; then
              echo "Guard: no other ai-in-progress ai-task issues — passes."
              return 0
            fi

            echo "Guard: checking $count in-progress issue(s) for file overlap..."

            local blocking="" overlap=""
            while IFS= read -r row; do
              local num="" body_sib="" sib_files="" inter=""
              num=$(printf '%s' "$row" | jq -r '.number')
              body_sib=$(printf '%s' "$row" | jq -r '.body')
              sib_files=$(printf '%s' "$body_sib" | extract_files)
              [ -z "$sib_files" ] && continue

              inter=$(comm -12 \
                <(printf '%s\n' "$current_files" | sort -u) \
                <(printf '%s\n' "$sib_files" | sort -u))

              if [ -n "$inter" ]; then
                blocking="$num"
                overlap="$inter"
                break
              fi
            done < <(printf '%s' "$in_progress" | jq -c '.[]')

            if [ -n "$blocking" ]; then
              file_list=$(printf '%s\n' "$overlap" \
                | awk '{if(NR>1) printf ", "; printf "%s",$0} END{print ""}')
              echo "Guard: overlap with #$blocking — $file_list"

              gh issue comment "$ISSUE_NUMBER" \
                --body "⏸️ AI Worker — dispatch deferred: overlapping files with in-progress issue #${blocking}: ${file_list}. Will retry when #${blocking} completes." || true
              gh issue edit "$ISSUE_NUMBER" \
                --remove-label "ai-in-progress" \
                --add-label "ai-blocked" \
                --add-label "ai-auto-retry" || true

              DEFERRED=true
            else
              echo "Guard: no overlap — passes."
            fi
          }

          # Run guard fail-open: if it errors for any reason, warn and proceed.
          run_guard || echo "::warning::File-overlap dispatch guard errored — proceeding (fail-open)."

          # If deferred, exit this step with 0; the watchdog will retry later.
          if [ "$DEFERRED" = "true" ]; then
            echo "Guard: dispatch deferred — stopping implementation step."
            exit 0
          fi
```

### Verification checklist

Before committing, verify:

- [ ] The step is placed after `Update labels — implementation started` and before `Implement sub-task`
- [ ] The indentation matches the surrounding steps (6 spaces for `- name:`)
- [ ] `${{ github.repository }}` and `$ISSUE_NUMBER` are used (same as surrounding steps)
- [ ] YAML is syntactically valid: `yamllint .github/workflows/ai-worker.yml`

### Logic paths

| Scenario | Outcome |
|----------|---------|
| Issue has no `## Files to change` section | Guard skipped, implementation proceeds |
| No other `ai-in-progress ai-task` issues | Guard passes, implementation proceeds |
| Other in-progress issues found, no file overlap | Guard passes, implementation proceeds |
| Overlap found with issue #N | Comment posted, `ai-blocked`+`ai-auto-retry` added, step exits 0 |
| Guard itself errors (API timeout, parse error) | Warning logged, implementation proceeds (fail-open) |
