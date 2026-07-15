import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDatabaseClient } from "@/lib/db/client";
import { loadDatabaseUrl } from "@/lib/env";

async function runMigrations() {
  const client = createDatabaseClient(loadDatabaseUrl());

  try {
    await migrate(client.db, { migrationsFolder: "drizzle" });
  } finally {
    await client.close();
  }
}

void runMigrations().catch((error: unknown) => {
  console.error("Database migration failed.", error);
  process.exitCode = 1;
});
