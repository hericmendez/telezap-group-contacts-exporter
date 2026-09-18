import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { migrateTelegramSession } from "./migrate.js";

let tmpRoot: string;
let legacyPath: string;
let sessionsRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tg-migrate-"));
  legacyPath = path.join(tmpRoot, "legacy-session");
  sessionsRoot = path.join(tmpRoot, "sessions");
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("migrateTelegramSession", () => {
  it("reports nothing-to-migrate when no legacy session exists", async () => {
    const result = await migrateTelegramSession({ userId: "alice", legacyPath, sessionsRoot });
    expect(result.status).toBe("nothing-to-migrate");
    expect(result.destinationPath.startsWith(sessionsRoot)).toBe(true);
  });

  it("copies, verifies, preserves the source, and restricts permissions", async () => {
    await fs.writeFile(legacyPath, "opaque-session-bytes");
    const result = await migrateTelegramSession({ userId: "alice", legacyPath, sessionsRoot });
    expect(result.status).toBe("migrated");
    expect(await fs.readFile(result.destinationPath, "utf8")).toBe("opaque-session-bytes");
    // source preserved byte-for-byte
    expect(await fs.readFile(legacyPath, "utf8")).toBe("opaque-session-bytes");
    expect(path.resolve(result.destinationPath).startsWith(path.resolve(sessionsRoot) + path.sep)).toBe(true);
    if (process.platform !== "win32") {
      expect((await fs.stat(result.destinationPath)).mode & 0o777).toBe(0o600);
    }
    // report carries paths only — never session contents
    expect(JSON.stringify(result)).not.toContain("opaque-session-bytes");
  });

  it("treats empty legacy files as nothing to migrate", async () => {
    await fs.writeFile(legacyPath, "   ");
    const result = await migrateTelegramSession({ userId: "alice", legacyPath, sessionsRoot });
    // whitespace-only content is not a session; destination untouched
    expect(result.status).toBe("nothing-to-migrate");
  });

  it("is idempotent on rerun", async () => {
    await fs.writeFile(legacyPath, "opaque-session-bytes");
    const first = await migrateTelegramSession({ userId: "alice", legacyPath, sessionsRoot });
    expect(first.status).toBe("migrated");
    const second = await migrateTelegramSession({ userId: "alice", legacyPath, sessionsRoot });
    expect(second.status).toBe("already-migrated");
    expect(second.destinationPath).toBe(first.destinationPath);
  });

  it("refuses to overwrite a different destination", async () => {
    await fs.writeFile(legacyPath, "legacy-bytes");
    // Pre-seed the real derived destination with unrelated contents.
    const { telegramSessionScopeForUser } = await import("./session.js");
    const dest = path.dirname(path.resolve(sessionsRoot, telegramSessionScopeForUser("bob", sessionsRoot).filePath));
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, "session"), "user-bytes");
    await expect(migrateTelegramSession({ userId: "bob", legacyPath, sessionsRoot })).rejects.toThrow(
      "already exists with different contents",
    );
    // source untouched
    expect(await fs.readFile(legacyPath, "utf8")).toBe("legacy-bytes");
  });

  it("refuses ambiguous ownership", async () => {
    await expect(migrateTelegramSession({ userId: "", legacyPath, sessionsRoot })).rejects.toThrow(
      "explicit --user",
    );
    await expect(migrateTelegramSession({ userId: "   ", legacyPath, sessionsRoot })).rejects.toThrow(
      "explicit --user",
    );
  });

  it("fails safely on unreadable destinations", async () => {
    await fs.writeFile(legacyPath, "opaque-session-bytes");
    // a file where the sessions root should be makes mkdir fail
    await fs.writeFile(sessionsRoot, "blocker");
    await expect(migrateTelegramSession({ userId: "alice", legacyPath, sessionsRoot })).rejects.toThrow();
    expect(await fs.readFile(legacyPath, "utf8")).toBe("opaque-session-bytes");
  });
});
