import { ai } from '@workspace/integrations-gemini-ai';
import { FormalError } from './package';
import { logger } from '../lib/logger';
export const formalModel = process.env.FORMAL_LAB_MODEL || process.env.SCIREVIEW_GEMINI_REVIEW_MODEL || 'gemini-3.5-flash';
export function compatibleSchema(schema: unknown): unknown {
  return JSON.parse(JSON.stringify(schema,(key,value)=>['minItems','maxItems','minimum','maximum','additionalProperties'].includes(key)?undefined:value));
}
export async function callFormalAI(options:{system:string;payload:unknown;schema?:unknown;pdf?:{base64:string;mimeType:string};timeoutMs?:number}):Promise<{data:any;model:string}> {
  const ms=Math.min(options.timeoutMs||90000,120000);
  const parts:any[]=[{text:JSON.stringify(options.payload)}];
  if(options.pdf) parts.push({inlineData:{mimeType:options.pdf.mimeType,data:options.pdf.base64}});
  for(let attempt=0;attempt<2;attempt++){ try {
    const response=await ai.models.generateContent({model:formalModel,contents:[{role:'user',parts}],config:{systemInstruction:options.system,responseMimeType:'application/json',...(options.schema?{responseJsonSchema:compatibleSchema(options.schema)}:{}),maxOutputTokens:32768,thinkingConfig:{thinkingLevel:'LOW' as any},temperature:0.1,abortSignal:AbortSignal.timeout(ms),httpOptions:{timeout:ms,retryOptions:{attempts:1}}}});
    const raw=(response.text||'').trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
    if(raw.length>300000) throw new FormalError('The AI response exceeded the supported size.',422);
    try{return {data:JSON.parse(raw),model:formalModel};}catch{throw new FormalError('The AI did not finish a valid structured response. The source and previous completed stages are preserved.',422);}
  } catch(error) {
    if(error instanceof FormalError) throw error;
    const status=Number((error as any)?.status)||0;
    if(attempt===0 && (error instanceof TypeError || status===502 || status===503 || status===504)){logger.warn({errorType:error instanceof Error?error.name:'unknown',status},'Retrying one transient Formal Lab model transport failure');await new Promise(resolve=>setTimeout(resolve,750));continue;}
    logger.warn({errorType:error instanceof Error?error.name:'unknown',status},'Formal Lab model stage failed');
    throw new FormalError('The AI service could not complete this stage. Your source and completed results are saved; retry the analysis.',503);
  }}
  throw new FormalError('The AI stage did not complete.',503);
}
