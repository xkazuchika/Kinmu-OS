import { describe, expect, it } from "vitest";

import { EnvironmentValidationError, loadDatabaseUrl, loadEnvironment } from "@/lib/env";

describe("loadEnvironment", () => {
  it("uses local development defaults", () => {
    const environment = loadEnvironment({});

    expect(environment.nodeEnv).toBe("development");
    expect(environment.appUrl.toString()).toBe("http://localhost:3000/");
    expect(environment.appVersion).toBe("0.1.0");
    expect(environment.databaseUrl).toContain("localhost:5432/kinmu");
    expect(environment.sourceCodeUrl.toString()).toBe("https://github.com/xkazuchika/Kinmu-OS");
  });

  it("requires secrets and URLs in production", () => {
    expect(() => loadEnvironment({ NODE_ENV: "production" })).toThrow(EnvironmentValidationError);
  });

  it("uses an isolated database name in the test environment", () => {
    const environment = loadEnvironment({
      NODE_ENV: "test",
      TEST_DATABASE_URL: "postgresql://kinmu:kinmu@localhost:5432/isolated_test",
    });

    expect(environment.databaseUrl).toContain("/isolated_test");
  });

  it("rejects an insufficient production session secret", () => {
    expect(() =>
      loadEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://user:password@db.example.com/kinmu",
        APP_URL: "https://kinmu.example.com",
        SESSION_SECRET: "too-short",
      }),
    ).toThrow("SESSION_SECRET must contain at least 32 characters");
  });

  it("exposes the deployed version and corresponding source URL", () => {
    const environment = loadEnvironment({
      APP_VERSION: "0.1.0-rc.1",
      SOURCE_CODE_URL: "https://github.com/example/kinmu-os/tree/v0.1.0-rc.1",
    });

    expect(environment.appVersion).toBe("0.1.0-rc.1");
    expect(environment.sourceCodeUrl.toString()).toContain("v0.1.0-rc.1");
  });

  it("loads a production database URL without requiring application settings", () => {
    expect(
      loadDatabaseUrl({
        DATABASE_URL: "postgresql://kinmu:secret@db:5432/kinmu",
        NODE_ENV: "production",
      }),
    ).toContain("db:5432/kinmu");
  });
});
