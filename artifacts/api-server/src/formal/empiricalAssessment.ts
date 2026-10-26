import type { FormalPackage, IngestedSource } from './contract';
import type { EmpiricalAssessment } from './assessmentContract';
import { FormalError } from './package';

const text={type:'string',minLength:1,maxLength:8000};
const ids={type:'array',items:{type:'string',minLength:1,maxLength:100},maxItems:900};
const object=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
/** Fresh model responses classify what the manuscript actually claims. Author
 * intent is attached by the server and cannot replace source evidence. */
export const empiricalAssessmentSchema=object({
  status:{type:'string',enum:['none-claimed','predictions-only','empirical-claims','unclear']},
  summary:text,sourceLineIds:ids,
  claims:{type:'array',maxItems:40,items:object({id:{type:'string',minLength:1,maxLength:80},statement:text,type:{type:'string',enum:['prediction','observation','experiment']},sourceLineIds:ids})},
  evidenceNeeded:{type:'array',maxItems:30,items:text},
});
export function validateEmpiricalAssessment(value:Omit<EmpiricalAssessment,'authorDeclaration'|'declarationStatus'>,pkg:FormalPackage,source:IngestedSource):EmpiricalAssessment{
  const lines=new Set(source.lines.map(line=>line.id));const seen=new Set<string>();
  const refs=(items:string[])=>{if(new Set(items).size!==items.length||items.some(id=>!lines.has(id)))throw new FormalError('Empirical assessment must reference actual manuscript lines.',422);};
  refs(value.sourceLineIds);
  for(const claim of value.claims){
    if(!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(claim.id)||seen.has(claim.id))throw new FormalError('Empirical claim IDs must be distinct.',422);seen.add(claim.id);
    refs(claim.sourceLineIds);if(!claim.sourceLineIds.length||claim.sourceLineIds.some(id=>!value.sourceLineIds.includes(id)))throw new FormalError('Each empirical statement needs its own source span within the assessment.',422);
  }
  if(value.status==='none-claimed'&&(value.claims.length||value.evidenceNeeded.length))throw new FormalError('A paper with no empirical claim cannot be assigned missing empirical evidence.',422);
  if(value.status==='predictions-only'&&(!value.claims.length||value.claims.some(claim=>claim.type!=='prediction')))throw new FormalError('Predictions must remain distinct from reported observations.',422);
  if(value.status==='empirical-claims'&&!value.claims.some(claim=>claim.type==='observation'||claim.type==='experiment'))throw new FormalError('An empirical evidence requirement must identify an actual observational or experimental assertion.',422);
  const empiricalLines=new Set((pkg.analysis?.coverage||[]).filter(item=>item.role==='empirical').flatMap(item=>item.sourceLineIds));
  if(value.status==='none-claimed'&&[...empiricalLines].some(id=>!value.sourceLineIds.includes(id)))throw new FormalError('An existing empirical-source classification must be explicitly reviewed before marking empirical testing inapplicable.',422);
  const authorDeclaration=(pkg as FormalPackage&{authorGuidance?:{empiricalStatus?:'unspecified'|'none'|'present'}}).authorGuidance?.empiricalStatus||'unspecified';
  const disagreement=authorDeclaration==='none'&&value.status==='empirical-claims'||authorDeclaration==='present'&&value.status==='none-claimed';
  return {...value,authorDeclaration,declarationStatus:authorDeclaration==='unspecified'?'not-provided':disagreement?'needs-review':'consistent'};
}
