import type {AuthorEmpiricalStatus,AuthorGuidanceField,AuthorSubmissionBrief,AuthorSubmissionBriefSection,AuthorSubmissionGuidance,CoverageItem,FormalPackage,IngestedSource} from './contract';

/** Shared by browser drafts and server validation. No Node, database or model imports. */
export const AUTHOR_GUIDANCE_FIELDS:readonly AuthorGuidanceField[]=['mainClaims','inputs','construction','outputs','novelty','predictions','empiricalClaims','scope','priorWork'];
export const AUTHOR_GUIDANCE_LIMITS={field:6000,total:24000} as const;
class AuthorGuidanceError extends Error {readonly statusCode=400;}
const fail=(message:string):never=>{throw new AuthorGuidanceError(message);};
export function normalizeAuthorGuidance(value:unknown):AuthorSubmissionGuidance|undefined {
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value))return fail('Author guidance must be an optional object.');
  const raw=value as Record<string,unknown>;
  if(Object.keys(raw).some(key=>key!=='empiricalStatus'&&!AUTHOR_GUIDANCE_FIELDS.includes(key as AuthorGuidanceField)))return fail('Author guidance contains unsupported fields.');
  const result:AuthorSubmissionGuidance={};let total=0;
  for(const key of AUTHOR_GUIDANCE_FIELDS){const item=raw[key];if(item===undefined)continue;if(typeof item!=='string'||item.length>AUTHOR_GUIDANCE_LIMITS.field||item.includes('\u0000'))return fail(`Author guidance ${key} must be text of at most ${AUTHOR_GUIDANCE_LIMITS.field} characters.`);const text=item.trim();if(text){result[key]=text;total+=text.length;}}
  if(total>AUTHOR_GUIDANCE_LIMITS.total)return fail(`Combined author guidance exceeds ${AUTHOR_GUIDANCE_LIMITS.total} characters.`);
  if(raw.empiricalStatus!==undefined){if(typeof raw.empiricalStatus!=='string')return fail('Choose whether empirical claims are unspecified, absent or present.');const status=raw.empiricalStatus.trim();if(status&&!['unspecified','none','present'].includes(status))return fail('Choose whether empirical claims are unspecified, absent or present.');if(status&&status!=='unspecified')result.empiricalStatus=status as AuthorEmpiricalStatus;}
  return Object.keys(result).length?result:undefined;
}
const unique=<T>(items:T[])=>[...new Set(items)];
const titles:Record<AuthorGuidanceField,string>={mainClaims:'Main claims',inputs:'Inputs and assumptions',construction:'Construction or derivation',outputs:'Outputs and consequences',novelty:'Proposed novelty',predictions:'Predictions',empiricalClaims:'Empirical claims',scope:'Domain and scope',priorWork:'Relationship to prior work'};
const textOf=(items:string[])=>unique(items.filter(item=>item.trim())).slice(0,20).map(item=>`- ${item}`).join('\n').slice(0,6000);
/** A preview of actual extracted proposals, never an additional model call or a
 * source rewrite. Saved author guidance is displayed separately as authorText. */
