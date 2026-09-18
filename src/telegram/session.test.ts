import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadTelegramSession, saveTelegramSession, clearTelegramSession } from "./session.js";

let tmpDir: string;
let filePath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tg-sess-"));
  filePath = path.join(tmpDir, "sess");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("telegram session file", () => {
  it("returns null when no session exists", async () => {
    expect(await loadTelegramSession(filePath)).toBeNull();
  });

  it("round-trips the session with owner-only permissions", async () => {
    await saveTelegramSession("opaque-session", filePath);
    expect(await loadTelegramSession(filePath)).toBe("opaque-session");
    const stat = await fs.stat(filePath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("clears the session idempotently", async () => {
    await saveTelegramSession("x", filePath);
    await clearTelegramSession(filePath);
    expect(await loadTelegramSession(filePath)).toBeNull();
    await clearTelegramSession(filePath);
  });
});

describe("telegram session scope", () => {
  it("derives deterministic, distinct, filesystem-safe paths", async () => {
    const { telegramSessionScopeForUser, TELEGRAM_SESSIONS_ROOT } = await import("./session.js");
    const a1 = telegramSessionScopeForUser("alice");
    const a2 = telegramSessionScopeForUser("alice");
    const b = telegramSessionScopeForUser("bob");
    expect(a1).toEqual(a2);
    expect(a1.filePath).not.toBe(b.filePath);
    expect(a1.filePath).toMatch(/^\.telegram_sessions\/[0-9a-f]{64}\/session$/);
    expect(TELEGRAM_SESSIONS_ROOT).toBe(".telegram_sessions");
  });

  it("neutralizes hostile userIds without collisions", async () => {
    const { telegramSessionScopeForUser } = await import("./session.js");
    const seen = new Set<string>();
    for (const hostile of ["../escape", "a/b", "a\\b", "user with spaces", "unicode-usuário-ç", "x".repeat(500), ".", ".."]) {
      const scope = telegramSessionScopeForUser(hostile);
      expect(scope.filePath).toMatch(/^\.telegram_sessions\/[0-9a-f]{64}\/session$/);
      expect(scope.filePath).not.toContain("..");
      seen.add(scope.filePath);
    }
    expect(seen.size).toBe(8);
  });

  it("rejects empty identities instead of falling back", async () => {
    const { telegramSessionScopeForUser } = await import("./session.js");
    expect(() => telegramSessionScopeForUser("")).toThrow("non-empty userId");
    expect(() => telegramSessionScopeForUser("   ")).toThrow("non-empty userId");
  });

  it("accepts a custom root for tests without touching the default", async () => {
    const { telegramSessionScopeForUser } = await import("./session.js");
    const scoped = telegramSessionScopeForUser("alice", tmpDir);
    expect(scoped.filePath.startsWith(tmpDir)).toBe(true);
    expect(scoped.filePath).toMatch(/\/[0-9a-f]{64}\/session$/);
  });
});
