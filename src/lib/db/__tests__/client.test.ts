import { describe, expect, it } from "vitest";

import { createDatabaseClient } from "@/lib/db/client";

describe("createDatabaseClient", () => {
  it("creates a closeable, lazy PostgreSQL client", async () => {
    const client = createDatabaseClient("postgresql://kinmu:kinmu@localhost:5432/kinmu_test");

    expect(client.db).toBeDefined();
    await expect(client.close()).resolves.toBeUndefined();
  });
});
