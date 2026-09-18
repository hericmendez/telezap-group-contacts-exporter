import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  formatAuthFailureMessage,
  formatDisconnectMessage,
  formatShutdownMessage,
  registerGracefulShutdown,
  hasShutdownHandlersRegistered,
  isShuttingDown,
  __resetShutdownStateForTests,
} from "./client.js";

// Mock client with destroy
function mockClient() {
  return {
    destroy: vi.fn(async () => {}),
    on: vi.fn(),
    once: vi.fn(),
  } as unknown as import("whatsapp-web.js").Client;
}

describe("whatsapp client pure helpers", () => {
  it("formats auth failure message", () => {
    expect(formatAuthFailureMessage("invalid session")).toBe(
      "WhatsApp authentication failed: invalid session",
    );
  });

  it("formats disconnect message", () => {
    expect(formatDisconnectMessage("NAVIGATION")).toBe("WhatsApp disconnected: NAVIGATION");
  });

  it("formats shutdown message", () => {
    expect(formatShutdownMessage("SIGINT")).toBe("Shutdown requested (SIGINT)...");
    expect(formatShutdownMessage("SIGTERM")).toBe("Shutdown requested (SIGTERM)...");
  });
});

describe("shutdown coordination", () => {
  beforeEach(() => {
    __resetShutdownStateForTests();
    // clean up listeners registered by previous tests
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
  });

  it("registers handlers once", () => {
    const client = mockClient();
    expect(hasShutdownHandlersRegistered()).toBe(false);
    registerGracefulShutdown(client as import("whatsapp-web.js").Client);
    expect(hasShutdownHandlersRegistered()).toBe(true);
    const countAfterFirst = process.listenerCount("SIGINT") + process.listenerCount("SIGTERM");
    registerGracefulShutdown(client as import("whatsapp-web.js").Client);
    const countAfterSecond = process.listenerCount("SIGINT") + process.listenerCount("SIGTERM");
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it("isShuttingDown starts false", () => {
    expect(isShuttingDown()).toBe(false);
  });
});

describe("whatsapp session scope", () => {
  it("preserves the legacy scope by default", async () => {
    const { LEGACY_WHATSAPP_SESSION_SCOPE } = await import("./client.js");
    expect(LEGACY_WHATSAPP_SESSION_SCOPE).toEqual({ dataPath: ".wwebjs_auth" });
  });

  it("maps userIds deterministically to filesystem-safe scopes", async () => {
    const { whatsappSessionScopeForUser } = await import("./client.js");
    const a1 = whatsappSessionScopeForUser("alice");
    const a2 = whatsappSessionScopeForUser("alice");
    const b = whatsappSessionScopeForUser("bob");
    expect(a1).toEqual(a2);
    expect(a1.dataPath).not.toBe(b.dataPath);
    expect(a1.clientId).not.toBe(b.clientId);
    expect(a1.dataPath).toMatch(/^\.whatsapp_sessions\/[0-9a-f]{64}$/);
    expect(a1.clientId).toMatch(/^wa-[0-9a-f]{16}$/);
    expect(a1).not.toEqual({ dataPath: ".wwebjs_auth" });
  });

  it("neutralizes hostile userIds (traversal, separators, unicode)", async () => {
    const { whatsappSessionScopeForUser } = await import("./client.js");
    for (const hostile of ["../../etc", "a/b\\c:d", "..", "usuário çã", "a".repeat(500)]) {
      const scope = whatsappSessionScopeForUser(hostile);
      expect(scope.dataPath).toMatch(/^\.whatsapp_sessions\/[0-9a-f]{64}$/);
      expect(scope.dataPath).not.toContain("..");
    }
    // distinct hostile ids still map distinctly
    expect(whatsappSessionScopeForUser("../../etc").dataPath).not.toBe(
      whatsappSessionScopeForUser("..").dataPath,
    );
  });

  it("rejects empty userIds instead of guessing", async () => {
    const { whatsappSessionScopeForUser } = await import("./client.js");
    expect(() => whatsappSessionScopeForUser("")).toThrow("non-empty userId");
    expect(() => whatsappSessionScopeForUser("   ")).toThrow("non-empty userId");
  });

  it("builds LocalAuth with the scope, legacy by default", async () => {
    const { buildClient, LEGACY_WHATSAPP_SESSION_SCOPE } = await import("./client.js");
    const legacy = buildClient();
    const auth = (legacy as unknown as { authStrategy: { dataPath: string; clientId?: string } }).authStrategy;
    expect(auth.dataPath).toContain(".wwebjs_auth");
    expect(auth.clientId).toBeUndefined();

    const scoped = buildClient({ dataPath: ".whatsapp_sessions/abc", clientId: "wa-abc" });
    const scopedAuth = (scoped as unknown as { authStrategy: { dataPath: string; clientId?: string } }).authStrategy;
    expect(scopedAuth.dataPath).toContain(".whatsapp_sessions/abc");
    expect(scopedAuth.clientId).toBe("wa-abc");
    expect(LEGACY_WHATSAPP_SESSION_SCOPE.clientId).toBeUndefined();
    await legacy.destroy().catch(() => {});
    await scoped.destroy().catch(() => {});
  });
});
