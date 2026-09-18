import { describe, it, expect, beforeEach } from "vitest";
import {
  getWhatsAppManager,
  destroyWhatsAppManager,
  __resetManagerForTests,
} from "./whatsapp.js";

beforeEach(() => {
  __resetManagerForTests();
});

describe("getWhatsAppManager registry", () => {
  it("returns the same instance for the same user", () => {
    expect(getWhatsAppManager("user-a")).toBe(getWhatsAppManager("user-a"));
  });

  it("returns different instances for different users", () => {
    const a = getWhatsAppManager("user-a");
    const b = getWhatsAppManager("user-b");
    expect(a).not.toBe(b);
    expect(getWhatsAppManager("user-b")).toBe(b);
  });

  it("rejects anonymous identities instead of falling back", () => {
    expect(() => getWhatsAppManager("")).toThrow("authenticated userId");
    expect(() => getWhatsAppManager(undefined as unknown as string)).toThrow("authenticated userId");
  });

  it("destroying one user leaves the other untouched", async () => {
    const a = getWhatsAppManager("user-a");
    const b = getWhatsAppManager("user-b");
    await destroyWhatsAppManager("user-a");
    expect(getWhatsAppManager("user-a")).not.toBe(a);
    expect(getWhatsAppManager("user-b")).toBe(b);
  });

  it("destroying an unknown user is a no-op", async () => {
    await destroyWhatsAppManager("ghost");
    expect(getWhatsAppManager("user-a")).toBe(getWhatsAppManager("user-a"));
  });

  it("reset drops the whole registry", () => {
    const first = getWhatsAppManager("user-a");
    __resetManagerForTests();
    expect(getWhatsAppManager("user-a")).not.toBe(first);
  });
});

describe("getWhatsAppManager session ownership (M3)", () => {
  it("threads the userId into isolated session scopes", () => {
    const a = getWhatsAppManager("user-a");
    const b = getWhatsAppManager("user-b");
    expect(a.getSessionScope().dataPath).not.toBe(b.getSessionScope().dataPath);
    expect(a.getSessionScope().dataPath).toMatch(/^\.whatsapp_sessions\//);
    expect(a.getSessionScope()).toEqual(a.getSessionScope());
  });

  it("destroying A never touches B's session scope", async () => {
    const b = getWhatsAppManager("user-b");
    const scopeBefore = b.getSessionScope();
    await destroyWhatsAppManager("user-a");
    expect(getWhatsAppManager("user-b").getSessionScope()).toEqual(scopeBefore);
  });
});
