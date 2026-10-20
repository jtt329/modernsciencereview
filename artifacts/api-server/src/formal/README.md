# Formal Lab

The current source-linked workflow is documented in
[Formal Lab v2](../../../../docs/formal-lab-v2.md). The separate entry point is
`/formal-lab`; the original prepared scalar baseline remains explicitly labelled
at `/formal-lab?prepared=1`.

## Current pipeline

A signed-in author uploads an actual PDF, text or TeX source. The system retains
its original bytes and SHA-256, indexes numbered source lines, and asks AI to
inventory source-specific inputs and assertions. A coverage audit and bounded
scalar formalization groups propose inspectable mathematical candidates. The
prepared example’s equations are not supplied to fresh source analysis.

The author reviews the original source, extracted lines, assumptions, definitions,
domains, exact equations, coverage and gaps, then approves an immutable revision.
A separate publication checkbox is optional and initially unchecked. Approval
without publication consent keeps the submission private. Edits require a new
revision and approval.

The server invokes the independent fixed SymPy checker against the stored
approved package. Actual results determine coverage labels; definitions and
physical inputs do not become independently proved physics. A post-verification
AI pass generates an explanation and qualitative scientific review. If it fails,
a clearly labelled deterministic report preserves the computed findings.

With explicit consent, eligible conditional consequences join isolated subject
records with immutable source/revision/check references. A version-bound narrative
compiles those contributions into a readable subject account above the preserved
evidence pool. Unsupported assertions and tooling gaps remain visible. Neither
the paper review nor subject synthesis establishes physical applicability,
source fidelity, experimental validity or literature-wide novelty automatically.
An argument outside the scalar tool’s language may already be supplied by the
manuscript; not checking it is different from finding it absent or incorrect.

## Components

- `contract.ts`, `package.ts`: bounded expression trees, package validation,
  provenance contracts, canonical JSON and revision digests.
- `sources.ts`, `ingest.ts`: original source retention, extraction, inventory,
  coverage audit and independently namespaced scalar formalization.
- `model.ts`, `jobs.ts`: configured AI transport and persisted processing events.
- `store.ts`: owner-scoped submissions, immutable revisions, approval and results.
- `checker.ts`, `../../formal-verifier/`: credential-free static symbolic worker,
  exact arithmetic, dimensions/domains, deterministic traces and resource bounds.
- `outputs.ts`, `subjects.ts`: computed source coverage, explanation/review,
  explicit publication, conservative deduplication and cited subject synthesis.
- `../routes/formalLab.ts`: authenticated workflow and limited public access to
  explicitly published immutable snapshots.

No existing paper reviews, scoring, readers or field-overview records are replaced.
All new database objects are isolated additive `formal_lab_*` tables.

For pilot limits, privacy/retry behavior, Python and Railway configuration, and the
actual JavaScript/Python/build verification commands, use the
[v2 documentation](../../../../docs/formal-lab-v2.md). The checker’s detailed
mathematical scope is in [its README](../../formal-verifier/README.md).
