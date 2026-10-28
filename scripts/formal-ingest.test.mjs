import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(path.join(root,'artifacts/api-server/package.json'));
let temp, api;
before(async()=>{
  const {build}=require('esbuild');
  temp=await mkdtemp(path.join(tmpdir(),'msr-formal-ingest-'));
  const ingest=path.join(root,'artifacts/api-server/src/formal/ingest.ts');
  const checker=path.join(root,'artifacts/api-server/src/formal/checker.ts');
  const outputs=path.join(root,'artifacts/api-server/src/formal/outputs.ts');
  const packages=path.join(root,'artifacts/api-server/src/formal/package.ts');
  const outfile=path.join(temp,'ingest-tests.mjs');
  await build({stdin:{contents:`export * from ${JSON.stringify(ingest)};export {isolatedModels} from ${JSON.stringify(checker)};export {buildCoverage} from ${JSON.stringify(outputs)};export {packageDigest} from ${JSON.stringify(packages)};`,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',outfile,logLevel:'silent',plugins:[{name:'deterministic-ai-transport',setup(b){b.onLoad({filter:/[\\/]formal[\\/]subjects\.ts$/},()=>({contents:`export async function publishOutputs(){throw new Error('Database use is forbidden in pure tests');}export async function readSubject(){throw new Error('Database use is forbidden in pure tests');}export async function listSubjects(){throw new Error('Database use is forbidden in pure tests');}`,loader:'ts'}));b.onLoad({filter:/[\\/]formal[\\/]model\.ts$/},()=>({contents:`export async function callFormalAI(options){const state=globalThis[Symbol.for('msr.formal-ingest.tests')];state.calls.push(options);if(!state.responses.length)throw new Error('No deterministic response prepared');const response=state.responses.shift();if(response?.__throw)throw Object.assign(new Error(response.message||'Deterministic provider failure'),response.__throw);return {data:response,model:'deterministic-test-model'};}`,loader:'ts'}));}}]});
  api=await import(pathToFileURL(outfile).href);
});
after(async()=>{if(temp)await rm(temp,{recursive:true,force:true});delete globalThis[Symbol.for('msr.formal-ingest.tests')];});

const S=name=>({op:'symbol',name});
const I=value=>({op:'integer',value});
function fixtures(){
  const source={id:'00000000-0000-4000-a000-000000000001',filename:'simple-model.tex',mimeType:'text/plain',sha256:'b'.repeat(64),pageCount:1,lines:[{id:'p1-l001',page:1,line:1,text:'Simple model'},{id:'p1-l002',page:1,line:2,text:'Assume f=x^2 for real dimensionless x.'},{id:'p1-l003',page:1,line:3,text:'Then df/dx=2x.'},{id:'p1-l004',page:1,line:4,text:'A sentence with no supported assertion identified.'}],warnings:[],createdAt:'2026-10-19T00:00:00.000Z',fileUrl:'/api/formal-lab/sources/00000000-0000-4000-a000-000000000001/file',events:[]};
  const inventory={title:'Simple model',authors:'Test author',mainClaim:'The model has derivative 2x.',subjectSlug:'scalar-models',subjectTitle:'Scalar models',inputs:[{id:'model',title:'Chosen physical model',statement:'f=x^2 with real dimensionless x.',sourceUrl:'',sourceLineIds:['p1-l002'],basis:'stated',justification:'The submitted source explicitly adopts this model.'}],coverage:[{id:'given',statement:'f=x^2.',role:'physical-input',sourceLineIds:['p1-l002'],inputIds:['model'],reason:'An adopted model, not an independent physical conclusion.'},{id:'derivative',statement:'df/dx=2x.',role:'mathematical',sourceLineIds:['p1-l003'],inputIds:['model'],reason:'A derivative to compute from the supplied model.'}],groups:[{id:'derivatives',title:'Derivative model',coverageIds:['derivative'],sourceLineIds:['p1-l002','p1-l003'],focus:'Differentiate with respect to independent x.'}],warnings:[]};
  const audit={additionalCoverage:[{id:'title',statement:'Source title: Simple model.',role:'metadata',sourceLineIds:['p1-l001'],inputIds:[],reason:'Identifies source metadata.'},{id:'unread-line',statement:source.lines[3].text,role:'unassessed',sourceLineIds:['p1-l004'],inputIds:[],reason:'No supported claim was identified; this is not verified.'}],additionalInputs:[],corrections:[],groups:structuredClone(inventory.groups),warnings:[]};
  const batch={assumptions:['The physical applicability of the source-chosen model is an adopted premise.'],symbols:[{name:'x',label:'Independent dimensionless coordinate',domain:'real',dimensions:[0,0,0,0,0,0,0],definitionJson:'',definitionDescription:''},{name:'f',label:'Model value',domain:'real',dimensions:[0,0,0,0,0,0,0],definitionJson:JSON.stringify({op:'pow',base:S('x'),exponent:2}),definitionDescription:'The source specifies f as the square of x.'}],claims:[{id:'derivative',title:'Derivative of the specified model',lhsJson:JSON.stringify({op:'diff',expr:S('f'),variable:'x'}),rhsJson:JSON.stringify({op:'mul',args:[I(2),S('x')]}),explanation:'Computes an actual derivative, conditional on the chosen source model.',coverageIds:['derivative'],sourceLineIds:['p1-l002','p1-l003']}],consequences:[{title:'Slope',text:'Under the chosen model, the local slope is twice x.',claimIds:['derivative']}],limitations:['This does not establish the model’s applicability to an experiment.'],unformalized:[]};
  return {source,inventory,audit,batch};
}
function transport(responses){const state={responses:structuredClone(responses),calls:[]};globalThis[Symbol.for('msr.formal-ingest.tests')]=state;return state;}
function valid(f){return api.validateInventory(f.inventory,f.source);}
async function analyzed(f=fixtures(),guidance){const state=transport([f.inventory,f.audit,f.batch]);const events=[];const pkg=await api.analyzeSource(f.source,Buffer.from('test source bytes'),async(stage,message)=>events.push({stage,message}),guidance);return {pkg,state,events,f};}

test('source-derived inputs retain source fingerprint, not a fixed catalogue version',()=>{
  const f=fixtures();const inventory=valid(f);assert.equal(inventory.inputs[0].version,'source-bbbbbbbbbbbb');assert.equal(inventory.inputs[0].statement,f.inventory.inputs[0].statement);
});
test('inventory rejects references to nonexistent source lines',()=>{
  const f=fixtures();f.inventory.coverage[0].sourceLineIds=['p99-l999'];assert.throws(()=>valid(f),/identifier is absent/);
});
test('non-atomic equation chains retain their evidence as unassessed units',()=>{
  const f=fixtures();f.inventory.coverage[1].statement='f=x^2=another_value';const result=valid(f);const item=result.coverage.find(c=>c.id==='derivative');assert.equal(item.statement,'f=x^2=another_value');assert.equal(item.role,'unassessed');assert.deepEqual(item.sourceLineIds,['p1-l003']);assert.match(item.reason,/Non-atomic source statement; individual equalities require separate coverage/);
});
test('source input proposals receive visible adopted-premise coverage if omitted',()=>{
  const f=fixtures();f.inventory.coverage[0].role='citation';f.inventory.coverage.forEach(c=>c.inputIds=[]);const result=valid(f);const premise=result.coverage.find(c=>c.role==='physical-input');assert.deepEqual(premise.inputIds,['model']);assert.equal(premise.statement,f.inventory.inputs[0].statement);assert.deepEqual(premise.sourceLineIds,['p1-l002']);assert.match(premise.reason,/Adopted proposed premise, not an independently verified/);
});
test('unknown ancillary input links are removed without losing source evidence',()=>{
  const f=fixtures();f.inventory.coverage[0].inputIds=['unknown-model'];const result=valid(f);const item=result.coverage.find(c=>c.id==='given');assert.equal(item.role,'physical-input');assert.deepEqual(item.inputIds,[]);assert.equal(item.statement,f.inventory.coverage[0].statement);assert.deepEqual(item.sourceLineIds,['p1-l002']);assert.match(item.reason,/Missing input proposal references: unknown-model/);assert(!result.coverage.some(c=>c.inputIds.includes('unknown-model')));assert(result.coverage.some(c=>c.inputIds.includes('model')));
});
test('known input links survive alongside a removed typo',()=>{
  const f=fixtures();f.inventory.coverage[1].inputIds=['model','typo'];const item=valid(f).coverage.find(c=>c.id==='derivative');assert.deepEqual(item.inputIds,['model']);assert.match(item.reason,/typo/);
});
test('unknown source references stay strict and diagnose the exact identifier',()=>{
  const f=fixtures();f.inventory.coverage[0].sourceLineIds=['p42-l999'];assert.throws(()=>valid(f),error=>/Unknown IDs: "p42-l999"/.test(error.message)&&/Allowed IDs: p1-l001/.test(error.message));
});
test('audit repairs source mapping and preserves existing assertions',()=>{
  const f=fixtures();f.audit.corrections=[{coverageId:'derivative',role:'mathematical',sourceLineIds:['p1-l002','p1-l003'],reason:'The complete equation span includes its model premise.'}];const result=api.applyCoverageAudit(valid(f),f.audit,f.source);assert.equal(result.coverage.length,4);assert.deepEqual(result.coverage.find(c=>c.id==='derivative').sourceLineIds,['p1-l002','p1-l003']);
});
test('an input added by the audit receives its own actual source-linked premise unit',()=>{
  const f=fixtures();f.audit.additionalInputs=[{...f.inventory.inputs[0],id:'audit-input',title:'An additional source premise',statement:'An additional source premise awaiting author approval.',sourceLineIds:['p1-l004'],justification:'The audit located this proposed premise in the source.'}];const result=api.applyCoverageAudit(valid(f),f.audit,f.source);const item=result.coverage.find(c=>c.inputIds.includes('audit-input'));assert.equal(item.role,'physical-input');assert.equal(item.statement,f.audit.additionalInputs[0].statement);assert.deepEqual(item.sourceLineIds,['p1-l004']);assert.match(item.reason,/not an independently verified physical result/);
});
test('audit cannot promote a retained broad chain into checked mathematical coverage',()=>{
  const f=fixtures();f.inventory.coverage[1].statement='f=x^2=another_value';f.audit.corrections=[{coverageId:'derivative',role:'mathematical',sourceLineIds:['p1-l002','p1-l003'],reason:'Attempted broad promotion.'}];const result=api.applyCoverageAudit(valid(f),f.audit,f.source);assert.equal(result.coverage.find(c=>c.id==='derivative').role,'unassessed');assert.match(result.coverage.find(c=>c.id==='derivative').reason,/Non-atomic source statement/);
});
test('audit identifies every remaining unmapped source line by exact ID',()=>{
  const f=fixtures();f.audit.additionalCoverage=[];assert.throws(()=>api.applyCoverageAudit(valid(f),f.audit,f.source),/p1-l001, p1-l004/);
});
test('audit cannot correct an unknown assertion',()=>{
  const f=fixtures();f.audit.corrections=[{coverageId:'missing',role:'definition',sourceLineIds:['p1-l003'],reason:'An invented assertion.'}];assert.throws(()=>api.applyCoverageAudit(valid(f),f.audit,f.source),/unknown assertion/);
});
test('namespace rewriting includes derivatives and simultaneous-substitution keys',()=>{
  const expression={op:'substitute',expr:{op:'diff',expr:S('f'),variable:'x'},values:{x:I(3)}};assert.deepEqual(api.namespaceExpr(expression,'b5_'),{op:'substitute',expr:{op:'diff',expr:S('b5_f'),variable:'b5_x'},values:{b5_x:I(3)}});
});
test('fifth namespace is supported and a sixth is rejected',()=>{
  const f=fixtures();const packed=api.validateBatch(f.batch,f.source,valid(f),f.inventory.groups[0],5);assert.equal(packed.package.claims[0].id,'b5-derivative');assert.throws(()=>api.namespacePackage(packed.package,6),/Invalid formalization batch index/);
});
test('each derived symbol is declared through its own definition entry',()=>{
  const f=fixtures();const packed=api.validateBatch(f.batch,f.source,valid(f),f.inventory.groups[0],1);assert.equal(packed.package.definitions[0].symbol,'b1_f');assert.equal(packed.package.symbols.filter(s=>s.name==='b1_f').length,1);assert(!('definitionJson' in packed.package.symbols[0]));
});
test('executable or unsupported AST operations are rejected as data',()=>{
  const f=fixtures();f.batch.claims[0].lhsJson=JSON.stringify({op:'python',code:'never execute'});assert.throws(()=>api.validateBatch(f.batch,f.source,valid(f),f.inventory.groups[0],1),/Unsupported expression operation/);
});
test('missing derived symbols are rejected instead of silently invented',()=>{
  const f=fixtures();f.batch.claims[0].rhsJson=JSON.stringify(S('undeclared'));assert.throws(()=>api.validateBatch(f.batch,f.source,valid(f),f.inventory.groups[0],1),/Undeclared symbol/);
});
test('claims cannot cite an assertion outside their assigned source group',()=>{
  const f=fixtures();f.batch.claims[0].coverageIds=['given'];assert.throws(()=>api.validateBatch(f.batch,f.source,valid(f),f.inventory.groups[0],1),/identifier is absent/);
});
test('batch bounds reject more than24 symbols',()=>{
  const f=fixtures();f.batch.symbols=Array.from({length:25},(_,i)=>({...f.batch.symbols[0],name:'x'+i}));assert.throws(()=>api.validateBatch(f.batch,f.source,valid(f),f.inventory.groups[0],1),/at most 24/);
});
test('zero candidates yields a coverage gap and never a dummy equality',()=>{
  const f=fixtures();Object.assign(f.batch,{claims:[],symbols:[],consequences:[],unformalized:[{coverageId:'derivative',reason:'No supported candidate exists.'}]});assert.equal(api.validateBatch(f.batch,f.source,valid(f),f.inventory.groups[0],1).package,null);
});
test('defined derivative variables and cyclic models fail structural validation',()=>{
  const f=fixtures();f.batch.symbols[0].definitionJson=JSON.stringify(I(1));f.batch.symbols[0].definitionDescription='This makes x dependent.';assert.throws(()=>api.validateBatch(f.batch,f.source,valid(f),f.inventory.groups[0],1),/Derivative variable x has a definition/);
  const cycle=fixtures();cycle.batch.symbols[0].definitionJson=JSON.stringify(S('f'));cycle.batch.symbols[0].definitionDescription='A cyclic input.';cycle.batch.claims[0].lhsJson=JSON.stringify(S('f'));assert.throws(()=>api.validateBatch(cycle.batch,cycle.source,valid(cycle),cycle.inventory.groups[0],1),/Cyclic definition/);
});
test('derived coefficients with wrong SI dimensions fail typing before approval',()=>{
  const f=fixtures();f.batch.symbols.push({name:'c',label:'Fixed speed',domain:'positive',dimensions:[0,1,-1,0,0,0,0],definitionJson:'',definitionDescription:''},{name:'G',label:'Fixed gravitational constant',domain:'positive',dimensions:[-1,3,-2,0,0,0,0],definitionJson:'',definitionDescription:''},{name:'coupling',label:'Derived coupling',domain:'positive',dimensions:[-1,-1,-2,0,0,0,0],definitionJson:JSON.stringify({op:'div',numerator:S('G'),denominator:{op:'pow',base:S('c'),exponent:4}}),definitionDescription:'The source specifies this coefficient.'});assert.throws(()=>api.validateBatch(f.batch,f.source,valid(f),f.inventory.groups[0],1),/Definition coupling has declared SI dimensions.*AST has/);f.batch.symbols.find(s=>s.name==='coupling').dimensions=[-1,-1,2,0,0,0,0];assert(api.validateBatch(f.batch,f.source,valid(f),f.inventory.groups[0],1).package.definitions.some(d=>d.symbol==='b1_coupling'));
});
test('zero-valued derived definitions retain permissive unit handling',()=>{
  const f=fixtures();f.batch.symbols.push({name:'zeroEnergy',label:'Zero-valued energy',domain:'real',dimensions:[1,2,-2,0,0,0,0],definitionJson:JSON.stringify(I(0)),definitionDescription:'A source-specified zero value.'});assert(api.validateBatch(f.batch,f.source,valid(f),f.inventory.groups[0],1).package);
});
test('typing ordinary derivative coefficients uses the independent coordinate units',()=>{
  const f=fixtures();f.batch.symbols[0].dimensions=[0,1,0,0,0,0,0];f.batch.symbols[1].dimensions=[0,2,0,0,0,0,0];f.batch.symbols.push({name:'slope',label:'Length-valued coefficient',domain:'real',dimensions:[0,1,0,0,0,0,0],definitionJson:JSON.stringify({op:'diff',expr:S('f'),variable:'x'}),definitionDescription:'An ordinary independent-coordinate derivative.'});assert(api.validateBatch(f.batch,f.source,valid(f),f.inventory.groups[0],1).package);
});
test('input wording alone never silently imposes a missing scalar constraint',()=>{
  const f=fixtures();f.batch.assumptions.push('The author describes x=2y as a family input.');f.batch.symbols.push({name:'y',label:'An otherwise independent coordinate',domain:'real',dimensions:[0,0,0,0,0,0,0],definitionJson:'',definitionDescription:''});f.batch.claims[0].lhsJson=JSON.stringify(S('x'));f.batch.claims[0].rhsJson=JSON.stringify({op:'mul',args:[I(2),S('y')]});const result=api.validateBatch(f.batch,f.source,valid(f),f.inventory.groups[0],1);assert(!result.package.definitions.some(d=>['b1_x','b1_y'].includes(d.symbol)));assert.deepEqual(result.package.claims[0].lhs,S('b1_x'));
});
test('complete automatic orchestration preserves all source rows and exact claim references',async()=>{
  const {pkg,state,events,f}=await analyzed();assert.equal(state.calls.length,3);assert.equal(pkg.claims.length,1);assert.equal(pkg.analysis.claimReferences[0].claimId,'b1-derivative');assert.equal(new Set(pkg.analysis.coverage.flatMap(c=>c.sourceLineIds)).size,f.source.lines.length);assert(events.some(e=>e.stage==='analysis-ready'));assert(pkg.analysis.coverage.some(c=>c.role==='unassessed'));assert(!('authorGuidance' in state.calls[0].payload.request));
});
test('a confirmed small-source output cap selects compact transport once with identical scientific content',async()=>{
 const f=fixtures(),baseline=await analyzed(structuredClone(f));const state=transport([{__throw:{code:'FORMAL_MODEL_OUTPUT_LIMIT'},message:'Provider-confirmed output token limit.'},f.inventory,f.audit,f.batch]),events=[];
 const pkg=await api.analyzeSource(f.source,Buffer.from('source bytes'),async(stage,message)=>events.push({stage,message}));
 assert.equal(state.calls.length,4);assert.deepEqual(pkg.claims,baseline.pkg.claims);assert.deepEqual(pkg.selectedInputs,baseline.pkg.selectedInputs);assert.deepEqual(pkg.assumptions,baseline.pkg.assumptions);
 assert.deepEqual(state.calls[1].payload.request.numberedLines,f.source.lines);assert.equal(state.calls[1].schema.properties.coverage.items.properties.reason.maxLength,120);assert.match(state.calls[1].system,/not permission to merge distinct equalities, omit claims or remove scientific conditions/);
 assert.equal(events.filter(event=>event.message.includes('structural repair')).length,0);assert.ok(events.some(event=>event.stage==='inventory-compact'));assert.deepEqual(state.calls.map(call=>call.outputBudget),['source-inventory','source-inventory','source-coverage-audit',undefined]);
});
test('a 527-row complete seven-page source uses compact wording first and retains every row and equation',async()=>{
 const f=fixtures();f.source.mimeType='application/pdf';f.source.filename='seven-page.pdf';f.source.pageCount=7;
 for(let index=4;index<527;index++){const page=2+Math.floor((index-4)/88),line=1+(index-4)%88;f.source.lines.push({id:`p${page}-l${String(line).padStart(3,'0')}`,page,line,text:'The stated model remains restricted to its declared scalar domain.'});}
 const mapped=new Set(f.inventory.coverage.flatMap(item=>item.sourceLineIds));
 for(let page=1;page<=7;page++){const sourceLineIds=f.source.lines.filter(line=>line.page===page&&!mapped.has(line.id)).map(line=>line.id);if(sourceLineIds.length)f.inventory.coverage.push({id:'context-'+page,statement:'Source context and stated model scope.',role:'scope',sourceLineIds,inputIds:[],reason:'Stated domain context, not a separate proof.'});}
 f.audit={additionalCoverage:[],additionalInputs:[],corrections:[],groups:structuredClone(f.inventory.groups),warnings:[]};
 const {pkg,state}=await analyzed(f);assert.equal(state.calls.length,3);assert.equal(state.calls[0].schema.properties.coverage.items.properties.reason.maxLength,120);
 assert.deepEqual(state.calls[0].payload.request.numberedLines,f.source.lines);assert.deepEqual(state.calls[1].payload.request.source.numberedLines,f.source.lines);assert.ok(state.calls.every(call=>call.pdf?.mimeType==='application/pdf'));
 assert.equal(new Set(pkg.analysis.coverage.flatMap(item=>item.sourceLineIds)).size,527);assert.equal(pkg.claims.length,1);assert.equal(pkg.claims[0].lhs.op,'diff');assert.equal(pkg.claims[0].lhs.variable,'b1_x');assert.equal(pkg.claims[0].rhs.op,'mul');assert.equal(pkg.selectedInputs[0].statement,'f=x^2 with real dimensionless x.');assert.equal(pkg.analysis.coverage.filter(item=>item.role==='unassessed').length,0);
});
test('a repeated confirmed output cap stops compact analysis without a third identical request',async()=>{
 const f=fixtures(),failure={__throw:{code:'FORMAL_MODEL_OUTPUT_LIMIT'},message:'Provider-confirmed output token limit.'},state=transport([failure,failure]);
 await assert.rejects(()=>api.analyzeSource(f.source,Buffer.from('source'),async()=>{}),error=>error.code==='FORMAL_MODEL_OUTPUT_LIMIT');assert.equal(state.calls.length,2);
});
test('ordinary provider failures never select the output-limit fallback',async()=>{
 const f=fixtures(),state=transport([{__throw:{code:'UNRELATED_FAILURE'}},{__throw:{code:'UNRELATED_FAILURE'}}]);
 await assert.rejects(()=>api.analyzeSource(f.source,Buffer.from('source'),async()=>{}));assert.equal(state.calls.length,2);assert.ok(state.calls.every(call=>!call.system.includes('COMPACT TRANSPORT')));
});
test('compact limits reject excess wording rather than truncating scientific statements or changing their role',()=>{
 const f=fixtures();f.inventory.coverage[0].reason='x'.repeat(121);assert.throws(()=>api.validateCompactInventory(f.inventory,f.source),/compact coverage reason/);assert.equal(f.inventory.coverage[0].reason.length,121);
 f.inventory.coverage[0].reason='A stated physical premise.';f.inventory.coverage[1].statement='f=x^2=another_value';const compact=api.validateCompactInventory(f.inventory,f.source);assert.equal(compact.coverage[1].role,'unassessed');assert.equal(compact.coverage[1].statement,'f=x^2=another_value');
 const oversized=fixtures();oversized.inventory.inputs[0].justification='x'.repeat(201);assert.throws(()=>api.validateCompactInventory(oversized.inventory,oversized.source),/compact input justification/);
});
test('inventory and audit provider schemas require the same nonempty text as their parsers',()=>{
 for(const schema of [api.inventorySchema,api.compactInventorySchema]){
   for(const key of ['title','mainClaim','subjectSlug','subjectTitle'])assert.equal(schema.properties[key].minLength,1,key);
   assert.equal(schema.properties.authors.minLength,undefined);
   const coverage=schema.properties.coverage.items.properties,input=schema.properties.inputs.items.properties,group=schema.properties.groups.items.properties;
   for(const key of ['id','statement','reason'])assert.equal(coverage[key].minLength,1,key);
   for(const key of ['id','title','statement','justification'])assert.equal(input[key].minLength,1,key);
   for(const key of ['id','title','focus'])assert.equal(group[key].minLength,1,key);
   assert.equal(input.sourceUrl.minLength,undefined);assert.equal(schema.properties.warnings.items.minLength,1);
 }
 assert.equal(api.compactInventorySchema.properties.coverage.items.properties.reason.maxLength,120);
 for(const key of ['id','statement','reason'])assert.equal(api.auditSchema.properties.additionalCoverage.items.properties[key].minLength,1,key);
 for(const key of ['id','title','statement','justification'])assert.equal(api.auditSchema.properties.additionalInputs.items.properties[key].minLength,1,key);
 assert.equal(api.auditSchema.properties.additionalInputs.items.properties.sourceUrl.minLength,undefined);
 for(const key of ['coverageId','reason'])assert.equal(api.auditSchema.properties.corrections.items.properties[key].minLength,1,key);
});
test('empty coverage reasons remain rejected for every role without inserting scientific text',()=>{
 for(const role of ['mathematical','physical-input','definition','interpretation','empirical','citation','scope','metadata','unassessed']){
   const f=fixtures();f.inventory.coverage[0].role=role;f.inventory.coverage[0].reason='';const before=JSON.stringify(f.inventory);
   assert.throws(()=>api.validateInventory(f.inventory,f.source),/coverage reason/);assert.throws(()=>api.validateCompactInventory(f.inventory,f.source),/coverage reason/);assert.equal(JSON.stringify(f.inventory),before);
   const audit=fixtures();audit.audit.additionalCoverage[0].role=role;audit.audit.additionalCoverage[0].reason='';assert.throws(()=>api.applyCoverageAudit(valid(audit),audit.audit,audit.source),/coverage reason/);
 }
 const f=fixtures();f.audit.corrections=[{coverageId:'given',role:'physical-input',sourceLineIds:['p1-l002'],reason:''}];assert.throws(()=>api.applyCoverageAudit(valid(f),f.audit,f.source),/corrected coverage reason/);
});
test('required input wording stays nonempty while absent URLs and author metadata remain permitted',async()=>{
 for(const key of ['id','title','statement','justification']){
   const f=fixtures();f.inventory.inputs[0][key]='';assert.throws(()=>api.validateInventory(f.inventory,f.source));assert.equal(f.inventory.inputs[0][key],'');
   const added=fixtures();added.audit.additionalInputs=[{...added.inventory.inputs[0],id:'new-input',[key]:''}];assert.throws(()=>api.applyCoverageAudit(valid(added),added.audit,added.source));
 }
 const f=fixtures();f.inventory.authors='';f.inventory.inputs[0].sourceUrl='';const {pkg,state}=await analyzed(f);assert.equal(pkg.authors,'');assert.equal(pkg.selectedInputs[0].sourceUrl,undefined);
 assert.ok(state.calls[0].system.includes('concise NONEMPTY reason'));assert.ok(state.calls[1].system.includes('concise NONEMPTY reason'));
});
test('author guidance propagates without suppressing source coverage and discrepancies warn',async()=>{
  const {pkg,state,f}=await analyzed(fixtures(),{title:'An author-selected title',mainClaim:'A narrower requested focus'});assert.equal(state.calls[0].payload.request.authorGuidance.title,'An author-selected title');assert.equal(state.calls[2].payload.request.authorGuidance.mainClaim,'A narrower requested focus');assert(pkg.analysis.extractionWarnings.some(w=>w.includes('differs from the source-extracted')));assert.equal(new Set(pkg.analysis.coverage.flatMap(c=>c.sourceLineIds)).size,f.source.lines.length);
});
test('a partial scalar subclaim cannot mark its broader assertion complete',async()=>{
  const f=fixtures();f.batch.unformalized=[{coverageId:'derivative',reason:'The broader interpretation is not established.'}];const {pkg}=await analyzed(f);assert.deepEqual(pkg.analysis.coverage.find(c=>c.id==='derivative').claimIds,[]);assert.deepEqual(pkg.analysis.coverage.find(c=>c.id==='candidate-b1-derivative').claimIds,['b1-derivative']);
});
test('a retained non-atomic unit cannot inherit its narrower candidate result',async()=>{
  const f=fixtures();f.inventory.coverage[1].statement='f=x^2=another_value';const {pkg}=await analyzed(f);const broad=pkg.analysis.coverage.find(c=>c.id==='derivative');assert.equal(broad.role,'unassessed');assert.deepEqual(broad.claimIds,[]);assert.deepEqual(pkg.analysis.coverage.find(c=>c.id==='candidate-b1-derivative').claimIds,['b1-derivative']);
});
test('surviving models retain their original assumption labels after an earlier gap',async()=>{
  const f=fixtures();f.inventory.groups=[{...f.inventory.groups[0],id:'first',title:'Unsupported first model'},{...f.inventory.groups[0],id:'second',title:'Supported second model'}];f.audit.groups=structuredClone(f.inventory.groups);const empty={assumptions:[],symbols:[],claims:[],consequences:[],limitations:[],unformalized:[{coverageId:'derivative',reason:'No exact scalar translation in the first model.'}]};transport([f.inventory,f.audit,empty,f.batch]);const pkg=await api.analyzeSource(f.source,Buffer.from('source'),async()=>{});assert.equal(pkg.claims[0].id,'b2-derivative');assert(pkg.assumptions.every(s=>s.startsWith('Model 2:')));
});
test('a physical-input unit with only unknown links stays unsupported despite passing equations',async()=>{
  const f=fixtures();f.inventory.coverage[0].inputIds=['unknown-proposal'];const {pkg}=await analyzed(f);const report={checker:'fixture',engine:'fixture',checkedAt:'2026-10-19T00:00:00.000Z',packageDigest:api.packageDigest(pkg),status:'checked',claims:pkg.claims.map(c=>({id:c.id,title:c.title,status:'checked',residual:'0',dimensions:'consistent',domainRestrictions:[],message:'Fixture mathematical finding.'})),limitations:[]};const coverage=api.buildCoverage(pkg,report,f.source);assert.equal(coverage.find(c=>c.id==='given').status,'unsupported');assert(!coverage.some(c=>c.inputIds.includes('unknown-proposal')));
});
test('one structural repair uses the exact error and retains the source',async()=>{
  const f=fixtures();const bad=structuredClone(f.inventory);bad.coverage[0].sourceLineIds=['p99-l999'];const state=transport([bad,f.inventory,f.audit,f.batch]);const pkg=await api.analyzeSource(f.source,Buffer.from('source'),async()=>{});assert.equal(pkg.claims.length,1);assert.equal(state.calls.length,4);assert.match(state.calls[1].payload.structuralRepair.error,/identifier is absent/);
});
test('disjoint namespaced models isolate different definitions',async()=>{
  const {pkg}=await analyzed();const b2=api.namespacePackage({...pkg,analysis:undefined,symbols:fixtures().batch.symbols.map(({definitionJson,definitionDescription,...s})=>s),definitions:[{symbol:'f',expression:{op:'pow',base:S('x'),exponent:3},description:'A different independent model.'}],claims:[{id:'slope',title:'Cubic derivative',lhs:{op:'diff',expr:S('f'),variable:'x'},rhs:{op:'mul',args:[I(3),{op:'pow',base:S('x'),exponent:2}]},explanation:'A separate model uses a cube.'}],consequences:[]},2);
  const joined={...pkg,symbols:[...pkg.symbols,...b2.symbols],definitions:[...pkg.definitions,...b2.definitions],claims:[...pkg.claims,...b2.claims]};const parts=api.isolatedModels(joined);assert.deepEqual(parts.map(p=>p.id),['b1','b2']);assert.deepEqual(parts[0].package.symbols.map(s=>s.name),['b1_x','b1_f']);assert.deepEqual(parts[1].package.definitions.map(d=>d.symbol),['b2_f']);assert.equal(parts[1].package.definitions[0].expression.exponent,3);
});
test('cross-model dependencies retain their full definition closure',async()=>{
  const {pkg}=await analyzed();pkg.symbols.push({name:'b2_y',label:'A required cross-model quantity',domain:'real',dimensions:[0,0,0,0,0,0,0]},{name:'b3_z',label:'A transitive dependency',domain:'real',dimensions:[0,0,0,0,0,0,0]},{name:'b4_unused',label:'Unrelated',domain:'real',dimensions:[0,0,0,0,0,0,0]});pkg.definitions.find(d=>d.symbol==='b1_f').expression=S('b2_y');pkg.definitions.push({symbol:'b2_y',expression:S('b3_z'),description:'A real dependency.'},{symbol:'b3_z',expression:I(1),description:'Transitive input.'},{symbol:'b4_unused',expression:I(9),description:'Unrelated definition.'});const [part]=api.isolatedModels(pkg);assert(part.package.symbols.some(s=>s.name==='b2_y'));assert(part.package.symbols.some(s=>s.name==='b3_z'));assert(!part.package.symbols.some(s=>s.name==='b4_unused'));assert.deepEqual(part.package.definitions.map(d=>d.symbol),['b1_f','b2_y','b3_z']);
});
test('unnamespaced legacy packages remain whole',async()=>{
  const {pkg}=await analyzed();pkg.analysis=undefined;const models=api.isolatedModels(pkg);assert.equal(models.length,1);assert.equal(models[0].id,'whole-package');assert.equal(models[0].package,pkg);
});
test('actual independent SymPy worker checks the automatically assembled candidate',{skip:!process.env.FORMAL_PYTHON},async()=>{
  const {pkg}=await analyzed();const worker=path.join(root,'artifacts/api-server/formal-verifier/check.py');const report=JSON.parse(execFileSync(process.env.FORMAL_PYTHON,['-I',worker],{input:JSON.stringify({package:pkg,packageDigest:'a'.repeat(64)}),encoding:'utf8',timeout:20000}));assert.equal(report.checker,'formal-lab-sympy-v2');assert.equal(report.status,'checked');assert.equal(report.claims[0].derivationKind,'identity');assert.equal(report.claims[0].residual,'0');
});

test('structured author pointers reach inventory, audit, formalization and the saved package without becoming source assertions',async()=>{
 const f=fixtures(),guidance={mainClaims:'  Inspect the derivative claim. ',inputs:'Inspect the adopted model.',construction:'Differentiate with independent x.',outputs:'Compare the slope statement.',novelty:'A guidance-only novelty assertion.',predictions:'A guidance-only prediction.',empiricalClaims:'None are intended.',scope:'Real scalar x.',priorWork:'Check standard calculus.',empiricalStatus:'none'};
 const before=JSON.stringify(f.source),{pkg,state}=await analyzed(f,guidance);assert.equal(state.calls.length,3);
 for(const call of state.calls){const request=call.payload.request,pointers=request.authorGuidance||request.source?.authorGuidance;assert.equal(pointers.mainClaims,'Inspect the derivative claim.');assert.equal(pointers.empiricalStatus,'none');assert.match(call.system,/untrusted requests/);assert.match(call.system,/must never erase an empirical assertion/);}
 assert.deepEqual(pkg.authorGuidance,{...guidance,mainClaims:'Inspect the derivative claim.'});assert.equal(JSON.stringify(f.source),before);assert.ok(!pkg.analysis.coverage.some(item=>item.statement.includes('guidance-only')));assert.equal(pkg.claims.length,1);assert.equal(pkg.approvedAt,undefined);assert.equal(pkg.verification,undefined);
});
test('blank author guidance is absent from every stage and preserves the no-guidance package digest',async()=>{const normal=await analyzed(),blank=await analyzed(fixtures(),{mainClaims:' ',novelty:'',empiricalStatus:'unspecified'});assert.equal(api.packageDigest(blank.pkg),api.packageDigest(normal.pkg));assert.equal(Object.hasOwn(blank.pkg,'authorGuidance'),false);assert.ok(blank.state.calls.every(call=>!call.payload.request.authorGuidance&&!call.payload.request.source?.authorGuidance));});
test('a bounded structural repair retains the same untrusted author pointers and exact source bytes',async()=>{const f=fixtures(),bad=structuredClone(f.inventory);bad.coverage[0].sourceLineIds=['p99-l999'];const state=transport([bad,f.inventory,f.audit,f.batch]),guidance={mainClaims:'Inspect this source claim.',empiricalStatus:'none'};const pkg=await api.analyzeSource(f.source,Buffer.from('fixed source'),async()=>{},guidance);assert.equal(state.calls.length,4);for(const call of state.calls){const request=call.payload.request;assert.equal((request.authorGuidance||request.source?.authorGuidance).mainClaims,guidance.mainClaims);}assert.equal(pkg.source.sha256,f.source.sha256);assert.deepEqual(pkg.authorGuidance,guidance);});
test('source empirical assertions stay visible when an author says there are none',async()=>{const f=fixtures();f.source.lines[3].text='The measured slope agrees with the prediction.';f.audit.additionalCoverage.find(item=>item.id==='unread-line').role='empirical';f.audit.additionalCoverage.find(item=>item.id==='unread-line').statement=f.source.lines[3].text;const {pkg}=await analyzed(f,{empiricalStatus:'none'});assert.equal(pkg.authorGuidance.empiricalStatus,'none');assert.ok(pkg.analysis.coverage.some(item=>item.role==='empirical'&&item.sourceLineIds.includes('p1-l004')));assert.ok(pkg.analysis.extractionWarnings.some(warning=>warning.includes('empirical-status guidance conflicts')));});
test('invalid author guidance is rejected before any model call',async()=>{for(const guidance of [{unknown:'invented'},{mainClaims:'x'.repeat(6001)},{empiricalStatus:'proved'}]){const state=transport([]);await assert.rejects(()=>api.analyzeSource(fixtures().source,Buffer.from('source'),async()=>{},guidance));assert.equal(state.calls.length,0);}});
