import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { GET } from "./route.js";
import {
  setLastExport,
  __resetLastExportForTests,
} from "../../../../lib/last-export.js";
import { authedRequest, resetAuthForTests } from "../../../../auth/test-utils.js";

beforeEach(() => {
  __resetLastExportForTests();
  resetAuthForTests();
});

afterEach(() => {
  __resetLastExportForTests();
});

describe("GET /api/export/download", () => {
  it("returns 404 when nothing was exported", async () => {
    const res = await GET(authedRequest("http://localhost/api/export/download"));
    expect(res.status).toBe(404);
  });

  it("serves unicode filenames with ByteString-safe headers", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wa-dl-"));
    try {
      // The route derives the filename from the file path: use a Unicode
      // group title so the shared Content-Disposition helper is exercised.
      const filePath = path.join(tmpDir, "Família Silva ❤️.csv");
      await fs.writeFile(
        filePath,
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("WHATSAPP_ID;NOME\n1;João\n", "utf8")]),
      );
      setLastExport("test-user", { filePath, groupName: "Família Silva ❤️", createdAt: "t" });

      const res = await GET(authedRequest("http://localhost/api/export/download"));
      expect(res.status).toBe(200);
      const disposition = res.headers.get("Content-Disposition")!;
      expect(() => new Headers({ "Content-Disposition": disposition })).not.toThrow();
      expect(disposition).toMatch(/^attachment; filename="[^"]+"; filename\*=UTF-8''.+$/);
      expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]!)).toBe("Família Silva ❤️.csv");
      const bytes = Buffer.from(await res.arrayBuffer());
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
