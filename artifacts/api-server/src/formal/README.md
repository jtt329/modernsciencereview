# Formal Lab prototype

Separate public entry: `/formal-lab`. It never writes papers, reviews, overview blocks, scoring, or existing explanation records.

## Working flow

1. Select versioned cited inputs and provide source text and a main claim.
2. Request a schema-constrained AI proposal (with at most one structural correction attempt), or inspect the prepared one-page packet. AI receives only the explicit source excerpt, claim, metadata, and selected inputs.
3. Save and inspect an immutable revision. All definitions, domains, hypotheses, candidate equations, explanation text, and provenance belong to its SHA-256 digest.
4. Explicitly approve that digest as the signed-in author. Edits and regeneration create a new revision with no approval or result.
5. The fixed SymPy checker reloads the approved package from storage. Its report binds the same digest. Explanatory paragraphs appear only if all their referenced mathematical claims checked; the prose interpretation itself is not machine verified.

The public example report is an unapproved demonstration. It does not record J. T. Tyler's approval. The author test source is the exact October 12, 2026 one-page PDF, with an extracted TeX transcription for the model and a source SHA-256. Its ten prepared scalar claims all check. Thermal and FRW statements are outside this first prepared claim set.

## Components

- `contract.ts`: declarative expression tree and package/report types.
- `package.ts`: API limits, exact field validation, canonical JSON and SHA-256.
- `store.ts`: isolated additive `formal_lab_submissions` and `formal_lab_revisions` tables; owner checks and row locks prevent stale approval/results from becoming current.
- `checker.ts`: at most two static Python subprocesses, 15-second wall limit, bounded output, no inherited credentials. The worker also applies CPU/memory limits on Linux.
- `../routes/formalLab.ts`: catalog, public demo, private drafts, immutable revisions, AI, approval and verification.
- `../../formal-verifier/`: pinned SymPy worker, tests and detailed checker scope.

## Runtime and deployment

Local setup:

```sh
python3 -m venv .formal-venv
.formal-venv/bin/python -m pip install -r artifacts/api-server/formal-verifier/requirements.txt
pnpm test:formal
.formal-venv/bin/python artifacts/api-server/formal-verifier/test_check.py
```

`FORMAL_PYTHON` can select another interpreter. The API build copies the static checker beside its bundle. Railway's API service alone uses `RAILPACK_CONFIG_FILE=artifacts/api-server/railpack.formal.json`; this adds pinned Python and a virtual environment. Web and review-worker configurations remain independent. Existing AI credentials and authentication are reused. `FORMAL_LAB_MODEL` overrides the existing Gemini draft model choice.

All writes require the existing account session; author drafts and reports are private. Foreign owners receive 404. Browser writes require a trusted site origin. Prototype limits include 50 submissions/account, 100 revisions/submission, one AI request/account at a time and six/hour; these are basic pilot controls, not a public high-volume service. The AI limiter is process-local. No user-supplied code or symbolic string parser is executed.

## Scope and next increment

This first checker handles bounded exact scalar rational/polynomial identities, integer powers, derivatives, simultaneous substitutions, dimensions, and denominator domains. It does not verify source authenticity, prose assumptions, experimental evidence, novelty, tensor calculus, PDEs, or physical applicability. Definitions are explicit premises, not newly proved physics. Nonzero residuals disprove an identity over its declared domain, not equality at every point.

The next useful experiment is an author-approved small packet followed by an independent review of whether it faithfully expresses the source. Then add a second example from a different paper. Add a Lean/Mathlib/Physlib adapter only for selected theorems that benefit from kernel checking; record all hypotheses, audit axioms and proof gaps, and preserve the distinction between conditional theorem checking and evidence for physics.
