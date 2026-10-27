import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(path.join(root,'artifacts/api-server/package.json'));
const {build}=require('esbuild');
const dir=await mkdtemp(path.join(tmpdir(),'formal-outputs-'));after(()=>rm(dir,{recursive:true,force:true}));
await build({stdin:{contents:"export * from './outputs.ts'; export * from './subjects.ts'; export {packageDigest} from './package.ts';",resolveDir:path.join(root,'artifacts/api-server/src/formal'),sourcefile:'test-entry.ts'},outfile:path.join(dir,'outputs.mjs'),platform:'node',bundle:true,format:'esm',logLevel:'silent',plugins:[{name:'offline-boundaries',setup(b){b.onResolve({filter:/^@workspace\/db$/},()=>({path:'db',namespace:'stub'}));b.onResolve({filter:/^\.\/model$/},()=>({path:'model',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='db'?"export const pool={query(){throw new Error('Database must not be used by pure output tests')}};":"export const getCurrentFormalModel=()=>({model:'test'});export async function callFormalAI(){throw new Error('Offline test model')}"}));}}]});
const {buildCoverage,validateGeneratedOutputs,buildFallbackOutputs,compileSubjectOutputs,packageDigest,generateOutputs,validateSubjectOverview,isCurrentSubjectOverview}=await import(pathToFileURL(path.join(dir,'outputs.mjs')).href);
const example=JSON.parse(await readFile(path.join(root,'artifacts/api-server/src/formal/example.json'),'utf8'));
function fixture(){
 const pkg=structuredClone(example);pkg.claims=pkg.claims.slice(0,2);pkg.consequences=[];
 const source={id:'source-1',filename:'one-page.pdf',mimeType:'application/pdf',sha256:pkg.source.sha256,pageCount:1,lines:Array.from({length:7},(_,i)=>({id:`L${i+1}`,page:1,line:i+1,text:`Source line ${i+1}`})),warnings:[],createdAt:'2026-10-19T00:00:00Z',fileUrl:'/api/formal-lab/sources/source-1/file',events:[]};
 const [first,second]=pkg.claims;
 pkg.analysis={version:'source-analysis-v2',sourceId:source.id,subjectSlug:'horizon-thermodynamics',subjectTitle:'Horizon thermodynamics',coverage:[
  {id:'input',statement:'The boundary potential is an adopted physical input.',role:'physical-input',sourceLineIds:['L1'],claimIds:[],inputIds:[pkg.selectedInputs[0].id],reason:'Starting premise.'},
  {id:'derivative',statement:'The derivative follows from the declared potential.',role:'mathematical',sourceLineIds:['L2'],claimIds:[first.id],inputIds:[pkg.selectedInputs[0].id],reason:'Exact derivative candidate.'},
  {id:'definition',statement:'A response coefficient is defined.',role:'definition',sourceLineIds:['L3'],claimIds:[second.id],inputIds:[],reason:'Definition rather than independent evidence.'},
  {id:'interpretation',statement:'The mechanics suggests an interpretation.',role:'interpretation',sourceLineIds:['L4'],claimIds:[],inputIds:[],reason:'Interpretive prose.'},
  {id:'empirical',statement:'A possible empirical implication.',role:'empirical',sourceLineIds:['L5'],claimIds:[],inputIds:[],reason:'No empirical data checked.'},
  {id:'scope',statement:'The stated construction is conditional.',role:'scope',sourceLineIds:['L7'],claimIds:[],inputIds:[],reason:'Domain of application.'}],inputReferences:[],claimReferences:[],extractionWarnings:[]};
 const report={checker:'static-worker',engine:'SymPy',checkedAt:'2026-10-19T00:00:00Z',packageDigest:packageDigest(pkg),status:'checked',claims:pkg.claims.map(c=>({id:c.id,status:'checked',title:c.title,residual:'0',dimensions:'consistent',domainRestrictions:[],message:'Exact residual is zero.',derivationKind:'identity'})),limitations:[]};
 return {pkg,source,report};
}
function proposal(f){return {explanation:[{id:'consequence',title:'A conditional consequence',text:'Under the declared potential, the exact derivative has the checked coefficient.',claimIds:[f.pkg.claims[0].id],coverageIds:['input','derivative'],sourceLineIds:['L1','L2'],inputIds:[f.pkg.selectedInputs[0].id]}],review:{summary:'A conditional mechanics result.',explanatoryContribution:'A derivative makes its response coefficient explicit.',correctness:'The selected mathematical candidate checked.',physicalJustification:'The boundary prescription still needs independent assessment.',priorWork:'The source supplies citations.',strengths:['Clear declared premise.'],openQuestions:['Does the boundary prescription apply in the stated regime?'],recommendation:'Inspect the translation and physical foundations.',claimIds:[f.pkg.claims[0].id]}};}
function submission(f){return {id:'11111111-1111-4111-8111-111111111111',title:f.pkg.title,currentRevision:{id:'22222222-2222-4222-8222-222222222222',submissionId:'11111111-1111-4111-8111-111111111111',revision:1,package:f.pkg,digest:packageDigest(f.pkg),createdAt:'2026-10-19T00:00:00Z',origin:'ai',model:'test',approvedAt:'2026-10-19T00:01:00Z',verification:f.report,publishConsent:true}};}
function subject(){return {slug:'horizon-thermodynamics',title:'Horizon thermodynamics',version:0,updatedAt:'2026-10-19T00:00:00Z',paragraphs:[]};}
test('coverage accounts for every nonempty source line and keeps adopted inputs, definitions, prose and empirical claims distinct',()=>{
 const f=fixture();const c=buildCoverage(f.pkg,f.report,f.source);
 assert.equal(c.find(i=>i.id==='derivative').status,'checked');assert.equal(c.find(i=>i.id==='input').status,'adopted-input');assert.equal(c.find(i=>i.id==='definition').status,'definition');assert.equal(c.find(i=>i.id==='interpretation').status,'interpretive');assert.equal(c.find(i=>i.id==='empirical').status,'unsupported');assert.equal(c.find(i=>i.sourceLineIds.includes('L6')).status,'not-assessed');
 assert.deepEqual(new Set(c.flatMap(i=>i.sourceLineIds)),new Set(f.source.lines.map(l=>l.id)));
});
test('a tautological definition restatement cannot make a physical input or mathematical coverage into an independently checked result',()=>{
 const f=fixture();f.report.claims[0].derivationKind='definition-restatement';const c=buildCoverage(f.pkg,f.report,f.source);assert.equal(c.find(i=>i.id==='derivative').status,'definition');assert.equal(c.find(i=>i.id==='input').status,'adopted-input');
 const o=validateGeneratedOutputs(proposal(f),f.pkg,f.report,f.source,'test');assert.equal(o.explanation[0].status,'unverified-context');
});
test('failed, unknown-dimension and contradicted candidates never become checked coverage',()=>{
 for(const [status,dimensions,expected] of [['unsupported','consistent','unsupported'],['checked','unsupported','unsupported'],['contradicted','consistent','contradicted']]){const f=fixture();Object.assign(f.report.claims[0],{status,dimensions});assert.equal(buildCoverage(f.pkg,f.report,f.source).find(i=>i.id==='derivative').status,expected);}
});
test('reports bind exact package digests and all coverage provenance IDs must exist',()=>{
 const f=fixture();f.pkg.assumptions.push('Changed premise');assert.throws(()=>buildCoverage(f.pkg,f.report,f.source),/exact package/);
 const g=fixture();g.pkg.analysis.coverage[0].sourceLineIds=['missing'];g.report.packageDigest=packageDigest(g.pkg);assert.throws(()=>buildCoverage(g.pkg,g.report,g.source),/source/);
});
test('generated explanations validate source and claim references and recompute labels',()=>{
 const f=fixture();const raw=proposal(f);raw.explanation[0].status='verified';const out=validateGeneratedOutputs(raw,f.pkg,f.report,f.source,'test');assert.equal(out.explanation[0].status,'conditional-checked');assert.match(out.review.priorWork,/No literature-wide/);assert.match(out.review.physicalJustification,/adopted premises/);
 for(const mutate of [p=>p.explanation[0].claimIds=['invented'],p=>p.explanation[0].sourceLineIds=['L2'],p=>p.explanation[0].coverageIds=['invented'],p=>p.explanation[0].inputIds=['invented']]){const p=proposal(f);mutate(p);assert.throws(()=>validateGeneratedOutputs(p,f.pkg,f.report,f.source,'test'));}
});
test('interpretations cannot inherit a checked label by referencing an unrelated checked equation',()=>{
 const f=fixture();const p=proposal(f);p.explanation[0].coverageIds=['interpretation'];p.explanation[0].sourceLineIds=['L4'];assert.equal(validateGeneratedOutputs(p,f.pkg,f.report,f.source,'test').explanation[0].status,'unverified-context');
});
test('every coverage unit has a use or pending disposition, and absent mathematical explanations are preserved',()=>{
 const f=fixture();const p=proposal(f);p.explanation[0].coverageIds=['scope'];p.explanation[0].sourceLineIds=['L7'];p.explanation[0].claimIds=[];const out=validateGeneratedOutputs(p,f.pkg,f.report,f.source,'test');
 assert.ok(out.explanation.some(s=>s.coverageIds.includes('derivative')));assert.ok(out.contributions.some(c=>c.reason.includes('adopted premise')));assert.equal(out.contributions.length,out.explanation.length+out.coverage.filter(c=>!out.explanation.some(s=>s.coverageIds.includes(c.id))).length);
});
test('unavailable AI falls back to the real computed report without fabricating an ideal review',async()=>{
 const f=fixture();const out=await generateOutputs(f.pkg,f.report,f.source);assert.equal(out.model,'deterministic-report-v2');assert.match(out.review.summary,/2\/2/);assert.ok(out.coverage.some(c=>c.status==='not-assessed'));assert.ok(out.warnings.some(w=>w.includes('AI explanation was unavailable')));
});
test('publication requires exact approved digest, explicit consent and the matching hashed source',()=>{
 for(const mutate of [s=>s.currentRevision.publishConsent=false,s=>s.currentRevision.approvedAt=null,s=>s.currentRevision.digest='bad']){const f=fixture();const s=submission(f);mutate(s);const out=buildFallbackOutputs(f.pkg,f.report,f.source);assert.throws(()=>compileSubjectOutputs(subject(),s,f.source,out));}
 const f=fixture();const source={...f.source,sha256:'bad'};assert.throws(()=>compileSubjectOutputs(subject(),submission(f),source,buildFallbackOutputs(f.pkg,f.report,f.source)),/hash/);
});
test('subject compilation preserves conditional premises and immutable source citations, deduplicating only exact dependency matches',()=>{
 const f=fixture();const out=validateGeneratedOutputs(proposal(f),f.pkg,f.report,f.source,'test');const s=submission(f);
 const first=compileSubjectOutputs(subject(),s,f.source,out);assert.equal(first.subject.version,1);assert.equal(first.subject.paragraphs.length,1);assert.ok(first.subject.paragraphs[0].conditions.some(c=>c.includes('Adopted input')));assert.match(first.subject.paragraphs[0].text,/conditional mathematical/);assert.equal(first.subject.paragraphs[0].sources[0].digest,s.currentRevision.digest);
 const duplicate=compileSubjectOutputs(first.subject,s,f.source,out);assert.equal(duplicate.changed,false);assert.equal(duplicate.subject.paragraphs.length,1);assert.equal(duplicate.outputs.contributions[0].disposition,'already-represented');assert.equal(duplicate.outputs.contributions[0].paragraphId,first.subject.paragraphs[0].id);
 const g=fixture();g.pkg.assumptions.push('Additional physical regime restriction');g.report.packageDigest=packageDigest(g.pkg);const changed=compileSubjectOutputs(first.subject,submission(g),g.source,validateGeneratedOutputs(proposal(g),g.pkg,g.report,g.source,'test'));assert.equal(changed.subject.paragraphs.length,2);
});
test('unverified contexts are retained as pending findings and never inserted into a checked field explanation',()=>{
 const f=fixture();f.report.claims[0].status='unsupported';const out=validateGeneratedOutputs(proposal(f),f.pkg,f.report,f.source,'test');const result=compileSubjectOutputs(subject(),submission(f),f.source,out);assert.equal(result.subject.paragraphs.length,0);assert.ok(result.outputs.contributions.every(c=>c.disposition==='unsupported'));
});

