import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route.js";
import { getWhatsAppManager } from "../../../../lib/whatsapp.js";
import { authedRequest, resetAuthForTests } from "../../../../auth/test-utils.js";

vi.mock("../../../../lib/whatsapp.js", () => ({
  getWhatsAppManager: vi.fn(),
}));

const mockedManager = vi.mocked(getWhatsAppManager);

function stubManager(qr: string | null) {
  const manager = {
    getQRCode: vi.fn(() => qr),
  } as unknown as import("../../../../whatsapp/manager.js").WhatsAppManager;
  mockedManager.mockReturnValue(manager);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthForTests();
});

describe("GET /api/whatsapp/qr", () => {
  it("returns the raw QR string", async () => {
    stubManager("raw-qr-content");
    const res = await GET(authedRequest("http://localhost/api/whatsapp/qr"));
    expect(await res.json()).toEqual({ qr: "raw-qr-content" });
  });

  it("returns null when no QR is pending", async () => {
    stubManager(null);
    const res = await GET(authedRequest("http://localhost/api/whatsapp/qr"));
    expect(await res.json()).toEqual({ qr: null });
  });
});
