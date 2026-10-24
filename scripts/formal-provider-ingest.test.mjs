import assert from 'node:assert/strict';
import {after,afterEach,before,beforeEach,test} from 'node:test';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Offline integration tests: production extraction, ingestion and model adapter
// run together. Only the external HTTP/Google/database boundaries are replaced.
// Fixture AI replies are not evidence that the sample paper has been verified.
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(path.join(root,'artifacts/api-server/package.json'));
const {build}=require('esbuild');
const originalFetch=globalThis.fetch;
const originalKey=process.env.OPENAI_API_KEY;
let dir,api,sampleBytes,sampleSource,calls;

before(async()=>{
  dir=await mkdtemp(path.join(tmpdir(),'formal-provider-ingest-'));
  await build({stdin:{contents:`export * from './ingest.ts';export {extractSource} from './sources.ts';export {resolveFormalModel,withFormalModel,openAISchema} from './model.ts';`,resolveDir:path.join(root,'artifacts/api-server/src/formal'),loader:'ts'},outfile:path.join(dir,'bridge.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'offline-boundaries',setup(b){
    b.onResolve({filter:/^@workspace\/db$/},()=>({path:'db',namespace:'offline'}));
    b.onResolve({filter:/^@workspace\/integrations-gemini-ai$/},()=>({path:'google',namespace:'offline'}));
    b.onResolve({filter:/\/lib\/logger$/},()=>({path:'logger',namespace:'offline'}));
    b.onLoad({filter:/.*/,namespace:'offline'},args=>({contents:args.path==='db'?"export const pool={query(){throw new Error('Database access forbidden in offline provider-ingest tests')}};":args.path==='google'?"export const ai={models:{generateContent(){throw new Error('Unexpected Google call in a Sol test')}}};":"export const logger={warn(){}};"}));
  }}]});
  await build({entryPoints:[path.join(root,'artifacts/api-server/formal-source-worker.cjs')],outfile:path.join(dir,'formal-source-worker.cjs'),bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  api=await import(pathToFileURL(path.join(dir,'bridge.mjs')).href);
  sampleBytes=await readFile(path.join(root,'artifacts/scireview/public/formal-lab/horizon-boundary-summary-current.pdf'));
  sampleSource=await api.extractSource('horizon-pressure-one-page.pdf','application/pdf',sampleBytes);
});
after(async()=>{if(dir)await rm(dir,{recursive:true,force:true});});
beforeEach(()=>{process.env.OPENAI_API_KEY='offline-test-placeholder';calls=[];});
afterEach(()=>{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;});

const encoder=new TextEncoder();
const event=(type,value)=>`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`;
function completed(value){return {id:'resp_offline_fixture',status:'completed',model:'gpt-6.1-sol-offline-fixture',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:1000,output_tokens:2000,output_tokens_details:{reasoning_tokens:500}}};}
function streamed(value){
  const text=JSON.stringify(value);
  const data=encoder.encode(event('response.created',{response:{id:'resp_offline_fixture',status:'in_progress'}})+event('response.output_text.delta',{delta:text})+event('response.completed',{response:completed(value)}));
  // Split UTF-8 and SSE framing across network chunks, as a real response can.
  return new Response(new ReadableStream({start(controller){for(let i=0;i<data.length;i+=137)controller.enqueue(data.slice(i,i+137));controller.close();}}),{headers:{'Content-Type':'text/event-stream'}});
}
function queueReplies(replies){
  globalThis.fetch=async(url,options)=>{
    const request=JSON.parse(options.body);calls.push({url,request});
    assert.equal(url,'https://api.openai.com/v1/responses');
    assert.equal(request.model,'gpt-6.1-sol');assert.equal(request.stream,true);assert.equal(request.store,false);
    assert.equal(request.text.format.strict,true);
    assert.ok(replies.length,'unexpected extra model call');
    return streamed(replies.shift());
  };
}
function assertClosed(schema){
  if(!schema||typeof schema!=='object')return;
  if(schema.type==='object'||schema.properties){assert.equal(schema.additionalProperties,false);assert.deepEqual(schema.required,Object.keys(schema.properties));}
  for(const value of Object.values(schema))if(value&&typeof value==='object'){if(Array.isArray(value))value.forEach(assertClosed);else assertClosed(value);}
}
function requestSource(request){const data=JSON.parse(request.input[0].content.find(part=>part.type==='input_text').text).request;return data.source||data;}
function assertOriginalSource(request,source,bytes){
  const payload=requestSource(request);assert.equal(payload.sha256,source.sha256);assert.deepEqual(payload.numberedLines,source.lines);
  const file=request.input[0].content.find(part=>part.type==='input_file');
  if(bytes){assert.ok(file);const raw=Buffer.from(file.file_data.split(',')[1],'base64');assert.deepEqual(raw,bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),source.sha256);}else assert.equal(file,undefined);
}

