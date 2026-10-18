// Public projection of the later saved explanatory-update review. Legacy rows stay immutable.
export function projectExplanatoryReview(version: any, legacy: any = null) {
  if (!version || !/^explanatory-update-B2(?:\.1)?/.test(version.promptName || '')) return null;
  if (legacy?.createdAt && new Date(legacy.createdAt).getTime() > new Date(version.createdAt).getTime()) return null;
  if (!['sound', 'contested_defensible', 'fatal_verified'].includes(version.correctnessInternal)) return null;
  const result = version.adjudicatedJson || {};
  const corrected = !!result.restorationCorrection;
  const scientificReview = corrected ? version.contributionPassage : result.scientificReview;
  if (typeof scientificReview !== 'string' || !scientificReview.trim()) return null;
  const score = corrected ? null : version.recommendedScore;
  if (!corrected && (!Number.isInteger(score) || score < 0 || score > 100)) return null;
  const ledger = {
    schemaVersion: 'explanatory-update-B2.1', promptVersion: version.promptVersion,
    promptName: version.promptName, sourceReviewVersionId: version.id,
    scientificReview, scopeOfUpdate: result.scopeOfUpdate || version.scope,
    score, scorePendingReassessment: corrected,
    // Never expose internal correctness verdicts, raw allegations, or evidence packets.
    explanatoryUpdate: corrected ? null : result.explanatoryUpdate,
    deltaBeyondPriorField: corrected ? null : result.deltaBeyondPriorField,
    alreadyAvailable: corrected ? null : result.alreadyAvailable,
    scoreStressTest: corrected ? null : result.scoreStressTest,
    breakdown: corrected ? null : result.breakdown,
    reviewContextUsed: result.reviewContextUsed,
  };
  return {
    id: legacy?.id || version.id, paperId: version.paperId,
    score, overallIntrinsicScore: score, summary: scientificReview,
    centralClaim: '', finalJudgment: '', correctness: '', novelty: '',
    modelName: version.promptName, systemPrompt: '',
    coverageLedgerJson: JSON.stringify(ledger),
    likesCount: legacy?.likesCount || 0, createdAt: version.createdAt,
  };
}

export function explanatoryPaperIdentity(paper: any) {
  return JSON.stringify([paper.title.trim().toLowerCase(), paper.content, paper.paperAuthors || '']);
}
