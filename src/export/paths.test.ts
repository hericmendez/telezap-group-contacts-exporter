import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { exportDirForUser, EXPORTS_ROOT } from "./paths.js";

describe("exportDirForUser", () => {
  it("derives deterministic per-user platform namespaces", () => {
    const a = exportDirForUser("alice", "whatsapp");
    expect(a).toBe(exportDirForUser("alice", "whatsapp"));
    expect(a).toMatch(/^output[/\\][0-9a-f]{64}[/\\]whatsapp$/);
    expect(exportDirForUser("alice", "telegram")).toMatch(/^output[/\\][0-9a-f]{64}[/\\]telegram$/);
  });

  it("separates users and platforms", () => {
    const aWa = exportDirForUser("alice", "whatsapp");
    const bWa = exportDirForUser("bob", "whatsapp");
    const aTg = exportDirForUser("alice", "telegram");
    expect(aWa).not.toBe(bWa);
    expect(aWa).not.toBe(aTg);
    expect(path.resolve(aWa).startsWith(path.resolve(EXPORTS_ROOT) + path.sep)).toBe(true);
  });

  it("neutralizes hostile userIds", () => {
    const seen = new Set<string>();
    for (const hostile of ["../escape", "..", "/", "\\", "a/b", "user with spaces", "unicode-usuário-ç", "x".repeat(500), ""]) {
      const dir = exportDirForUser(hostile === "" ? "" : hostile, "whatsapp");
      expect(path.resolve(dir).startsWith(path.resolve(EXPORTS_ROOT) + path.sep) || path.resolve(dir) === path.resolve(EXPORTS_ROOT)).toBe(true);
      expect(dir).not.toContain("..");
      seen.add(dir);
    }
    // all hostile ids map inside the root; distinct ids stay distinct (except legacy fallback)
    expect(seen.size).toBeGreaterThan(1);
  });

  it("falls back to the legacy shared directory without a userId", () => {
    expect(exportDirForUser(null, "whatsapp")).toBe("output");
    expect(exportDirForUser(undefined, "telegram")).toBe("output");
    expect(exportDirForUser("   ", "whatsapp")).toBe("output");
  });

  it("honors a custom base directory", () => {
    expect(exportDirForUser("alice", "whatsapp", "tmp-out")).toMatch(/^tmp-out[/\\][0-9a-f]{64}[/\\]whatsapp$/);
  });
});
