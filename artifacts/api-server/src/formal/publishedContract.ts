/** Public discovery cards are constructed only from an explicitly published snapshot. */
export interface PublishedFormalPaper {
  id:string;revisionId:string;revision:number;title:string;authors:string;summary:string;mainClaim:string;
  source:{url:string;filename:string;pageCount:number;sha256:string;version:string};
  subject:{slug:string;title:string;url:string};publishedAt:string;updatedAt:string;reviewUrl:string;
  rigor:{equations:number;checkedEquations:number;identities:number;definitionRestatements:number;sourceStatements:number;checkedSourceStatements:number;declaredInputs:number;openStatements:number};
  assessment?:{id:string;summary:string;readiness:string;label:string;verifiedAt:string;model:string;exactSupplementChecks:number;exactSupplementChecksPassed:number};
  concepts:string[];
}
