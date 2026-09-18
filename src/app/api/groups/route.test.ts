import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route.js";
import { getWhatsAppManager } from "../../../lib/whatsapp.js";
import { authedRequest, resetAuthForTests } from "../../../auth/test-utils.js";

vi.mock("../../../lib/whatsapp.js", () => ({
  getWhatsAppManager: vi.fn(),
}));

const mockedManager = vi.mocked(getWhatsAppManager);

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthForTests();
});

describe("GET /api/groups", () => {
  it("returns the serializable group list", async () => {
    const groups = [{ id: "120363423663114428@g.us", name: "Fazendinha", participantCount: 2 }];
    const manager = {
      getGroups: vi.fn(async () => groups),
    } as unknown as import("../../../whatsapp/manager.js").WhatsAppManager;
    mockedManager.mockReturnValue(manager);

    const res = await GET(authedRequest("http://localhost/api/groups"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ groups });
  });

  it("returns 409 when WhatsApp is not connected", async () => {
    const manager = {
      getGroups: vi.fn(async () => {
        throw new Error("WhatsApp client is not connected. Call connect() and wait until status is connected.");
      }),
    } as unknown as import("../../../whatsapp/manager.js").WhatsAppManager;
    mockedManager.mockReturnValue(manager);

    const res = await GET(authedRequest("http://localhost/api/groups"));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("not connected") });
  });
});

describe("GET /api/groups identity", () => {
  it("lists through the requesting user's manager", async () => {
    const fakeA = { getGroups: vi.fn(async () => [{ id: "a" }]) };
    const fakeB = { getGroups: vi.fn(async () => [{ id: "b" }]) };
    mockedManager.mockImplementation(((userId: string) =>
      (userId === "user-a" ? fakeA : fakeB) as unknown as import("../../../whatsapp/manager.js").WhatsAppManager) as never);
    const resB = await GET(authedRequest("http://localhost/api/groups", undefined, "user-b"));
    expect(mockedManager).toHaveBeenCalledWith("user-b");
    expect(await resB.json()).toEqual({ groups: [{ id: "b" }] });
    expect(fakeB.getGroups).toHaveBeenCalledTimes(1);
    expect(fakeA.getGroups).not.toHaveBeenCalled();
  });
});
