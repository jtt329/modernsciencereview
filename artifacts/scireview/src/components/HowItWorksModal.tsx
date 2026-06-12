import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Loader2 } from 'lucide-react';

interface HowItWorksModalProps {
  onClose: () => void;
}

// Sections 5-6 and the extended era paragraph describe clauses that exist
// only in the v19 prompt. Flip this with v19 activation; until then the
// page shows only what is true under the active prompt.
const V19_ACTIVE = false;

const CENTRALITY_CLASSES = [
  ['C1', 'Establishes a new law, dynamics, mechanism, phenomenon, or empirical fact (including a major new measurement capability demonstrated in the manuscript).'],
  ['C2', 'Derives or recovers known laws from fewer, firmer, or more fundamental primitives, or proves a new theorem about them.'],
  ['C3', 'Unifies, reorganizes, translates, or systematizes known results under one construction or representation.'],
  ['C4', 'Constrains, bounds, or excludes alternatives; confirmations and null results.'],
  ['C5', 'Provides methods, datasets, instruments, or diagnostics, valued at the capability demonstrated.'],
] as const;

const FIRMNESS_CLASSES = [
  ['F1', 'Directly measured phenomena or data.'],
  ['F2', 'Established-theory regimes with strong indirect evidence (astrophysical black holes, the expanding universe as measured).'],
  ['F3', 'Plausible but unobserved constructs of established theory (horizon interiors, Hawking radiation of stellar-mass black holes).'],
  ['F4', 'Constructs internal to untested frameworks (extremal or supersymmetric black holes, higher dimensions, specific quantum gravity proposals).'],
] as const;

const GlossaryCards = ({ entries }: { entries: ReadonlyArray<readonly [string, string]> }) => (
  <div className="grid sm:grid-cols-2 gap-3 mt-3">
    {entries.map(([label, text]) => (
      <div key={label} className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
        <span className="inline-block rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest">{label}</span>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">{text}</p>
      </div>
    ))}
  </div>
);

const Section = ({ id, number, title, children }: { id: string; number: number; title: string; children: React.ReactNode }) => (
  <section id={id} className="scroll-mt-6">
    <h3 className="text-xl font-black text-slate-900">
      <span className="text-slate-400 mr-2">{number}.</span>{title}
    </h3>
    <div className="mt-3 space-y-3 text-[15px] text-slate-600 leading-relaxed">{children}</div>
  </section>
);

type HowItWorksStats = {
  promptVersion: string | null;
  totalReviews: number;
  recognizedReviews: number;
  exampleAnchoredPaperId: string | null;
};

