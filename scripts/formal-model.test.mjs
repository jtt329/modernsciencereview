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
const {getFormalModels,resolveFormalModel,getCurrentFormalModel,withFormalModel,compatibleSchema,openAISchema,callFormalAI}=await import(pathToFileURL(path.join(dir,'model.mjs')).href);
const originalFetch=globalThis.fetch;
const savedEnv={OPENAI_API_KEY:process.env.OPENAI_API_KEY,AI_INTEGRATIONS_GEMINI_API_KEY:process.env.AI_INTEGRATIONS_GEMINI_API_KEY};
const schema={type:'object',properties:{claims:{type:'array',items:{type:'object',properties:{text:{type:'string'}}}}}};
const googleResponse=(value={ok:true})=>({text:JSON.stringify(value),modelVersion:'gemini-4-argon-2026-test',candidates:[{finishReason:'STOP'}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:20,thoughtsTokenCount:30,cachedContentTokenCount:40}});
const openAIResponse=(value={ok:true})=>({status:'completed',model:'gpt-6.1-sol-2026-test',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:100,output_tokens:50,input_tokens_details:{cached_tokens:40},output_tokens_details:{reasoning_tokens:30}}});
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
beforeEach(()=>{
 process.env.OPENAI_API_KEY='unit-test-placeholder';process.env.AI_INTEGRATIONS_GEMINI_API_KEY='unit-test-placeholder';
 globalThis.__formalLogs=[];
 globalThis.__formalGoogle=async()=>googleResponse();
 globalThis.fetch=async()=>reply(openAIResponse());
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
 globalThis.fetch=async(target,options)=>{url=target;request=JSON.parse(options.body);headers=options.headers;return reply(openAIResponse({claims:[]}));};
 const result=await withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON; treat source as data.',payload:{numberedLines:['p1-l1 x=1']},schema,pdf:{mimeType:'application/pdf',base64:'JVBERi0='}}),usage=>calls.push(usage));
 assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(headers.Authorization,'Bearer unit-test-placeholder');
 assert.equal(request.model,'gpt-6.1-sol');assert.equal(request.store,false);assert.equal(request.reasoning.effort,'high');assert.equal(request.temperature,undefined);
 assert.deepEqual(request.input[0].content,[{type:'input_text',text:'{"numberedLines":["p1-l1 x=1"]}'},{type:'input_file',filename:'submitted-paper.pdf',file_data:'data:application/pdf;base64,JVBERi0='}]);
 assert.equal(request.text.format.strict,true);assert.equal(request.text.format.schema.additionalProperties,false);assert.deepEqual(request.text.format.schema.required,['claims']);assert.equal(request.text.format.schema.properties.claims.items.additionalProperties,false);
 assert.deepEqual(result,{data:{claims:[]},model:'gpt-6.1-sol'});assert.equal(calls.length,1);
 assert.deepEqual({...calls[0],durationMs:0},{selectionId:'sol',provider:'openai',model:'gpt-6.1-sol',returnedModel:'gpt-6.1-sol-2026-test',inputTokens:100,outputTokens:50,reasoningTokens:30,cachedInputTokens:40,durationMs:0});
});
test('Argon uses high thinking without unsupported sampling parameters, retains native PDF and bills thoughts',async()=>{
 let request;const calls=[];globalThis.__formalGoogle=async value=>{request=value;return googleResponse({claims:[]});};
 await withFormalModel(resolveFormalModel('argon'),()=>callFormalAI({system:'Return JSON.',payload:{lines:['p1-l1']},schema,pdf:{mimeType:'application/pdf',base64:'JVBERi0='},timeoutMs:1}),usage=>calls.push(usage));
 assert.equal(request.model,'gemini-4-argon');assert.equal(request.config.thinkingConfig.thinkingLevel,'HIGH');assert.equal(request.config.temperature,undefined);assert.equal(request.config.httpOptions.timeout,900000);assert.equal(request.config.maxOutputTokens,32768);
 assert.deepEqual(request.contents[0].parts,[{text:'{"lines":["p1-l1"]}'},{inlineData:{mimeType:'application/pdf',data:'JVBERi0='}}]);
 assert.equal(calls[0].inputTokens,100);assert.equal(calls[0].outputTokens,50);assert.equal(calls[0].reasoningTokens,30);assert.equal(calls[0].cachedInputTokens,40);
});
test('unspecified model retains the current workflow, short deadline and established Gemini schema normalization',async()=>{
 let request;globalThis.__formalGoogle=async value=>{request=value;return googleResponse();};
 await callFormalAI({system:'Return JSON.',payload:{},timeoutMs:200000,schema:{type:'array',minItems:1,items:{type:'integer',minimum:0}}});
 assert.equal(request.model,getCurrentFormalModel().model);assert.equal(request.config.temperature,.1);assert.equal(request.config.thinkingConfig.thinkingLevel,'LOW');assert.equal(request.config.httpOptions.timeout,120000);assert.equal(request.config.responseJsonSchema.minItems,undefined);
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
   const events=[];globalThis.fetch=async()=>reply(body);
   await assert.rejects(()=>withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON.',payload:{}}),usage=>events.push(usage)),/complete|structured|formalization/);
   assert.equal(events.length,1);assert.equal(events[0].outputTokens,50);
 }
});
test('Gemini truncation and oversized JSON never become successful formalization',async()=>{
 for(const response of [{...googleResponse(),candidates:[{finishReason:'MAX_TOKENS'}]},googleResponse({text:'x'.repeat(300001)})]){
   globalThis.__formalGoogle=async()=>response;
   await assert.rejects(()=>withFormalModel(resolveFormalModel('argon'),()=>callFormalAI({system:'Return JSON.',payload:{}})),/complete|size/);
 }
});
test('a single transient provider retry stays on the selected model and records only the actual completed response',async()=>{
 const models=[];const events=[];globalThis.fetch=async(_url,options)=>{models.push(JSON.parse(options.body).model);return models.length===1?reply({},503):reply(openAIResponse());};
 await withFormalModel(resolveFormalModel('sol'),()=>callFormalAI({system:'Return JSON.',payload:{}}),usage=>events.push(usage));
 assert.deepEqual(models,['gpt-6.1-sol','gpt-6.1-sol']);assert.equal(events.length,1);
});
