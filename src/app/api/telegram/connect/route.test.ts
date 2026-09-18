import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route.js";
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

function stubManager(status: Record<string, unknown>, connectImpl?: () => Promise<void>) {
  const manager = {
    connect: vi.fn(connectImpl ?? (async () => {})),
    getStatus: vi.fn(() => status),
  } as unknown as import("../../../../telegram/manager.js").TelegramManager;
  mockedManager.mockReturnValue(manager);
  return manager;
}

const DISCONNECTED = {
  transport: "disconnected",
  authorized: false,
  loginStep: "none",
  qr: null,
  user: null,
  passwordHint: null,
  error: null,
};

describe("POST /api/telegram/connect", () => {
  it("starts connecting without awaiting it", async () => {
    let finished = false;
    const manager = stubManager(DISCONNECTED, async () => {
      await new Promise((r) => setTimeout(r, 50));
      finished = true;
    });
    const res = await POST(authedRequest("http://localhost/api/telegram/connect", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ started: true });
    expect(manager.connect).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
  });

  it("does not reconnect when already up", async () => {
    const manager = stubManager({ ...DISCONNECTED, transport: "connected", authorized: true });
    const res = await POST(authedRequest("http://localhost/api/telegram/connect", { method: "POST" }));
    expect(await res.json()).toMatchObject({ started: false });
    expect(manager.connect).not.toHaveBeenCalled();
  });
});

describe("POST /api/telegram/connect identity", () => {
  it("connects the requesting user's manager only", async () => {
    const fakeA = {
      connect: vi.fn(async () => {}),
      getStatus: vi.fn(() => ({ transport: "disconnected", authorized: false, loginStep: "none", qr: null, user: null, passwordHint: null, error: null })),
    };
    const fakeB = {
      connect: vi.fn(async () => {}),
      getStatus: vi.fn(() => ({ transport: "disconnected", authorized: false, loginStep: "none", qr: null, user: null, passwordHint: null, error: null })),
    };
    mockedManager.mockImplementation(((userId: string) =>
      (userId === "user-a" ? fakeA : fakeB) as unknown as import("../../../../telegram/manager.js").TelegramManager) as never);
    await POST(authedRequest("http://localhost/api/telegram/connect", { method: "POST" }, "user-a"));
    expect(mockedManager).toHaveBeenCalledWith("user-a");
    expect(fakeA.connect).toHaveBeenCalledTimes(1);
    expect(fakeB.connect).not.toHaveBeenCalled();
  });
});
