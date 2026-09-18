import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route.js";
import { getWhatsAppManager } from "../../../../lib/whatsapp.js";
import { authedRequest, resetAuthForTests } from "../../../../auth/test-utils.js";

vi.mock("../../../../lib/whatsapp.js", () => ({
  getWhatsAppManager: vi.fn(),
}));

const mockedManager = vi.mocked(getWhatsAppManager);

function stubManager(status: Record<string, unknown>) {
  const manager = {
    getStatus: vi.fn(() => status),
  } as unknown as import("../../../../whatsapp/manager.js").WhatsAppManager;
  mockedManager.mockReturnValue(manager);
  return manager;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthForTests();
});

describe("GET /api/whatsapp/status", () => {
  it("returns the manager status snapshot", async () => {
    stubManager({ status: "connected", number: "5516993038349", qr: null, error: null });
    const res = await GET(authedRequest("http://localhost/api/whatsapp/status"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "connected",
      number: "5516993038349",
      qr: null,
      error: null,
    });
  });

  it("exposes only serializable values", async () => {
    stubManager({ status: "qr", number: null, qr: "raw-qr", error: null });
    const body = (await (await GET(authedRequest("http://localhost/api/whatsapp/status"))).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["error", "number", "qr", "status"]);
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
  });
});

describe("GET /api/whatsapp/status identity", () => {
  it("resolves a different manager per authenticated user", async () => {
    const fakeA = { getStatus: vi.fn(() => ({ status: "connected" })) };
    const fakeB = { getStatus: vi.fn(() => ({ status: "disconnected" })) };
    mockedManager.mockImplementation(((userId: string) =>
      (userId === "user-a" ? fakeA : fakeB) as unknown as import("../../../../whatsapp/manager.js").WhatsAppManager) as never);
    const resA = await GET(authedRequest("http://localhost/api/whatsapp/status", undefined, "user-a"));
    const resB = await GET(authedRequest("http://localhost/api/whatsapp/status", undefined, "user-b"));
    expect(mockedManager).toHaveBeenCalledWith("user-a");
    expect(mockedManager).toHaveBeenCalledWith("user-b");
    expect(await resA.json()).toMatchObject({ status: "connected" });
    expect(await resB.json()).toMatchObject({ status: "disconnected" });
    expect(fakeA.getStatus).toHaveBeenCalledTimes(1);
    expect(fakeB.getStatus).toHaveBeenCalledTimes(1);
  });
});