// This fixture deliberately proposes no interpretation or check of the real
// paper: it exercises the full request size and references without faking a pass.
test('actual 82-line PDF crosses production inventory and audit requests without truncation or a fabricated candidate',async()=>{
  assert.equal(sampleSource.pageCount,1);assert.equal(sampleSource.lines.length,82);
  assert.equal(sampleSource.sha256,'0dab6492b6814c887b8d40b675b33693145c80be91a11300c1188ade83193dc9');
  const inventory={title:'Offline request-size fixture',authors:'',mainClaim:'This fixture does not analyze or verify the manuscript.',subjectSlug:'offline-fixture',subjectTitle:'Offline transport fixture',inputs:[],coverage:sampleSource.lines.map((line,index)=>({id:`line-${index+1}`,statement:line.text,role:'unassessed',sourceLineIds:[line.id],inputIds:[],reason:'Transport fixture only; this source line remains unassessed.'})),groups:[],warnings:['No scientific interpretation is supplied by this offline fixture.']};
  queueReplies([inventory,{additionalCoverage:[],additionalInputs:[],corrections:[],groups:[],warnings:[]}]);
  const events=[];const usage=[];const before=structuredClone(sampleSource);
  await assert.rejects(()=>api.withFormalModel(api.resolveFormalModel('sol'),()=>api.analyzeSource(sampleSource,sampleBytes,async(stage,message)=>events.push({stage,message})),call=>usage.push(call)),/no faithful bounded scalar candidate/);
  assert.equal(calls.length,2);assert.equal(usage.length,2);
  for(const {request} of calls){assertOriginalSource(request,sampleSource,sampleBytes);assertClosed(request.text.format.schema);}
  assert.deepEqual(calls.map(({request})=>request.text.format.schema),[api.openAISchema(api.inventorySchema),api.openAISchema(api.auditSchema)]);
  assert.deepEqual(sampleSource,before);assert.ok(events.some(item=>/Inventoried 82 source assertions/.test(item.message)));
  assert.ok(!events.some(item=>['analysis-ready','verification','approved'].includes(item.stage)));
});

