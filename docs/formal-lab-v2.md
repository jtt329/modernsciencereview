# Formal Lab v2

Formal Lab is a separate experimental submission and explanation workflow at
`/formal-lab`. It does not replace the existing paper reviews, scoring, readers,
or field-overview records. The old prepared scalar example remains available at
`/formal-lab?prepared=1` and is labelled separately from fresh source analysis.

## Actual workflow

1. A signed-in user uploads a PDF, plain text or TeX source. The original bytes
   are retained privately, hashed with SHA-256, and extracted into numbered
   page/line references. TeX is read as text; uploaded code is never executed.
2. The configured AI receives the numbered source and, for PDFs, the original
   PDF. It proposes a source-specific inventory of inputs and assertions. A
   further model pass audits omitted claims, physical foundations and scope.
   This is model-assisted extraction, not proof that the inventory is exhaustive
   or the transcription faithful.
3. Up to five independently namespaced scalar models are formalized. Separate
   namespaces prevent an independent coordinate in one model from silently
   becoming a family-defined quantity in another. Supported claims are encoded
   as bounded expression trees. Other assertions remain visible with a reason.
4. The author inspects the original, numbered source, proposed inputs,
   assumptions, domains, definitions, exact equations, coverage and warnings.
   Editing the package saves a new immutable revision. Its canonical JSON
   digest binds its mathematics, assumptions, interpretation and provenance.
5. The author explicitly approves that exact revision. Public publication is a
   separate, optional checkbox, initially unchecked. Approval alone keeps the
   source and results private. A revision’s recorded approval/consent is not
   silently applied to later revisions.
6. The server reloads the approved revision and invokes the independent static
   SymPy worker. AI cannot provide a successful verification status. Each
   candidate has its own result, residual, dimensional assessment, domain
   restrictions and deterministic checking steps.
7. Coverage is computed from the actual results. An input stays an adopted
   premise; a definition restatement does not become an independent derivation.
   Every nonempty extracted line is mapped or explicitly left unassessed.
8. AI generates the paper explanation and qualitative scientific review from
   the source, approved package and checker report. Reference IDs are validated
   and section statuses are recomputed by the server. If generation fails, the
   actual findings remain available as a labelled deterministic evidence report.
9. With explicit publication consent, eligible conditional consequences join
   an isolated shared subject account. Source-linked evidence paragraphs remain
   immutable records. Exact content and dependency/premise matching can associate
   an already represented contribution with its existing paragraph; approximate
   similarity never discards a result.
10. A further AI pass compiles a readable subject narrative above that evidence
    pool. Each section references existing paragraph IDs; unmapped contributions
    are retained explicitly. The narrative is attached only to the evidence
    version it read. A failed or oversized synthesis preserves the complete
    evidence pool, and stale narratives are not displayed as current.

## Output and traceability

The results provide **Verification**, **Explanation**, **Scientific review**,
**Source & log**, and **Field contribution** tabs. They expose different kinds of
evidence rather than a blanket “paper verified” verdict.

- Source line IDs point to extracted text and its original page. PDF extraction
  can damage ordering, subscripts, superscripts or fractions; the original PDF
  remains available for comparison and is also supplied to the model.
- Inputs have stated/cited/inferred provenance. Candidate equations cite source
  lines, and each coverage unit records its mathematical role and disposition.
- Checking steps describe deterministic operations actually performed; they are
  not an AI’s private reasoning or an independently verified prose derivation.
- Processing stages are recorded as server-owned job events; author package edits cannot replace the server ingestion trail. Completed processing evidence is
  retained with the submission output where available.
- Shared paragraphs preserve inputs and conditions, supporting submission,
  revision digest, source file, source lines and checked claim IDs. A later
  private draft does not rewrite a previously published snapshot.
- The scientific review uses a compiled summary, explanatory contribution,
  mathematical correctness/coverage, physical justification, prior work,
  strengths, open questions and recommendation. It has no invented numerical
  score. It does not claim a literature-wide novelty search or validation of
  every cited paper.

## What a check means