test('compiled subject prose cites only actual evidence and retains every unmapped contribution explicitly',()=>{
 const f=fixture();const out=validateGeneratedOutputs(proposal(f),f.pkg,f.report,f.source,'test');const compiled=compileSubjectOutputs(subject(),submission(f),f.source,out).subject;
 compiled.paragraphs.push({...structuredClone(compiled.paragraphs[0]),id:'p-additional',title:'Additional conditional result'});
 const raw={introduction:'A conditional account of the supplied horizon-mechanics contributions.',sections:[{id:'mechanics',title:'From a potential to its mechanical response',text:'The first contribution makes the response coefficient explicit under the stated boundary prescription.',paragraphIds:[compiled.paragraphs[0].id]}]};
 const overview=validateSubjectOverview(raw,compiled,'test-model');assert.equal(overview.sourceVersion,compiled.version);assert.equal(overview.sections.length,2);assert.deepEqual(new Set(overview.sections.flatMap(s=>s.paragraphIds)),new Set(compiled.paragraphs.map(p=>p.id)));assert.match(overview.sections[1].text,/not integrated/);
 raw.sections[0].paragraphIds=['invented-evidence'];assert.throws(()=>validateSubjectOverview(raw,compiled,'test'),/missing evidence/);
});
test('a compiled overview is renderable only for the exact evidence version it summarized',()=>{
 const value=subject();assert.equal(isCurrentSubjectOverview(value),false);
 value.overview={introduction:'Prior narrative',sections:[],model:'test',generatedAt:'2026-10-19T00:00:00Z',sourceVersion:0};assert.equal(isCurrentSubjectOverview(value),true);
 value.version=1;assert.equal(isCurrentSubjectOverview(value),false);
});

