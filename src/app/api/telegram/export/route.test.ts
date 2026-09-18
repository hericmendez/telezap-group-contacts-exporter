import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route.js";
import { getTelegramManager } from "../../../../lib/telegram.js";
import { getLastTelegramExport, __resetLastTelegramExportForTests } from "../../../../lib/telegram-export.js";
import { getLastExport, __resetLastExportForTests } from "../../../../lib/last-export.js";
import { TelegramGroupNotFoundError } from "../../../../telegram/group.js";
import {
  TelegramFloodError,
  TelegramParticipantsUnavailableError,
} from "../../../../telegram/participants.js";
import { authedJsonRequest, resetAuthForTests } from "../../../../auth/test-utils.js";

vi.mock("../../../../lib/telegram.js", () => ({
  getTelegramManager: vi.fn(),
}));

const mockedManager = vi.mocked(getTelegramManager);

beforeEach(() => {
  vi.clearAllMocks();
  __resetLastTelegramExportForTests();
  __resetLastExportForTests();
});

const RESULT = {
  groupId: "123456789012345678",
  groupTitle: "Example Group",
  participantCount: 2,
  filename: "telegram-Example Group.csv",
  filePath: "output/telegram-Example Group.csv",
};

function postRequest(body: unknown): NextRequest {
  return authedJsonRequest("http://localhost/api/telegram/export", body);
}

function stubExport(impl: (id: string) => Promise<typeof RESULT>) {
  const manager = {
    exportGroupById: vi.fn(impl),
  } as unknown as import("../../../../telegram/manager.js").TelegramManager;
  mockedManager.mockReturnValue(manager);
  return manager;
}

describe("POST /api/telegram/export", () => {
  it("exports by ID and returns safe metadata with downloadUrl", async () => {
    const manager = stubExport(async () => RESULT);
    const res = await POST(postRequest({ groupId: "123456789012345678" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      groupId: "123456789012345678",
      groupTitle: "Example Group",
      participantCount: 2,
      filename: "telegram-Example Group.csv",
      downloadUrl: "/api/telegram/export/download",
    });
    expect(manager.exportGroupById).toHaveBeenCalledWith("123456789012345678", { excludeHiddenPhone: false });
    // slot registered, filePath stripped, WhatsApp slot untouched
    expect(getLastTelegramExport("test-user")).toMatchObject({ filePath: RESULT.filePath, groupId: RESULT.groupId });
    expect(getLastExport("test-user")).toBeNull();
    const text = JSON.stringify(body);
    for (const secret of ["filePath", "accessHash", "TEST_SESSION", "TEST_API_HASH", "TEST_CODE", "TEST_PASSWORD"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("replaces the previous Telegram export", async () => {
    stubExport(async (id: string) => ({ ...RESULT, groupId: id, filename: `telegram-${id}.csv`, filePath: `output/telegram-${id}.csv` }));
    await POST(postRequest({ groupId: "111" }));
    await POST(postRequest({ groupId: "222" }));
    expect(getLastTelegramExport("test-user")).toMatchObject({ groupId: "222" });
  });

  it("returns 400 for missing, empty, and name-only bodies", async () => {
    const manager = stubExport(async () => RESULT);
    for (const body of [{}, { groupId: "   " }, { groupName: "Example Group" }]) {
      const res = await POST(postRequest(body));
      expect(res.status).toBe(400);
    }
    expect(manager.exportGroupById).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown groups", async () => {
    stubExport(async (id: string) => {
      throw new TelegramGroupNotFoundError(id);
    });
    const res = await POST(postRequest({ groupId: "000" }));
    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    stubExport(async () => {
      throw new Error("Telegram authentication is required. Connect and log in first.");
    });
    const res = await POST(postRequest({ groupId: "123456789012345678" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when enumeration is unavailable", async () => {
    stubExport(async () => {
      throw new TelegramParticipantsUnavailableError();
    });
    const res = await POST(postRequest({ groupId: "123456789012345678" }));
    expect(res.status).toBe(403);
  });

  it("returns 429 on FloodWait and 500 on unexpected failures", async () => {
    stubExport(async () => {
      throw new TelegramFloodError(15);
    });
    const flood = await POST(postRequest({ groupId: "123456789012345678" }));
    expect(flood.status).toBe(429);
    expect(await flood.json()).toMatchObject({ error: expect.stringContaining("15s") });

    stubExport(async () => {
      throw new Error("disk on fire");
    });
    const broken = await POST(postRequest({ groupId: "123456789012345678" }));
    expect(broken.status).toBe(500);
    expect(await broken.json()).toEqual({ error: "disk on fire" });
  });

  it("passes excludeHiddenPhone through and rejects non-booleans", async () => {
    const manager = stubExport(async () => RESULT);
    const res = await POST(postRequest({ groupId: "123456789012345678", excludeHiddenPhone: true }));
    expect(res.status).toBe(200);
    expect(manager.exportGroupById).toHaveBeenCalledWith("123456789012345678", { excludeHiddenPhone: true });

    const bad = await POST(postRequest({ groupId: "123456789012345678", excludeHiddenPhone: "yes" }));
    expect(bad.status).toBe(400);
  });

  it("does not register failed exports", async () => {
    stubExport(async () => {
      throw new Error("disk on fire");
    });
    await POST(postRequest({ groupId: "123456789012345678" }));
    expect(getLastTelegramExport("test-user")).toBeNull();
  });
});

describe("POST /api/telegram/export identity", () => {
  it("exports through the requesting user's manager", async () => {
    const calls: string[] = [];
    mockedManager.mockImplementation(((userId: string) =>
      ({
        exportGroupById: vi.fn(async (groupId: string) => {
          calls.push(`${userId}:${groupId}`);
          return { groupId, groupTitle: "T", participantCount: 0, filename: "f", filePath: "p" };
        }),
      }) as unknown as import("../../../../telegram/manager.js").TelegramManager) as never);
    const res = await POST(postRequest({ groupId: "999" }));
    expect(mockedManager).toHaveBeenCalledWith("test-user");
    expect(calls).toEqual(["test-user:999"]);
    expect(res.status).toBe(200);
  });
});
