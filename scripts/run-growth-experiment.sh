#!/bin/bash
# S6 coverage-growth experiment (Phase 2a brief): four FRESH from-empty seeds on the
# generalized system (SKELETON=none, neutral slug), A ⊂ B ⊂ C sharing ingestion order so
# differences isolate coverage; plus an order-permuted B. Auditor after each run.
#
# Sequential, no notification chaining (JT). Logs ROUND_START/ROUND_END exit+secs per round,
# RUN_DONE per run, ALL_RUNS_DONE at the end. NEVER deletes anything — fresh-ness comes from
# pre-cleaned per-run PGLITE_DIRs (the launcher removes them ONCE before first start); the
# harness skip-guard makes re-running this script after a crash safe and cheap.
set -u
cd /Users/jttyler/Projects/modernsciencereview
LOG="${GROWTH_LOG:?GROWTH_LOG required}"
OUTDIR="/Users/jttyler/Desktop/Top 55/phase1_overview"
PAPERS_FILE="$OUTDIR/corpus_c_tail.json"

# Shared seed order: A = first 3 of B; C = B + the remaining folder papers in folder order.
B_ROUNDS=("02,01,3" "u,11,4" "j,b,9" "pw,ck,10" "8,7,6")
C_TAIL_ROUNDS=("c08,c09,c10" "c13,c14,c15" "c16,c17,c18" "c19,c20,c21" "c22,c23,c26" \
  "c27,c28,c29" "c30,c31,c32" "c33,c35,c36" "c37,c38,c39" "c40,c41,c42" \
  "c44,c45,c47" "c48,c49,c50" "c51,c52,c53" "c54,c55")
# Permuted B: exact reverse — the crank submission arrives FIRST on an empty field.
BPERM_ROUNDS=("6,7,8" "10,ck,pw" "9,b,j" "4,11,u" "3,01,02")

run_rounds() { # $1=run name, $2=db dir, rest=round csv lists
  local NAME="$1" DB="$2"; shift 2
  for P in "$@"; do
    local S=$(date +%s)
    echo "ROUND_START run=$NAME papers=$P at=$(date -u +%H:%M:%SZ)" >> "$LOG"
    MODE=live SKELETON=none OVERVIEW_SLUG=field PAPERS="$P" PAPERS_FILE="$PAPERS_FILE" \
      PGLITE_DIR="$OUTDIR/$DB" NODE_ENV=production \
      AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com \
      node --env-file=.env scripts/phase1-seed-overview.mjs >> "$LOG" 2>&1
    echo "ROUND_END run=$NAME papers=$P exit=$? secs=$(( $(date +%s) - S ))" >> "$LOG"
  done
  local S=$(date +%s)
  echo "AUDIT_START run=$NAME at=$(date -u +%H:%M:%SZ)" >> "$LOG"
  MODE=audit AUDIT_LABEL="$NAME" OVERVIEW_SLUG=field PAPERS_FILE="$PAPERS_FILE" \
    PGLITE_DIR="$OUTDIR/$DB" NODE_ENV=production \
    AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com \
    node --env-file=.env scripts/phase1-seed-overview.mjs >> "$LOG" 2>&1
  echo "AUDIT_END run=$NAME exit=$? secs=$(( $(date +%s) - S ))" >> "$LOG"
  echo "RUN_DONE run=$NAME" >> "$LOG"
}

TOTAL_START=$(date +%s)
run_rounds run-a run-a-db "${B_ROUNDS[0]}"
run_rounds run-b run-b-db "${B_ROUNDS[@]}"
run_rounds run-c run-c-db "${B_ROUNDS[@]}" "${C_TAIL_ROUNDS[@]}"
run_rounds run-bperm run-bperm-db "${BPERM_ROUNDS[@]}"
echo "ALL_RUNS_DONE total_secs=$(( $(date +%s) - TOTAL_START ))" >> "$LOG"
