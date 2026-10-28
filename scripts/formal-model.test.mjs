import {test,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(path.join(root,'artifacts/api-server/package.json'));
const {build}=require('esbuild');
const dir=await mkdtemp(path.join(tmpdir(),'formal-model-'));after(()=>rm(dir,{recursive:true,force:true}));
await build({entryPoints:[path.join(root,'artifacts/api-server/src/formal/model.ts')],outfile:path.join(dir,'model.mjs'),platform:'node',bundle:true,format:'esm',logLevel:'silent',plugins:[{name:'provider-boundaries',setup(b){
 b.onResolve({filter:/^@workspace\/integrations-gemini-ai$/},()=>({path:'gemini',namespace:'stub'}));
 b.onResolve({filter:/\/lib\/logger$/},()=>({path:'logger',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='gemini'?"export const ai={models:{generateContent(request){return globalThis.__formalGoogle(request)}}};":"export const logger={warn(...args){globalThis.__formalLogs.push(args)}};"}));
}}]});
const {getFormalModels,resolveFormalModel,getCurrentFormalModel,withFormalModel,compatibleSchema,openAISchema,callFormalAI,readOpenAIResponse}=await import(pathToFileURL(path.join(dir,'model.mjs')).href);
const originalFetch=globalThis.fetch;
const savedEnv={OPENAI_API_KEY:process.env.OPENAI_API_KEY,AI_INTEGRATIONS_GEMINI_API_KEY:process.env.AI_INTEGRATIONS_GEMINI_API_KEY};
const schema={type:'object',properties:{claims:{type:'array',items:{type:'object',properties:{text:{type:'string'}}}}}};
const googleResponse=(value={ok:true})=>({text:JSON.stringify(value),modelVersion:'gemini-4-argon-2026-test',candidates:[{finishReason:'STOP'}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:20,thoughtsTokenCount:30,cachedContentTokenCount:40}});
const openAIResponse=(value={ok:true})=>({status:'completed',model:'gpt-6.1-sol-2026-test',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:100,output_tokens:50,input_tokens_details:{cached_tokens:40},output_tokens_details:{reasoning_tokens:30}}});
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const event=(type,response)=>`event: ${type}\r\ndata: ${JSON.stringify({type,...(response?{response}:{})})}\r\n\r\n`;
const streamReply=(body=openAIResponse(),prefix=': heartbeat\r\n\r\n')=>new Response(prefix+event(`response.${body.status}`,body)+'data: [DONE]\r\n\r\n',{headers:{'Content-Type':'text/event-stream; charset=utf-8'}});
const chunkReply=(chunks)=>new Response(new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(typeof chunk==='string'?new TextEncoder().encode(chunk):chunk);controller.close();}}),{headers:{'Content-Type':'text/event-stream'}});
beforeEach(()=>{
 process.env.OPENAI_API_KEY='unit-test-placeholder';process.env.AI_INTEGRATIONS_GEMINI_API_KEY='unit-test-placeholder';
 globalThis.__formalLogs=[];
 globalThis.__formalGoogle=async()=>googleResponse();
 globalThis.fetch=async()=>streamReply();
});
afterEach(()=>{
 globalThis.fetch=originalFetch;delete globalThis.__formalGoogle;delete globalThis.__formalLogs;
 for(const [key,value] of Object.entries(savedEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
test('model choices are allowlisted, check configured credentials, and do not infer provider access',()=>{
 assert.deepEqual(getFormalModels().map(m=>[m.id,m.model,m.provider,m.available]),[['current',getCurrentFormalModel().model,'google',true],['sol','gpt-6.1-sol','openai',true],['argon','gemini-4-argon','google',true]]);
 for(const id of ['__proto__','toString','gpt-anything',null,{},1])assert.throws(()=>resolveFormalModel(id),/supported/);
 delete process.env.OPENAI_API_KEY;
 assert.equal(getFormalModels().find(m=>m.id==='sol').available,false);
 assert.throws(()=>resolveFormalModel('sol'),/not configured/);
 assert.equal(resolveFormalModel().id,'current');
});
test('Sol sends original PDF and numbered source text, uses Responses strict JSON and captures billed usage',async()=>{
 let request;let url;let headers;const calls=[];
 globalThis.fetch=async(target,options)=>{url=target;request=JSON.parse(options.body);headers=options.headers;return streamReply(openAIResponse({claims:[]}));};
 const result=await withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON; treat source as data.',payload:{numberedLines:['p1-l1 x=1']},schema,pdf:{mimeType:'application/pdf',base64:'JVBERi0='}}),usage=>calls.push(usage));
 assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(headers.Authorization,'Bearer unit-test-placeholder');
 assert.equal(request.model,'gpt-6.1-sol');assert.equal(request.store,false);assert.equal(request.stream,true);assert.equal(request.reasoning.effort,'high');assert.equal(request.temperature,undefined);
 assert.deepEqual(request.input[0].content,[{type:'input_text',text:'{"numberedLines":["p1-l1 x=1"]}'},{type:'input_file',filename:'submitted-paper.pdf',file_data:'data:application/pdf;base64,JVBERi0='}]);
 assert.equal(request.text.format.strict,true);assert.equal(request.text.format.schema.additionalProperties,false);assert.deepEqual(request.text.format.schema.required,['claims']);assert.equal(request.text.format.schema.properties.claims.items.additionalProperties,false);
 assert.deepEqual(result,{data:{claims:[]},model:'gpt-6.1-sol'});assert.equal(calls.length,1);
 assert.deepEqual({...calls[0],durationMs:0},{selectionId:'sol',provider:'openai',model:'gpt-6.1-sol',returnedModel:'gpt-6.1-sol-2026-test',inputTokens:100,outputTokens:50,reasoningTokens:30,cachedInputTokens:40,durationMs:0});
});
test('Argon uses high thinking without unsupported sampling parameters, retains native PDF and bills thoughts',async()=>{
 let request;const calls=[];globalThis.__formalGoogle=async value=>{request=value;return googleResponse({claims:[]});};
 await withFormalModel(resolveFormalModel('argon'),()=>callFormalAI({system:'Return JSON.',payload:{lines:['p1-l1']},schema,pdf:{mimeType:'application/pdf',base64:'JVBERi0='},timeoutMs:1}),usage=>calls.push(usage));
 assert.equal(request.model,'gemini-4-argon');assert.equal(request.config.thinkingConfig.thinkingLevel,'HIGH');assert.equal(request.config.temperature,undefined);assert.ok(request.config.httpOptions.timeout<=900000&&request.config.httpOptions.timeout>=899000);assert.equal(request.config.maxOutputTokens,32768);
 assert.deepEqual(request.contents[0].parts,[{text:'{"lines":["p1-l1"]}'},{inlineData:{mimeType:'application/pdf',data:'JVBERi0='}}]);
 assert.equal(calls[0].inputTokens,100);assert.equal(calls[0].outputTokens,50);assert.equal(calls[0].reasoningTokens,30);assert.equal(calls[0].cachedInputTokens,40);
});
test('unspecified model retains the current workflow, short deadline and established Gemini schema normalization',async()=>{
 let request;globalThis.__formalGoogle=async value=>{request=value;return googleResponse();};
 await callFormalAI({system:'Return JSON.',payload:{},timeoutMs:200000,schema:{type:'array',minItems:1,items:{type:'integer',minimum:0}}});
 assert.equal(request.model,getCurrentFormalModel().model);assert.equal(request.config.temperature,.1);assert.equal(request.config.thinkingConfig.thinkingLevel,'LOW');assert.ok(request.config.httpOptions.timeout<=120000&&request.config.httpOptions.timeout>=119000);assert.equal(request.config.responseJsonSchema.minItems,undefined);
 assert.deepEqual(compatibleSchema({minimum:0,minItems:1,type:'array'}),{type:'array'});
});
test('strict normalization closes nested objects, definitions, anyOf, and property names without mutating the source schema',()=>{
 const source={type:'object',properties:{properties:{type:'object',properties:{label:{type:'string'}}},entry:{anyOf:[{type:'object',properties:{text:{type:'string'}}},{type:'null'}]},nodes:{type:'array',items:{$ref:'#/$defs/node'}}},$defs:{node:{type:'object',properties:{value:{type:'string'}}}}};
 const before=structuredClone(source);const result=openAISchema(source);assert.deepEqual(source,before);
 assert.equal(result.properties.properties.additionalProperties,false);assert.deepEqual(result.properties.properties.required,['label']);
 assert.equal(result.properties.entry.anyOf[0].additionalProperties,false);assert.deepEqual(result.properties.entry.anyOf[1],{type:'null'});assert.equal(result.$defs.node.additionalProperties,false);
 assert.throws(()=>openAISchema({type:'object',additionalProperties:{type:'string'}}),/open-ended/);
});
test('independent concurrent jobs retain their model selection and usage handler across asynchronous stages',async()=>{
 const events={sol:[],argon:[]};
 const run=id=>withFormalModel(resolveFormalModel(id),async()=>{
   assert.equal(getCurrentFormalModel().id,id);await new Promise(resolve=>setTimeout(resolve,id==='sol'?5:1));
   const first=await callFormalAI({system:'Return JSON.',payload:{}});await Promise.resolve();assert.equal(getCurrentFormalModel().id,id);
   return first.model;
 },usage=>events[id].push(usage));
 const result=await Promise.all([run('sol'),run('argon')]);assert.deepEqual(result,['gpt-6.1-sol','gemini-4-argon']);
 assert.deepEqual(events.sol.map(e=>e.selectionId),['sol']);assert.deepEqual(events.argon.map(e=>e.selectionId),['argon']);assert.equal(getCurrentFormalModel().id,'current');
});
test('a selected config cannot replace an allowlisted model or provider, even when supplied as an object',async()=>{
 await withFormalModel({id:'sol',model:'not-allowed',provider:'google',label:'spoof'},async()=>assert.equal(getCurrentFormalModel().model,'gpt-6.1-sol'));
});
test('provider rejection exposes no raw error body and never silently switches models',async()=>{
 let count=0;globalThis.fetch=async()=>{count++;return reply({error:{message:'unit-test-private-body'}},403);};
 await assert.rejects(()=>withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON.',payload:{}})),error=>/OpenAI credential or model access was rejected/.test(error.message)&&!error.message.includes('unit-test-private-body'));
 assert.equal(count,1);assert.ok(!JSON.stringify(globalThis.__formalLogs).includes('unit-test-private-body'));
});
test('incomplete, refused and malformed OpenAI outputs fail closed while keeping actual token usage',async()=>{
 for(const body of [{...openAIResponse(),status:'incomplete'}, {...openAIResponse(),output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'No'}]}]}, {...openAIResponse(),output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'{"truncated"'}]}]}]){
   const events=[];globalThis.fetch=async()=>streamReply(body);
   await assert.rejects(()=>withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON.',payload:{}}),usage=>events.push(usage)),/complete|structured|formalization/);
   assert.equal(events.length,1);assert.equal(events[0].outputTokens,50);
 }
});
test('only trusted source-analysis profiles use the bounded larger Sol output allowance',async()=>{
 const requests=[];globalThis.fetch=async(_url,options)=>{requests.push(JSON.parse(options.body));return streamReply();};
 for(const outputBudget of [undefined,'source-inventory','source-coverage-audit'])await withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON.',payload:{},...(outputBudget?{outputBudget}:{})}));
 assert.deepEqual(requests.map(request=>request.max_output_tokens),[32768,65536,65536]);
 assert.ok(requests.every(request=>request.reasoning.effort==='high'&&request.store===false&&request.stream===true));
 await assert.rejects(()=>withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON.',payload:{},outputBudget:'unbounded'})),/Unsupported internal/);assert.equal(requests.length,3);
 let google;globalThis.__formalGoogle=async request=>{google=request;return googleResponse();};await withFormalModel(resolveFormalModel('argon'),()=>callFormalAI({system:'Return JSON.',payload:{},outputBudget:'source-inventory'}));assert.equal(google.config.maxOutputTokens,32768);
});
test('a provider-confirmed output-token stop has a safe distinct cause and is never automatically duplicated',async()=>{
 for(const reason of ['max_output_tokens','content_filter',undefined]){
   let requests=0;const calls=[];globalThis.fetch=async()=>{requests++;return streamReply({...openAIResponse(),status:'incomplete',incomplete_details:{reason,private_body:'must-not-escape'}});};
   await assert.rejects(()=>withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON.',payload:{}}),usage=>calls.push(usage)),error=>{assert.equal(error.code,reason==='max_output_tokens'?'FORMAL_MODEL_OUTPUT_LIMIT':undefined);assert.ok(!error.message.includes('must-not-escape'));return /did not complete/.test(error.message);});
   assert.equal(requests,1);assert.equal(calls.length,1);assert.equal(calls[0].outputTokens,50);assert.ok(!JSON.stringify(globalThis.__formalLogs).includes('must-not-escape'));
 }
});
test('Gemini truncation and oversized JSON never become successful formalization',async()=>{
 for(const response of [{...googleResponse(),candidates:[{finishReason:'MAX_TOKENS'}]},googleResponse({text:'x'.repeat(300001)})]){
   globalThis.__formalGoogle=async()=>response;
   await assert.rejects(()=>withFormalModel(resolveFormalModel('argon'),()=>callFormalAI({system:'Return JSON.',payload:{}})),/complete|size/);
 }
});
test('a single transient provider retry stays on the selected model and records only the actual completed response',async()=>{
 const models=[];const events=[];globalThis.fetch=async(_url,options)=>{models.push(JSON.parse(options.body).model);return models.length===1?reply({},503):streamReply();};
 await withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON.',payload:{}}),usage=>events.push(usage));
 assert.deepEqual(models,['gpt-6.1-sol','gpt-6.1-sol']);assert.equal(events.length,1);
});

test('Sol uses a fifteen-minute bounded stream while keeping high reasoning',async()=>{
 const originalTimeout=AbortSignal.timeout;const timeouts=[];
 AbortSignal.timeout=ms=>{timeouts.push(ms);return originalTimeout.call(AbortSignal,ms);};
 try{await withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON.',payload:{},timeoutMs:120000}));}
 finally{AbortSignal.timeout=originalTimeout;}
 assert.equal(timeouts.length,1);assert.ok(timeouts[0]<=900000&&timeouts[0]>=899000);
});
test('stream parser handles CRLF, split UTF-8, multiline data, comments, deltas and terminal usage',async()=>{
 const body=openAIResponse({explanation:'δQ = T dS 🌌'});
 const terminal=JSON.stringify({type:'response.completed',response:body});
 const boundary=terminal.indexOf(',"response"');
 const encoded=new TextEncoder().encode(': heartbeat\r\n\r\n'+event('response.created',{status:'in_progress'})+'event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"{partial must not be used}"}\r\n\r\nevent: response.completed\r\ndata: '+terminal.slice(0,boundary+1)+'\r\ndata: '+terminal.slice(boundary+1)+'\r\n\r\ndata: [DONE]\r\n\r\n');
 const chunks=[];for(let position=0;position<encoded.length;position+=7)chunks.push(encoded.slice(position,position+7));
 assert.deepEqual(await readOpenAIResponse(chunkReply(chunks)),body);
});
test('only a complete terminal event can succeed; deltas, DONE, truncated or malformed streams fail closed',async()=>{
 const invalid=[
   event('response.output_text.delta',undefined)+'data: [DONE]\n\n',
   'event: response.completed\ndata: {broken}\n\n',
   'data: '+JSON.stringify({type:'response.completed',response:openAIResponse()})+'\n',
   event('response.completed',{...openAIResponse(),status:'in_progress'}),
   'event: response.failed\ndata: '+JSON.stringify({type:'response.completed',response:openAIResponse()})+'\n\n',
 ];
 for(const value of invalid)await assert.rejects(()=>readOpenAIResponse(chunkReply([value])),/stream ended/);
});
test('stream and JSON transport limits bound retained provider data',async()=>{
 for(const response of [chunkReply(['data: '+ 'x'.repeat(1024*1024)+'\n\n']),chunkReply(['x'.repeat(2*1024*1024+1)]),reply({text:'x'.repeat(2*1024*1024)})]){
   await assert.rejects(()=>readOpenAIResponse(response),/stream ended/);
 }
});
test('many deltas are discarded and do not count against the retained final-response buffer',async()=>{
 const delta='data: '+JSON.stringify({type:'response.output_text.delta',delta:'x'.repeat(8000)})+'\n\n';
 const chunks=Array.from({length:400},()=>delta);chunks.push(event('response.completed',openAIResponse({claims:[]})));
 assert.deepEqual(await readOpenAIResponse(chunkReply(chunks)),openAIResponse({claims:[]}));
});
test('stream failure and incomplete terminal events never accept valid-looking partial JSON',async()=>{
 let count=0;const calls=[];
 for(const final of [{...openAIResponse({claims:[]}),status:'incomplete'},{...openAIResponse({claims:[]}),status:'failed'}]){
   globalThis.fetch=async()=>{count++;return streamReply(final,'data: '+JSON.stringify({type:'response.output_text.delta',delta:'{"claims":[]}'})+'\n\n');};
   await assert.rejects(()=>withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON.',payload:{}}),usage=>calls.push(usage)),/did not complete/);
 }
 assert.equal(count,2);assert.equal(calls.length,2);assert.ok(calls.every(call=>call.outputTokens===50));
 globalThis.fetch=async()=>chunkReply(['data: '+JSON.stringify({type:'error',message:'private-provider-message',code:'server_error'})+'\n\n']);
 await assert.rejects(()=>withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON.',payload:{}})),error=>!error.message.includes('private-provider-message'));
 assert.ok(!JSON.stringify(globalThis.__formalLogs).includes('private-provider-message'));
});
test('deadline, abort and nested Undici timeouts are distinct, safe and never automatically retried',async()=>{
 const errors=[new DOMException('private timeout data','TimeoutError'),new DOMException('private abort data','AbortError'),Object.assign(new TypeError('fetch failed private data'),{cause:Object.assign(new Error('private headers timeout'),{code:'UND_ERR_HEADERS_TIMEOUT'})}),Object.assign(new TypeError('terminated'),{cause:Object.assign(new Error('private body timeout'),{code:'UND_ERR_BODY_TIMEOUT'})})];
 for(const failure of errors){
   let count=0;globalThis.fetch=async()=>{count++;throw failure;};
   await assert.rejects(()=>withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON.',payload:{}})),error=>error.statusCode===504&&/timed out/.test(error.message)&&/uploaded source and previously saved revisions/.test(error.message)&&!error.message.includes('private'));
   assert.equal(count,1);
 }
 assert.ok(!JSON.stringify(globalThis.__formalLogs).includes('private'));
});
test('timeout after stream headers retains no partial result and makes no duplicate paid request',async()=>{
 let count=0;
 globalThis.fetch=async()=>{count++;return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: {"type":"response.created"}\n\n'));controller.error(new DOMException('private source text','TimeoutError'));}}),{headers:{'Content-Type':'text/event-stream'}});};
 await assert.rejects(()=>withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON.',payload:{}})),error=>error.statusCode===504);
 assert.equal(count,1);
});
test('provider errors retain only allowlisted diagnostic metadata and never raw provider bodies',async()=>{
 globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:'invalid_json_schema',param:'text.format.schema',message:'private paper contents'}}),{status:400,headers:{'Content-Type':'application/json','x-request-id':'req_unit-test'}});
 await assert.rejects(()=>withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON.',payload:{}})));
 assert.ok(globalThis.__formalLogs.some(([fields])=>fields.providerCode==='invalid_json_schema'&&fields.providerParam==='text.format.schema'&&fields.requestId==='req_unit-test'));
 assert.ok(!JSON.stringify(globalThis.__formalLogs).includes('private paper contents'));
 globalThis.__formalLogs=[];
 globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:'private-secret-code',param:'private-secret-param',message:'private paper contents'}}),{status:400,headers:{'Content-Type':'application/json','x-request-id':'private-request'}});
 await assert.rejects(()=>withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON.',payload:{}})));
 assert.ok(!JSON.stringify(globalThis.__formalLogs).includes('private'));
});

test('one transient retry shares the original stage deadline instead of extending it',async()=>{
 const originalNow=Date.now;const originalTimeout=AbortSignal.timeout;const timeouts=[];let clock=1000;let calls=0;
 Date.now=()=>clock;AbortSignal.timeout=ms=>{timeouts.push(ms);return originalTimeout.call(AbortSignal,ms);};
 globalThis.fetch=async()=>{calls++;if(calls===1){clock+=600000;return reply({},503);}return streamReply();};
 try{await withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON.',payload:{}}));}
 finally{Date.now=originalNow;AbortSignal.timeout=originalTimeout;}
 assert.equal(calls,2);assert.deepEqual(timeouts,[900000,300000]);
});

test('malformed JSON fallback responses fail without an automatic duplicate request',async()=>{
 for(const body of [null,[],{status:'in_progress'},{output:[]}]){
   let count=0;globalThis.fetch=async()=>{count++;return reply(body);};
   await assert.rejects(()=>withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON.',payload:{}})),/stream ended/);
   assert.equal(count,1);
 }
});
