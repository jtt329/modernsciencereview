#!/bin/bash
# Phase 2a ACCEPTANCE test (post-S6, fixed system): one fresh from-empty Run C (all 56 folder
# papers) + one fresh order-permuted Run B (crank first), on the P1-P7 system. Structure pass
# runs every STRUCTURE_PASS_EVERY papers and ALWAYS on the final round of each run
# (STRUCTURE_PASS_FINAL=1). Auditor after each run. Sequential, resumable, never deletes.
# Nothing to the live DB. Decisive tests: reorganization occurs, C is not a many-root forest,
# anchor opening reflects breadth, strict-inequality green, cranks fail-closed, Ong localizes
# without vanishing, permuted-B's Ong-as-root order artifact heals through the structure pass.
set -u
cd /Users/jttyler/Projects/modernsciencereview
LOG="${ACCEPT_LOG:?ACCEPT_LOG required}"
OUTDIR="/Users/jttyler/Desktop/Top 55/phase1_overview"
PAPERS_FILE="$OUTDIR/corpus_c_tail.json"

B_ROUNDS=("02,01,3" "u,11,4" "j,b,9" "pw,ck,10" "8,7,6")
C_TAIL_ROUNDS=("c08,c09,c10" "c13,c14,c15" "c16,c17,c18" "c19,c20,c21" "c22,c23,c26" \
  "c27,c28,c29" "c30,c31,c32" "c33,c35,c36" "c37,c38,c39" "c40,c41,c42" \
  "c44,c45,c47" "c48,c49,c50" "c51,c52,c53" "c54,c55")
BPERM_ROUNDS=("6,7,8" "10,ck,pw" "9,b,j" "4,11,u" "3,01,02")

run_rounds() { # $1=run name, $2=db dir, then: all round csv lists (last one gets FINAL structure pass)
  local NAME="$1" DB="$2"; shift 2
  local ROUNDS=("$@") n=$#
  for i in "${!ROUNDS[@]}"; do
    local P="${ROUNDS[$i]}" S FINAL=""
    [ "$i" -eq "$((n - 1))" ] && FINAL="STRUCTURE_PASS_FINAL=1"
    S=$(date +%s)
    echo "ROUND_START run=$NAME papers=$P final=${FINAL:-0} at=$(date -u +%H:%M:%SZ)" >> "$LOG"
    # `env` (not a bare assignment prefix): a word produced by expansion is NOT recognized as an
    # assignment prefix by the shell, so ${FINAL:+...} inline would make the shell try to EXECUTE
    # the next VAR=val as a command. env parses its VAR=val args at runtime; an empty $FINAL vanishes.
    env MODE=live SKELETON=none OVERVIEW_SLUG=field PAPERS="$P" PAPERS_FILE="$PAPERS_FILE" \
      PGLITE_DIR="$OUTDIR/$DB" STRUCTURE_PASS_EVERY=5 $FINAL \
      NODE_ENV=production AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com \
      node --env-file=.env scripts/phase1-seed-overview.mjs >> "$LOG" 2>&1
    echo "ROUND_END run=$NAME papers=$P exit=$? secs=$(( $(date +%s) - S ))" >> "$LOG"
  done
  local S=$(date +%s)
  echo "AUDIT_START run=$NAME at=$(date -u +%H:%M:%SZ)" >> "$LOG"
  env MODE=audit AUDIT_LABEL="accept-$NAME" OVERVIEW_SLUG=field PAPERS_FILE="$PAPERS_FILE" \
    PGLITE_DIR="$OUTDIR/$DB" NODE_ENV=production \
    AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com \
    node --env-file=.env scripts/phase1-seed-overview.mjs >> "$LOG" 2>&1
  echo "AUDIT_END run=$NAME exit=$? secs=$(( $(date +%s) - S ))" >> "$LOG"
  echo "RUN_DONE run=$NAME" >> "$LOG"
}

TOTAL_START=$(date +%s)
run_rounds c accept-c-db "${B_ROUNDS[@]}" "${C_TAIL_ROUNDS[@]}"
run_rounds bperm accept-bperm-db "${BPERM_ROUNDS[@]}"
echo "ALL_RUNS_DONE total_secs=$(( $(date +%s) - TOTAL_START ))" >> "$LOG"
