import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Client } from "whatsapp-web.js";
import { WhatsAppManager } from "./manager.js";

// ── Fake client (no WhatsApp, no network, no session) ───────────────────────

class FakeClient extends EventEmitter {
  info: { wid?: { user?: string; _serialized?: string } } | undefined = undefined;
  initialize = vi.fn(async (): Promise<void> => {});
  destroy = vi.fn(async (): Promise<void> => {});
  getChats = vi.fn(async (): Promise<unknown[]> => []);
  getChatById = vi.fn(async (_id: string): Promise<unknown> => {
    throw new Error("getChatById not stubbed");
  });
  getContactById = vi.fn(async (_id: string): Promise<unknown> => {
    throw new Error("getContactById not stubbed");
  });
}

function setup() {
  const fake = new FakeClient();
  const factory = vi.fn(() => fake as unknown as Client);
  const manager = new WhatsAppManager({ showQrInTerminal: false, clientFactory: factory });
  return { fake, factory, manager };
}

/** Drive a fresh manager to `connected` with a stubbed number. */
async function connectFake(
  manager: WhatsAppManager,
  fake: FakeClient,
  number = "5511999999999",
): Promise<void> {
  const promise = manager.connect();
  fake.info = { wid: { user: number, _serialized: `${number}@c.us` } };
  fake.emit("authenticated");
  fake.emit("ready");
  await promise;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── State ───────────────────────────────────────────────────────────────────

describe("WhatsAppManager initial state", () => {
  it("starts disconnected with no QR, number, or error", () => {
    const { manager } = setup();
    expect(manager.getStatus()).toEqual({
      status: "disconnected",
      number: null,
      qr: null,
      error: null,
    });
    expect(manager.getQRCode()).toBeNull();
    expect(manager.getConnectedNumber()).toBeNull();
    expect(manager.getLastError()).toBeNull();
  });
});

// ── Connect / concurrency ───────────────────────────────────────────────────

describe("WhatsAppManager connect", () => {
  it("creates and initializes exactly one client", async () => {
    const { fake, factory, manager } = setup();
    const promise = manager.connect();
    fake.emit("ready");
    await promise;
    expect(factory).toHaveBeenCalledTimes(1);
    expect(fake.initialize).toHaveBeenCalledTimes(1);
    expect(manager.getStatus().status).toBe("connected");
  });

  it("concurrent connect() calls share a single initialization", async () => {
    const { fake, factory, manager } = setup();
    const p1 = manager.connect();
    const p2 = manager.connect();
    const p3 = manager.connect();
    fake.emit("ready");
    await Promise.all([p1, p2, p3]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(fake.initialize).toHaveBeenCalledTimes(1);
  });

  it("connect() is a no-op when already connected", async () => {
    const { fake, factory, manager } = setup();
    await connectFake(manager, fake);
    await manager.connect();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(fake.initialize).toHaveBeenCalledTimes(1);
  });

  it("surfaces initialization failures instead of hanging", async () => {
    const { fake, manager } = setup();
    fake.initialize.mockRejectedValueOnce(new Error("browser exploded"));
    await expect(manager.connect()).rejects.toThrow(
      "Failed to initialize WhatsApp client: browser exploded",
    );
    expect(manager.getStatus().status).toBe("disconnected");
    expect(manager.getLastError()).toContain("browser exploded");
  });
});

// ── QR ──────────────────────────────────────────────────────────────────────

describe("WhatsAppManager QR handling", () => {
  it("stores raw QR content and exposes it via getQRCode()/getStatus()", async () => {
    const { fake, manager } = setup();
    const promise = manager.connect();
    expect(manager.getStatus().status).toBe("connecting");
    fake.emit("qr", "raw-qr-string");
    expect(manager.getQRCode()).toBe("raw-qr-string");
    expect(manager.getStatus()).toMatchObject({ status: "qr", qr: "raw-qr-string" });
    fake.emit("ready");
    await promise;
  });

  it("clears the QR once connected", async () => {
    const { fake, manager } = setup();
    await connectFake(manager, fake);
    // qr emitted pre-auth then cleared by authenticated/ready
    expect(manager.getQRCode()).toBeNull();
    expect(manager.getStatus().qr).toBeNull();
  });

  it("clears a stale QR on authenticated (before ready)", () => {
    const { fake, manager } = setup();
    void manager.connect().catch(() => {});
    fake.emit("qr", "stale-qr");
    expect(manager.getQRCode()).toBe("stale-qr");
    fake.emit("authenticated");
    expect(manager.getQRCode()).toBeNull();
    expect(manager.getStatus().status).toBe("connecting");
    fake.emit("ready");
  });
});

// ── Ready / number ──────────────────────────────────────────────────────────

describe("WhatsAppManager ready and number", () => {
  it("transitions to connected on ready", async () => {
    const { fake, manager } = setup();
    const promise = manager.connect();
    fake.emit("ready");
    await promise;
    expect(manager.getStatus().status).toBe("connected");
  });

  it("returns the library-provided wid.user number when connected", async () => {
    const { fake, manager } = setup();
    await connectFake(manager, fake, "5516993038349");
    expect(manager.getConnectedNumber()).toBe("5516993038349");
    expect(manager.getStatus()).toMatchObject({
      status: "connected",
      number: "5516993038349",
    });
  });

  it("returns null number when the library exposes no wid", async () => {
    const { fake, manager } = setup();
    const promise = manager.connect();
    fake.info = undefined;
    fake.emit("ready");
    await promise;
    expect(manager.getConnectedNumber()).toBeNull();
    expect(manager.getStatus().number).toBeNull();
  });

  it("getStatus() exposes only plain values, never library objects", async () => {
    const { fake, manager } = setup();
    await connectFake(manager, fake);
    const status = manager.getStatus();
    expect(Object.keys(status).sort()).toEqual(["error", "number", "qr", "status"]);
    expect(typeof status.status).toBe("string");
  });
});

// ── Auth failure ────────────────────────────────────────────────────────────

describe("WhatsAppManager auth failure", () => {
  it("rejects connect() and records the error visibly", async () => {
    const { manager, fake } = setup();
    const promise = manager.connect();
    // attach rejection handler timing-safe: emit after listener registration
    const assertion = expect(promise).rejects.toThrow(
      "WhatsApp authentication failed: bad session",
    );
    fake.emit("auth_failure", "bad session");
    await assertion;
    expect(manager.getStatus().status).toBe("auth_failed");
    expect(manager.getStatus().error).toBe("WhatsApp authentication failed: bad session");
    expect(manager.getLastError()).toBe("WhatsApp authentication failed: bad session");
    expect(manager.getQRCode()).toBeNull();
  });

  it("allows reconnecting after an auth failure with a fresh client", async () => {
    const { fake, factory, manager } = setup();
    const first = manager.connect();
    const firstAssertion = expect(first).rejects.toThrow("WhatsApp authentication failed");
    fake.emit("auth_failure", "expired");
    await firstAssertion;

    const secondFake = new FakeClient();
    factory.mockReturnValueOnce(secondFake as unknown as Client);
    const second = manager.connect();
    // the reconnect path awaits stale-client teardown before wiring the new
    // client — wait until the fresh client exists before emitting `ready`.
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
    secondFake.emit("ready");
    await second;
    expect(manager.getStatus().status).toBe("connected");
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

// ── Disconnect ──────────────────────────────────────────────────────────────

describe("WhatsAppManager disconnect", () => {
  it("returns to disconnected and destroys the client once", async () => {
    const { fake, manager } = setup();
    await connectFake(manager, fake);
    await manager.disconnect();
    expect(manager.getStatus().status).toBe("disconnected");
    expect(manager.getConnectedNumber()).toBeNull();
    expect(fake.destroy).toHaveBeenCalledTimes(1);
    // idempotent
    await manager.disconnect();
    expect(fake.destroy).toHaveBeenCalledTimes(1);
  });

  it("disconnects cleanly when never connected", async () => {
    const { manager } = setup();
    await manager.disconnect();
    expect(manager.getStatus().status).toBe("disconnected");
  });

  it("handles the library disconnected event", async () => {
    const { fake, manager } = setup();
    await connectFake(manager, fake);
    fake.emit("disconnected", "NAVIGATION");
    expect(manager.getStatus().status).toBe("disconnected");
    expect(manager.getStatus().error).toBe("WhatsApp disconnected: NAVIGATION");
    expect(manager.getConnectedNumber()).toBeNull();
  });
});

// ── Groups / export ─────────────────────────────────────────────────────────

function stubGroupFlow(fake: FakeClient) {
  fake.getChats.mockResolvedValue([
    {
      id: { _serialized: "120363025@g.us" },
      name: "Família Silva",
      isGroup: true,
      participants: [{}, {}],
    },
    { id: "999@c.us", name: "Direct Chat", isGroup: false },
  ]);
  fake.getChatById.mockImplementation(async (id: string) => {
    expect(id).toBe("120363025@g.us");
    return {
      id: { _serialized: "120363025@g.us" },
      name: "Família Silva",
      isGroup: true,
      participants: [
        { id: { _serialized: "5511999999999@c.us" }, isAdmin: true, isSuperAdmin: false },
        { id: { _serialized: "123456789@lid" }, isAdmin: false, isSuperAdmin: false },
      ],
    };
  });
  fake.getContactById.mockImplementation(async (id: string) => {
    if (id === "5511999999999@c.us") {
      return { name: "João Silva", pushname: "João", number: "5511999999999" };
    }
    throw new Error("unknown contact");
  });
}

describe("WhatsAppManager groups and export", () => {
  it("getGroups() requires a connection", async () => {
    const { manager } = setup();
    await expect(manager.getGroups()).rejects.toThrow("not connected");
  });

  it("lists groups once connected", async () => {
    const { fake, manager } = setup();
    stubGroupFlow(fake);
    await connectFake(manager, fake);
    const groups = await manager.getGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: "120363025@g.us", name: "Família Silva" });
  });

  it("exportGroup() refuses when disconnected", async () => {
    const { manager } = setup();
    await expect(manager.exportGroup("Família Silva")).rejects.toThrow("not connected");
  });

  it("exportGroup() runs the full pipeline, keeps the client alive, returns a result", async () => {
    const { fake, manager } = setup();
    stubGroupFlow(fake);
    await connectFake(manager, fake);

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wge-test-"));
    const outputPath = path.join(tmpDir, "familia.csv");

    const result = await manager.exportGroup("Família Silva", { outputFile: outputPath });

    expect(result).toEqual({
      groupName: "Família Silva",
      groupId: "120363025@g.us",
      participantCount: 2,
      resolvedCount: 1,
      unresolvedCount: 1,
      outputPath,
    });

    // CSV was written with BOM + header + 2 rows
    const raw = await fs.promises.readFile(outputPath);
    expect(raw[0]).toBe(0xef);
    expect(raw[1]).toBe(0xbb);
    expect(raw[2]).toBe(0xbf);
    const text = raw.toString("utf8");
    expect(text).toContain("WHATSAPP_ID;NOME;NOME_WHATSAPP;NUMERO;ADMIN;SUPER_ADMIN");
    expect(text).toContain("João Silva");
    expect(text).toContain("123456789@lid");

    // client was NOT destroyed — it stays alive for reuse
    expect(fake.destroy).not.toHaveBeenCalled();
    expect(manager.getStatus().status).toBe("connected");

    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("exportGroup() rejects unknown groups without touching the client", async () => {
    const { fake, manager } = setup();
    stubGroupFlow(fake);
    await connectFake(manager, fake);
    await expect(manager.exportGroup("Nope")).rejects.toThrow('Group "Nope" was not found.');
    expect(fake.destroy).not.toHaveBeenCalled();
  });

  it("exportGroup() derives the default output path from the group name", async () => {
    const { fake, manager } = setup();
    stubGroupFlow(fake);
    await connectFake(manager, fake);
    const tmpCwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wge-cwd-"));
    const previousCwd = process.cwd();
    process.chdir(tmpCwd);
    try {
      const result = await manager.exportGroup("Família Silva");
      expect(result.outputPath).toBe(path.join("output", "Família Silva.csv"));
      const exists = await fs.promises
        .access(path.join(tmpCwd, result.outputPath))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    } finally {
      process.chdir(previousCwd);
      await fs.promises.rm(tmpCwd, { recursive: true, force: true });
    }
    expect(fake.destroy).not.toHaveBeenCalled();
  });
});

describe("WhatsAppManager exportGroupById", () => {
  it("refuses when disconnected", async () => {
    const { manager } = setup();
    await expect(manager.exportGroupById("120363025@g.us")).rejects.toThrow("not connected");
  });

  it("exports by opaque ID, passes it intact, keeps the client alive", async () => {
    const { fake, manager } = setup();
    stubGroupFlow(fake);
    await connectFake(manager, fake);

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wge-test-"));
    const outputPath = path.join(tmpDir, "familia.csv");

    const result = await manager.exportGroupById("120363025@g.us", { outputFile: outputPath });

    expect(result).toEqual({
      groupName: "Família Silva",
      groupId: "120363025@g.us",
      participantCount: 2,
      resolvedCount: 1,
      unresolvedCount: 1,
      outputPath,
    });

    // the opaque ID reached the library untouched (no parsing, no rebuild)
    for (const call of fake.getChatById.mock.calls) {
      expect(call[0]).toBe("120363025@g.us");
    }
    expect(fake.destroy).not.toHaveBeenCalled();
    expect(manager.getStatus().status).toBe("connected");

    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("rejects unknown IDs without leaking internals", async () => {
    const { fake, manager } = setup();
    stubGroupFlow(fake);
    await connectFake(manager, fake);
    fake.getChatById.mockRejectedValueOnce(new Error("ProtocolError: bad session"));
    await expect(manager.exportGroupById("000@g.us")).rejects.toThrow('Group "000@g.us" was not found.');
    expect(fake.destroy).not.toHaveBeenCalled();
  });

  it("rejects chats that are not groups", async () => {
    const { fake, manager } = setup();
    stubGroupFlow(fake);
    await connectFake(manager, fake);
    fake.getChatById.mockResolvedValueOnce({
      id: { _serialized: "999@c.us" },
      name: "Direct Chat",
      isGroup: false,
    });
    await expect(manager.exportGroupById("999@c.us")).rejects.toThrow('Group "999@c.us" was not found.');
    expect(fake.destroy).not.toHaveBeenCalled();
  });

  it("rejects empty IDs", async () => {
    const { fake, manager } = setup();
    stubGroupFlow(fake);
    await connectFake(manager, fake);
    await expect(manager.exportGroupById("   ")).rejects.toThrow("was not found");
    expect(fake.getChatById).not.toHaveBeenCalled();
  });
});

describe("WhatsAppManager live-session slot (removed in M3)", () => {
  it("no longer refuses concurrent connections: isolation is per session scope", async () => {
    const first = setup();
    const second = setup();
    const promiseA = first.manager.connect();
    const promiseB = second.manager.connect();
    first.fake.emit("ready");
    second.fake.emit("ready");
    await Promise.all([promiseA, promiseB]);
    expect(first.manager.getStatus().status).toBe("connected");
    expect(second.manager.getStatus().status).toBe("connected");
  });

  it("failed connects still allow retry", async () => {
    const first = setup();
    await connectFake(first.manager, first.fake);
    await first.manager.disconnect();

    const third = setup();
    third.fake.initialize.mockRejectedValueOnce(new Error("browser exploded"));
    await expect(third.manager.connect()).rejects.toThrow("browser exploded");
    // slot released by the failure: a retry may proceed to initialize again.
    // (Retry awaits stale-client teardown before wiring listeners, so wait
    // for the fresh client before emitting, like the reconnect test above.)
    const retry = third.manager.connect();
    await vi.waitFor(() => expect(third.factory).toHaveBeenCalledTimes(2));
    third.fake.emit("authenticated");
    third.fake.emit("ready");
    await retry;
    expect(third.manager.getStatus().status).toBe("connected");
  });
});

function scopeOf(factory: { mock: { calls: unknown[][] } }, index: number): { dataPath: string; clientId?: string } {
  return (factory.mock.calls[index] as unknown[])[0] as { dataPath: string; clientId?: string };
}

describe("WhatsAppManager session scope (M3 isolation)", () => {
  it("passes the legacy scope when no userId is given (CLI behavior)", async () => {
    const { fake, factory, manager } = setup();
    expect(manager.getSessionScope()).toEqual({ dataPath: ".wwebjs_auth" });
    await connectFake(manager, fake);
    expect(scopeOf(factory, 0)).toEqual({ dataPath: ".wwebjs_auth" });
  });

  it("derives distinct scopes per user and hands them to the factory", async () => {
    const { factory: factoryA, manager: managerA } = setup();
    const { factory: factoryB, manager: managerB } = setup();
    const scopedA = new WhatsAppManager({ showQrInTerminal: false, userId: "alice", clientFactory: factoryA as never });
    const scopedB = new WhatsAppManager({ showQrInTerminal: false, userId: "bob", clientFactory: factoryB as never });
    expect(scopedA.getSessionScope().dataPath).not.toBe(scopedB.getSessionScope().dataPath);
    expect(scopedA.getSessionScope().clientId).not.toBe(scopedB.getSessionScope().clientId);
    expect(scopedA.getSessionScope().dataPath).toMatch(/^\.whatsapp_sessions\//);
  });

  it("connects two users concurrently without a global slot", async () => {
    const first = setup();
    const second = setup();
    const managerA = new WhatsAppManager({ showQrInTerminal: false, userId: "alice", clientFactory: first.factory as never });
    const managerB = new WhatsAppManager({ showQrInTerminal: false, userId: "bob", clientFactory: second.factory as never });
    const promiseA = managerA.connect();
    const promiseB = managerB.connect();
    first.fake.emit("ready");
    second.fake.emit("ready");
    await Promise.all([promiseA, promiseB]);
    expect(managerA.getStatus().status).toBe("connected");
    expect(managerB.getStatus().status).toBe("connected");
    expect(scopeOf(first.factory, 0)).toEqual(managerA.getSessionScope());
    expect(scopeOf(second.factory, 0)).toEqual(managerB.getSessionScope());
  });

  it("keeps QR state per user during concurrent logins", async () => {
    const first = setup();
    const second = setup();
    const managerA = new WhatsAppManager({ showQrInTerminal: false, userId: "alice", clientFactory: first.factory as never });
    const managerB = new WhatsAppManager({ showQrInTerminal: false, userId: "bob", clientFactory: second.factory as never });
    const promiseA = managerA.connect();
    const promiseB = managerB.connect();
    first.fake.emit("qr", "QR-FOR-ALICE");
    second.fake.emit("qr", "QR-FOR-BOB");
    expect(managerA.getQRCode()).toBe("QR-FOR-ALICE");
    expect(managerB.getQRCode()).toBe("QR-FOR-BOB");
    first.fake.emit("ready");
    second.fake.emit("ready");
    await Promise.all([promiseA, promiseB]);
  });

  it("reconnect reuses the same user's scope, never another's", async () => {
    const { fake, factory } = setup();
    const scoped = new WhatsAppManager({ showQrInTerminal: false, userId: "alice", clientFactory: factory as never });
    expect(factory).not.toHaveBeenCalled();
    const promise = scoped.connect();
    fake.emit("ready");
    await promise;
    const scope = (scopeOf(factory, 0)).dataPath;
    await scoped.disconnect();
    const retry = scoped.connect();
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
    fake.emit("ready");
    await retry;
    expect((scopeOf(factory, 1)).dataPath).toBe(scope);
    expect(scope).toMatch(/^\.whatsapp_sessions\//);
  });

  it("destroying A leaves B connected with its own session", async () => {
    const first = setup();
    const second = setup();
    const managerA = new WhatsAppManager({ showQrInTerminal: false, userId: "alice", clientFactory: first.factory as never });
    const managerB = new WhatsAppManager({ showQrInTerminal: false, userId: "bob", clientFactory: second.factory as never });
    const promiseA = managerA.connect();
    const promiseB = managerB.connect();
    first.fake.emit("ready");
    second.fake.emit("ready");
    await Promise.all([promiseA, promiseB]);
    await managerA.disconnect();
    expect(managerA.getStatus().status).toBe("disconnected");
    expect(managerB.getStatus().status).toBe("connected");
    expect(first.fake.destroy).toHaveBeenCalledTimes(1);
    expect(second.fake.destroy).not.toHaveBeenCalled();
  });
});

describe("WhatsAppManager per-user export output (M5)", () => {
  it("writes default exports inside the user's namespace", async () => {
    const { fake, factory } = setup();
    const manager = new WhatsAppManager({ showQrInTerminal: false, userId: "alice", clientFactory: factory });
    stubGroupFlow(fake);
    await connectFake(manager, fake);
    const tmpCwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wge-user-"));
    const previousCwd = process.cwd();
    process.chdir(tmpCwd);
    try {
      const result = await manager.exportGroupById("120363025@g.us");
      expect(result.outputPath).toMatch(/^output[/\\][0-9a-f]{64}[/\\]whatsapp[/\\]Família Silva\.csv$/);
      const exists = await fs.promises
        .access(path.join(tmpCwd, result.outputPath))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    } finally {
      process.chdir(previousCwd);
      await fs.promises.rm(tmpCwd, { recursive: true, force: true });
    }
  });

  it("separates namespaces per user on the same group", async () => {
    const first = setup();
    const second = setup();
    const managerA = new WhatsAppManager({ showQrInTerminal: false, userId: "alice", clientFactory: first.factory });
    const managerB = new WhatsAppManager({ showQrInTerminal: false, userId: "bob", clientFactory: second.factory });
    stubGroupFlow(first.fake);
    stubGroupFlow(second.fake);
    await connectFake(managerA, first.fake);
    await connectFake(managerB, second.fake);
    const tmpCwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wge-users-"));
    const previousCwd = process.cwd();
    process.chdir(tmpCwd);
    try {
      const [a, b] = await Promise.all([
        managerA.exportGroupById("120363025@g.us"),
        managerB.exportGroupById("120363025@g.us"),
      ]);
      expect(a.outputPath).not.toBe(b.outputPath);
      expect(a.outputPath).toContain(`${path.sep}whatsapp${path.sep}`);
      expect(b.outputPath).toContain(`${path.sep}whatsapp${path.sep}`);
    } finally {
      process.chdir(previousCwd);
      await fs.promises.rm(tmpCwd, { recursive: true, force: true });
    }
  });
});

describe("WhatsAppManager late callbacks after destroy (M6)", () => {
  it("events from a torn-down client cannot resurrect manager state", async () => {
    const { fake, manager } = setup();
    const promise = manager.connect();
    await manager.disconnect();
    fake.emit("qr", "LATE-QR");
    fake.emit("authenticated");
    fake.emit("ready");
    await promise;
    expect(manager.getStatus()).toEqual({
      status: "disconnected",
      number: null,
      qr: null,
      error: null,
    });
    expect(manager.getQRCode()).toBeNull();
  });

  it("disconnect during connect is safe to repeat", async () => {
    const { fake, manager } = setup();
    const promise = manager.connect();
    await manager.disconnect();
    await manager.disconnect();
    fake.emit("ready");
    await promise;
    expect(manager.getStatus().status).toBe("disconnected");
  });
});
