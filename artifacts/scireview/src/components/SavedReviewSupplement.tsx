import React from 'react';
import MathText from './FormalMathText';
import { ReviewDisclosure } from './FormalReviewDisclosure';
import { useSavedFormalReview } from './FormalSavedReviewContext';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === 'string' ? value : '';
export default function SavedReviewSupplement() {
  const saved = useSavedFormalReview();
  if (!saved) return null;
  const qa = object(saved.independentQA), editorial = object(qa.integratedAssessmentEditorial), finding = object(editorial.finding);
  const manual = object(object(qa.manualAlgebra).report), checks = object(manual.checks);
  const frw = object(object(qa.frwPrimaryReferences).report), sources = Array.isArray(frw.sources) ? frw.sources.map(object) : [];
  return <ReviewDisclosure id="saved-review-independent-qa" title="Additional source review and independent checks" preview="Inspect the separate equation audit, the Hayward wording assessment, and the recovered Cai–Kim and Kong primary-reference comparisons."><div className="fl-saved-qa">
    <p>These records are separate from the saved model assessment. They preserve its original judgment and identify the scope of each additional check.</p>
    {text(finding.detail) && <article><h3>Hayward pressure: precision of the fixed-variable label</h3><p><MathText text={text(finding.detail)} /></p><p><MathText text={text(editorial.effectOnSavedReview)} /></p></article>}
    {sources.length > 0 && <article><h3>Recovered primary-reference comparisons</h3><p>Both Cai–Kim and Kong were cited in the manuscript. A retrieval gap left them out of the original model comparison. The following separately recorded source review addresses that gap.</p>{sources.map((source, index) => <details className="fl-details" key={text(source.id) || index}><summary><MathText text={text(source.title)} /></summary><div className="fl-details-content"><p><MathText text={text(source.comparison)} /></p>{Array.isArray(source.locators) && <ul>{source.locators.map((locator, i) => <li key={i}><MathText text={text(locator)} /></li>)}</ul>}{/^https:\/\//.test(text(source.url)) && <a href={text(source.url)} target="_blank" rel="noopener noreferrer">Read the primary paper</a>}</div></details>)}<p><MathText text={text(frw.boundedConclusion)} /></p></article>}
    {Object.keys(checks).length > 0 && <article><h3>Separate source-transcribed algebra audit</h3><p>{Object.keys(checks).length} manually transcribed identities have zero residuals under their declared premises. These checks overlap in subject matter with the automatic report and are counted separately from its 60 candidates.</p><details className="fl-details"><summary>Inspect the separate audit residuals</summary><ul>{Object.entries(checks).map(([name, residual]) => <li key={name}><code>{name}</code> · residual <code>{String(residual)}</code></li>)}</ul></details></article>}
    <a href={saved.evidenceUrl}>Download the complete evidence and QA records</a>
  </div></ReviewDisclosure>;
}
