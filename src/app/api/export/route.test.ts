import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NextRequest } from "next/server";
import { POST } from "./route.js";
import { GET as downloadGET } from "./download/route.js";
import { getWhatsAppManager } from "../../../lib/whatsapp.js";
import { __resetLastExportForTests } from "../../../lib/last-export.js";
import { GroupNotFoundError } from "../../../whatsapp/group.js";
import { authedJsonRequest, authedRequest, resetAuthForTests } from "../../../auth/test-utils.js";

vi.mock("../../../lib/whatsapp.js", () => ({
  getWhatsAppManager: vi.fn(),
}));

const mockedManager = vi.mocked(getWhatsAppManager);

function postRequest(body: unknown): NextRequest {
  return authedJsonRequest("http://localhost/api/export", body);
}

function stubExport(impl: (id: string) => Promise<Record<string, unknown>>) {
  const manager = {
    exportGroupById: vi.fn(impl),
  } as unknown as import("../../../whatsapp/manager.js").WhatsAppManager;
  mockedManager.mockReturnValue(manager);
  return manager;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetLastExportForTests();
});

describe("POST /api/export", () => {
  it("exports via the shared manager and returns result + downloadUrl", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wge-api-"));
    const outputPath = path.join(tmpDir, "Fazendinha.csv");
    await fs.writeFile(outputPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("h", "utf8")]));
    const manager = stubExport(async () => ({
      groupName: "Fazendinha",
      groupId: "120363423663114428@g.us",
      participantCount: 2,
      resolvedCount: 2,
      unresolvedCount: 0,
      outputPath,
    }));

    const res = await POST(postRequest({ groupId: "120363423663114428@g.us" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      groupName: "Fazendinha",
      groupId: "120363423663114428@g.us",
      participantCount: 2,
      downloadUrl: "/api/export/download",
    });
    // serializable: survives a JSON round-trip unchanged
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
    expect(manager.exportGroupById).toHaveBeenCalledTimes(1);
    expect(manager.exportGroupById).toHaveBeenCalledWith("120363423663114428@g.us");

    // the registered file is downloadable byte-for-byte
    const dl = await downloadGET(authedRequest("http://localhost/api/export/download"));
    expect(dl.status).toBe(200);
    expect(dl.headers.get("Content-Type")).toContain("text/csv");
    expect(dl.headers.get("Content-Disposition")).toContain("Fazendinha.csv");
    const bytes = Buffer.from(await dl.arrayBuffer());
    expect(bytes[0]).toBe(0xef);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns 400 for missing groupId", async () => {
    stubExport(async () => ({}));
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("groupId") });
  });

  it("returns 400 for empty groupId", async () => {
    const manager = stubExport(async () => ({}));
    const res = await POST(postRequest({ groupId: "   " }));
    expect(res.status).toBe(400);
    expect(manager.exportGroupById).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown group IDs", async () => {
    stubExport(async (id: string) => {
      throw new GroupNotFoundError(id);
    });
    const res = await POST(postRequest({ groupId: "000@g.us" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("was not found") });
  });

  it("returns 404 for IDs that are not groups", async () => {
    stubExport(async (id: string) => {
      throw new GroupNotFoundError(id);
    });
    const res = await POST(postRequest({ groupId: "999@c.us" }));
    expect(res.status).toBe(404);
  });

  it("returns 409 when WhatsApp is not connected", async () => {
    stubExport(async () => {
      throw new Error("WhatsApp client is not connected. Call connect() first.");
    });
    const res = await POST(postRequest({ groupId: "120363423663114428@g.us" }));
    expect(res.status).toBe(409);
  });
});

describe("GET /api/export/download", () => {
  it("returns 404 when nothing was exported yet", async () => {
    const res = await downloadGET(authedRequest("http://localhost/api/export/download"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/export identity", () => {
  it("exports through the requesting user's manager", async () => {
    const calls: string[] = [];
    mockedManager.mockImplementation(((userId: string) =>
      ({
        exportGroupById: vi.fn(async (groupId: string) => {
          calls.push(`${userId}:${groupId}`);
          return { groupName: "G", groupId, participantCount: 0, resolvedCount: 0, unresolvedCount: 0, outputPath: "o" };
        }),
      }) as unknown as import("../../../whatsapp/manager.js").WhatsAppManager) as never);
    await POST(postRequest({ groupId: "111@g.us" }));
    expect(mockedManager).toHaveBeenCalledWith("test-user");
    expect(calls).toEqual(["test-user:111@g.us"]);
  });
});
