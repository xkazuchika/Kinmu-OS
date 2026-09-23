import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireActor: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDatabase: () => ({}) }));
vi.mock("@/lib/authorization", async (original) => ({
  ...(await original<typeof import("@/lib/authorization")>()),
  requireActor: mocks.requireActor,
}));
vi.mock("@/lib/attendance-action-center", async (original) => ({
  ...(await original<typeof import("@/lib/attendance-action-center")>()),
  listActionItems: mocks.list,
}));
import { GET } from "@/app/api/action-items/route";
import { AuthorizationError } from "@/lib/authorization";

describe("action item API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActor.mockResolvedValue({
      organizationId: "ours",
      userId: "self",
      role: "employee",
    });
  });
  it("does not cache unauthenticated or forbidden responses", async () => {
    for (const [error, status] of [
      [new AuthorizationError("認証が必要です。"), 401],
      [new AuthorizationError(), 403],
    ] as const) {
      mocks.requireActor.mockRejectedValueOnce(error);
      const response = await GET(new Request("http://localhost/api/action-items"));
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("uses server identity and returns scoped counts without caching", async () => {
    mocks.list.mockResolvedValue({ total: 2, items: [] });
    const response = await GET(
      new Request(
        "http://localhost/api/action-items?organizationId=other&month=2026-09&summary=true",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.list).toHaveBeenCalledWith(
      {},
      { organizationId: "ours", userId: "self", role: "employee" },
      expect.objectContaining({ month: "2026-09" }),
      expect.any(Date),
      true,
    );
    expect(mocks.list.mock.calls[0][2]).not.toHaveProperty("organizationId");
  });
});
