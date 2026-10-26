/** A bounded retrieved-literature review, never a novelty proof or author approval. */
export interface LiteraturePaper {
  id:string; title:string; authors:string[]; year:number|null; doi?:string; arxivId?:string; url:string;
  provider:'arxiv'|'crossref'|'inspire'; inspireId?:string; publicationDate?:string; evidenceLevel:'metadata'|'abstract'|'selected-fulltext'; relevance:string;
  // Abstracts are supplied privately to the model, not republished in evidence downloads.
}
export interface LiteratureSearch {
  provider:'arxiv'|'crossref'|'inspire'; query:string; url:string; status:'searched'|'unavailable';
  searchedAt:string; resultCount:number; note:string;
}
export interface LiteratureAssessment {
  version:'literature-assessment-v1';packageDigest:string;sourceId:string;sourceSha256:string;
  createdAt:string;model:string;status:'bounded-literature-assessment';noveltyEstablished:false;
  summary:string;searchQueries:{text:string;rationale:string}[];searches:LiteratureSearch[];papers:LiteraturePaper[];
  sections:{id:string;title:string;text:string;sourceLineIds:string[];paperIds:string[];evidenceBasis:'manuscript'|'metadata'|'abstract'|'selected-fulltext'|'mixed'}[];
  comparisons:{paperId:string;relationship:'prior-foundation'|'overlap'|'possible-distinction'|'context'|'uncertain';alreadyKnown:string;proposedDifference:string;neededEvidence:string[]}[];
  /** False means no exhaustive priority certification, not a ban on scoped positive findings. */
  noveltyFindings?:LiteratureNoveltyFinding[];passages?:LiteraturePassage[];searchAudit?:LiteratureSearchAudit;
  limitations:string[];
}

/** Scoped comparative judgments; this is not an exhaustive originality certificate. */
export interface LiteratureNoveltyFinding {
 id:string;candidateClaim:string;claimIds:string[];sourceLineIds:string[];
 contributionType:'known'|'reformulation'|'new-consequence'|'new-interpretation'|'new-hypothesis'|'undetermined';
 verdict:'already-known'|'appears-novel'|'partly-novel'|'insufficient-evidence';
 priority:'earlier-precedent-found'|'earliest-located'|'undetermined';
 confidence:{level:'low'|'moderate'|'high';reason:string;limits:string[]};closestPaperIds:string[];
 passageComparisons:{paperId:string;passageIds:string[];relationship:'same-result'|'foundation'|'overlap'|'distinct-construction'|'context'|'uncertain';priorResult:string;manuscriptDifference:string}[];
 neededEvidence:string[];
}
export interface LiteraturePassage {id:string;paperId:string;referenceId:string;excerptId:string;locator:string;sha256:string;}
export interface LiteratureSearchAudit {
 version:'literature-search-audit-v2';discovered:LiteraturePaper[];screenedPaperIds:string[];assessedPaperIds:string[];passagePaperIds:string[];
 excluded:{paperId:string;reason:string}[];/** Only unresolved latest attempts; full attempt history remains in searches. */ unavailable:{url:string;stage:'metadata'|'citation-neighborhood'|'primary-passages';reason:string}[];
 adaptiveRoundUsed:boolean;scope:string;
}