function syntheticReplies(source){
  const [title,model,derivative]=source.lines.map(line=>line.id);
  const group={id:'derivatives',title:'Synthetic derivative model',coverageIds:['derivative'],sourceLineIds:[model,derivative],focus:'Check the synthetic scalar model only.'};
  const inventory={title:'Synthetic adapter fixture',authors:'Test fixture',mainClaim:'The synthetic model has derivative 2x.',subjectSlug:'synthetic-scalars',subjectTitle:'Synthetic scalar fixtures',inputs:[{id:'model',title:'Synthetic chosen model',statement:'Assume f=x^2 for real dimensionless x.',sourceUrl:'',sourceLineIds:[model],basis:'stated',justification:'An explicit premise in the synthetic text.'}],coverage:[{id:'title',statement:'Synthetic adapter fixture',role:'metadata',sourceLineIds:[title],inputIds:[],reason:'Fixture title.'},{id:'given',statement:'f=x^2.',role:'physical-input',sourceLineIds:[model],inputIds:['model'],reason:'An adopted synthetic premise.'},{id:'derivative',statement:'df/dx=2x.',role:'mathematical',sourceLineIds:[derivative],inputIds:['model'],reason:'A proposed synthetic consequence.'}],groups:[group],warnings:[]};
  const S=name=>({op:'symbol',name});
  return [inventory,{additionalCoverage:[],additionalInputs:[],corrections:[],groups:[group],warnings:[]},{assumptions:['The synthetic source adopts f=x^2.'],symbols:[{name:'x',label:'Synthetic independent coordinate',domain:'real',dimensions:[0,0,0,0,0,0,0],definitionJson:'',definitionDescription:''},{name:'f',label:'Synthetic model',domain:'real',dimensions:[0,0,0,0,0,0,0],definitionJson:JSON.stringify({op:'pow',base:S('x'),exponent:2}),definitionDescription:'An adopted synthetic model.'}],claims:[{id:'derivative',title:'Synthetic derivative candidate',lhsJson:JSON.stringify({op:'diff',expr:S('f'),variable:'x'}),rhsJson:JSON.stringify({op:'mul',args:[{op:'integer',value:2},S('x')]}),explanation:'A candidate for later independent checking, not a recorded verification.',coverageIds:['derivative'],sourceLineIds:[model,derivative]}],consequences:[],limitations:['Offline fixture only; no physical applicability established.'],unformalized:[]}];
}

test('real ingestion and SSE adapter use each complete production schema and return only an unapproved synthetic proposal',async()=>{
  const bytes=Buffer.from('Synthetic adapter fixture\nAssume f=x^2 for real dimensionless x.\nThen df/dx=2x.');
  const source=await api.extractSource('synthetic-adapter.txt','text/plain',bytes);
  queueReplies(syntheticReplies(source));const events=[];const usage=[];
  const pkg=await api.withFormalModel(api.resolveFormalModel('sol'),()=>api.analyzeSource(source,bytes,async(stage,message)=>events.push({stage,message})),call=>usage.push(call));
  assert.equal(calls.length,3);assert.equal(usage.length,3);assert.ok(usage.every(call=>call.model==='gpt-6.1-sol'));
  assert.deepEqual(calls.map(({request})=>request.text.format.schema),[api.openAISchema(api.inventorySchema),api.openAISchema(api.auditSchema),api.openAISchema(api.batchSchema)]);
  for(const {request} of calls){assertClosed(request.text.format.schema);assertOriginalSource(request,source);}
  assert.equal(pkg.claims.length,1);assert.equal(pkg.claims[0].id,'b1-derivative');
  assert.deepEqual(new Set(pkg.analysis.coverage.flatMap(item=>item.sourceLineIds)),new Set(source.lines.map(line=>line.id)));
  assert.equal(pkg.approvedAt,undefined);assert.equal(pkg.verification,undefined);assert.equal(pkg.outputs,undefined);
  assert.ok(events.some(item=>item.stage==='analysis-ready'));assert.ok(!events.some(item=>['verification','approved'].includes(item.stage)));
});

test('an early timed-out provider stream preserves the actual source and never advances to a proposal or approval',async()=>{
  const before=structuredClone(sampleSource);const events=[];let count=0;
  globalThis.fetch=async(url,options)=>{
    count++;const request=JSON.parse(options.body);assert.equal(request.stream,true);assertOriginalSource(request,sampleSource,sampleBytes);
    let pulls=0;return new Response(new ReadableStream({pull(controller){if(pulls++===0)controller.enqueue(encoder.encode(event('response.created',{response:{id:'resp_timeout_fixture',status:'in_progress'}})));else controller.error(new DOMException('Offline timeout fixture','TimeoutError'));}}),{headers:{'Content-Type':'text/event-stream'}});
  };
  await assert.rejects(()=>api.withFormalModel(api.resolveFormalModel('sol'),()=>api.analyzeSource(sampleSource,sampleBytes,async(stage,message)=>events.push({stage,message}))),/OpenAI|timeout|time limit/i);
  assert.equal(count,1,'a partial paid generation must not be blindly restarted');assert.deepEqual(sampleSource,before);
  assert.deepEqual(events.map(item=>item.stage),['inventory']);
});
