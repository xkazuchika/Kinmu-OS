import { readFile, rename, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export const REMINDER_INTERVAL_MS = 15 * 60_000;
export type WorkerState = { lastAttempt: string; lastSuccess: string | null; ok: boolean };
export function workerHealthy(state: WorkerState, now = new Date()) {
  const success = state.lastSuccess ? Date.parse(state.lastSuccess) : NaN;
  return (
    state.ok &&
    Number.isFinite(success) &&
    now.getTime() >= success &&
    now.getTime() - success <= 30 * 60_000
  );
}
export async function readWorkerState(path: string): Promise<WorkerState> {
  return JSON.parse(await readFile(path, "utf8")) as WorkerState;
}
export async function runReminderWorker(options: {
  run: () => Promise<{ created: number; failed: number; organizations: number }>;
  path: string;
  once?: boolean;
  signal: AbortSignal;
  now?: () => Date;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: (value: Record<string, unknown>) => void;
}) {
  const now = options.now ?? (() => new Date());
  const wait = options.wait ?? ((ms, signal) => delay(ms, undefined, { signal }));
  let lastSuccess: string | null = null;
  let ok = true;
  do {
    const started = now();
    let counts = { created: 0, failed: 1, organizations: 0 };
    try {
      counts = await options.run();
    } catch {
      /* Only safe status is logged. */
    }
    ok = counts.failed === 0;
    if (ok) lastSuccess = now().toISOString();
    const state: WorkerState = { lastAttempt: started.toISOString(), lastSuccess, ok };
    const temporary = `${options.path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, options.path);
    options.log?.({ event: "action-reminders", ...state, ...counts });
    if (options.once || options.signal.aborted) break;
    try {
      await wait(
        Math.max(0, REMINDER_INTERVAL_MS - (now().getTime() - started.getTime())),
        options.signal,
      );
    } catch (error) {
      if (!options.signal.aborted) throw error;
    }
  } while (!options.signal.aborted);
  return ok;
}
