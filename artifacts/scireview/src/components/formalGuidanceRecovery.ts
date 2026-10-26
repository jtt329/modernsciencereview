import type { AuthorSubmissionGuidance } from '../../../api-server/src/formal/contract';
import { normalizeAuthorGuidance, AUTHOR_GUIDANCE_FIELDS, AUTHOR_GUIDANCE_LIMITS } from '../../../api-server/src/formal/authorGuidance';
import { validFormalId } from './formalIntakeRecovery';
export type GuidanceStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const key = (owner: string) => `formal-lab-author-guidance:${encodeURIComponent(owner)}`;
export const guidanceLength = (value: AuthorSubmissionGuidance) => AUTHOR_GUIDANCE_FIELDS.reduce((total, field) => total + (value[field]?.trim().length || 0), 0);
export function guidanceError(value: AuthorSubmissionGuidance): string | null { try { normalizeAuthorGuidance(value); return null; } catch (error) { return error instanceof Error ? error.message : 'Check the optional guidance fields.'; } }
/** One bounded pending entry per account, bound to one uploaded source. No global hints. */
export function rememberAuthorGuidance(store: GuidanceStore | null, owner: string, sourceId: string, value: AuthorSubmissionGuidance) {
  if (!owner || !validFormalId(sourceId)) return;
  try { const guidance = normalizeAuthorGuidance(value); if (!guidance) { store?.removeItem(key(owner)); return; } store?.setItem(key(owner), JSON.stringify({ version: 1, owner, sourceId, guidance })); } catch { /* Oversized or unavailable browser storage never blocks paper submission. */ }
}
export function readAuthorGuidance(store: GuidanceStore | null, owner: string, sourceId: string): AuthorSubmissionGuidance | null {
  try { const raw = store?.getItem(key(owner)); if (!raw) return null; if (raw.length > AUTHOR_GUIDANCE_LIMITS.total * 6 + 2000) throw new Error('Oversized retained guidance'); const record = JSON.parse(raw); if (record?.version !== 1 || record.owner !== owner || !validFormalId(record.sourceId)) throw new Error('Invalid retained guidance'); if (record.sourceId !== sourceId) return null; return normalizeAuthorGuidance(record.guidance) || null; } catch { clearAuthorGuidance(store, owner); return null; }
}
export function clearAuthorGuidance(store: GuidanceStore | null, owner: string) { try { store?.removeItem(key(owner)); } catch { /* Storage is optional. */ } }
