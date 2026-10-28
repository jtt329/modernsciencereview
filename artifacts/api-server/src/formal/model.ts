import { AsyncLocalStorage } from 'node:async_hooks';
import { ai } from '@workspace/integrations-gemini-ai';
import { FormalError } from './package';
import { logger } from '../lib/logger';

export const formalModel = process.env.FORMAL_LAB_MODEL || process.env.SCIREVIEW_GEMINI_REVIEW_MODEL || 'gemini-3.5-flash';
export type FormalModelId = 'current' | 'sol' | 'argon';
export interface FormalModelConfig { id:FormalModelId; label:string; model:string; provider:'google'|'openai'; }
export interface FormalModelCallUsage {
  selectionId:FormalModelId; provider:'google'|'openai'; model:string; returnedModel:string;
  inputTokens?:number; outputTokens?:number; reasoningTokens?:number; cachedInputTokens?:number; durationMs:number;
}
type UsageHandler = (usage:FormalModelCallUsage)=>void|Promise<void>;
const modelContext = new AsyncLocalStorage<{config:FormalModelConfig;onCall?:UsageHandler}>();
const modelConfigs:Readonly<Record<FormalModelId,Readonly<FormalModelConfig>>> = Object.freeze({
  current:Object.freeze({id:'current',label:'Current Gemini workflow',model:formalModel,provider:'google'}),
  sol:Object.freeze({id:'sol',label:'GPT-6.1 Sol',model:'gpt-6.1-sol',provider:'openai'}),
  argon:Object.freeze({id:'argon',label:'Gemini 4 Argon',model:'gemini-4-argon',provider:'google'}),
});
const hasKey = (value:string|undefined)=>Boolean(value?.trim());
export function getFormalModels():Array<FormalModelConfig & {available:boolean;reason?:string}> {
  return Object.values(modelConfigs).map(config=>{
    const available=hasKey(config.provider==='openai'?process.env.OPENAI_API_KEY:process.env.AI_INTEGRATIONS_GEMINI_API_KEY);
    return {...config,available,...(!available?{reason:`The ${config.provider==='openai'?'OpenAI':'Gemini'} API credential is not configured on this service.`}:{})};
  });
}
export function resolveFormalModel(id:unknown='current'):FormalModelConfig {
  const selected=id===undefined?'current':id;
  if(typeof selected!=='string'||!Object.hasOwn(modelConfigs,selected))throw new FormalError('Choose a supported Formal Lab model: current, sol, or argon.');
  const config=modelConfigs[selected as FormalModelId];
  const choice=getFormalModels().find(item=>item.id===config.id)!;
  if(!choice.available)throw new FormalError(choice.reason!,503);
  return {...config};
}
export function getCurrentFormalModel():FormalModelConfig { return {...(modelContext.getStore()?.config||modelConfigs.current)}; }
export function withFormalModel<T>(config:FormalModelConfig,fn:()=>T,onCall?:UsageHandler):T {
  // Re-resolve the ID: a submitted object can never supply an arbitrary model or provider URL.
  return modelContext.run({config:resolveFormalModel(config.id),onCall},fn);
}
export function compatibleSchema(schema:unknown):unknown {
  return JSON.parse(JSON.stringify(schema,(key,value)=>['minItems','maxItems','minimum','maximum','additionalProperties'].includes(key)?undefined:value));
}
/** Responses strict mode requires closed objects and every property in required.
 * Runtime source/package validators still enforce the original scientific contract. */
