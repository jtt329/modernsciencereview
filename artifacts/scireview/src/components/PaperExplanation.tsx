import React, {useEffect, useState} from 'react';
import LatexText from './LatexText';
export default function PaperExplanation({paperId}:{paperId:string}) {
 const [review,setReview]=useState<any>(null);
 const [contribution,setContribution]=useState<any>(null);
 useEffect(()=>{let active=true;setReview(null);setContribution(null);
  fetch(`/api/papers/${encodeURIComponent(paperId)}/review-version`).then(r=>r.ok?r.json():null).then(d=>{if(active)setReview(d)}).catch(()=>{});
  fetch(`/api/papers/${encodeURIComponent(paperId)}/contribution`).then(r=>r.ok?r.json():null).then(d=>{if(active)setContribution(d)}).catch(()=>{});
  return()=>{active=false};
 },[paperId]);
 if(!review&&!contribution)return null;
 return <section className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
  <h2 className="text-xl font-bold text-slate-900">Contribution to the living explanation</h2>
  {review?.contributionPassage&&<div className="whitespace-pre-line text-slate-700"><LatexText>{review.contributionPassage}</LatexText></div>}
  {review?.claims?.length>0&&<details><summary className="cursor-pointer text-blue-700">Archived review claims</summary><ul className="mt-3 space-y-3">{review.claims.map((c:any)=><li key={c.id} className="text-sm text-slate-700"><LatexText>{c.statement}</LatexText>{c.status&&<span className="ml-2 text-xs text-slate-500">({c.status})</span>}</li>)}</ul></details>}
  <a className="inline-block text-sm font-semibold text-blue-700 hover:underline" href="/fields/horizon-thermodynamics">Explore the explanation and its sources →</a>
 </section>;
}
