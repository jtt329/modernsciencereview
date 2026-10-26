/** A generation marker, not a new scientific judgment. Persisted reports are
 * validated by literatureStore; legacy reports remain readable but cannot cache
 * away the owner's explicit request for the claim-level comparison upgrade. */
export function hasCurrentLiteratureEvidence(value:unknown,expected:{packageDigest:string;sourceId?:string;sourceSha256?:string}):boolean{
  const report=value as any;
  if(!report||typeof report!=='object'||report.version!=='literature-assessment-v1'||report.status!=='bounded-literature-assessment'||report.noveltyEstablished!==false||report.packageDigest!==expected.packageDigest)return false;
  if(expected.sourceId!==undefined&&report.sourceId!==expected.sourceId||expected.sourceSha256!==undefined&&report.sourceSha256!==expected.sourceSha256)return false;
  const audit=report.searchAudit;
  return Array.isArray(report.noveltyFindings)&&report.noveltyFindings.length>0&&Array.isArray(report.passages)&&audit?.version==='literature-search-audit-v2'&&
    ['discovered','screenedPaperIds','assessedPaperIds','passagePaperIds','excluded','unavailable'].every(key=>Array.isArray(audit[key]))&&typeof audit.adaptiveRoundUsed==='boolean'&&typeof audit.scope==='string';
}
/** Feature compatibility for a saved current assessment, separate from its
 * scientific evidence fingerprint. Old reports stay readable as history; only
 * explicit owner requests may append the richer current assessment. */
export function hasCurrentScientificAssessment(value:unknown,expected:{packageDigest:string;sourceId?:string;sourceSha256?:string;evidenceFingerprint?:string;requiresNoveltyEvidence?:boolean}):boolean{
  const report=value as any;
  if(!report||typeof report!=='object'||report.version!=='scientific-assessment-v1'||report.status!=='scientifically-assessed'||report.packageDigest!==expected.packageDigest)return false;
  if(expected.sourceId!==undefined&&report.sourceId!==expected.sourceId||expected.sourceSha256!==undefined&&report.sourceSha256!==expected.sourceSha256||expected.evidenceFingerprint!==undefined&&report.evidenceFingerprint!==expected.evidenceFingerprint)return false;
  const empirical=report.empiricalAssessment,additions=report.reviewAdditions,method=report.assessmentMethod;
  if(!empirical||!['none-claimed','predictions-only','empirical-claims','unclear'].includes(empirical.status)||typeof empirical.summary!=='string'||!Array.isArray(empirical.sourceLineIds)||!Array.isArray(empirical.claims)||!Array.isArray(empirical.evidenceNeeded)||!['unspecified','none','present'].includes(empirical.authorDeclaration)||!['not-provided','consistent','needs-review'].includes(empirical.declarationStatus))return false;
  if(!additions||typeof additions.summary!=='string'||additions.manuscriptChanged!==false||!Array.isArray(additions.items))return false;
  if(!method||!['developer-provided-trusted-kernel','not-applied'].includes(method.derivationOrigin)||method.manuscriptChanged!==false||typeof method.method!=='string'||typeof method.sourceScope!=='string'||typeof method.aiRole!=='string')return false;
  if(expected.requiresNoveltyEvidence){const novelty=report.noveltyEvidence;if(!novelty||!Array.isArray(novelty.findings)||!novelty.findings.length||!Array.isArray(novelty.passages)||!Array.isArray(novelty.papers)||typeof novelty.scope!=='string'||!Number.isSafeInteger(novelty.unavailableRequests)||novelty.unavailableRequests<0)return false;}
  return true;
}