export function openAISchema(schema:unknown):unknown {
  const visit=(value:any):any=>{
    if(!value||typeof value!=='object'||Array.isArray(value))return value;
    const result:Record<string,any>=structuredClone(value);
    for(const key of ['properties','$defs','definitions']){
      if(result[key]&&typeof result[key]==='object')result[key]=Object.fromEntries(Object.entries(result[key]).map(([name,item])=>[name,visit(item)]));
    }
    for(const key of ['anyOf','oneOf','allOf'])if(Array.isArray(result[key]))result[key]=result[key].map(visit);
    if(result.items)result.items=visit(result.items);
    if(result.type==='object'||result.properties){
      if(result.additionalProperties && typeof result.additionalProperties==='object')throw new FormalError('This Formal Lab schema contains an unsupported open-ended object.',500);
      result.properties ||= {};
      result.required=Object.keys(result.properties);
      result.additionalProperties=false;
    }
    return result;
  };
  return visit(schema);
}
interface FormalAIOptions {system:string;payload:unknown;schema?:unknown;pdf?:{base64:string;mimeType:string};timeoutMs?:number;outputBudget?:'source-inventory'|'source-coverage-audit';}
const tokenCount=(value:unknown):number|undefined=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:undefined;
function parseStructured(raw:string):any {
  const text=raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
  if(text.length>300000)throw new FormalError('The AI response exceeded the supported size.',422);
  try{return JSON.parse(text);}catch{throw new FormalError(`The AI did not finish a valid structured response. ${retainedSourceMessage}`,422);}
}
async function recordUsage(config:FormalModelConfig,response:any,durationMs:number):Promise<void> {
  const handler=modelContext.getStore()?.onCall;
  if(!handler)return;
  const google=response.usageMetadata||{};const openai=response.usage||{};
  const usage:FormalModelCallUsage={selectionId:config.id,provider:config.provider,model:config.model,
    returnedModel:typeof (response.modelVersion||response.model)==='string'?(response.modelVersion||response.model):config.model,durationMs,
    inputTokens:tokenCount(config.provider==='google'?google.promptTokenCount:openai.input_tokens),
    // Google separates visible candidate tokens from billable thought tokens; OpenAI includes reasoning in output_tokens.
    outputTokens:config.provider==='google'?(tokenCount(google.candidatesTokenCount)!==undefined||tokenCount(google.thoughtsTokenCount)!==undefined?(tokenCount(google.candidatesTokenCount)||0)+(tokenCount(google.thoughtsTokenCount)||0):undefined):tokenCount(openai.output_tokens),
    reasoningTokens:tokenCount(config.provider==='google'?google.thoughtsTokenCount:openai.output_tokens_details?.reasoning_tokens),
    cachedInputTokens:tokenCount(config.provider==='google'?google.cachedContentTokenCount:openai.input_tokens_details?.cached_tokens)};
  try{await handler(usage);}catch{logger.warn({provider:config.provider,model:config.model},'Formal Lab usage recording failed');}
}
async function googleCall(options:FormalAIOptions,config:FormalModelConfig,ms:number):Promise<{data:any;model:string}> {
  const parts:any[]=[{text:JSON.stringify(options.payload)}];
  if(options.pdf)parts.push({inlineData:{mimeType:options.pdf.mimeType,data:options.pdf.base64}});
  const started=Date.now();
  const response=await ai.models.generateContent({model:config.model,contents:[{role:'user',parts}],config:{
    systemInstruction:options.system,responseMimeType:'application/json',...(options.schema?{responseJsonSchema:compatibleSchema(options.schema)}:{}),maxOutputTokens:32768,
    thinkingConfig:{thinkingLevel:(config.id==='argon'?'HIGH':'LOW') as any},...(config.id==='argon'?{}:{temperature:0.1}),
    abortSignal:AbortSignal.timeout(ms),httpOptions:{timeout:ms,retryOptions:{attempts:1}}}});
  await recordUsage(config,response,Date.now()-started);
  const finish=response.candidates?.[0]?.finishReason;
  if(finish&&finish!=='STOP')throw new FormalError(`Gemini did not complete the structured response. ${retainedSourceMessage}`,422);
  return {data:parseStructured(response.text||''),model:config.model};
}
const OPENAI_STREAM_EVENT_LIMIT=1024*1024;
const OPENAI_RESPONSE_BUFFER_LIMIT=2*1024*1024;
const retainedSourceMessage='Your uploaded source and previously saved revisions are retained.';
type ProviderError=Error&{status?:number;providerCode?:string;providerParam?:string;requestId?:string;noRetry?:boolean};
const providerCodes=new Set(['invalid_request_error','invalid_json_schema','invalid_api_key','model_not_found','insufficient_quota','rate_limit_exceeded','server_error','authentication_error','permission_denied','context_length_exceeded','unsupported_parameter','invalid_value']);
function safeProviderMetadata(value:any,requestId:string|null):Pick<ProviderError,'providerCode'|'providerParam'|'requestId'> {
  const code=value?.error?.code??value?.code;
  const param=value?.error?.param??value?.param;
  return {...(typeof code==='string'&&providerCodes.has(code)?{providerCode:code}:{}),
    ...(typeof param==='string'&&param.length<=120&&/^(?:model|input|instructions|reasoning|max_output_tokens|text|store|stream|service_tier)(?:\.[A-Za-z_][A-Za-z0-9_-]*|\[\d+\])*$/.test(param)?{providerParam:param}:{}),
    ...(typeof requestId==='string'&&/^req_[A-Za-z0-9_-]{1,100}$/.test(requestId)?{requestId}:{})};
}
function providerFailure(status:number,metadata:ReturnType<typeof safeProviderMetadata>={},noRetry=false):ProviderError {
  return Object.assign(new Error('OpenAI request failed'),{status,...metadata,...(noRetry?{noRetry:true}:{})});
}
function streamFailure():FormalError {return new FormalError(`OpenAI's response stream ended without a valid complete result. ${retainedSourceMessage} Please retry this stage.`,502);}
async function boundedResponseJSON(response:Response,limit=OPENAI_RESPONSE_BUFFER_LIMIT):Promise<any> {
  if(!response.body)throw streamFailure();
  const reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});let text='';let bytes=0;
  try {
    while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>limit)throw streamFailure();text+=decoder.decode(chunk.value,{stream:true});}
    text+=decoder.decode();try{return JSON.parse(text);}catch{throw streamFailure();}
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
/** Consume transport deltas without accepting partial JSON or duplicating the final output.
 * The terminal event contains the authoritative complete response and billed usage. */
