#!/bin/bash
# Sequential seed runner (JT: no notification chaining). Rounds logged with exit code + wall
# time to the runner log; ALL_ROUNDS_DONE marks completion. Resumable: already-seeded papers
# are skipped by the harness guard, so re-running this script is always safe.
set -u
cd /Users/jttyler/Projects/modernsciencereview
LOG="${SEED_RUNNER_LOG:?SEED_RUNNER_LOG required}"
ROUNDS=("j,b" "9,pw" "ck,10" "8" "7,6")
TOTAL_START=$(date +%s)
for P in "${ROUNDS[@]}"; do
  S=$(date +%s)
  echo "ROUND_START papers=$P at=$(date -u +%H:%M:%SZ)" >> "$LOG"
  MODE=live PAPERS="$P" PGLITE_DIR="/Users/jttyler/Desktop/Top 55/phase1_overview/seed-db" \
    NODE_ENV=production AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com \
    node --env-file=.env scripts/phase1-seed-overview.mjs >> "$LOG" 2>&1
  E=$?
  echo "ROUND_END papers=$P exit=$E secs=$(( $(date +%s) - S ))" >> "$LOG"
done
echo "ALL_ROUNDS_DONE total_secs=$(( $(date +%s) - TOTAL_START ))" >> "$LOG"
