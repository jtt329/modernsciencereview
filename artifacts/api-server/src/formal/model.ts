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
interface FormalAIOptions {system:string;payload:unknown;schema?:unknown;pdf?:{base64:string;mimeType:string};timeoutMs?:number;}
const tokenCount=(value:unknown):number|undefined=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:undefined;
function parseStructured(raw:string):any {
  const text=raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
  if(text.length>300000)throw new FormalError('The AI response exceeded the supported size.',422);
  try{return JSON.parse(text);}catch{throw new FormalError('The AI did not finish a valid structured response. The source and previous completed stages are preserved.',422);}
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
  if(finish&&finish!=='STOP')throw new FormalError('Gemini did not complete the structured response. Your source and completed stages are preserved.',422);
  return {data:parseStructured(response.text||''),model:config.model};
}
async function openAICall(options:FormalAIOptions,config:FormalModelConfig,ms:number):Promise<{data:any;model:string}> {
  const content:any[]=[{type:'input_text',text:JSON.stringify(options.payload)}];
  if(options.pdf)content.push({type:'input_file',filename:'submitted-paper.pdf',file_data:`data:${options.pdf.mimeType};base64,${options.pdf.base64}`});
  const started=Date.now();
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({
    model:config.model,instructions:options.system,input:[{role:'user',content}],reasoning:{effort:'high'},max_output_tokens:32768,store:false,
    text:{format:options.schema?{type:'json_schema',name:'formal_lab_response',strict:true,schema:openAISchema(options.schema)}:{type:'json_object'}}}),signal:AbortSignal.timeout(ms)});
  if(!response.ok){const error=new Error('OpenAI request failed') as Error&{status:number};error.status=response.status;throw error;}
  // Never surface a raw provider body: it can echo source content or credentials.
  const body:any=await response.json();
  await recordUsage(config,body,Date.now()-started);
  if(body.status!=='completed')throw new FormalError('OpenAI did not complete the structured response. Your source and completed stages are preserved.',422);
  const parts=(Array.isArray(body.output)?body.output:[]).filter((item:any)=>item?.type==='message'&&item?.role==='assistant').flatMap((item:any)=>Array.isArray(item.content)?item.content:[]);
  if(parts.some((part:any)=>part?.type==='refusal'))throw new FormalError('OpenAI could not produce a formalization for this source. Your source and completed stages are preserved.',422);
  const raw=parts.filter((part:any)=>part?.type==='output_text'&&typeof part.text==='string').map((part:any)=>part.text).join('');
  return {data:parseStructured(raw),model:config.model};
}
export async function callFormalAI(options:FormalAIOptions):Promise<{data:any;model:string}> {
  const config=getCurrentFormalModel();
  // Keep the established default workflow unchanged; reasoning models need longer bounded stage deadlines.
  const ms=config.id==='current'?Math.min(options.timeoutMs||90000,120000):Math.min(Math.max(options.timeoutMs||0,config.id==='argon'?900000:300000),900000);
  if(config.provider==='openai'&&!hasKey(process.env.OPENAI_API_KEY))throw new FormalError('The OpenAI API credential is not configured on this service.',503);
  for(let attempt=0;attempt<2;attempt++){try{
    return config.provider==='openai'?await openAICall(options,config,ms):await googleCall(options,config,ms);
  }catch(error){
    if(error instanceof FormalError)throw error;
    const status=Number((error as any)?.status)||0;
    if(attempt===0&&(error instanceof TypeError||status===502||status===503||status===504)){
      logger.warn({provider:config.provider,model:config.model,errorType:error instanceof Error?error.name:'unknown',status},'Retrying one transient Formal Lab model transport failure');
      await new Promise(resolve=>setTimeout(resolve,750));continue;
    }
    logger.warn({provider:config.provider,model:config.model,errorType:error instanceof Error?error.name:'unknown',status},'Formal Lab model stage failed');
    const provider=config.provider==='openai'?'OpenAI':'Gemini';
    const issue=status===401||status===403?'credential or model access was rejected':status===429?'quota or rate limit was reached':'service could not complete this stage';
    throw new FormalError(`${provider} ${issue}. Your source and completed results are saved; retry the analysis after resolving the provider issue.`,503);
  }}
  throw new FormalError('The AI stage did not complete.',503);
}