export async function readOpenAIResponse(response:Response):Promise<any> {
  const contentType=response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase();
  // Some API-compatible transports return a completed JSON response even for stream:true.
  if(contentType==='application/json'){
    const body=await boundedResponseJSON(response);
    if(!body||typeof body!=='object'||Array.isArray(body)||!['completed','incomplete','failed'].includes(body.status))throw streamFailure();
    return body;
  }
  if(contentType!=='text/event-stream'||!response.body)throw streamFailure();
  const reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});
  let buffer='';let data:string[]=[];let eventType='';let eventBytes=0;
  const dispatch=():any=>{
    if(!data.length){eventType='';eventBytes=0;return undefined;}
    const raw=data.join('\n');data=[];const declaredType=eventType;eventType='';eventBytes=0;
    if(raw==='[DONE]')throw streamFailure(); // A complete terminal event is required first.
    let event:any;try{event=JSON.parse(raw);}catch{throw streamFailure();}
    if(!event||typeof event!=='object'||Array.isArray(event)||typeof event.type!=='string'||(declaredType&&declaredType!==event.type))throw streamFailure();
    if(event.type==='error')throw providerFailure(502,safeProviderMetadata(event,response.headers.get('x-request-id')),true);
    const terminalStatus=({'response.completed':'completed','response.incomplete':'incomplete','response.failed':'failed'} as Record<string,string>)[event.type];
    if(!terminalStatus)return undefined;
    if(!event.response||typeof event.response!=='object'||event.response.status!==terminalStatus)throw streamFailure();
    return event.response;
  };
  const consume=(eof=false):any=>{
    while(true){
      const next=buffer.search(/[\r\n]/);if(next<0)break;
      if(!eof&&buffer[next]==='\r'&&next===buffer.length-1)break;
      const line=buffer.slice(0,next);const separator=buffer[next]==='\r'&&buffer[next+1]==='\n'?2:1;buffer=buffer.slice(next+separator);
      if(!line){const terminal=dispatch();if(terminal)return terminal;continue;}
      eventBytes+=Buffer.byteLength(line,'utf8')+1;if(eventBytes>OPENAI_STREAM_EVENT_LIMIT)throw streamFailure();
      if(line[0]===':')continue;
      const colon=line.indexOf(':');const field=colon<0?line:line.slice(0,colon);let value=colon<0?'':line.slice(colon+1);if(value[0]===' ')value=value.slice(1);
      if(field==='data')data.push(value);else if(field==='event')eventType=value;
    }
    return undefined;
  };
  try {
    while(true){
      const chunk=await reader.read();
      if(chunk.done){buffer+=decoder.decode();const terminal=consume(true);if(terminal)return terminal;throw streamFailure();}
      // Bound each decode before appending; no unbounded line/event is retained.
      if(chunk.value.byteLength>OPENAI_RESPONSE_BUFFER_LIMIT)throw streamFailure();
      buffer+=decoder.decode(chunk.value,{stream:true});if(Buffer.byteLength(buffer,'utf8')>OPENAI_RESPONSE_BUFFER_LIMIT)throw streamFailure();
      const terminal=consume();if(terminal)return terminal;
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function isTransportTimeout(error:unknown):boolean {
  let current:any=error;
  for(let depth=0;current&&depth<6;depth++,current=current.cause){
    if(['TimeoutError','AbortError'].includes(current.name)||['UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ETIMEDOUT','ABORT_ERR'].includes(current.code))return true;
  }
  return false;
}
async function openAICall(options:FormalAIOptions,config:FormalModelConfig,ms:number):Promise<{data:any;model:string}> {
  const content:any[]=[{type:'input_text',text:JSON.stringify(options.payload)}];
  if(options.pdf)content.push({type:'input_file',filename:'submitted-paper.pdf',file_data:`data:${options.pdf.mimeType};base64,${options.pdf.base64}`});
  const started=Date.now();
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({
    model:config.model,instructions:options.system,input:[{role:'user',content}],reasoning:{effort:'high'},max_output_tokens:options.outputBudget?65536:32768,store:false,stream:true,
    text:{format:options.schema?{type:'json_schema',name:'formal_lab_response',strict:true,schema:openAISchema(options.schema)}:{type:'json_object'}}}),signal:AbortSignal.timeout(ms)});
  if(!response.ok){
    let metadata=safeProviderMetadata(undefined,response.headers.get('x-request-id'));
    try{metadata=safeProviderMetadata(await boundedResponseJSON(response,65536),response.headers.get('x-request-id'));}catch{/* Raw provider content is deliberately discarded. */}
    throw providerFailure(response.status,metadata);
  }
  // Never surface provider bodies: they can echo source content or credentials.
  let body:any;try{body=await readOpenAIResponse(response);}catch(error){if(error&&typeof error==='object')Object.assign(error,{noRetry:true});throw error;}
  await recordUsage(config,body,Date.now()-started);
  if(body.status!=='completed'){
    // Only a provider-confirmed output limit may select smaller inventory
    // requests. Refusals, content filtering and interrupted transport must not
    // be misclassified as safe-to-retry oversized output.
    if(body.status==='incomplete'&&body.incomplete_details?.reason==='max_output_tokens')throw Object.assign(new FormalError(`OpenAI did not complete the structured response because its output limit was reached. ${retainedSourceMessage}`,422),{code:'FORMAL_MODEL_OUTPUT_LIMIT'});
    throw new FormalError(`OpenAI did not complete the structured response. ${retainedSourceMessage}`,422);
  }
  const parts=(Array.isArray(body.output)?body.output:[]).filter((item:any)=>item?.type==='message'&&item?.role==='assistant').flatMap((item:any)=>Array.isArray(item.content)?item.content:[]);
  if(parts.some((part:any)=>part?.type==='refusal'))throw new FormalError(`OpenAI could not produce a formalization for this source. ${retainedSourceMessage}`,422);
  const raw=parts.filter((part:any)=>part?.type==='output_text'&&typeof part.text==='string').map((part:any)=>part.text).join('');
  return {data:parseStructured(raw),model:config.model};
}
export async function callFormalAI(options:FormalAIOptions):Promise<{data:any;model:string}> {
  const config=getCurrentFormalModel();
  if(options.outputBudget!==undefined&&!['source-inventory','source-coverage-audit'].includes(options.outputBudget))throw new FormalError('Unsupported internal source-analysis output budget.',500);
  // Keep the established default workflow unchanged; reasoning models need longer bounded stage deadlines.
  const ms=config.id==='current'?Math.min(options.timeoutMs||90000,120000):900000;
  if(config.provider==='openai'&&!hasKey(process.env.OPENAI_API_KEY))throw new FormalError('The OpenAI API credential is not configured on this service.',503);
  const deadline=Date.now()+ms;
  for(let attempt=0;attempt<2;attempt++){try{
    const remaining=deadline-Date.now();if(remaining<=0)throw new DOMException('Formal Lab stage deadline exceeded','TimeoutError');
    return config.provider==='openai'?await openAICall(options,config,remaining):await googleCall(options,config,remaining);
  }catch(error){
    if(isTransportTimeout(error)){
      logger.warn({provider:config.provider,model:config.model,errorType:error instanceof Error?error.name:'unknown',status:504},'Formal Lab model stage timed out; no automatic retry');
      throw new FormalError(`${config.provider==='openai'?'OpenAI':'Gemini'} analysis timed out before returning a complete result. ${retainedSourceMessage} Please retry this stage.`,504);
    }
    if(error instanceof FormalError)throw error;
    const status=Number((error as any)?.status)||0;
    if(attempt===0&&!(error as ProviderError)?.noRetry&&(error instanceof TypeError||status===502||status===503||status===504)){
      logger.warn({provider:config.provider,model:config.model,errorType:error instanceof Error?error.name:'unknown',status},'Retrying one transient Formal Lab model transport failure');
      await new Promise(resolve=>setTimeout(resolve,750));continue;
    }
    logger.warn({provider:config.provider,model:config.model,errorType:error instanceof Error?error.name:'unknown',status,...safeProviderMetadata({error:{code:(error as ProviderError)?.providerCode,param:(error as ProviderError)?.providerParam}},(error as ProviderError)?.requestId||null)},'Formal Lab model stage failed');
    const provider=config.provider==='openai'?'OpenAI':'Gemini';
    const issue=status===401||status===403?'credential or model access was rejected':status===429?'quota or rate limit was reached':'service could not complete this stage';
    throw new FormalError(`${provider} ${issue}. ${retainedSourceMessage} Retry the analysis after resolving the provider issue.`,503);
  }}
  throw new FormalError('The AI stage did not complete.',503);
}
