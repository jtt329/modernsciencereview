import { createHash } from 'node:crypto';
import type { FormalPackage } from './contract';

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
  if (JSON.stringify(p).length > 120_000) fail('Package is too large (120 KB maximum).');
  keys(p, ['schemaVersion','title','authors','source','selectedInputs','mainClaim','assumptions','symbols','definitions','claims','consequences','limitations'], 'Package');
  if (p.schemaVersion !== 'formal-lab-v1') fail('Unsupported package version.');
  text(p.title, 'Title', 300); text(p.authors, 'Authors', 300, false); text(p.mainClaim, 'Main claim', 6000);
  object(p.source, 'Source'); keys(p.source, ['title','url','version','sha256','excerpt'], 'Source');
  text(p.source.title, 'Source title', 500); text(p.source.url, 'Source URL', 2000, false); text(p.source.version, 'Source version', 200);
  text(p.source.excerpt, 'Source excerpt', 16000);
  if (p.source.url && !/^https?:\/\//i.test(p.source.url) && !/^\/(?!\/)/.test(p.source.url)) fail('Source URL must be an http(s) or site-relative link.');
  if (p.source.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(p.source.sha256)) fail('Invalid source SHA-256.');
  list(p.selectedInputs, 'Selected inputs', 12);
  for (const i of p.selectedInputs) { object(i, 'Input'); keys(i,['id','version','title','statement','sourceUrl'],'Input'); text(i.id,'Input ID',100); text(i.version,'Input version',60); text(i.title,'Input title',300); text(i.statement,'Input statement',4000); if(i.sourceUrl) { text(i.sourceUrl,'Input link',2000); if(!/^https?:\/\//i.test(i.sourceUrl) && !/^\/(?!\/)/.test(i.sourceUrl)) fail('Invalid input link.'); } }
  for (const key of ['assumptions','limitations']) { list(p[key],key,30); for(const s of p[key]) text(s,key,3000); }
  list(p.symbols,'Symbols',32); if(!p.symbols.length) fail('Declare at least one symbol.');
  const declared = new Set<string>();
  for(const s of p.symbols) { object(s,'Symbol'); keys(s,['name','label','domain','dimensions'],'Symbol'); name(s.name,'Symbol'); if(declared.has(s.name)) fail('Duplicate symbol.'); declared.add(s.name); text(s.label,'Symbol label',500); if(!['real','positive','nonzero'].includes(s.domain)) fail('Choose an explicit real, positive, or nonzero domain.'); if(!Array.isArray(s.dimensions) || s.dimensions.length !== 3 || !s.dimensions.every((n:any)=>Number.isInteger(n)&&Math.abs(n)<=12)) fail('Dimensions must be three bounded integer exponents (mass, length, time).'); }
  let nodes = 0;
  function expr(e:any,depth=0): void {
    if(++nodes>2048 || depth>24) fail('Expression exceeds prototype complexity limits.');
    object(e,'Expression');
    switch(e.op) {
      case 'symbol': keys(e,['op','name'],'Symbol expression'); if(!declared.has(e.name)) fail(`Undeclared symbol: ${String(e.name)}`); break;
      case 'integer': keys(e,['op','value'],'Integer'); if(!Number.isSafeInteger(e.value)||Math.abs(e.value)>1e9) fail('Integer outside supported range.'); break;
      case 'rational': keys(e,['op','numerator','denominator'],'Rational'); if(![e.numerator,e.denominator].every(n=>Number.isSafeInteger(n)&&Math.abs(n)<=1e9)||e.denominator===0) fail('Invalid rational number.'); break;
      case 'add': case 'mul': keys(e,['op','args'],'Operation'); list(e.args,'Operands',16); if(e.args.length<1) fail('An operation needs operands.'); e.args.forEach((a:any)=>expr(a,depth+1)); break;
      case 'div': keys(e,['op','numerator','denominator'],'Division'); expr(e.numerator,depth+1); expr(e.denominator,depth+1); break;
      case 'pow': keys(e,['op','base','exponent'],'Power'); if(!Number.isInteger(e.exponent)||Math.abs(e.exponent)>8) fail('Only integer powers from -8 to 8 are supported.'); expr(e.base,depth+1); break;
      case 'diff': keys(e,['op','expr','variable'],'Derivative'); if(!declared.has(e.variable)) fail('Undeclared differentiation variable.'); expr(e.expr,depth+1); break;
      case 'substitute': keys(e,['op','expr','values'],'Substitution'); object(e.values,'Substitutions'); if(Object.keys(e.values).length>12) fail('Too many substitutions.'); for(const [k,v] of Object.entries(e.values)) { if(!declared.has(k)) fail('Undeclared substitution variable.'); expr(v,depth+1); } expr(e.expr,depth+1); break;
      default: fail('Unsupported expression operation.');
    }
  }
  list(p.definitions,'Definitions',30); const defs=new Set<string>();
  for(const d of p.definitions) { object(d,'Definition'); keys(d,['symbol','expression','description'],'Definition'); if(typeof d.symbol!=='string') fail('Each definition needs a string symbol matching a declaration.'); if(!declared.has(d.symbol)) fail(`Definition ${d.symbol.slice(0,40)} has no symbol declaration; declare it with its domain and dimensions.`); if(defs.has(d.symbol)) fail(`Duplicate definition for ${d.symbol.slice(0,40)}; define each symbol once.`); defs.add(d.symbol); text(d.description,'Definition description',2000); expr(d.expression); }
  list(p.claims,'Claims',16); if(!p.claims.length) fail('At least one claim is required.'); const ids=new Set<string>();
  for(const c of p.claims) { object(c,'Claim'); keys(c,['id','title','lhs','rhs','explanation'],'Claim'); text(c.id,'Claim ID',80); if(ids.has(c.id)) fail('Duplicate claim ID.'); ids.add(c.id); text(c.title,'Claim title',300); text(c.explanation,'Claim explanation',3000); expr(c.lhs); expr(c.rhs); }
  list(p.consequences,'Consequences',16);
  for(const c of p.consequences) { object(c,'Consequence'); keys(c,['title','text','claimIds'],'Consequence'); text(c.title,'Consequence title',300); text(c.text,'Consequence text',4000); list(c.claimIds,'Referenced claims',16); if(!c.claimIds.length || c.claimIds.some((id:any)=>!ids.has(id))) fail('Every consequence must reference existing checked claim candidates.'); }
  return p as FormalPackage;
}