The worker supports exact scalar rational/polynomial algebra, bounded integer
powers, declared scalar derivatives, simultaneous substitutions, denominator
restrictions and SI dimensions. Seven dimension exponents support thermal
quantities; legacy three-element mass/length/time vectors are padded internally.
Definitions are an acyclic dependency graph and explicit premises. Independent
coordinates are differentiated before family substitutions.

A passing check establishes the specified mathematical equality under its
stated premises and domains. It does not establish that every sentence in a
linked source span has been formalized. “Unsupported,” “inconclusive,”
“unformalized,” or an execution failure describes a limitation of this
translation/check, and does not show that the paper is false.

The prototype does not yet reproduce general tensor calculus, gravitational
action variations, null-boundary/corner derivations, PDE solutions, experiments,
or literature-wide novelty assessments. It is not a Lean kernel proof and does
not establish consistency of arbitrary physical postulates. AI prose and
cross-paper synthesis remain interpretations with inspectable evidence.

For the horizon example, differentiating a declared boundary potential tests its
consequences. Checking its physical/canonical foundation requires tracing the
stated Einstein action and boundary/corner prescription to the selected scalar
response, with its clock, admissible variations and regime. Such an argument may
already appear in the manuscript or its cited sources: the scalar engine’s not
checking it is different from finding the argument absent. A conditional theorem
within accepted GR need not require a new experiment; a novel empirical
prediction requires empirical assessment. The cited sources must be assessed at
the level of the specific claim and conventions, not treated as a general stamp
of correctness.

## Pilot boundaries and retained work

Uploads are bounded to 5 MB, 12 PDF pages, 45,000 extracted characters and 900
numbered lines. Oversized or unreadable sources are rejected explicitly rather
than silently truncated. Scanned-PDF OCR is not supported. Formalization is
bounded to five scalar groups; unsupported portions remain visible.

Submissions, source files, revisions, jobs, publications and subject accounts use
isolated additive `formal_lab_*` PostgreSQL tables. Author drafts require the
existing account session and owner checks. Published access exposes only
explicitly approved publication snapshots and source files. Jobs are persisted,
but work executes in the API process rather than a durable external queue;
server restarts can interrupt an in-flight model stage. Saved source files and
completed revisions/reports remain available for retry. Intermediate inventory and
audit objects remain in memory until a complete draft is saved; retries currently
restart analysis from the retained source rather than resuming those objects. Pilot account/job limits
are enforced; this is not a high-volume public service.

## Runtime and deployment

The API requires its existing `DATABASE_URL`, account/session configuration and
Gemini integration credentials. The submission page offers three allowlisted
profiles: the existing Gemini workflow, GPT-6.1 Sol, and Gemini 4 Argon. Sol uses
`OPENAI_API_KEY` with OpenAI's Responses API; Argon uses the existing Gemini
credential. Configured availability in the catalog is not proof of successful
inference or available quota. No secret is exposed to the browser.

`FORMAL_LAB_MODEL` selects the existing Gemini profile; otherwise it uses
`SCIREVIEW_GEMINI_REVIEW_MODEL`, then its coded fallback. Selecting Sol or Argon
for a new analysis does not change the older reviews or existing submissions.
The server records the exact requested model on the job and saved revision,
retains it through same-source author edits, and uses it again for explanation
and review generation. Changing the source requires fresh analysis. Each model
call records requested/returned model IDs and provider-reported input, output,
reasoning and cache token counts in the source/processing log when available.
Output counts include reported reasoning tokens; usage is not a final bill.

Both providers receive the original PDF plus numbered text. Sol uses high
reasoning and strict structured output over a bounded Responses event stream; only
a completed terminal response is accepted. Its fifteen-minute stage deadline also
covers any allowed transient retry. A timeout or interrupted stream does not
automatically duplicate a potentially billed request. Argon uses high thinking
without sampling parameters. Per-request model contexts keep simultaneous jobs isolated. Long
reasoning calls have bounded deadlines and refresh the persisted job lease.
The pinned current one-page source is dated 22 October 2026 and is separate from
the older prepared baseline. Loading that sample selects the file locally;
analysis requires an explicit click.

