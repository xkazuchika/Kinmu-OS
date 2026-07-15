import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkRateLimit, RateLimitError } from "@/lib/rate-limit";
import { proxy } from "@/proxy";

describe("security controls", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a cross-site mutating API request", () => {
    const response = proxy(
      new NextRequest("https://kinmu.example/api/profile", {
        headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
        method: "PATCH",
      }),
    );

    expect(response.status).toBe(403);
  });

  it("adds browser security headers", () => {
    const response = proxy(new NextRequest("https://kinmu.example/login"));

    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("accepts the configured public origin behind a reverse proxy", () => {
    vi.stubEnv("APP_URL", "https://kinmu.example");
    const response = proxy(
      new NextRequest("http://app:3000/api/profile", {
        headers: { origin: "https://kinmu.example", "sec-fetch-site": "same-origin" },
        method: "PATCH",
      }),
    );

    expect(response.status).toBe(200);
  });

  it("limits repeated attempts within a time window", () => {
    const key = `security-test-${crypto.randomUUID()}`;
    checkRateLimit(key, { limit: 1, windowMs: 60_000 });

    expect(() => checkRateLimit(key, { limit: 1, windowMs: 60_000 })).toThrow(RateLimitError);
  });
});
