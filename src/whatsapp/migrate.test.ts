import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { migrateLegacySession } from "./migrate.js";

let tmpRoot: string;
let legacyPath: string;
let sessionsRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wa-migrate-"));
  legacyPath = path.join(tmpRoot, "legacy");
  sessionsRoot = path.join(tmpRoot, "sessions");
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function seedLegacy(files: Record<string, string>): Promise<void> {
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(legacyPath, ...rel.split("/"));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, contents);
  }
}

async function listAll(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
      else out.push(rel);
    }
  }
  await walk(root, "");
  return out.sort();
}

describe("migrateLegacySession", () => {
  it("reports nothing-to-migrate when no legacy session exists", async () => {
    const result = await migrateLegacySession({ userId: "alice", legacyPath, sessionsRoot });
    expect(result.status).toBe("nothing-to-migrate");
    expect(result.filesCopied).toBe(0);
    expect(result.destinationPath.startsWith(sessionsRoot)).toBe(true);
  });

  it("copies, verifies, preserves the source, and restricts the root", async () => {
    await seedLegacy({ "session/foo": "secret-bytes", "session/nested/bar": "more" });
    const result = await migrateLegacySession({ userId: "alice", legacyPath, sessionsRoot });
    expect(result.status).toBe("migrated");
    expect(result.filesCopied).toBe(2);
    expect(await listAll(result.destinationPath)).toEqual(["session/foo", "session/nested/bar"]);
    // source preserved byte-for-byte
    expect(await fs.readFile(path.join(legacyPath, "session", "foo"), "utf8")).toBe("secret-bytes");
    // destination inside the sessions root, owner-only root on POSIX
    expect(path.resolve(result.destinationPath).startsWith(path.resolve(sessionsRoot) + path.sep)).toBe(true);
    if (process.platform !== "win32") {
      expect((await fs.stat(result.destinationPath)).mode & 0o777).toBe(0o700);
    }
    // report carries paths and counts only — never file contents
    expect(JSON.stringify(result)).not.toContain("secret-bytes");
  });

  it("is idempotent on rerun", async () => {
    await seedLegacy({ "session/foo": "x" });
    const first = await migrateLegacySession({ userId: "alice", legacyPath, sessionsRoot });
    expect(first.status).toBe("migrated");
    const second = await migrateLegacySession({ userId: "alice", legacyPath, sessionsRoot });
    expect(second.status).toBe("already-migrated");
    expect(second.destinationPath).toBe(first.destinationPath);
  });

  it("refuses to overwrite a different destination", async () => {
    await seedLegacy({ "session/foo": "legacy-data" });
    // Pre-seed the real derived destination with unrelated contents.
    const { whatsappSessionScopeForUser } = await import("./client.js");
    const expected = path.join(sessionsRoot, path.basename(whatsappSessionScopeForUser("bob").dataPath));
    await fs.mkdir(path.join(expected, "session"), { recursive: true });
    await fs.writeFile(path.join(expected, "session", "mine"), "mine");
    await expect(migrateLegacySession({ userId: "bob", legacyPath, sessionsRoot })).rejects.toThrow(
      "already exists with different contents",
    );
    // source untouched
    expect(await listAll(legacyPath)).toEqual(["session/foo"]);
  });

  it("refuses ambiguous ownership", async () => {
    await expect(migrateLegacySession({ userId: "", legacyPath, sessionsRoot })).rejects.toThrow(
      "explicit --user",
    );
    await expect(migrateLegacySession({ userId: "   ", legacyPath, sessionsRoot })).rejects.toThrow(
      "explicit --user",
    );
  });

  it("fails safely on unreadable sources", async () => {
    await fs.writeFile(legacyPath, "not-a-directory");
    await expect(migrateLegacySession({ userId: "alice", legacyPath, sessionsRoot })).rejects.toThrow();
  });
});
