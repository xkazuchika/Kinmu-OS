import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { connect, query, end } = vi.hoisted(() => {
  const query = vi.fn();
  const end = vi.fn();
  return { connect: vi.fn(() => Object.assign(query, { end })), query, end };
});

vi.mock("postgres", () => ({ default: connect }));

import { GET } from "@/app/api/health/route";

describe("database readiness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    query.mockResolvedValue([{ ready: 1 }]);
    end.mockResolvedValue(undefined);
  });

  afterEach(() => vi.useRealTimers());

  it("returns uncached success only after the database responds and closes its connection", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
    expect(query).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledWith({ timeout: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns an uncached 503 without disclosing database errors", async () => {
    query.mockRejectedValue(new Error("postgresql://secret:password@private-db/accounting"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(end).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cuts off a stalled connection or query within two seconds and releases it", async () => {
    query.mockImplementation(() => new Promise(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(1_500);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(end).toHaveBeenCalledWith({ timeout: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns 503 for connection construction failure", async () => {
    connect.mockImplementationOnce(() => {
      throw new Error("private configuration");
    });
    expect((await GET()).status).toBe(503);
    expect(end).not.toHaveBeenCalled();
  });
});
