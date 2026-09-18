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

function stubStatus(status: Record<string, unknown>) {
  const manager = {
    getStatus: vi.fn(() => status),
  } as unknown as import("../../../../telegram/manager.js").TelegramManager;
  mockedManager.mockReturnValue(manager);
  return manager;
}

const LOGGED_OUT = {
  transport: "disconnected",
  authorized: false,
  loginStep: "none",
  qr: null,
  user: null,
  passwordHint: null,
  error: null,
};

describe("GET /api/telegram/status", () => {
  it("returns the manager snapshot with serializable keys only", async () => {
    stubStatus({ ...LOGGED_OUT, transport: "connected", authorized: true });
    const res = await GET(authedRequest("http://localhost/api/telegram/status"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["authorized", "error", "loginStep", "passwordHint", "qr", "transport", "user"],
    );
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
  });

  it("never leaks session material", async () => {
    stubStatus({
      ...LOGGED_OUT,
      transport: "connected",
      qr: "tg://login?token=TEST_TOKEN",
      error: null,
    });
    const text = JSON.stringify(await (await GET(authedRequest("http://localhost/api/telegram/status"))).json());
    expect(text).not.toContain("TEST_SESSION");
    expect(text).not.toContain("TEST_API_HASH");
    expect(text).not.toContain("TEST_CODE");
    expect(text).not.toContain("TEST_PASSWORD");
  });
});

describe("GET /api/telegram/status identity", () => {
  it("resolves a different manager per authenticated user", async () => {
    const fakeA = { getStatus: vi.fn(() => ({ authorized: true })) };
    const fakeB = { getStatus: vi.fn(() => ({ authorized: false })) };
    mockedManager.mockImplementation(((userId: string) =>
      (userId === "user-a" ? fakeA : fakeB) as unknown as import("../../../../telegram/manager.js").TelegramManager) as never);
    const resA = await GET(authedRequest("http://localhost/api/telegram/status", undefined, "user-a"));
    const resB = await GET(authedRequest("http://localhost/api/telegram/status", undefined, "user-b"));
    expect(mockedManager).toHaveBeenCalledWith("user-a");
    expect(mockedManager).toHaveBeenCalledWith("user-b");
    expect(await resA.json()).toMatchObject({ authorized: true });
    expect(await resB.json()).toMatchObject({ authorized: false });
  });
});
