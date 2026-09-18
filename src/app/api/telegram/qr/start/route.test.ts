import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route.js";
import { getTelegramManager } from "../../../../../lib/telegram.js";
import { authedRequest, resetAuthForTests } from "../../../../../auth/test-utils.js";

vi.mock("../../../../../lib/telegram.js", () => ({
  getTelegramManager: vi.fn(),
}));

const mockedManager = vi.mocked(getTelegramManager);

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthForTests();
});

const BASE = {
  transport: "connected",
  authorized: false,
  loginStep: "none",
  qr: null,
  user: null,
  passwordHint: null,
  error: null,
};

function stubManager(status: Record<string, unknown>) {
  const manager = {
    startQrLogin: vi.fn(async () => {}),
    getStatus: vi.fn(() => status),
  } as unknown as import("../../../../../telegram/manager.js").TelegramManager;
  mockedManager.mockReturnValue(manager);
  return manager;
}

describe("POST /api/telegram/qr/start", () => {
  it("starts QR login without awaiting the scan", async () => {
    let finished = false;
    const manager = stubManager(BASE);
    (manager.startQrLogin as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      finished = true;
    });
    const res = await POST(authedRequest("http://localhost/api/telegram/qr/start", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ started: true });
    expect(manager.startQrLogin).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
  });

  it("refuses a second attempt while one is pending", async () => {
    const manager = stubManager({ ...BASE, loginStep: "qr_pending", qr: "tg://login?token=x" });
    const res = await POST(authedRequest("http://localhost/api/telegram/qr/start", { method: "POST" }));
    expect(res.status).toBe(409);
    expect(manager.startQrLogin).not.toHaveBeenCalled();
  });

  it("returns 409 when the transport is down", async () => {
    const manager = stubManager({ ...BASE, transport: "disconnected" });
    const res = await POST(authedRequest("http://localhost/api/telegram/qr/start", { method: "POST" }));
    expect(res.status).toBe(409);
    expect(manager.startQrLogin).not.toHaveBeenCalled();
  });

  it("does nothing when already authorized", async () => {
    const manager = stubManager({ ...BASE, authorized: true });
    const res = await POST(authedRequest("http://localhost/api/telegram/qr/start", { method: "POST" }));
    expect(await res.json()).toMatchObject({ started: false });
    expect(manager.startQrLogin).not.toHaveBeenCalled();
  });
});