export default function HowItWorksModal({ onClose }: HowItWorksModalProps) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [stats, setStats] = useState<HowItWorksStats | null>(null);

  useEffect(() => {
    if (prompt !== null) return;
    setPromptLoading(true);
    fetch('/api/papers/system-prompt', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setPrompt(d.prompt))
      .catch(() => setPrompt('Failed to load system prompt.'))
      .finally(() => setPromptLoading(false));
  }, [prompt]);

  useEffect(() => {
    fetch('/api/stats/recognition')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && typeof d.totalReviews === 'number') setStats(d); })
      .catch(() => {});
  }, []);

  const calibrationTabLink = stats?.exampleAnchoredPaperId
    ? `/papers/${encodeURIComponent(stats.exampleAnchoredPaperId)}`
    : null;
  let sectionNumber = 0;
  const nextNumber = () => { sectionNumber += 1; return sectionNumber; };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto"
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8"
      >
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-7 py-6 border-b border-slate-100">
            <button
              onClick={onClose}
              className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-indigo-600 transition-colors mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to homepage
            </button>
            <h2 className="text-3xl font-black text-slate-900">How Modern Science Review works</h2>
            <p className="text-base text-slate-500 mt-2 leading-relaxed max-w-2xl">
              Every paper on this site is reviewed by an AI scientific referee under a fixed, versioned, public
              protocol. This page explains the entire pipeline — what the reviewer sees, how scores are computed, how
              papers are compared against a benchmark of landmark and failed physics papers, and what the system can
              and cannot promise.
            </p>
          </div>

          <div className="px-7 py-8 space-y-10">
            <Section id="hiw-identity-blind" number={nextNumber()} title="The identity-blind protocol">
              <p>
                Before review, the manuscript is stripped of identifying information: author names, affiliations,
                acknowledgments, and metadata are removed, and the reviewer is instructed to judge the work from its
                contents alone.
              </p>
              <p>
                We say <em>identity-blind</em>, not "blind," on purpose. A model trained on the scientific literature
                may still recognize a famous paper from its content. We don't pretend otherwise — we measure it. The
                reviewer must disclose when it suspects it recognizes the work, the disclosure is stored with the
                review, recognition rates across our benchmark are published, and recognized papers are barred from
                serving as calibration anchors. The review also flags any text that appears designed to instruct the
                reviewer rather than inform a reader (prompt-injection hardening).
              </p>
              {stats && stats.totalReviews > 0 && (
                <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
                  Live recognition rate under the active prompt ({stats.promptVersion}): the reviewer disclosed
                  recognition on {stats.recognizedReviews} of {stats.totalReviews} reviews.
                </p>
              )}
            </Section>

            <Section id="hiw-review" number={nextNumber()} title="The review itself">
              <p>
                Each manuscript is reviewed in two independent blind passes by the same model family, followed by an
                adjudication pass that reconciles them into the final review. Disagreement between passes is recorded,
                not hidden: the per-pass scores and their spread are stored with the review, and both blind passes are
                readable on the paper page alongside the final review.
              </p>
            </Section>

            <Section id="hiw-diagnostic" number={nextNumber()} title="The diagnostic score: Input, Construction, Output">
              <p>
                The reviewer does not produce a gut-feeling grade. It fills out a structured diagnostic ledger with
                three dimensions, each scored 0–10 in half-point steps. The headline intrinsic score is 10 × the
                average of the three.
              </p>
              <p>
                <strong className="text-slate-800">Input Strength.</strong> What does the paper assume? The reviewer
                lists the primitive inputs — the theories, principles, and data the argument stands on — and grades how
                firm and how fundamental they are. Inputs are graded by empirical confirmation status alone: directly
                tested physics ranks highest, experimentally invalidated ideas rank lowest, and everything between is
                placed by the actual state of evidence — not by how large or prestigious the literature built on it is.
              </p>
              <p>
                <strong className="text-slate-800">Construction Strength.</strong> What does the paper build? The
                reviewer lists the constructions the paper introduces — definitions, methods, derivations, formalisms —
                and grades their quality: validity (does the argument hold), and how hard it would be to vary the
                construction while preserving the result.
              </p>
              <p>
                <strong className="text-slate-800">Output Strength.</strong> What does the paper deliver? The reviewer
                lists the central outputs and weighs them by correctness, support, depth, and breadth — where breadth
                counts only across genuinely independent cases.
              </p>
              <p>Every subscore comes with a written rationale and an itemized list, all public on the paper page.</p>
            </Section>

            <Section id="hiw-centrality" number={nextNumber()} title="Output centrality: what kind of result is it?">
              <p>Each central output is classified by what it changes:</p>
              <GlossaryCards entries={CENTRALITY_CLASSES} />
              <p>
                At equal correctness and support, higher classes carry more weight. These labels appear in the
                structured data; the written review describes them in plain words.
              </p>
            </Section>

            {V19_ACTIVE && (
              <Section id="hiw-output-firmness" number={nextNumber()} title="Output firmness: what is the result about?">
                <p>
                  An exact theorem about an untested framework is not the same achievement as a fact established about
                  nature. Each central output's <em>referent</em> — the thing the result is about — is classified by
                  firmness:
                </p>
                <GlossaryCards entries={FIRMNESS_CLASSES} />
                <p>
                  A result about an F4 referent is a framework-internal achievement, however exact its derivation — it
                  earns construction credit, not established-fact credit. This grading is applied symmetrically to all
                  research programs: the size, popularity, or prestige of a program's literature is not evidence and
                  does not enter the assessment.
                </p>
              </Section>
            )}

            {V19_ACTIVE && (
              <Section id="hiw-construction-firmness" number={nextNumber()} title="Construction firmness: how solid is the building?">
                <p>
                  Each central construction is graded on two axes: <strong className="text-slate-800">rigor</strong>{' '}
                  (proven theorem &gt; checked derivation &gt; consistent heuristic &gt; conjecture) and{' '}
                  <strong className="text-slate-800">forcedness</strong> (uniquely determined by the inputs &gt; natural
                  among few alternatives &gt; chosen &gt; tuned or ad hoc). The strongest constructions are proved{' '}
                  <em>and</em> forced; the weakest are conjectural <em>and</em> tunable. One deliberate counterweight: a
                  first-of-its-kind construction that survives basic consistency checks earns origination credit even at
                  heuristic rigor — polish is not the same thing as pioneering.
                </p>
              </Section>
            )}

            <Section id="hiw-era" number={nextNumber()} title="Judged against its own era">
              {V19_ACTIVE ? (
                <p>
                  The reviewer judges each paper against what its field had reason to believe at the time, not against
                  everything learned since. A 1973 paper is not penalized because its once-novel construction later
                  became standard, and a recent paper earns no credit merely for standing on fifty years of accumulated
                  structure. Rigor norms evolve too; each construction is judged against the demands of its problem, not
                  the stylistic standards of a later era.
                </p>
              ) : (
                <p>Each paper is judged against what its field had reason to believe at the time.</p>
              )}
            </Section>

            <Section id="hiw-calibration" number={nextNumber()} title="Calibration: pairwise comparison against the benchmark">
              <p>
                A score produced by reading one paper in isolation is only as good as the rubric. So we add a second,
                independent measurement: every paper is compared head-to-head against neighboring papers from our
                benchmark — a set of ~55 physics papers spanning acknowledged landmarks, solid mid-tier work, and known
                failures.
              </p>
              <p>The mechanics, in order:</p>
              <ol className="list-decimal list-outside ml-5 space-y-2">
                <li>
                  <strong className="text-slate-800">Cohorts.</strong> Papers are clustered by topic into small cohorts
                  of genuinely comparable work.
                </li>
                <li>
                  <strong className="text-slate-800">Blind pairs.</strong> Within a cohort, the model judges pairs of{' '}
                  <em>reviews</em> (stripped of scores and identifying conclusions): which paper has stronger inputs,
                  constructions, outputs — and which is stronger overall. "Overall" is its own judged question, not an
                  average of the three, which is why dimension win rates and the overall outcome can differ.
                </li>
                <li>
                  <strong className="text-slate-800">Position-bias control.</strong> Every pair is judged twice with the
                  papers' positions swapped. Inconsistent verdicts are flagged and down-weighted.
                </li>
                <li>
                  <strong className="text-slate-800">Ranking.</strong> A Bradley–Terry fit turns the pairwise outcomes
                  into a strength ranking within each cohort.
                </li>
                <li>
                  <strong className="text-slate-800">Anchors.</strong> A small set of admin-pinned anchor papers —
                  endorsed reference points spanning the full quality range, from a field-defining landmark pinned at
                  100 down to a failed paper pinned near 0 — fixes the scale. One global monotone curve maps every
                  paper's ranked position to 0–100 through all anchors pooled. Papers the reviewer recognized are
                  barred from automatic anchor service; an administrator can deliberately pin one as an anchor, and
                  that override is publicly badged on every page that uses it.
                </li>
                <li>
                  <strong className="text-slate-800">Bridges.</strong> Selected papers are compared across cohort
                  boundaries so all cohorts share one scale. A cohort with no anchor and no bridge still gets calibrated
                  through a median fallback, but is flagged with an "unanchored cohort" badge — lower confidence, on
                  purpose, in the open.
                </li>
              </ol>
              <p>
                The result is the <strong className="text-slate-800">calibrated score</strong> — the paper's measured
                position among its peers. The <strong className="text-slate-800">intrinsic score</strong> (from the
                diagnostic ledger alone) is shown alongside it. When the two disagree sharply, that disagreement is
                information, and it is published, not smoothed over.
              </p>
              <p>
                Every pairwise judgment — verdict, margin, and the model's written rationale — is stored and readable on
                the paper's{' '}
                {calibrationTabLink ? (
                  <a href={calibrationTabLink} className="font-bold text-indigo-600 hover:underline">Calibration tab</a>
                ) : (
                  <span className="font-bold">Calibration tab</span>
                )}
                . Nothing in the ranking is asserted; all of it is auditable.
              </p>
              <p>
                We also publish sensitivity analyses: re-fitting the calibration under different anchor choices moves
                most papers by 0–3 points, which is the evidence that the scores are measurement-dominated rather than
                anchor-dominated.
              </p>
            </Section>

            <Section id="hiw-publication-safety" number={nextNumber()} title="Publication safety">
              <p>
                Scores publish automatically — with one tripwire. If a paper's calibrated score diverges from its
                intrinsic score by more than 12 points, or its cohort's mapping shows geometric strain, the page shows
                the intrinsic score with a "calibration under review" badge until a human approves or holds the
                calibrated value. Everything else publishes untouched.
              </p>
            </Section>

            <Section id="hiw-realized-yield" number={nextNumber()} title="Realized Yield: the hindsight layer (where assessed)">
              <p>
                The blind review deliberately ignores history. A separate assessment — never blended into the scores
                above — asks the opposite question with hindsight fully permitted: what confirmed knowledge,
                measurements, or established methods did this paper's constructions actually produce in the historical
                record? Citations, fame, and activity volume do not count; only traced contributions to confirmed
                science do. Where assessed, this appears as a third chip: "Realized yield N at &lt;age&gt; years —
                &lt;ahead of / typical for / behind&gt; expectations." Recent papers render as provisional. The
                comparison between blind scores and realized yield across the benchmark is the standing validation
                experiment for the whole instrument.
              </p>
            </Section>

            <Section id="hiw-claims" number={nextNumber()} title="What this system does not claim">
              <ul className="list-disc list-outside ml-5 space-y-2">
                <li>It does not claim perfect blindness; it measures and discloses recognition.</li>
                <li>
                  It does not claim the reviewer is free of training-data bias; the symmetric-grading and era-relative
                  clauses exist because we found such biases, and the benchmark + calibration layer exists to detect
                  what the rubric misses.
                </li>
                <li>
                  It does not claim a score is truth. It claims the entire chain of evidence behind every number —
                  rationales, pairwise verdicts, anchor choices, sensitivity analyses, prompt version and hash — is
                  recorded and public, so every score can be contested on the merits.
                </li>
              </ul>
              <p>
                The review prompt is versioned and hashed; every review and every calibration run records exactly which
                version produced it. When the protocol changes, scores are regenerated under the new version — old and
                new are never mixed.
              </p>
            </Section>

            <div className="border border-slate-200 rounded-3xl overflow-hidden bg-white">
              <div className="px-6 py-5 border-b border-slate-100">
                <span className="font-black text-slate-900 text-xl">The exact prompt</span>
                <p className="text-sm text-slate-500 mt-1">The full instructions the review system receives for every review pass — the protocol described above, verbatim</p>
              </div>
              <div className="bg-slate-950 px-6 py-6">
                {promptLoading ? (
                  <div className="flex items-center gap-2 text-slate-400 text-sm py-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                  </div>
                ) : (
                  <pre className="text-slate-200 text-[15px] leading-8 whitespace-pre-wrap font-mono">
                    {prompt}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
