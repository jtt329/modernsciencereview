import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {normalizeMathMarkdown} from '../lib/mathMarkdown';
export default function ExplanatoryReviewCard({review,ledger}:{review:any;ledger:any}) {
 const text=(v:any):string=> typeof v==='string'?v:Array.isArray(v)?v.map(text).filter(Boolean).join('\n\n'):v&&typeof v==='object'?Object.entries(v).map(([k,x])=>`${k.replace(/([a-z])([A-Z])/g,'$1 $2')}: ${text(x)}`).join('\n\n'):'';
 const markdown=(v:any)=><div className="prose prose-invert max-w-none prose-p:leading-relaxed"><ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{normalizeMathMarkdown(text(v))}</ReactMarkdown></div>;
 return <section className="bg-gradient-to-br from-indigo-950 to-slate-900 text-white rounded-3xl p-6 md:p-8 space-y-6">
  <header className="flex flex-wrap items-start justify-between gap-5"><div><h2 className="text-xl font-bold">Scientific Review</h2><p className="text-xs text-slate-400 mt-1">{ledger.promptVersion} · {new Date(review.createdAt).toLocaleDateString()}</p></div><div className="sm:text-right"><p className="text-xs font-bold uppercase tracking-widest text-indigo-300">Explanatory advance</p><p className="text-4xl font-black mt-1">{ledger.scorePendingReassessment?'Pending':`${review.score}/100`}</p></div></header>
  <p className="text-sm text-slate-300">How much the paper advances scientific explanation relative to the prior knowledge used in this review.</p>
  {ledger.scorePendingReassessment&&<p className="rounded-xl bg-amber-500/10 border border-amber-400/30 p-4 text-sm text-amber-100">A saved re-verification superseded the original verdict. Its old score is withheld until a corrected score is available.</p>}
  {markdown(ledger.scientificReview)}
  {ledger.scopeOfUpdate&&<p className="text-xs text-slate-400">Scope: {String(ledger.scopeOfUpdate).replaceAll('_',' ')}</p>}
  {[['Explanatory contribution',ledger.explanatoryUpdate],['What changed beyond prior work',ledger.deltaBeyondPriorField],['Score rationale',ledger.scoreStressTest],['Input, construction, and output',ledger.breakdown]].map(([title,value])=>value?<details key={String(title)} className="border-t border-white/10 pt-4"><summary className="cursor-pointer text-sm font-semibold text-indigo-200">{String(title)}</summary><div className="mt-4">{markdown(value)}</div></details>:null)}
 </section>;
}
