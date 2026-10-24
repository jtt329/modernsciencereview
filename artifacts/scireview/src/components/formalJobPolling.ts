type JobSnapshot = { status: string };
type Timer = ReturnType<typeof setTimeout>;

/** Poll serially until completion, even when the server snapshot is unchanged. */
export function pollFormalJob<T extends JobSnapshot>({
  read,
  onValue,
  onError,
  intervalMs = 2000,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = timer => clearTimeout(timer),
}: {
  read: () => Promise<T>;
  onValue: (value: T) => void;
  onError: (error: unknown) => void;
  intervalMs?: number;
  schedule?: (callback: () => void, delay: number) => Timer;
  cancel?: (timer: Timer) => void;
}): () => void {
  let active = true;
  let timer: Timer | undefined;
  const tick = async () => {
    timer = undefined;
    try {
      const value = await read();
      if (!active) return;
      onValue(value);
      if (value.status !== 'queued' && value.status !== 'running') {
        active = false;
        return;
      }
    } catch (error) {
      if (!active) return;
      onError(error);
    }
    if (active) timer = schedule(tick, intervalMs);
  };
  timer = schedule(tick, intervalMs);
  return () => {
    active = false;
    if (timer !== undefined) cancel(timer);
  };
}
