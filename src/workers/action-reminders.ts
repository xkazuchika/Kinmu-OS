import { runActionReminders } from "@/lib/action-reminders";
import { createDatabaseClient } from "@/lib/db/client";
import { loadDatabaseUrl } from "@/lib/env";
import { readWorkerState, runReminderWorker, workerHealthy } from "@/lib/reminder-worker";

async function main() {
  const path = process.env.REMINDER_STATE_PATH ?? "/tmp/kinmu-action-reminders.json";
  if (process.argv.includes("--health")) {
    process.exitCode = workerHealthy(await readWorkerState(path)) ? 0 : 1;
    return;
  }
  const client = createDatabaseClient(loadDatabaseUrl());
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    const ok = await runReminderWorker({
      run: () => runActionReminders(client.db),
      path,
      once: process.argv.includes("--once"),
      signal: controller.signal,
      log: (value) => console.log(JSON.stringify(value)),
    });
    if (!ok) process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await client.close();
  }
}
void main().catch(() => {
  console.error("Action reminder worker failed.");
  process.exitCode = 1;
});
