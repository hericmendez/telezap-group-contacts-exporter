import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NextRequest } from "next/server";
import { POST as waExport } from "./export/route.js";
import { GET as waDownload } from "./export/download/route.js";
import { POST as tgExport } from "./telegram/export/route.js";
import { GET as tgDownload } from "./telegram/export/download/route.js";
import { getWhatsAppManager } from "../../lib/whatsapp.js";
import { getTelegramManager } from "../../lib/telegram.js";
import { authedJsonRequest, authedRequest, resetAuthForTests } from "../../auth/test-utils.js";
import {
  __resetLastExportForTests,
} from "../../lib/last-export.js";
import {
  __resetLastTelegramExportForTests,
} from "../../lib/telegram-export.js";

vi.mock("../../lib/whatsapp.js", () => ({
  getWhatsAppManager: vi.fn(),
  destroyWhatsAppManager: vi.fn(),
}));

vi.mock("../../lib/telegram.js", () => ({
  getTelegramManager: vi.fn(),
  destroyTelegramManager: vi.fn(),
}));

const mockedWaManager = vi.mocked(getWhatsAppManager);
const mockedTgManager = vi.mocked(getTelegramManager);

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "xuser-"));
  vi.clearAllMocks();
  resetAuthForTests();
  __resetLastExportForTests();
  __resetLastTelegramExportForTests();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeCsv(filePath: string, marker: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(marker, "utf8")]),
  );
}

function waFakeFor(userId: string) {
  return {
    exportGroupById: vi.fn(async (groupId: string) => {
      const filePath = path.join(tmpDir, `${userId}-wa.csv`);
      await writeCsv(filePath, `WA:${userId}:${groupId}`);
      return {
        groupName: "G",
        groupId,
        participantCount: 1,
        resolvedCount: 1,
        unresolvedCount: 0,
        outputPath: filePath,
      };
    }),
  } as unknown as import("../../whatsapp/manager.js").WhatsAppManager;
}

function tgFakeFor(userId: string) {
  return {
    exportGroupById: vi.fn(async (groupId: string) => {
      const filePath = path.join(tmpDir, `${userId}-tg.csv`);
      await writeCsv(filePath, `TG:${userId}:${groupId}`);
      return {
        groupId,
        groupTitle: "T",
        participantCount: 1,
        filename: `${userId}-tg.csv`,
        filePath,
      };
    }),
  } as unknown as import("../../telegram/manager.js").TelegramManager;
}

function waPost(body: unknown, userId: string): NextRequest {
  return authedJsonRequest("http://localhost/api/export", body, userId);
}

function tgPost(body: unknown, userId: string): NextRequest {
  return authedJsonRequest("http://localhost/api/telegram/export", body, userId);
}

async function bodyBytes(res: Response): Promise<string> {
  return Buffer.from(await res.arrayBuffer()).toString("utf8");
}

describe("cross-user export/download isolation", () => {
  beforeEach(() => {
    mockedWaManager.mockImplementation(((userId: string) => waFakeFor(userId)) as never);
    mockedTgManager.mockImplementation(((userId: string) => tgFakeFor(userId)) as never);
  });

  it("Case 1/2/3: A and B exports never cross on either platform", async () => {
    expect((await waExport(waPost({ groupId: "g1" }, "alice"))).status).toBe(200);
    expect((await waExport(waPost({ groupId: "g1" }, "bob"))).status).toBe(200);
    expect((await tgExport(tgPost({ groupId: "t1" }, "alice"))).status).toBe(200);
    expect((await tgExport(tgPost({ groupId: "t1" }, "bob"))).status).toBe(200);

    const dlCases = [
      [waDownload, "http://localhost/api/export/download", "alice", "WA:alice:g1"],
      [waDownload, "http://localhost/api/export/download", "bob", "WA:bob:g1"],
      [tgDownload, "http://localhost/api/telegram/export/download", "alice", "TG:alice:t1"],
      [tgDownload, "http://localhost/api/telegram/export/download", "bob", "TG:bob:t1"],
    ] as const;
    for (const [handler, url, userId, marker] of dlCases) {
      const res = await handler(authedRequest(url, undefined, userId));
      expect(res.status).toBe(200);
      expect(await bodyBytes(res)).toContain(marker);
    }
  });

  it("Case 5: same user keeps WhatsApp and Telegram exports independent", async () => {
    expect((await waExport(waPost({ groupId: "g1" }, "alice"))).status).toBe(200);
    expect((await tgExport(tgPost({ groupId: "t1" }, "alice"))).status).toBe(200);
    const wa = await waDownload(authedRequest("http://localhost/api/export/download", undefined, "alice"));
    const tg = await tgDownload(
      authedRequest("http://localhost/api/telegram/export/download", undefined, "alice"),
    );
    expect(await bodyBytes(wa)).toContain("WA:alice:g1");
    expect(await bodyBytes(tg)).toContain("TG:alice:t1");
  });

  it("Case 6: failed export preserves the previous valid slot", async () => {
    expect((await waExport(waPost({ groupId: "g1" }, "alice"))).status).toBe(200);
    mockedWaManager.mockImplementation(((userId: string) => ({
      exportGroupById: vi.fn(async () => {
        throw new Error("boom");
      }),
    })) as never);
    const failed = await waExport(waPost({ groupId: "g2" }, "alice"));
    expect(failed.status).toBe(500);
    const dl = await waDownload(authedRequest("http://localhost/api/export/download", undefined, "alice"));
    expect(dl.status).toBe(200);
    expect(await bodyBytes(dl)).toContain("WA:alice:g1");
  });

  it("Case 7: user without export gets a controlled 404 with no leak", async () => {
    expect((await waExport(waPost({ groupId: "g1" }, "alice"))).status).toBe(200);
    for (const [handler, url] of [
      [waDownload, "http://localhost/api/export/download"],
      [tgDownload, "http://localhost/api/telegram/export/download"],
    ] as const) {
      const res = await handler(authedRequest(url, undefined, "carol"));
      expect(res.status).toBe(404);
      const text = JSON.stringify(await res.json());
      expect(text).not.toMatch(/output|tmp|home|Error|at /);
    }
  });
});
