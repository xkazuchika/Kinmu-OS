import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/lib/db/schema";
import { loadEnvironment } from "@/lib/env";

export function createDatabaseClient(connectionString: string) {
  const sql = postgres(connectionString, {
    idle_timeout: 20,
    max: 10,
  });

  return {
    db: drizzle({ client: sql, schema }),
    close: () => sql.end({ timeout: 5 }),
  };
}

export type AppDatabase = ReturnType<typeof createDatabaseClient>["db"];

let databaseClient: ReturnType<typeof createDatabaseClient> | undefined;

export function getDatabase() {
  databaseClient ??= createDatabaseClient(loadEnvironment().databaseUrl);

  return databaseClient.db;
}

export async function closeDatabase() {
  if (!databaseClient) {
    return;
  }

  await databaseClient.close();
  databaseClient = undefined;
}
