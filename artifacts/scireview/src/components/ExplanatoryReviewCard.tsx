import React, { useState } from "react";
import {
  Award,
  BrainCircuit,
  Clock,
  Layers,
  Scale,
  Sparkles,
  Target,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMathMarkdown } from "../lib/mathMarkdown";

const assessmentParts = [
  {
    id: "input",
    label: "Input",
    description: "What the argument starts from",
    icon: Layers,
  },
  {
    id: "construction",
    label: "Construction",
    description: "How the result is established",
    icon: BrainCircuit,
  },
  {
    id: "output",
    label: "Output",
    description: "What the paper establishes",
    icon: Target,
  },
] as const;
function prose(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.map(prose).filter(Boolean).join("\n\n");
  return "";
}
function Markdown({ value }: { value: unknown }) {
  return (
    <div className="prose prose-invert prose-sm md:prose-base max-w-none text-slate-300 leading-relaxed break-words [&_.katex-display]:overflow-x-auto [&_.katex-display]:py-2">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {normalizeMathMarkdown(prose(value))}
      </ReactMarkdown>
    </div>
  );
}
function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Award;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 md:p-6 space-y-4">
      <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-indigo-200">
        <Icon className="h-4 w-4 shrink-0" />
        {title}
      </h3>
      {children}
    </section>
  );
}
export default function ExplanatoryReviewCard({
  review,
  ledger,
  onLike,
  isLiked,
}: {
  review: any;
  ledger: any;
  onLike: (id: string, e: React.MouseEvent) => void;
  isLiked: boolean;
}) {
  const [part, setPart] = useState<"input" | "construction" | "output">(
    "input",
  );
  const stress = ledger.scoreStressTest || {};
  const context = ledger.reviewContextUsed || {};
  const hasBreakdown = assessmentParts.some((p) =>
    prose(ledger.breakdown?.[p.id]),
  );
  const selected = assessmentParts.find((p) => p.id === part)!;
  return (
    <article className="overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-950 to-slate-900 text-white shadow-2xl">
      <div className="p-5 md:p-8 space-y-7">
        <header className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-3">
            <span className="rounded-xl border border-indigo-400/20 bg-indigo-400/10 p-2.5">
              <Sparkles className="h-6 w-6 text-indigo-300" />
            </span>
            <div>
              <h2 className="text-xl font-black tracking-tight">
                AI Scientific Review
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Explanatory-update review ·{" "}
                {new Date(review.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
          <button
            onClick={(e) => onLike(review.id, e)}
            aria-pressed={isLiked}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${isLiked ? "border-rose-300/40 text-rose-200" : "border-white/15 text-slate-300"}`}
          >
            {isLiked ? "Liked" : "Like review"} · {review.likesCount || 0}
          </button>
        </header>
        <div className="flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-indigo-300/15 bg-white/5 p-5">
          <div className="max-w-xl">
            <p className="text-xs font-black uppercase tracking-widest text-indigo-200">
              Explanatory advance
            </p>
            <p className="mt-2 text-sm text-slate-300">
              The paper’s contribution relative to the prior scientific
              knowledge used in this review.
            </p>
            {context.reviewEpoch && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
                <Clock className="h-3.5 w-3.5" />
                Baseline: {context.reviewEpoch}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-4xl md:text-5xl font-black tracking-tight">
              {ledger.scorePendingReassessment
                ? "Pending"
                : `${review.score}/100`}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {ledger.scorePendingReassessment
                ? "Corrected score not yet saved"
                : "Saved review score"}
            </p>
          </div>
        </div>
        {ledger.scorePendingReassessment && (
          <p className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
            A saved re-verification superseded the original verdict. The old
            score is withheld until a corrected score is available.
          </p>
        )}
        <nav
          aria-label="Review sections"
          className="flex flex-wrap gap-2 text-xs font-semibold"
        >
          {[
            ["scientific-review", "Scientific review"],
            ...(hasBreakdown ? [["review-assessment", "Assessment"]] : []),
            ...(prose(stress.whyNotHigher) || prose(stress.whyNotLower)
              ? [["review-score-rationale", "Score rationale"]]
              : []),
          ].map(([id, title]) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-full border border-white/10 px-3 py-2 text-slate-300 hover:bg-white/10"
            >
              {title}
            </a>
          ))}
        </nav>
        <div id="scientific-review" className="scroll-mt-32">
          <Panel title="Scientific Review" icon={Award}>
            <Markdown value={ledger.scientificReview} />
          </Panel>
        </div>
        {hasBreakdown && (
          <div id="review-assessment" className="scroll-mt-32">
            <Panel
              title="Input → Construction → Output Assessment"
              icon={BrainCircuit}
            >
              <p className="text-sm text-slate-400">
                This saved version explains each dimension in words. It does not
                assign separate numerical subscores.
              </p>
              <div
                role="tablist"
                aria-label="Assessment dimensions"
                onKeyDown={(event) => {
                  if (
                    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                      event.key,
                    )
                  )
                    return;
                  event.preventDefault();
                  const current = assessmentParts.findIndex(
                    (p) => p.id === part,
                  );
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? 2
                        : (current + (event.key === "ArrowRight" ? 1 : 2)) % 3;
                  const target = assessmentParts[next].id;
                  setPart(target);
                  document.getElementById(`dimension-${target}`)?.focus();
                }}
                className="grid grid-cols-3 gap-2 md:gap-3"
              >
                {assessmentParts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    id={`dimension-${p.id}`}
                    aria-label={p.label}
                    aria-selected={part === p.id}
                    tabIndex={part === p.id ? 0 : -1}
                    aria-controls="dimension-panel"
                    onClick={() => setPart(p.id)}
                    className={`rounded-xl border p-2 sm:p-4 text-left transition-colors ${part === p.id ? "border-indigo-300/50 bg-indigo-400/15" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                  >
                    <p.icon
                      className={`h-5 w-5 mb-3 ${part === p.id ? "text-indigo-200" : "text-slate-400"}`}
                    />
                    <span className="block text-[11px] sm:text-sm font-bold break-words">
                      {p.label}
                    </span>
                    <span className="hidden md:block mt-1 text-xs text-slate-400">
                      {p.description}
                    </span>
                  </button>
                ))}
              </div>
              <div
                id="dimension-panel"
                role="tabpanel"
                aria-labelledby={`dimension-${part}`}
                className="rounded-xl bg-slate-950/30 p-4 md:p-5"
              >
                <h4 className="font-bold text-indigo-100 mb-3">
                  {selected.label}
                </h4>
                <Markdown
                  value={
                    ledger.breakdown?.[part] ||
                    "No separate assessment was saved for this dimension."
                  }
                />
              </div>
            </Panel>
          </div>
        )}
        {(prose(ledger.explanatoryUpdate) ||
          prose(ledger.deltaBeyondPriorField)) && (
          <Panel title="Contribution to scientific understanding" icon={Target}>
            <div className="grid gap-5 md:grid-cols-2">
              {[
                ["Explanatory contribution", ledger.explanatoryUpdate],
                [
                  "What changed beyond prior work",
                  ledger.deltaBeyondPriorField,
                ],
              ].map(([title, value]) =>
                prose(value) ? (
                  <section key={prose(title)}>
                    <h4 className="font-bold text-emerald-200 text-sm mb-3">
                      {prose(title)}
                    </h4>
                    <Markdown value={value} />
                  </section>
                ) : null,
              )}
            </div>
            {prose(ledger.alreadyAvailable) && (
              <details className="border-t border-white/10 pt-4">
                <summary className="cursor-pointer font-semibold text-sm text-slate-300">
                  What was already known
                </summary>
                <div className="mt-3">
                  <Markdown value={ledger.alreadyAvailable} />
                </div>
              </details>
            )}
          </Panel>
        )}
        {(prose(stress.whyNotHigher) || prose(stress.whyNotLower)) && (
          <div id="review-score-rationale" className="scroll-mt-32">
            <Panel title="Score rationale" icon={Scale}>
              <div className="grid md:grid-cols-2 gap-4">
                {[
                  ["Why not higher?", stress.whyNotHigher],
                  ["Why not lower?", stress.whyNotLower],
                ].map(([title, value]) =>
                  prose(value) ? (
                    <section
                      key={title}
                      className="rounded-xl bg-slate-950/30 p-4"
                    >
                      <h4 className="text-sm font-bold text-indigo-100 mb-3">
                        {title}
                      </h4>
                      <Markdown value={value} />
                    </section>
                  ) : null,
                )}
              </div>
              {prose(stress.inflationAudit) && (
                <details className="border-t border-white/10 pt-4">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-300">
                    Scoring checks
                  </summary>
                  <div className="mt-3">
                    <Markdown value={stress.inflationAudit} />
                  </div>
                </details>
              )}
            </Panel>
          </div>
        )}
        <details className="border-t border-white/10 pt-4">
          <summary className="cursor-pointer text-xs font-semibold text-slate-400">
            Review record
          </summary>
          <dl className="grid gap-3 mt-4 text-xs text-slate-400 sm:grid-cols-2">
            <div>
              <dt className="font-bold text-slate-300">Methodology</dt>
              <dd className="break-all mt-1">{ledger.promptVersion}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-300">Saved</dt>
              <dd className="mt-1">
                {new Date(review.createdAt).toLocaleString()}
              </dd>
            </div>
            {ledger.scopeOfUpdate && (
              <div>
                <dt className="font-bold text-slate-300">Scope</dt>
                <dd className="mt-1">
                  {String(ledger.scopeOfUpdate).replaceAll("_", " ")}
                </dd>
              </div>
            )}
          </dl>
        </details>
      </div>
    </article>
  );
}
