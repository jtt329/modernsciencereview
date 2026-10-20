import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Expr, FormalPackage, VerificationReport } from './contract';
import { FormalError } from './package';
let active = 0;
async function runVerifier(pkg: FormalPackage, digest: string): Promise<VerificationReport> {
  const fromSource = fileURLToPath(new URL('../../formal-verifier/check.py', import.meta.url));
  const fromBundle = fileURLToPath(new URL('./formal-verifier/check.py', import.meta.url));
  const script = existsSync(fromBundle) ? fromBundle : fromSource;
  const rootVenv = path.resolve(process.cwd(), '.formal-venv/bin/python');
  const python = process.env.FORMAL_PYTHON || (existsSync(rootVenv) ? rootVenv : 'python3');
  return await new Promise((resolve, reject) => {
      const child = spawn(python, ['-I', script], { stdio: ['pipe','pipe','pipe'], cwd: path.dirname(script), env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8', PYTHONHASHSEED: '0' } });
      let out = ''; let err = ''; let settled = false;
      const finish = (error?: Error, report?: VerificationReport) => { if(settled) return; settled=true; clearTimeout(timer); error ? reject(error) : resolve(report!); };
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new FormalError('The checker reached its 20-second limit; no verification was recorded.', 504)); }, 20_000);
      child.stdout.on('data', c => { out += c.toString(); if(out.length>1_200_000) { child.kill('SIGKILL'); finish(new FormalError('Checker output exceeded its limit.', 502)); } });
      child.stderr.on('data', c => { err += c.toString().slice(0,1000); });
      child.on('error', () => finish(new FormalError('The symbolic checker is unavailable. The draft and approval are preserved.', 503)));
      child.on('close', code => {
        if(settled) return;
        if(code !== 0) { finish(new FormalError('The checker could not complete this package. No successful verification was recorded.', 422)); return; }
        try { const report = JSON.parse(out) as VerificationReport; if(report.packageDigest !== digest || !Array.isArray(report.claims) || report.claims.length !== pkg.claims.length) throw new Error('Invalid report'); finish(undefined,report); }
        catch { finish(new FormalError('The checker returned an invalid result. No verification was recorded.',502)); }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify({package:pkg,packageDigest:digest}));
    });
}

function referencedSymbols(expr:Expr):string[]{
  switch(expr.op){case 'symbol':return [expr.name];case 'integer':case 'rational':return [];case 'add':case 'mul':return expr.args.flatMap(referencedSymbols);case 'div':return [...referencedSymbols(expr.numerator),...referencedSymbols(expr.denominator)];case 'pow':return referencedSymbols(expr.base);case 'diff':return [expr.variable,...referencedSymbols(expr.expr)];case 'substitute':return [...Object.keys(expr.values),...referencedSymbols(expr.expr),...Object.values(expr.values).flatMap(referencedSymbols)];}
}
/** Approved source models have explicit independent namespaces. Audit each model
 * and all of its actual dependencies without letting an unrelated failed model
 * erase the checks completed in the other physical regimes. */
export function isolatedModels(pkg:FormalPackage):{id:string;package:FormalPackage}[]{
  if(!pkg.analysis || !pkg.symbols.every(s=>/^b[1-5]_/.test(s.name)) || !pkg.claims.every(c=>/^b[1-5]-/.test(c.id)))return [{id:'whole-package',package:pkg}];
  const groups=[...new Set(pkg.claims.map(c=>c.id.match(/^(b[1-5])-/)![1]))];
  return groups.map(id=>{
    const claims=pkg.claims.filter(c=>c.id.startsWith(id+'-'));
    const needed=new Set(pkg.symbols.filter(s=>s.name.startsWith(id+'_')).map(s=>s.name));
    claims.forEach(c=>[...referencedSymbols(c.lhs),...referencedSymbols(c.rhs)].forEach(n=>needed.add(n)));
    let changed=true;while(changed){changed=false;for(const d of pkg.definitions.filter(d=>needed.has(d.symbol)))for(const name of referencedSymbols(d.expression))if(!needed.has(name)){needed.add(name);changed=true;}}
    return {id,package:{...pkg,symbols:pkg.symbols.filter(s=>needed.has(s.name)),definitions:pkg.definitions.filter(d=>needed.has(d.symbol)),claims}};
  });
}
export async function verifyPackage(pkg:FormalPackage,digest:string):Promise<VerificationReport>{
  if(active>=2)throw new FormalError('The checker is busy. Try again shortly.',429);active++;
  try{
    const models=isolatedModels(pkg);const reports:VerificationReport[]=[];
    for(const model of models){const report=await runVerifier(model.package,digest);if(models.length>1)for(const c of report.claims)c.steps=[`Audit the independent source model ${model.id} and its declared dependency closure.`,...(c.steps||[])];reports.push(report);}
    if(reports.length===1)return reports[0];
    const byId=new Map(reports.flatMap(r=>r.claims).map(c=>[c.id,c]));const claims=pkg.claims.map(c=>byId.get(c.id)!);const statuses=claims.map(c=>c.status);
    return {...reports[0],checkedAt:new Date().toISOString(),claims,status:statuses.every(s=>s==='checked')?'checked':statuses.includes('checked')?'partial':'failed',limitations:[...new Set([...reports.flatMap(r=>r.limitations),'Independent source models were checked separately under their declared premises. Compatibility between physical regimes and the physical justification of inputs remain separate review questions.'])]};
  }finally{active--;}
}
