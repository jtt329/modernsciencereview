import type {FormalPackage,IngestedSource} from './contract';
import type {ScientificAssessmentEvidence,ReviewAdditions} from './assessmentContract';
import {FormalError} from './package';
const text={type:'string',minLength:1,maxLength:8000},ids={type:'array',items:{type:'string',minLength:1,maxLength:100},maxItems:900};
const object=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const reviewAdditionsSchema=object({summary:text,items:{type:'array',maxItems:20,items:object({id:{type:'string',minLength:1,maxLength:80},title:{type:'string',minLength:1,maxLength:300},kind:{type:'string',enum:['calculation','derivation','literature-comparison','clarification','proposed-manuscript-edit']},description:text,manuscriptBasis:{type:'string',enum:['stated','cited','not-explicit','unclear']},sourceLineIds:ids,checkRefs:{type:'array',maxItems:80,items:object({kind:{type:'string',enum:['scalar-check','canonical-check','geometry-check','derivation-check']},id:{type:'string',minLength:1,maxLength:100}})},paperIds:ids,status:{type:'string',enum:['checked-under-premises','source-assessed','interpretive','proposal']}})}});
export function validateReviewAdditions(value:Omit<ReviewAdditions,'manuscriptChanged'>,pkg:FormalPackage,source:IngestedSource,evidence:ScientificAssessmentEvidence):ReviewAdditions{
 const sourceIds=new Set(source.lines.map(line=>line.id)),paperIds=new Set([...(evidence.literature?.papers.map(p=>p.id)||[]),...(evidence.primaryReferences?.filter(p=>p.status==='retrieved').map(p=>p.id)||[])]);
 // Both zero-residual derivations and expected-nonzero controls are genuine
 // computations in the saved restricted report. Register their exact IDs and
 // statuses without changing their kind or counting controls as positive proof.
 const derivationChecks=evidence.restrictedCanonicalDerivation?.checks.filter(check=>check.kind==='derivation'||check.kind==='negative-control')||[];
 const checks=new Map<string,string>();for(const[kind,values]of[['scalar-check',evidence.verification.claims],['canonical-check',evidence.canonical?.checks||[]],['geometry-check',evidence.geometry?.checks||[]],['derivation-check',derivationChecks]] as const)for(const check of values)checks.set(kind+':'+check.id,check.status);
 const seen=new Set<string>();for(const item of value.items){
  if(!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(item.id)||seen.has(item.id))throw new FormalError('Review additions need distinct stable IDs.',422);seen.add(item.id);
  if(!item.sourceLineIds.length||new Set(item.sourceLineIds).size!==item.sourceLineIds.length||item.sourceLineIds.some(id=>!sourceIds.has(id)))throw new FormalError('Each review addition must name its actual manuscript source span.',422);
  if(new Set(item.paperIds).size!==item.paperIds.length||item.paperIds.some(id=>!paperIds.has(id)))throw new FormalError('Review additions must reference actual retrieved papers.',422);
  const refs=item.checkRefs.map(ref=>ref.kind+':'+ref.id);if(new Set(refs).size!==refs.length||refs.some(ref=>!checks.has(ref)))throw new FormalError('Review additions cannot invent computation evidence.',422);
  if(item.status==='checked-under-premises'&&(!refs.length||refs.some(ref=>checks.get(ref)!=='checked')))throw new FormalError('A computed review addition requires actual passing checks.',422);
  if(item.status==='source-assessed'&&!item.paperIds.length)throw new FormalError('A source-assessed addition must reference retrieved literature.',422);
  if(item.kind==='proposed-manuscript-edit'&&item.status!=='proposal')throw new FormalError('A suggested manuscript edit cannot be represented as an accepted or verified edit.',422);
 }
 return {...value,manuscriptChanged:false};
}