test('adopted input summary counts approved input proposals, not repeated coverage units',()=>{
 const f=fixture();const repeated=structuredClone(f.pkg.analysis.coverage[0]);repeated.id='same-input-again';f.pkg.analysis.coverage.push(repeated);f.report.packageDigest=packageDigest(f.pkg);
 const out=buildFallbackOutputs(f.pkg,f.report,f.source);assert.equal(out.summary.conditionalInputs,f.pkg.selectedInputs.length);
});

test('a checked consequence inside a mixed unverified section gets its own eligible explanation without promoting the interpretation',()=>{
 const f=fixture();const raw=proposal(f);
 raw.explanation[0].coverageIds=['input','derivative','interpretation'];
 raw.explanation[0].sourceLineIds=['L1','L2','L4'];
 raw.explanation[0].text='The derivative checks, but this paragraph also discusses an unverified physical interpretation.';
 const out=validateGeneratedOutputs(raw,f.pkg,f.report,f.source,'test');
 const mixed=out.explanation.find(section=>section.id==='consequence');assert.equal(mixed.status,'unverified-context');
 const isolated=out.explanation.find(section=>section.id!==mixed.id&&section.coverageIds.includes('derivative'));
 assert.ok(isolated);assert.equal(isolated.status,'conditional-checked');assert.deepEqual(isolated.coverageIds,['derivative']);assert.deepEqual(isolated.sourceLineIds,['L2']);assert.ok(!isolated.text.includes('unverified physical interpretation'));
 assert.equal(out.coverage.find(item=>item.id==='interpretation').status,'interpretive');
 const compiled=compileSubjectOutputs(subject(),submission(f),f.source,out);
 assert.equal(compiled.subject.paragraphs.length,1);assert.deepEqual(compiled.subject.paragraphs[0].sources[0].sourceLineIds,['L2']);assert.ok(!compiled.subject.paragraphs[0].text.includes('unverified physical interpretation'));
 assert.equal(compiled.outputs.contributions.find(item=>item.sectionId===mixed.id).disposition,'unsupported');
 assert.equal(compiled.outputs.contributions.find(item=>item.sectionId===isolated.id).disposition,'included');
});