export function buildAuthorSubmissionBrief(pkg:FormalPackage,source?:IngestedSource):AuthorSubmissionBrief {
  const guidance=normalizeAuthorGuidance(pkg.authorGuidance);
  const sourceMatches=!!source&&(!pkg.analysis||pkg.analysis.sourceId===source.id)&&(!pkg.source.sha256||pkg.source.sha256===source.sha256);
  const lines=new Set(sourceMatches?source!.lines.map(line=>line.id):[]),knownClaims=new Set(pkg.claims.map(claim=>claim.id)),knownInputs=new Set(pkg.selectedInputs.map(input=>input.id));
  const linked=(ids:string[])=>unique(ids.filter(id=>lines.has(id)));
  const coverage=pkg.analysis?.coverage||[];
  const claimLines=(ids:string[])=>linked((pkg.analysis?.claimReferences||[]).filter(reference=>ids.includes(reference.claimId)).flatMap(reference=>reference.sourceLineIds));
  const fields=new Map<AuthorGuidanceField,{text:string;items?:CoverageItem[];sourceLineIds?:string[];claimIds?:string[];inputIds?:string[]}>();
  const allClaims=pkg.claims.map(claim=>claim.id);
  fields.set('mainClaims',{text:pkg.mainClaim,sourceLineIds:claimLines(allClaims),claimIds:allClaims});
  fields.set('inputs',{text:textOf(pkg.selectedInputs.map(input=>`${input.title}: ${input.statement}`)),sourceLineIds:linked((pkg.analysis?.inputReferences||[]).flatMap(reference=>reference.sourceLineIds)),inputIds:pkg.selectedInputs.map(input=>input.id)});
  const construction=coverage.filter(item=>item.role==='mathematical');
  fields.set('construction',{text:construction.length?textOf(construction.map(item=>item.statement)):textOf(pkg.definitions.map(definition=>`${definition.symbol}: ${definition.description}`)),items:construction});
  const outputClaims=unique(pkg.consequences.flatMap(consequence=>consequence.claimIds)).filter(id=>knownClaims.has(id));
  fields.set('outputs',{text:textOf(pkg.consequences.map(consequence=>`${consequence.title}: ${consequence.text}`)),sourceLineIds:claimLines(outputClaims),claimIds:outputClaims});
  const substantive=coverage.filter(item=>!['citation','metadata'].includes(item.role));
  const novelty=substantive.filter(item=>/\bnovel|\bnew\b|\boriginal\b|\bfirst\b|contribut|propos|advance/i.test(item.statement));
  fields.set('novelty',{text:textOf(novelty.map(item=>item.statement)),items:novelty});
  const predictions=substantive.filter(item=>/\b(?:predict(?:s|ed|ing|ion|ions)?|forecast(?:s|ed|ing)?)\b|\btestable\s+(?:consequences?|predictions?|implications?)\b/i.test(item.statement)&&
    !/\b(?:no|without)\s+(?:new\s+|empirical\s+|observational\s+|experimental\s+)*predictions?\b|\bdoes\s+not\s+(?:make\s+|offer\s+|propose\s+)?(?:any\s+)?predict|\bnot\s+(?:an?\s+)?testable\b/i.test(item.statement));
  fields.set('predictions',{text:textOf(predictions.map(item=>item.statement)),items:predictions});
  const empirical=coverage.filter(item=>item.role==='empirical');
  fields.set('empiricalClaims',{text:textOf(empirical.map(item=>item.statement)),items:empirical});
  const scope=coverage.filter(item=>item.role==='scope');fields.set('scope',{text:textOf(scope.map(item=>item.statement)),items:scope});
  const prior=coverage.filter(item=>item.role==='citation');fields.set('priorWork',{text:textOf(prior.map(item=>item.statement)),items:prior});
  const sections=AUTHOR_GUIDANCE_FIELDS.map((id):AuthorSubmissionBriefSection=>{
    const draft=fields.get(id)!;const sourceLineIds=linked([...(draft.sourceLineIds||[]),...(draft.items||[]).flatMap(item=>item.sourceLineIds)]);
    const claimIds=unique([...(draft.claimIds||[]),...(draft.items||[]).flatMap(item=>item.claimIds)]).filter(claimId=>knownClaims.has(claimId));
    const inputIds=unique([...(draft.inputIds||[]),...(draft.items||[]).flatMap(item=>item.inputIds)]).filter(inputId=>knownInputs.has(inputId));
    const basis=draft.text?(sourceLineIds.length?'source-linked-draft':'package-proposal'):'not-stated';
    return {id,title:titles[id],text:draft.text,basis,sourceLineIds,claimIds,inputIds,note:basis==='source-linked-draft'?'Drafted from the existing source-linked package; this is a proposed interpretation, not a new proof or an author approval.':basis==='package-proposal'?'Existing package proposal without a validated numbered source link for this brief section.':'No explicit statement was identified in the current package for this section. Absence here does not establish absence in the original paper.',...(guidance?.[id]?{authorText:guidance[id]}:{})};
  });
  const noEmpirical=coverage.filter(item=>item.role==='scope'&&/\bno\s+(?:new\s+)?(?:empirical|observational|experimental)\s+(?:claims?|predictions?)\b|\bdoes\s+not\s+(?:make|assert|advance|offer|propose)\s+(?:any\s+|new\s+)?(?:empirical|observational|experimental)\s+(?:claims?|predictions?)\b|\bis\s+not\s+an?\s+(?:empirical|observational|experimental)\s+claim\b/i.test(item.statement));
  const sourceStatus:AuthorEmpiricalStatus=sourceMatches&&empirical.length?'present':sourceMatches&&noEmpirical.length?'none':'unspecified';
  const authorStatus=guidance?.empiricalStatus||'unspecified';
  const conflict=sourceStatus!=='unspecified'&&authorStatus!=='unspecified'&&sourceStatus!==authorStatus;
  const status=sourceStatus!=='unspecified'?sourceStatus:authorStatus;
  const notes:string[]=[];
  if(sourceStatus==='unspecified')notes.push('No explicit empirical-claim classification has been established from the source coverage; this is different from an author explicitly stating none.');
  if(authorStatus!=='unspecified')notes.push('The author empirical classification is a pointer to review, not evidence that can override the manuscript.');
  if(conflict)notes.push('The author classification conflicts with the source-linked coverage and requires review. Source assertions must remain visible.');
  if(sourceStatus==='present'&&noEmpirical.length)notes.push('The source coverage itself includes both empirical claims and a statement disclaiming them; compare the exact source spans.');
  return {version:'author-submission-brief-v1',sections,empirical:{status,sourceStatus,authorStatus,basis:sourceStatus!=='unspecified'?'source-linked-draft':authorStatus!=='unspecified'?'author-guidance':'not-stated',sourceLineIds:linked([...empirical,...noEmpirical].flatMap(item=>item.sourceLineIds)),conflict,notes},limitations:['This brief reuses existing structured proposals and source links; it does not perform an additional AI review.','Author guidance is separate from manuscript evidence. Editing it requires a new revision and fresh approval before verification.','All original source assertions remain in the coverage ledger, including material outside the author’s chosen focus.']};
}
