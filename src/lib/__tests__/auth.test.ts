import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  cookieValue,
  hashPassword,
  sessionCookie,
  SESSION_COOKIE_NAME,
  validatePassword,
  verifyPassword,
} from "@/lib/auth";

describe("authentication primitives", () => {
  it("uses Argon2id to protect and verify passwords", async () => {
    const password = "a-long-and-unique-passphrase";
    const passwordHash = await hashPassword(password);

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(passwordHash, password)).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, "incorrect-password")).resolves.toBe(false);
  });

  it("requires a minimum password length", () => {
    expect(() => validatePassword("too-short")).toThrow(AuthenticationError);
  });

  it("creates an HttpOnly, same-site session cookie", () => {
    const cookie = sessionCookie("token", new Date(Date.now() + 60_000));

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookieValue(`${SESSION_COOKIE_NAME}=token; other=value`, SESSION_COOKIE_NAME)).toBe(
      "token",
    );
  });

  it("adds Secure only for HTTPS deployments", () => {
    const expiresAt = new Date(Date.now() + 60_000);

    expect(sessionCookie("token", expiresAt, true)).toContain("Secure");
    expect(sessionCookie("token", expiresAt, false)).not.toContain("Secure");
  });
});
