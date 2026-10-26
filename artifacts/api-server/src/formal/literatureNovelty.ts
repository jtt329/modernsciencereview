import { createHash } from 'node:crypto';
import type { FormalPackage, IngestedSource } from './contract';
import type { LiteratureAssessment,LiteraturePaper,LiteratureNoveltyFinding,LiteraturePassage } from './literatureContract';
import type { CanonicalReference } from './canonicalContract';
import { FormalError } from './package';
const str={type:'string'},list={type:'array',items:str};
export const NOVELTY_SCHEMA={type:'array',items:{type:'object',properties:{id:str,candidateClaim:str,claimIds:list,sourceLineIds:list,contributionType:{type:'string',enum:['known','reformulation','new-consequence','new-interpretation','new-hypothesis','undetermined']},verdict:{type:'string',enum:['already-known','appears-novel','partly-novel','insufficient-evidence']},priority:{type:'string',enum:['earlier-precedent-found','earliest-located','undetermined']},confidence:{type:'object',properties:{level:{type:'string',enum:['low','moderate','high']},reason:str,limits:list},required:['level','reason','limits'],additionalProperties:false},closestPaperIds:list,passageComparisons:{type:'array',items:{type:'object',properties:{paperId:str,passageIds:list,relationship:{type:'string',enum:['same-result','foundation','overlap','distinct-construction','context','uncertain']},priorResult:str,manuscriptDifference:str},required:['paperId','passageIds','relationship','priorResult','manuscriptDifference'],additionalProperties:false}},neededEvidence:list},required:['id','candidateClaim','claimIds','sourceLineIds','contributionType','verdict','priority','confidence','closestPaperIds','passageComparisons','neededEvidence'],additionalProperties:false}};
function error(message:string):never{throw new FormalError('Invalid claim-level novelty evidence: '+message,422);}
const object=(v:any,fields:string[])=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!fields.includes(k))||fields.some(k=>!Object.hasOwn(v,k)))error('unsupported fields.');};
const txt=(v:any,max=6000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)error('invalid text.');};
const strings=(v:any,max=24)=>{if(!Array.isArray(v)||v.length>max||v.some(s=>typeof s!=='string'||!s.trim()||s.length>2000)||new Set(v).size!==v.length)error('invalid bounded references.');};
const hash=(v:string)=>createHash('sha256').update(v).digest('hex').slice(0,24);
export function literaturePassageRegistry(papers:LiteraturePaper[],references:CanonicalReference[]):LiteraturePassage[]{
 const result:LiteraturePassage[]=[];
 for(const paper of papers){if(paper.evidenceLevel!=='selected-fulltext'||!paper.arxivId)continue;
  const ref=references.find(r=>r.id.replace(/v\d+$/,'')===paper.arxivId!.replace(/v\d+$/,''));
  if(ref?.status!=='retrieved'||!ref.sha256||!/^[a-f0-9]{64}$/.test(ref.sha256))continue;
  for(const excerpt of ref.excerpts){if(!excerpt.text.trim())continue;result.push({id:'passage-'+hash(paper.id+'|'+ref.id+'|'+excerpt.id),paperId:paper.id,referenceId:ref.id,excerptId:excerpt.id,locator:excerpt.locator,sha256:ref.sha256});}
 }return result;
}
export function validateNoveltyFindings(value:unknown,pkg:FormalPackage,source:IngestedSource,papers:LiteraturePaper[],passages:LiteraturePassage[],assessmentTimestampUTC:string):LiteratureNoveltyFinding[]{
 if(!Array.isArray(value)||value.length<1||value.length>12)error('provide one to twelve clearly scoped main-claim findings.');
 const paperById=new Map(papers.map(p=>[p.id,p])),passageById=new Map(passages.map(p=>[p.id,p])),sourceIds=new Set(source.lines.map(l=>l.id)),claimIds=new Set(pkg.claims.map(c=>c.id)),ids=new Set<string>();
 const manuscriptDate=pkg.source.version.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
 const manuscriptYear=Number(pkg.source.version.match(/\b(?:19|20)\d{2}\b/)?.[0])||new Date(assessmentTimestampUTC).getUTCFullYear();
 if(!Number.isInteger(manuscriptYear))error('assessment chronology is missing.');
 return value.map((v:any)=>{
  object(v,['id','candidateClaim','claimIds','sourceLineIds','contributionType','verdict','priority','confidence','closestPaperIds','passageComparisons','neededEvidence']);txt(v.id,120);if(ids.has(v.id))error('duplicate finding.');ids.add(v.id);txt(v.candidateClaim);strings(v.claimIds,120);strings(v.sourceLineIds,30);if(!v.sourceLineIds.length||v.sourceLineIds.some((id:string)=>!sourceIds.has(id))||v.claimIds.some((id:string)=>!claimIds.has(id)))error('claim must reference actual manuscript lines and formal claim IDs.');
  if(!['known','reformulation','new-consequence','new-interpretation','new-hypothesis','undetermined'].includes(v.contributionType)||!['already-known','appears-novel','partly-novel','insufficient-evidence'].includes(v.verdict)||!['earlier-precedent-found','earliest-located','undetermined'].includes(v.priority))error('unknown judgment.');
  object(v.confidence,['level','reason','limits']);if(!['low','moderate','high'].includes(v.confidence.level))error('confidence must be qualitative.');txt(v.confidence.reason,4000);strings(v.confidence.limits,12);if(!v.confidence.limits.length)error('bounded search limitations must remain explicit.');
  strings(v.closestPaperIds,12);if(v.closestPaperIds.some((id:string)=>!paperById.has(id)))error('unknown closest paper.');strings(v.neededEvidence,12);
  if(!Array.isArray(v.passageComparisons)||v.passageComparisons.length>16)error('invalid comparisons.');
  const readEarlier=new Set<string>(),antecedents=new Set<string>(),sameResults=new Set<string>();
  for(const c of v.passageComparisons){object(c,['paperId','passageIds','relationship','priorResult','manuscriptDifference']);const p=paperById.get(c.paperId);if(!p||!v.closestPaperIds.includes(c.paperId))error('comparison references an unknown closest paper.');strings(c.passageIds,12);if(c.passageIds.some((id:string)=>passageById.get(id)?.paperId!==c.paperId))error('comparison must reference actually retrieved passages from that paper.');if(!['same-result','foundation','overlap','distinct-construction','context','uncertain'].includes(c.relationship))error('unknown relationship.');txt(c.priorResult);txt(c.manuscriptDifference);
   if(c.passageIds.length&&p.evidenceLevel!=='selected-fulltext')error('metadata and abstracts cannot become full-text comparisons.');
   const prior=typeof p.year==='number'&&(p.year<manuscriptYear||p.year===manuscriptYear&&!!manuscriptDate&&!!p.publicationDate&&/^\d{4}-\d{2}-\d{2}$/.test(p.publicationDate)&&Number.isFinite(Date.parse(p.publicationDate))&&p.publicationDate<manuscriptDate);const different=p.title.trim().toLowerCase()!==pkg.title.trim().toLowerCase()&&p.url!==pkg.source.url;
   if(c.passageIds.length&&prior&&different){if(!['context','uncertain'].includes(c.relationship)&&c.priorResult.trim().length>=30&&c.manuscriptDifference.trim().length>=30)readEarlier.add(p.id);if(c.relationship==='same-result'||c.relationship==='overlap')antecedents.add(p.id);if(c.relationship==='same-result')sameResults.add(p.id);}
  }
  if((v.verdict==='already-known'||v.contributionType==='known')&&!sameResults.size)error('a negative already-known verdict needs a read, chronologically earlier SAME-RESULT passage, not related metadata or overlap.');
  if(v.contributionType==='known'&&v.verdict!=='already-known'||v.verdict==='already-known'&&['new-consequence','new-interpretation','new-hypothesis'].includes(v.contributionType))error('contribution type and novelty verdict contradict each other.');
  const positive=v.verdict==='appears-novel'||v.verdict==='partly-novel'||['new-consequence','new-interpretation','new-hypothesis'].includes(v.contributionType)||v.priority==='earliest-located';
  if(positive&&!readEarlier.size)error('positive novelty needs an actual passage comparison with a distinct, chronologically earlier paper.');
  if(v.priority==='earlier-precedent-found'&&!antecedents.size)error('an earlier precedent requires an actual earlier overlapping-result passage.');
  if(v.confidence.level==='high'&&positive&&readEarlier.size<2)error('high positive confidence needs at least two distinct earlier full-text comparisons.');
  if(!papers.length&&(v.verdict!=='insufficient-evidence'||v.priority!=='undetermined'||v.confidence.level!=='low'))error('absence of search hits cannot establish novelty.');
  return v as LiteratureNoveltyFinding;
 });
}
export function missingNoveltyFinding(pkg:FormalPackage,source:IngestedSource):LiteratureNoveltyFinding[]{return [{id:'main-claim-unassessed',candidateClaim:pkg.mainClaim,claimIds:[],sourceLineIds:source.lines.slice(0,12).map(l=>l.id),contributionType:'undetermined',verdict:'insufficient-evidence',priority:'undetermined',confidence:{level:'low',reason:'No structured claim-level comparison was returned in this legacy-compatible review.',limits:['The prior report remains available; lack of a structured verdict is not evidence for or against originality.']},closestPaperIds:[],passageComparisons:[],neededEvidence:['Read relevant earlier passages and compare the exact proposed claim.']}];}
/** Persisted reports contain only passage locators/hashes. Runtime validation
 * previously required the corresponding private retrieved text. */
