import type { CoverageItem, FormalPackage, VerificationReport } from './contract';
import { canonicalJson } from './package';
const base = (name: string) => name.replace(/^b[1-5]_/, '');
const sameLines = (a: string[], b: string[]) => a.length > 0 && canonicalJson([...new Set(a)].sort()) === canonicalJson([...new Set(b)].sort());
/** Recover only an exact atomic symbol = symbol/symbol relation, with identical
 * source references and an independently checked candidate. Never infer a full
 * variational statement, a physical interpretation, or a broader prose claim. */
export function recoverCoverageMappings(pkg: FormalPackage, report: VerificationReport, items: CoverageItem[]): CoverageItem[] {
  const checked = new Set(report.claims.filter(c => c.status === 'checked' && c.dimensions === 'consistent' && c.derivationKind === 'identity').map(c => c.id));
  return items.map(item => {
    if (item.role !== 'mathematical' || item.claimIds.length) return item;
    const match = /^\s*\$?([A-Za-z][A-Za-z0-9_]*)\s*=\s*([A-Za-z][A-Za-z0-9_]*)\s*\/\s*([A-Za-z][A-Za-z0-9_]*)\$?\.?\s*$/.exec(item.statement);
    if (!match) return item;
    const candidates = pkg.claims.filter(claim => {
      if (!checked.has(claim.id) || claim.lhs.op !== 'symbol' || claim.rhs.op !== 'div' || claim.rhs.numerator.op !== 'symbol' || claim.rhs.denominator.op !== 'symbol') return false;
      const names = [claim.lhs.name, claim.rhs.numerator.name, claim.rhs.denominator.name];
      const namespaces = names.map(name => /^b[1-5]_/.exec(name)?.[0] || '');
      if (new Set(namespaces).size !== 1 || names.some((name, i) => base(name) !== match[i + 1])) return false;
      const refs = pkg.analysis?.claimReferences.find(ref => ref.claimId === claim.id)?.sourceLineIds || [];
      return sameLines(item.sourceLineIds, refs);
    });
    if (!candidates.length) return item;
    return { ...item, claimIds: candidates.map(c => c.id), reason: `Coverage mapping reconciled against exact checked identity candidates with the same numbered source span: ${candidates.map(c => c.id).join(', ')}. The original analysis omitted those links. This is conditional mathematical support under the approved premises; no physical or canonical foundation is established by this mapping repair.` };
  });
}
