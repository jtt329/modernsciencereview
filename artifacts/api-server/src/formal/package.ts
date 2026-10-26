import { createHash } from 'node:crypto';
import type { FormalPackage } from './contract';
import {normalizeAuthorGuidance} from './authorGuidance';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k,v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}
export function packageDigest(pkg: FormalPackage): string {
  return createHash('sha256').update(canonicalJson(pkg)).digest('hex');
}
export class FormalError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}
const fail = (message: string): never => { throw new FormalError(message); };
const object = (v: any, label: string) => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`${label} must be an object.`); };
const text = (v: any, label: string, max = 4000, required = true) => { if (typeof v !== 'string' || v.length > max || (required && !v.trim())) fail(`${label} must be ${required ? 'nonempty ' : ''}text, at most ${max} characters.`); };
const list = (v: any, label: string, max = 30) => { if (!Array.isArray(v) || v.length > max) fail(`${label} must be a list of at most ${max} items.`); };
const name = (v: any, label: string) => { if (typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(v)) fail(`${label} must be a simple symbol name.`); };
const keys = (v: any, allowed: string[], label: string) => { if (Object.keys(v).some(k => !allowed.includes(k))) fail(`${label} contains unsupported fields.`); };
export function validatePackage(value: unknown): FormalPackage {
  const p: any = structuredClone(value);
  object(p, 'Package');
  if (JSON.stringify(p).length > 600_000) fail('Package is too large (600 KB maximum).');
  keys(p, ['schemaVersion','title','authors','source','selectedInputs','mainClaim','assumptions','symbols','definitions','claims','consequences','limitations','analysis','authorGuidance'], 'Package');
  if(Object.prototype.hasOwnProperty.call(p,'authorGuidance')){const guidance=normalizeAuthorGuidance(p.authorGuidance);if(guidance)p.authorGuidance=guidance;else delete p.authorGuidance;}
  if (p.schemaVersion !== 'formal-lab-v1') fail('Unsupported package version.');
  text(p.title, 'Title', 300); text(p.authors, 'Authors', 300, false); text(p.mainClaim, 'Main claim', 6000);
  object(p.source, 'Source'); keys(p.source, ['title','url','version','sha256','excerpt'], 'Source');
  text(p.source.title, 'Source title', 500); text(p.source.url, 'Source URL', 2000, false); text(p.source.version, 'Source version', 200);
  text(p.source.excerpt, 'Source excerpt', 45000);
  if (p.source.url && !/^https?:\/\//i.test(p.source.url) && !/^\/(?!\/)/.test(p.source.url)) fail('Source URL must be an http(s) or site-relative link.');
  if (p.source.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(p.source.sha256)) fail('Invalid source SHA-256.');
  list(p.selectedInputs, 'Selected inputs', 40);
  for (const i of p.selectedInputs) { object(i, 'Input'); keys(i,['id','version','title','statement','sourceUrl'],'Input'); text(i.id,'Input ID',100); text(i.version,'Input version',60); text(i.title,'Input title',300); text(i.statement,'Input statement',4000); if(i.sourceUrl) { text(i.sourceUrl,'Input link',2000); if(!/^https?:\/\//i.test(i.sourceUrl) && !/^\/(?!\/)/.test(i.sourceUrl)) fail('Invalid input link.'); } }
  for (const key of ['assumptions','limitations']) { list(p[key],key,120); for(const s of p[key]) text(s,key,3000); }
  list(p.symbols,'Symbols',120); if(!p.symbols.length) fail('Declare at least one symbol.');
  const declared = new Set<string>();
  for(const s of p.symbols) { object(s,'Symbol'); keys(s,['name','label','domain','dimensions'],'Symbol'); name(s.name,'Symbol'); if(declared.has(s.name)) fail('Duplicate symbol.'); declared.add(s.name); text(s.label,'Symbol label',500); if(!['real','positive','nonzero'].includes(s.domain)) fail('Choose an explicit real, positive, or nonzero domain.'); if(!Array.isArray(s.dimensions) || ![3,7].includes(s.dimensions.length) || !s.dimensions.every((n:any)=>Number.isInteger(n)&&Math.abs(n)<=12)) fail('Dimensions must have three legacy or seven SI integer exponents.'); }
  let nodes = 0;
  function expr(e:any,depth=0): void {
    if(++nodes>16000 || depth>32) fail('Expression exceeds prototype complexity limits.');
    object(e,'Expression');
    switch(e.op) {
      case 'symbol': keys(e,['op','name'],'Symbol expression'); if(!declared.has(e.name)) fail(`Undeclared symbol: ${String(e.name)}`); break;
      case 'integer': keys(e,['op','value'],'Integer'); if(!Number.isSafeInteger(e.value)||Math.abs(e.value)>1e9) fail('Integer outside supported range.'); break;
      case 'rational': keys(e,['op','numerator','denominator'],'Rational'); if(![e.numerator,e.denominator].every(n=>Number.isSafeInteger(n)&&Math.abs(n)<=1e9)||e.denominator===0) fail('Invalid rational number.'); break;
      case 'add': case 'mul': keys(e,['op','args'],'Operation'); list(e.args,'Operands',32); if(e.args.length<1) fail('An operation needs operands.'); e.args.forEach((a:any)=>expr(a,depth+1)); break;
      case 'div': keys(e,['op','numerator','denominator'],'Division'); expr(e.numerator,depth+1); expr(e.denominator,depth+1); break;
      case 'pow': keys(e,['op','base','exponent'],'Power'); if(!Number.isInteger(e.exponent)||Math.abs(e.exponent)>8) fail('Only integer powers from -8 to 8 are supported.'); expr(e.base,depth+1); break;
      case 'diff': keys(e,['op','expr','variable'],'Derivative'); if(!declared.has(e.variable)) fail('Undeclared differentiation variable.'); expr(e.expr,depth+1); break;
      case 'substitute': keys(e,['op','expr','values'],'Substitution'); object(e.values,'Substitutions'); if(Object.keys(e.values).length>32) fail('Too many substitutions.'); for(const [k,v] of Object.entries(e.values)) { if(!declared.has(k)) fail('Undeclared substitution variable.'); expr(v,depth+1); } expr(e.expr,depth+1); break;
      default: fail('Unsupported expression operation.');
    }
  }
  list(p.definitions,'Definitions',120); const defs=new Set<string>();
  for(const d of p.definitions) { object(d,'Definition'); keys(d,['symbol','expression','description'],'Definition'); if(typeof d.symbol!=='string') fail('Each definition needs a string symbol matching a declaration.'); if(!declared.has(d.symbol)) fail(`Definition ${d.symbol.slice(0,40)} has no symbol declaration; declare it with its domain and dimensions.`); if(defs.has(d.symbol)) fail(`Duplicate definition for ${d.symbol.slice(0,40)}; define each symbol once.`); defs.add(d.symbol); text(d.description,'Definition description',2000); expr(d.expression); }
  list(p.claims,'Claims',120); if(!p.claims.length) fail('At least one claim is required.'); const ids=new Set<string>();
  for(const c of p.claims) { object(c,'Claim'); keys(c,['id','title','lhs','rhs','explanation'],'Claim'); text(c.id,'Claim ID',80); if(ids.has(c.id)) fail('Duplicate claim ID.'); ids.add(c.id); text(c.title,'Claim title',300); text(c.explanation,'Claim explanation',3000); expr(c.lhs); expr(c.rhs); }
  list(p.consequences,'Consequences',80);
  for(const c of p.consequences) { object(c,'Consequence'); keys(c,['title','text','claimIds'],'Consequence'); text(c.title,'Consequence title',300); text(c.text,'Consequence text',4000); list(c.claimIds,'Referenced claims',80); if(!c.claimIds.length || c.claimIds.some((id:any)=>!ids.has(id))) fail('Every consequence must reference existing checked claim candidates.'); }
  if(p.analysis !== undefined) {
    const a=p.analysis; object(a,'Analysis'); keys(a,['version','sourceId','subjectSlug','subjectTitle','coverage','inputReferences','claimReferences','extractionWarnings','ingestionLog'],'Analysis');
    if(a.version!=='source-analysis-v2'||typeof a.sourceId!=='string'||!/^[a-f0-9-]{36}$/.test(a.sourceId)) fail('Invalid source analysis version or source ID.');
    if(typeof a.subjectSlug!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.subjectSlug)||a.subjectSlug.length>80) fail('Invalid subject slug.'); text(a.subjectTitle,'Subject title',200);
    const inputIds=new Set(p.selectedInputs.map((i:any)=>i.id));
    const lines=(v:any)=>{list(v,'Source line references',900); if(!v.length||v.some((id:any)=>typeof id!=='string'||!/^p[0-9]+-l[0-9]+$/.test(id)))fail('Every source reference needs a nonempty list of numbered source lines.');};
    list(a.coverage,'Source assertions',1300); const coverageIds=new Set();
    for(const c of a.coverage){object(c,'Coverage item');keys(c,['id','statement','role','sourceLineIds','claimIds','inputIds','reason'],'Coverage item');text(c.id,'Coverage ID',100);if(coverageIds.has(c.id))fail('Duplicate coverage ID.');coverageIds.add(c.id);text(c.statement,'Source assertion',4000);text(c.reason,'Coverage reason',4000,false);if(!['mathematical','physical-input','definition','interpretation','empirical','citation','scope','metadata','unassessed'].includes(c.role))fail('Unknown coverage role.');lines(c.sourceLineIds);list(c.claimIds,'Coverage claims',120);list(c.inputIds,'Coverage inputs',40);if(c.claimIds.some((id:any)=>!ids.has(id))||c.inputIds.some((id:any)=>!inputIds.has(id)))fail('Coverage must reference known claims and inputs.');}
    list(a.inputReferences,'Input references',40);for(const r of a.inputReferences){object(r,'Input reference');keys(r,['inputId','sourceLineIds','basis','justification'],'Input reference');if(!inputIds.has(r.inputId)||!['stated','cited','inferred'].includes(r.basis))fail('Invalid input reference.');lines(r.sourceLineIds);text(r.justification,'Input justification',4000);}
    list(a.claimReferences,'Claim references',120); const referenced=new Set();for(const r of a.claimReferences){object(r,'Claim reference');keys(r,['claimId','sourceLineIds'],'Claim reference');if(!ids.has(r.claimId)||referenced.has(r.claimId))fail('Invalid or duplicate claim reference.');referenced.add(r.claimId);lines(r.sourceLineIds);}if(referenced.size!==ids.size)fail('Every formal claim must cite its numbered source lines.');
    if(a.ingestionLog!==undefined){list(a.ingestionLog,'Ingestion log',200);for(const e of a.ingestionLog){object(e,'Ingestion event');keys(e,['at','stage','message'],'Ingestion event');text(e.at,'Event timestamp',80);text(e.stage,'Event stage',80);text(e.message,'Event message',3000);}}
    list(a.extractionWarnings,'Extraction warnings',50);a.extractionWarnings.forEach((v:any)=>text(v,'Extraction warning',4000));
  }
  return p as FormalPackage;
}