export function validateStoredLiteratureEnhancements(report:LiteratureAssessment,pkg?:FormalPackage):void{
 if(report.noveltyFindings===undefined&&report.passages===undefined&&report.searchAudit===undefined)return;
 if(!Array.isArray(report.noveltyFindings)||!Array.isArray(report.passages)||!report.searchAudit||report.searchAudit.version!=='literature-search-audit-v2')error('enhancement bundle is incomplete.');
 const paperIds=new Set(report.papers.map(p=>p.id));const seen=new Set<string>();
 for(const passage of report.passages){object(passage,['id','paperId','referenceId','excerptId','locator','sha256']);txt(passage.id,120);if(seen.has(passage.id)||!paperIds.has(passage.paperId)||!/^https:\/\/arxiv\.org\/(?:html|pdf)\//.test(passage.locator)||!/^[a-f0-9]{64}$/.test(passage.sha256))error('invalid persisted passage provenance.');seen.add(passage.id);}
 const audit=report.searchAudit;if(!Array.isArray(audit.discovered)||audit.discovered.length>180||!Array.isArray(audit.excluded)||!Array.isArray(audit.unavailable)||typeof audit.adaptiveRoundUsed!=='boolean')error('invalid discovery audit.');
 const publicPaperFields=['id','title','authors','year','doi','arxivId','url','provider','inspireId','publicationDate','evidenceLevel','relevance'];
 for(const paper of [...report.papers,...audit.discovered])if(Object.keys(paper).some(key=>!publicPaperFields.includes(key)))error('private abstracts or source passage prose cannot be persisted as public bibliographic metadata.');
 const discoveredIds=new Set(audit.discovered.map(p=>p.id));
 if(new Set(audit.discovered.map(p=>p.id)).size!==audit.discovered.length||audit.screenedPaperIds.some(id=>!discoveredIds.has(id))||audit.excluded.some(item=>!discoveredIds.has(item.paperId)||!item.reason.trim())||audit.passagePaperIds.some(id=>!report.passages!.some(p=>p.paperId===id)))error('discovery audit references must resolve to actual metadata or registered passages.');
 for(const list of [audit.screenedPaperIds,audit.assessedPaperIds,audit.passagePaperIds])strings(list,180);if(audit.assessedPaperIds.some(id=>!paperIds.has(id)))error('audit assessed record mismatch.');
 if(pkg){const sourceIds=[...new Set([...(pkg.analysis?.coverage.flatMap(c=>c.sourceLineIds)||[]),...report.sections.flatMap(s=>s.sourceLineIds)])];const source={id:report.sourceId,sha256:report.sourceSha256,lines:sourceIds.map(id=>({id,text:'',page:0,line:0}))} as IngestedSource;validateNoveltyFindings(report.noveltyFindings,pkg,source,report.papers,report.passages,report.createdAt);}
}
