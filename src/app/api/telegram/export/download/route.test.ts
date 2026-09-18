import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { GET } from "./route.js";
import {
  setLastTelegramExport,
  __resetLastTelegramExportForTests,
} from "../../../../../lib/telegram-export.js";
import { authedRequest, resetAuthForTests } from "../../../../../auth/test-utils.js";

beforeEach(() => {
  __resetLastTelegramExportForTests();
  resetAuthForTests();
});

afterEach(() => {
  __resetLastTelegramExportForTests();
});

describe("GET /api/telegram/export/download", () => {
  it("returns 404 when nothing was exported", async () => {
    const res = await GET(authedRequest("http://localhost/api/telegram/export/download"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when the file is gone", async () => {
    setLastTelegramExport("test-user", {
      filePath: path.join(os.tmpdir(), "tg-missing.csv"),
      filename: "telegram-Missing.csv",
      groupId: "1",
      groupTitle: "Missing",
      participantCount: 0,
      createdAt: new Date().toISOString(),
    });
    const res = await GET(authedRequest("http://localhost/api/telegram/export/download"));
    expect(res.status).toBe(404);
  });

  const names = ["telegram-Fazendinha.csv", "telegram-Minha Família.csv", "telegram-Família ❤️.csv", "telegram-日本語.csv", "telegram-Grupo 😀.csv"];

  it.each(names)("downloads %s with BOM and safe headers", async (filename) => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tg-dl-"));
    try {
      const filePath = path.join(tmpDir, "out.csv");
      await fs.writeFile(
        filePath,
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("TELEGRAM_ID;NOME\n1;João\n", "utf8")]),
      );
      setLastTelegramExport("test-user", { filePath, filename, groupId: "1", groupTitle: "t", participantCount: 1, createdAt: "t" });

      const res = await GET(authedRequest("http://localhost/api/telegram/export/download"));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/csv");

      const disposition = res.headers.get("Content-Disposition")!;
      // ByteString-safe construction (would throw on raw Unicode)
      expect(() => new Headers({ "Content-Disposition": disposition })).not.toThrow();
      expect(disposition).toMatch(/^attachment; filename="[^"]+"; filename\*=UTF-8''.+$/);
      expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]!)).toBe(filename);

      const bytes = Buffer.from(await res.arrayBuffer());
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
      expect(bytes.toString("utf8")).toContain("João");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
