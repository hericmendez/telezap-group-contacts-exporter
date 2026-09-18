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

describe("GET /api/telegram/qr", () => {
  it("returns the pending payload and nothing else", async () => {
    const manager = {
      getQRCode: vi.fn(() => "tg://login?token=TEST_TOKEN"),
    } as unknown as import("../../../../telegram/manager.js").TelegramManager;
    mockedManager.mockReturnValue(manager);
    const res = await GET(authedRequest("http://localhost/api/telegram/qr"));
    const body = await res.json();
    expect(body).toEqual({ qr: "tg://login?token=TEST_TOKEN" });
  });

  it("returns null when no QR is pending", async () => {
    const manager = {
      getQRCode: vi.fn(() => null),
    } as unknown as import("../../../../telegram/manager.js").TelegramManager;
    mockedManager.mockReturnValue(manager);
    expect(await (await GET(authedRequest("http://localhost/api/telegram/qr"))).json()).toEqual({ qr: null });
  });
});
