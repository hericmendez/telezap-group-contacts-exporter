import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route.js";
import { getWhatsAppManager } from "../../../../lib/whatsapp.js";
import { authedRequest, resetAuthForTests } from "../../../../auth/test-utils.js";

vi.mock("../../../../lib/whatsapp.js", () => ({
  getWhatsAppManager: vi.fn(),
}));

const mockedManager = vi.mocked(getWhatsAppManager);

function stubManager(status: string) {
  const manager = {
    connect: vi.fn(async () => {}),
    getStatus: vi.fn(() => ({ status, number: null, qr: null, error: null })),
  } as unknown as import("../../../../whatsapp/manager.js").WhatsAppManager;
  mockedManager.mockReturnValue(manager);
  return manager;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthForTests();
});

describe("POST /api/whatsapp/connect", () => {
  it("starts connecting from disconnected without awaiting it", async () => {
    let resolved = false;
    const manager = stubManager("disconnected");
    (manager.connect as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      resolved = true;
    });
    const res = await POST(authedRequest("http://localhost/api/whatsapp/connect", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ started: true });
    expect(manager.connect).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false); // responded before connect finished
  });

  it("does not start a second attempt when already connected", async () => {
    const manager = stubManager("connected");
    const res = await POST(authedRequest("http://localhost/api/whatsapp/connect", { method: "POST" }));
    expect(await res.json()).toMatchObject({ started: false, status: "connected" });
    expect(manager.connect).not.toHaveBeenCalled();
  });

  it("does not duplicate attempts while qr is pending", async () => {
    const manager = stubManager("qr");
    const res = await POST(authedRequest("http://localhost/api/whatsapp/connect", { method: "POST" }));
    expect(await res.json()).toMatchObject({ started: false, status: "qr" });
    expect(manager.connect).not.toHaveBeenCalled();
  });
});

describe("POST /api/whatsapp/connect identity", () => {
  it("connects the requesting user's manager only", async () => {
    const fakeA = {
      connect: vi.fn(async () => {}),
      getStatus: vi.fn(() => ({ status: "disconnected", number: null, qr: null, error: null })),
    };
    const fakeB = {
      connect: vi.fn(async () => {}),
      getStatus: vi.fn(() => ({ status: "disconnected", number: null, qr: null, error: null })),
    };
    mockedManager.mockImplementation(((userId: string) =>
      (userId === "user-a" ? fakeA : fakeB) as unknown as import("../../../../whatsapp/manager.js").WhatsAppManager) as never);
    await POST(authedRequest("http://localhost/api/whatsapp/connect", { method: "POST" }, "user-a"));
    await POST(authedRequest("http://localhost/api/whatsapp/connect", { method: "POST" }, "user-b"));
    expect(mockedManager).toHaveBeenCalledWith("user-a");
    expect(mockedManager).toHaveBeenCalledWith("user-b");
    expect(fakeA.connect).toHaveBeenCalledTimes(1);
    expect(fakeB.connect).toHaveBeenCalledTimes(1);
  });
});