Use the actual `src/formal/model.ts` configuration when changing deployments.

`FORMAL_PYTHON` can select the Python interpreter. Otherwise the API checks a
root `.formal-venv/bin/python`, then `python3`. Install the pinned SymPy
requirements into the selected interpreter:

```sh
python3 -m venv .formal-venv
.formal-venv/bin/python -m pip install -r artifacts/api-server/formal-verifier/requirements.txt
```

PDF extraction runs in a separate worker with a 15-second timeout, heap limits and two-reader capacity. The API build bundles that reader and copies the fixed verifier into its deployment bundle. Its isolated
subprocess receives JSON on stdin with a minimal environment and returns a
bounded JSON report. No user-generated Python or string expression evaluator is
executed. CPU/memory/complexity limits are enforced by the worker where supported,
with an additional API wall timeout, output bound and concurrency cap.

The existing Railway API service uses
`RAILPACK_CONFIG_FILE=artifacts/api-server/railpack.formal.json`. That file adds
pinned Python, builds the API, and installs the pinned verifier dependencies in
`/app/.formal-venv`. Preserve the independent web and review-worker deployment
configuration. Existing website and review data require no replacement migration.
Schema additions are lazy and additive; do not run a destructive schema push.

## Validation

Run from the repository root:

```sh
pnpm test:formal
.formal-venv/bin/python -B -m unittest discover -s artifacts/api-server/formal-verifier -v
pnpm typecheck
pnpm test
pnpm build
```

`test:formal` covers package/proposal bounds, immutable digests, source and
coverage reference validation, namespaced ingestion, unsupported gaps, exact
publication consent, conditional field compilation, conservative deduplication,
and version-bound subject narratives. Python tests exercise actual SymPy
calculations, dimension/domain failures, substitutions, definition restatements,
malicious/unsupported ASTs, limits and the subprocess protocol. These commands
are distinct: the current root `pnpm test` does not automatically include the
formal-lab tests or Python suite.

Deployment/browser verification should include a real source upload and fresh AI
analysis; inspection and approval of the resulting revision; independent checking;
all output tabs and numbered-source links; private versus explicitly published
access; subject-to-source evidence links; reload/revisit behavior; desktop/mobile
layout; and the existing main site. Unit tests cannot substitute for that actual
pipeline check. Record observed outcomes separately rather than assuming fixed
numbers of extracted claims, passing checks or generated sections.

## Review conversations, version history, and research assessments

The current interface has four stages: **Upload → Review & approve → Verify → Results**.
The review and approval stages share one source-linked view. Approval starts
verification and output generation immediately. A repeated request reuses the
same live exact-revision job; a reload does not request another paid analysis.
A failed publication phase can resume from saved mathematical and explanation
outputs without regenerating them.

Item-level discussions cover inputs, assumptions, definitions, claims, warnings,
source statements and lines, and major review/explanation/field sections. The
server stores each comment before requesting the selected model's response.
The model can explain disagreement or propose bounded before/after replacements.
It reads the full current source and formulation, plus existing verification and
review evidence. Proposed edits are validated as data, checked against exact
before-values and source IDs, and diagnostically checked across all candidates.
They are never author approval. Explicit acceptance creates a new unapproved
revision; old approval, results and publication consent do not carry over.
Accepted manuscript-line changes create an immutable amended text transcription
with stable line IDs and ancestry. It is clearly distinguished from the original
typeset PDF. The original upload and prior reviews remain accessible in history.

Result counters open their exact equation, statement or input lists. Source/log
issues link to the precise affected item. Derived coverage reconciliation can
recover a missing link only for an exact atomic ratio identity, matching approved
symbol names and the identical source-line span, with an independently passing
check. It never rewrites the approved package or original report; the interface
shows old and reconciled counts separately. Context, adopted premises, partial
coverage, unassessed claims and actual contradictions have distinct labels.

Canonical and literature assessments are separate artifacts bound to the exact
approved revision, digest and source hash. New processing runs attempt them after
saving the core results; existing runs can request them explicitly. A retrieval
or model failure preserves the completed core report and leaves an explicit
research gap with an independent retry action. Public reads require the exact
published snapshot; private comments and revision history remain owner-only.

