import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route.js";
import { getTelegramManager } from "../../../../lib/telegram.js";
import { authedRequest, resetAuthForTests } from "../../../../auth/test-utils.js";

vi.mock("../../../../lib/telegram.js", () => ({
  getTelegramManager: vi.fn(),
}));

const mockedManager = vi.mocked(getTelegramManager);

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthForTests();
});

const GROUPS = [
  { id: "100", title: "Devs", kind: "supergroup" },
  { id: "200", title: "Family", kind: "group", participantCount: 2 },
];

describe("GET /api/telegram/groups", () => {
  it("returns the group list without internals", async () => {
    const manager = {
      getGroups: vi.fn(async () => GROUPS),
    } as unknown as import("../../../../telegram/manager.js").TelegramManager;
    mockedManager.mockReturnValue(manager);
    const res = await GET(authedRequest("http://localhost/api/telegram/groups"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ groups: GROUPS });
    expect(JSON.stringify(body)).not.toContain("accessHash");
  });

  it("returns 401 when authentication is required", async () => {
    const manager = {
      getGroups: vi.fn(async () => {
        throw new Error("Telegram authentication is required. Connect and log in first.");
      }),
    } as unknown as import("../../../../telegram/manager.js").TelegramManager;
    mockedManager.mockReturnValue(manager);
    const res = await GET(authedRequest("http://localhost/api/telegram/groups"));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/telegram/groups identity", () => {
  it("lists through the requesting user's manager", async () => {
    const fakeA = { getGroups: vi.fn(async () => [{ id: "a" }]) };
    const fakeB = { getGroups: vi.fn(async () => [{ id: "b" }]) };
    mockedManager.mockImplementation(((userId: string) =>
      (userId === "user-a" ? fakeA : fakeB) as unknown as import("../../../../telegram/manager.js").TelegramManager) as never);
    const resA = await GET(authedRequest("http://localhost/api/telegram/groups", undefined, "user-a"));
    expect(mockedManager).toHaveBeenCalledWith("user-a");
    expect(await resA.json()).toEqual({ groups: [{ id: "a" }] });
    expect(fakeA.getGroups).toHaveBeenCalledTimes(1);
    expect(fakeB.getGroups).not.toHaveBeenCalled();
  });
});
