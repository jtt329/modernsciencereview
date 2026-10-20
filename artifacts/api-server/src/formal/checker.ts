import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { FormalPackage, VerificationReport } from './contract';
import { FormalError } from './package';
let active = 0;
export async function verifyPackage(pkg: FormalPackage, digest: string): Promise<VerificationReport> {
  if (active >= 2) throw new FormalError('The checker is busy. Try again shortly.', 429);
  const fromSource = fileURLToPath(new URL('../../formal-verifier/check.py', import.meta.url));
  const fromBundle = fileURLToPath(new URL('./formal-verifier/check.py', import.meta.url));
  const script = existsSync(fromBundle) ? fromBundle : fromSource;
  const rootVenv = path.resolve(process.cwd(), '.formal-venv/bin/python');
  const python = process.env.FORMAL_PYTHON || (existsSync(rootVenv) ? rootVenv : 'python3');
  active++;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(python, ['-I', script], { stdio: ['pipe','pipe','pipe'], cwd: path.dirname(script), env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8', PYTHONHASHSEED: '0' } });
      let out = ''; let err = ''; let settled = false;
      const finish = (error?: Error, report?: VerificationReport) => { if(settled) return; settled=true; clearTimeout(timer); error ? reject(error) : resolve(report!); };
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new FormalError('The checker reached its 15-second limit; no verification was recorded.', 504)); }, 15_000);
      child.stdout.on('data', c => { out += c.toString(); if(out.length>200_000) { child.kill('SIGKILL'); finish(new FormalError('Checker output exceeded its limit.', 502)); } });
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
  } finally { active--; }
}
