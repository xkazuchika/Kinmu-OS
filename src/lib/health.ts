import postgres from "postgres";

import { loadDatabaseUrl } from "@/lib/env";

export async function checkDatabaseHealth(): Promise<boolean> {
  let connection: ReturnType<typeof postgres> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    connection = postgres(loadDatabaseUrl(), { connect_timeout: 1, max: 1, prepare: false });
    await Promise.race([
      connection`SELECT 1`,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Health check timed out.")), 1_500);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    await connection?.end({ timeout: 0 });
  }
}