The canonical supplement retrieves only allowlisted, versioned primary arXiv
sources explicitly cited by the manuscript. It assesses action, polarization,
clock, variations, corners, signs and regime using targeted passages. A separate
trusted SymPy script checks inverse cut-metric and area identities, every component
of the four-dimensional Palatini Ricci variation, a stated regular static-horizon
canonical momentum limit, and scalar/thermal coefficient identities. These are
fixed prerequisite computations with explicit assumptions, not a generic proof
compiler for arbitrary null-boundary actions. AI source agreement is labelled
separately from exact computation; a full canonical derivation is not certified.

The literature supplement plans bounded queries and executes actual public
arXiv and Crossref metadata searches. It records queries, dates, unavailable
providers, identifiers, sources and whether metadata, abstracts, or selected
passages of explicitly cited primary papers were available. Selected passages
are labelled separately from a full reading of the paper.
It explains inputs/construction/outputs, the paper's argument, established prior
work, proposed advances, field placement and remaining limits. Comparisons must
cite retrieved records; absence of a result is not proof of novelty. Abstracts
and full retrieved source passages are not republished wholesale in evidence.

The Results view has four tabs: Verification, Explanation, Scientific review, and
Source & log. Field contribution is an assessment within Scientific review, not
a duplicate explanation tab. It evaluates novelty, conceptual insight, predictions
where supplied, and the proposed change to the subject account against the
retrieved evidence. Existing saved field contributions and publication links are
preserved.

The single evidence download retains all of the original five-output snapshot and adds
available research assessments, this revision's authorized private discussions,
and a labelled public subject snapshot when applicable. The original PDF remains
a separately linked, hashed file. Missing supplementary data is disclosed in the
export rather than invented or silently called complete.


## Public library, current assessment and author corrections

`/formal-lab` now browses explicitly published papers and source-linked subject
accounts. `/formal-lab/submit` opens the upload workflow; existing
`/formal-lab?submission=...` review links remain valid. Public cards come only
from the latest published snapshot, never a newer private author draft. Subject
maps link the actual existing compiled paragraphs and their source evidence.

A separate, append-only scientific assessment synthesizes the exact approved
source, original verification, canonical and literature supplements, accepted
review corrections, and cited supporting material. Its evidence fingerprint is
recomputed on reads; a changed input makes the assessment visibly stale. Reading
or reloading never starts an AI call. Existing papers can explicitly refresh the
assessment; new verification runs attempt it after preserving completed outputs.
Its overall summary and four tab summaries distinguish established conditional
mathematics, adopted standard premises, proposed contribution and genuine open
questions. Publication readiness is a qualified scientific assessment, not new
author approval or publication consent.

Rigor counts are computed from actual evidence, not chosen by the model. Original
scalar claims, canonical prerequisites, fixed geometry checks, source coverage and
literature access are separate categories, never a percentage of scientific truth.
The fixed Rindler supplement checks six declared geometric statements using 26
coordinate/component identities. It establishes the specified normal distance,
reference acceleration and independent planar area; it does not certify arbitrary
tensor equations or a complete general null-boundary variational theorem.

The source-aware assessment retrieves five allowlisted primary papers, including
Cai–Kim and Akbar–Cai. It distinguishes instantaneous equilibrium screen pressure
from dynamical horizon-temperature and bulk work-density conventions. Explicitly
identified companion excerpts can supply cited canonical derivation context,
with URL, page locators and a content hash. They never replace or silently amend
the primary manuscript.

Saved discussions may now propose review-only resolutions separately from
manuscript amendments. An author explicitly accepts a bounded, fingerprinted
before/after correction or disposition. The immutable resolution ledger preserves
the original review, source, approved package and exact check results. A review
refresh considers accepted corrections across all sections; accepting a comment
does not by itself mark an open scientific concern resolved. Public overlays
contain accepted evidence-linked corrections only, without private conversations.
Queue failure leaves the accepted correction saved and a visible refresh action.
The single evidence export adds the current assessment and resolution record while
retaining the original submission and all previous result artifacts.
