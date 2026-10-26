import type { LiteraturePaper,LiteratureSearch } from './literatureContract';
import { FormalError } from './package';
type RecordPaper=LiteraturePaper&{abstract?:string};
const ID=/^\d{1,15}$/,ARXIV=/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i;
/** INSPIRE's official REST API and search guide document citedby/refersto recid.
 * No provider-returned links, user URLs or general query syntax are followed. */
export function inspireNeighborhoodUrl(kind:'references'|'citations',recordId:string):string{
 if(!ID.test(recordId))throw new FormalError('Invalid INSPIRE record identifier.',422);
 const url=new URL('https://inspirehep.net/api/literature');url.searchParams.set('q',`${kind==='references'?'citedby':'refersto'} recid ${recordId}`);url.searchParams.set('size','6');url.searchParams.set('sort','mostcited');return url.href;
}
export function inspireSeedUrl(arxivId:string):string{
 if(!ARXIV.test(arxivId))throw new FormalError('Invalid citation seed arXiv identifier.',422);
 return 'https://inspirehep.net/api/arxiv/'+arxivId.replace(/v\d+$/,'').split('/').map(encodeURIComponent).join('/');
}
async function json(url:string):Promise<any>{
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(25000),headers:{Accept:'application/json','User-Agent':'ModernScienceFormalLab/1.0 (https://modernscience.space)'}});
 if(!response.ok||!response.headers.get('content-type')?.toLowerCase().includes('json')||!response.body)throw new Error('unavailable');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{while(true){const piece=await reader.read();if(piece.done)break;length+=piece.value.byteLength;if(length>2*1024*1024)throw new Error('large');chunks.push(piece.value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function retrieveInspireNeighborhood(seeds:{arxivId?:string;inspireId?:string;title:string}[],parse:(value:unknown)=>RecordPaper[],onEvent?:(stage:string,message:string)=>void|Promise<void>):Promise<{searches:LiteratureSearch[];papers:RecordPaper[]}>{
 const searches:LiteratureSearch[]=[],papers:RecordPaper[]=[];const used=new Set<string>();
 for(const seed of seeds.slice(0,3)){
  let id=seed.inspireId&&ID.test(seed.inspireId)?seed.inspireId:undefined;
  if(!id&&seed.arxivId){const url=inspireSeedUrl(seed.arxivId),searchedAt=new Date().toISOString();try{const record=await json(url);const control=String(record.metadata?.control_number??record.id);if(!ID.test(control))throw new Error('invalid record number');const returnedIds=record.metadata?.arxiv_eprints?.map((item:any)=>item.value).filter((value:unknown)=>typeof value==='string')||[];if(returnedIds.length&&!returnedIds.some((value:string)=>value.replace(/v\d+$/,'')===seed.arxivId!.replace(/v\d+$/,'')))throw new Error('different arXiv identity');id=control;const found=parse({hits:{hits:[{...record,id:control}]}});papers.push(...found);searches.push({provider:'inspire',query:'Citation seed lookup: arXiv '+seed.arxivId,url,status:'searched',searchedAt,resultCount:found.length,note:'Resolved the actual INSPIRE record for a validated arXiv identifier; metadata and available abstract only.'});}catch{searches.push({provider:'inspire',query:'Citation seed lookup: arXiv '+seed.arxivId,url,status:'unavailable',searchedAt,resultCount:0,note:'The INSPIRE record lookup failed; its citation neighborhood was not silently treated as searched.'});}}
  if(!id||used.has(id))continue;used.add(id);await onEvent?.('literature-citations',`Checking references and citing papers around the actual INSPIRE record ${id}; each direction is bounded to six records.`);
  for(const kind of ['references','citations'] as const){const url=inspireNeighborhoodUrl(kind,id),searchedAt=new Date().toISOString();try{const found=parse(await json(url));papers.push(...found);searches.push({provider:'inspire',query:`Citation neighborhood ${kind}: recid ${id}`,url,status:'searched',searchedAt,resultCount:found.length,note:`Retrieved up to six actual ${kind==='references'?'references cited by':'papers citing'} this seed, ranked by citation count. Citation links establish discovery context, not detailed agreement or full-paper reading.`});}catch{searches.push({provider:'inspire',query:`Citation neighborhood ${kind}: recid ${id}`,url,status:'unavailable',searchedAt,resultCount:0,note:'This bounded citation-neighborhood request failed; no missing records or prior-art verdict were invented.'});}}
 }
 return {searches,papers};
}
