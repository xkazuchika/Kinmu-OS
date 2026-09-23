import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readWorkerState, runReminderWorker, workerHealthy } from "@/lib/reminder-worker";

describe("reminder worker lifecycle", () => {
  it("records failures, recovers and stops promptly on cancellation", async () => {
    const folder = await mkdtemp(join(tmpdir(), "kinmu-worker-"));
    const path = join(folder, "state.json");
    const controller = new AbortController();
    let run = 0;
    const states: unknown[] = [];
    const now = new Date("2026-09-22T00:00:00Z");
    try {
      const ok = await runReminderWorker({
        path,
        signal: controller.signal,
        now: () => now,
        run: async () => {
          run++;
          if (run === 1) throw new Error("secret should not be logged");
          return { created: 2, failed: 0, organizations: 1 };
        },
        log: (state) => states.push(state),
        wait: async () => {
          const state = await readWorkerState(path);
          if (run === 1) expect(workerHealthy(state, now)).toBe(false);
          else controller.abort();
        },
      });
      expect(ok).toBe(true);
      expect(run).toBe(2);
      expect(JSON.stringify(states)).not.toContain("secret");
      const state = await readWorkerState(path);
      expect(workerHealthy(state, now)).toBe(true);
      expect(workerHealthy(state, new Date(now.getTime() + 30 * 60000 + 1))).toBe(false);
      expect(workerHealthy({ ...state, lastSuccess: "invalid" }, now)).toBe(false);
      expect(workerHealthy({ ...state, ok: false }, now)).toBe(false);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
  it("reports a failed single run without waiting", async () => {
    const folder = await mkdtemp(join(tmpdir(), "kinmu-once-"));
    try {
      expect(
        await runReminderWorker({
          path: join(folder, "state"),
          once: true,
          signal: new AbortController().signal,
          run: async () => ({ created: 0, failed: 1, organizations: 0 }),
          wait: async () => {
            throw new Error("must not wait");
          },
        }),
      ).toBe(false);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
