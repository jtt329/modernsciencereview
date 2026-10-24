import type { FormalJob, IngestedSource } from '../../../api-server/src/formal/contract';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type RetainedIntake = { userId: string; sourceId: string; modelId?: 'current' | 'sol' | 'argon'; jobId?: string };
export const validFormalId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const validModelId = (value: unknown): value is 'current' | 'sol' | 'argon' => value === 'current' || value === 'sol' || value === 'argon';
export function queryFormalJobId(search: string): string | null { const id = new URLSearchParams(search).get('job'); return validFormalId(id) ? id : null; }
const sourceKey = (userId: string) => `formal-lab-retained-source:${encodeURIComponent(userId)}`;
const jobKey = (userId: string) => `formal-lab-active-job:${encodeURIComponent(userId)}`;
export function readRetainedIntake(store: Store | null, userId: string): RetainedIntake | null {
  try {
    const raw = store?.getItem(sourceKey(userId));
    if (!raw) return null;
    const item = JSON.parse(raw);
    if (item?.userId !== userId || !validFormalId(item.sourceId) || (item.jobId !== undefined && !validFormalId(item.jobId)) || (item.modelId !== undefined && !validModelId(item.modelId))) { store?.removeItem(sourceKey(userId)); return null; }
    return item;
  } catch { try { store?.removeItem(sourceKey(userId)); } catch {} return null; }
}
export function retainIntake(store: Store | null, userId: string, item: Omit<RetainedIntake, 'userId'>): void {
  if (!validFormalId(item.sourceId) || (item.jobId !== undefined && !validFormalId(item.jobId)) || (item.modelId !== undefined && !validModelId(item.modelId))) return;
  try { store?.setItem(sourceKey(userId), JSON.stringify({ ...item, userId })); } catch { /* Recovery is optional when browser storage is unavailable. */ }
}
export function clearRetainedIntake(store: Store | null, userId: string): void { try { store?.removeItem(sourceKey(userId)); } catch {} }
export function rememberActiveJob(store: Store | null, userId: string, jobId: string): void { if (validFormalId(jobId)) try { store?.setItem(jobKey(userId), jobId); store?.removeItem('formal-lab-active-job'); } catch {} }
export function readActiveJob(store: Store | null, userId: string): string | null { try { const id = store?.getItem(jobKey(userId)) || store?.getItem('formal-lab-active-job'); return validFormalId(id) ? id : null; } catch { return null; } }
export function clearActiveJob(store: Store | null, userId: string): void { try { store?.removeItem(jobKey(userId)); store?.removeItem('formal-lab-active-job'); } catch {} }

/** GETs only. The caller supplies authenticated readers and a workspace-lifetime guard. */
export async function recoverFormalIntake({ reference, activeJobId, readJob, readSource, isCurrent }: {
  reference: RetainedIntake | null;
  activeJobId: string | null;
  readJob: (id: string) => Promise<FormalJob>;
  readSource: (id: string) => Promise<IngestedSource>;
  isCurrent: () => boolean;
}): Promise<{ job: FormalJob | null; source: IngestedSource | null; modelId?: RetainedIntake['modelId']; jobError?: unknown; sourceError?: unknown } | null> {
  let job: FormalJob | null = null;
  let jobError: unknown, sourceError: unknown;
  const jobId = activeJobId || reference?.jobId;
  if (validFormalId(jobId)) try { job = await readJob(jobId); } catch (error) { jobError = error; }
  if (!isCurrent()) return null;
  const sourceId = job?.kind === 'analyze' && validFormalId(job.sourceId) ? job.sourceId : reference?.sourceId;
  let source: IngestedSource | null = null;
  if (validFormalId(sourceId)) try { source = await readSource(sourceId); } catch (error) { sourceError = error; }
  if (!isCurrent()) return null;
  return { job, source, modelId: validModelId(job?.model?.id) ? job.model.id : reference?.modelId, ...(jobError ? { jobError } : {}), ...(sourceError ? { sourceError } : {}) };
}
