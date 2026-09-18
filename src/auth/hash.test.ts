import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./hash.js";

describe("scrypt password hashing", () => {
  it("hashes and verifies", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash.startsWith("scrypt.16384.8.1.")).toBe(true);
    expect(hash).not.toContain("$");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong horse", hash)).toBe(false);
  }, 15000);

  it("rejects malformed stored values without throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "plaintext")).toBe(false);
    expect(await verifyPassword("x", "scrypt$bad")).toBe(false);
    expect(await verifyPassword("x", "md5$abc$def")).toBe(false);
  }, 15000);

  it("produces unique salts", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  }, 15000);
});
