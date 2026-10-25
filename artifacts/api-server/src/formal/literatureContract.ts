/** A bounded retrieved-literature review, never a novelty proof or author approval. */
export interface LiteraturePaper {
  id:string; title:string; authors:string[]; year:number|null; doi?:string; arxivId?:string; url:string;
  provider:'arxiv'|'crossref'; evidenceLevel:'metadata'|'abstract'|'selected-fulltext'; relevance:string;
  // Abstracts are supplied privately to the model, not republished in evidence downloads.
}
export interface LiteratureSearch {
  provider:'arxiv'|'crossref'; query:string; url:string; status:'searched'|'unavailable';
  searchedAt:string; resultCount:number; note:string;
}
export interface LiteratureAssessment {
  version:'literature-assessment-v1';packageDigest:string;sourceId:string;sourceSha256:string;
  createdAt:string;model:string;status:'bounded-literature-assessment';noveltyEstablished:false;
  summary:string;searchQueries:{text:string;rationale:string}[];searches:LiteratureSearch[];papers:LiteraturePaper[];
  sections:{id:string;title:string;text:string;sourceLineIds:string[];paperIds:string[];evidenceBasis:'manuscript'|'metadata'|'abstract'|'selected-fulltext'|'mixed'}[];
  comparisons:{paperId:string;relationship:'prior-foundation'|'overlap'|'possible-distinction'|'context'|'uncertain';alreadyKnown:string;proposedDifference:string;neededEvidence:string[]}[];
  limitations:string[];
}
