#!/usr/bin/env bash
# check-llm-context.sh
#
# CI guard: enforces that no file outside dashboard/lib/llm-context/ imports
# llmComplete or runAgenticChat directly from their source modules.
# The ONLY permitted importers are files inside dashboard/lib/llm-context/.
#
# Usage:  bash dashboard/scripts/check-llm-context.sh
#         npm run lint:llm-context      (from the dashboard/ directory)
#
# Exits 0 when no violations are found, 1 when violations are detected.

set -euo pipefail

DASHBOARD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Check: no file outside llm-context/ imports llmComplete from llm-client
VIOLATIONS_LLM_COMPLETE=$(grep -rn \
  --include='*.ts' --include='*.tsx' \
  'from.*"@/lib/llm-client"\|from.*"./llm-client"\|from.*"../llm-client"\|from.*"../../llm-client"' \
  "$DASHBOARD_DIR" \
  | grep 'llmComplete' \
  | grep -v 'dashboard/lib/llm-context/' \
  | grep -v '__tests__' \
  | grep -v 'node_modules' \
  || true)

# Check: no file outside llm-context/ imports runAgenticChat from runner
VIOLATIONS_AGENTIC=$(grep -rn \
  --include='*.ts' --include='*.tsx' \
  'from.*"@/lib/llm-tools/runner"\|from.*"./runner"\|from.*"../runner"\|from.*"../../llm-tools/runner"' \
  "$DASHBOARD_DIR" \
  | grep 'runAgenticChat' \
  | grep -v 'dashboard/lib/llm-context/' \
  | grep -v '__tests__' \
  | grep -v 'node_modules' \
  || true)

FAILED=0

if [ -n "$VIOLATIONS_LLM_COMPLETE" ]; then
  echo "❌ LLM context boundary violation — files importing llmComplete outside llm-context/:"
  echo "$VIOLATIONS_LLM_COMPLETE"
  echo ""
  FAILED=1
fi

if [ -n "$VIOLATIONS_AGENTIC" ]; then
  echo "❌ LLM context boundary violation — files importing runAgenticChat outside llm-context/:"
  echo "$VIOLATIONS_AGENTIC"
  echo ""
  FAILED=1
fi

if [ "$FAILED" -eq 1 ]; then
  echo "All LLM calls must go through dashboard/lib/llm-context/assemble.ts"
  echo "  - Replace direct llmComplete() calls with assembleRequest() from '@/lib/llm-context'"
  echo "  - Replace direct runAgenticChat() calls with assembleRequest() from '@/lib/llm-context'"
  exit 1
fi

echo "✅ llm-context boundary check passed"
