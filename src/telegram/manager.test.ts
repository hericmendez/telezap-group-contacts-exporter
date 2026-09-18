import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { TelegramClient } from "teleproto";
import {
  FloodWaitError,
  PasswordHashInvalidError,
  PhoneCodeInvalidError,
  SessionPasswordNeededError,
  SessionRevokedError,
} from "teleproto/errors";
import { TelegramManager } from "./manager.js";

// ── Fake client (no Telegram, no network, no session file) ─────────────────

function makeFake(overrides: Record<string, unknown> = {}) {
  return {
    connect: vi.fn(async (): Promise<unknown> => true),
    checkAuthorization: vi.fn(async (): Promise<unknown> => false),
    invoke: vi.fn(async (_req: unknown): Promise<unknown> => ({})),
    signInUserWithQrCode: vi.fn(
      async (
        _creds: unknown,
        _params: {
          qrCode?: (t: { token: Buffer; expires: number }) => Promise<void>;
          onError?: (e: Error) => Promise<boolean | void>;
          abortSignal?: AbortSignal;
        },
      ): Promise<unknown> => ({}),
    ),
    sendCode: vi.fn(async (_creds: unknown, _phone: string): Promise<unknown> => ({ phoneCodeHash: "hash123" })),
    signInWithPassword: vi.fn(
      async (
        _creds: unknown,
        _params: { password: (hint?: string) => Promise<string>; onError?: (e: Error) => Promise<boolean | void> },
      ): Promise<unknown> => ({}),
    ),
    getMe: vi.fn(async (): Promise<unknown> => ({ id: "777000", firstName: "A", lastName: "B", username: "u" })),
    getDialogs: vi.fn(async (): Promise<unknown> => []),
    disconnect: vi.fn(async (): Promise<void> => {}),
    destroy: vi.fn(async (): Promise<void> => {}),
    session: { save: vi.fn((): string => "saved-session") },
    ...overrides,
  };
}

type Fake = ReturnType<typeof makeFake>;

const API_ENV = { TELEGRAM_API_ID: "123456", TELEGRAM_API_HASH: "testhash" };
let savedEnv: Record<string, string | undefined>;
let tmpDir: string;

async function setup(fake?: Fake) {
  const f = fake ?? makeFake();
  const factory = vi.fn((_data: string): TelegramClient => f as unknown as TelegramClient);
  const sessionPath = path.join(tmpDir, `tg-${Math.random().toString(36).slice(2)}.session`);
  const sessionRoot = path.join(tmpDir, "roots", `root-${Math.random().toString(36).slice(2)}`);
  const manager = new TelegramManager({ sessionPath, clientFactory: factory });
  return { fake: f, factory, manager, sessionPath, sessionRoot };
}

const USER = { id: "777000", firstName: "Grazi", lastName: "", username: "grazi" };

beforeEach(async () => {
  savedEnv = { TELEGRAM_API_ID: process.env.TELEGRAM_API_ID, TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH };
  process.env.TELEGRAM_API_ID = API_ENV.TELEGRAM_API_ID;
  process.env.TELEGRAM_API_HASH = API_ENV.TELEGRAM_API_HASH;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tg-mgr-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── State ───────────────────────────────────────────────────────────────────

describe("TelegramManager initial state", () => {
  it("starts disconnected, logged out, with no secrets exposed", async () => {
    const { manager } = await setup();
    expect(manager.getStatus()).toEqual({
      transport: "disconnected",
      authorized: false,
      loginStep: "none",
      qr: null,
      user: null,
      passwordHint: null,
      error: null,
    });
    expect(manager.getQRCode()).toBeNull();
    expect(manager.getConnectedUser()).toBeNull();
  });
});

// ── Connect ─────────────────────────────────────────────────────────────────

describe("TelegramManager connect", () => {
  it("requires configuration without leaking values", async () => {
    delete process.env.TELEGRAM_API_HASH;
    const { manager } = await setup();
    await expect(manager.connect()).rejects.toThrow("Missing TELEGRAM_API_HASH");
    await expect(manager.connect()).rejects.not.toThrow("testhash");
  });

  it("records config failures on status instead of vanishing", async () => {
    delete process.env.TELEGRAM_API_ID;
    const { manager } = await setup();
    await expect(manager.connect()).rejects.toThrow("Missing TELEGRAM_API_ID");
    // fire-and-forget callers (routes) only poll status — the error must be there
    expect(manager.getStatus()).toMatchObject({
      transport: "disconnected",
      error: "Missing TELEGRAM_API_ID. Create an application at https://my.telegram.org and set TELEGRAM_API_ID in .env.",
    });
  });

  it("resumes a saved session and caches the user", async () => {
    const { manager, sessionPath } = await setup();
    await fs.writeFile(sessionPath, "persisted", { mode: 0o600 });
    const fake = makeFake();
    fake.checkAuthorization.mockResolvedValue(true);
    fake.getMe.mockResolvedValue(USER);
    const factory = vi.fn((_data: string): TelegramClient => fake as unknown as TelegramClient);
    const m2 = new TelegramManager({ sessionPath, clientFactory: factory });
    await m2.connect();
    expect(m2.getStatus()).toMatchObject({ transport: "connected", authorized: true, loginStep: "none" });
    expect(m2.getConnectedUser()).toEqual({ id: "777000", firstName: "Grazi", lastName: "", username: "grazi" });
    expect(factory.mock.calls[0]![0]).toBe("persisted");
  });

  it("stays logged out when no valid session exists", async () => {
    const { manager } = await setup();
    await manager.connect();
    expect(manager.getStatus()).toMatchObject({ transport: "connected", authorized: false });
  });

  it("shares one in-flight connect across concurrent calls", async () => {
    const { fake, factory, manager } = await setup();
    let release!: (v: unknown) => void;
    fake.connect.mockImplementation(() => new Promise((r) => { release = r; }));
    const p1 = manager.connect();
    const p2 = manager.connect();
    await vi.waitFor(() => expect(fake.connect).toHaveBeenCalledTimes(1));
    release(true);
    await Promise.all([p1, p2]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(manager.getStatus().transport).toBe("connected");
  });

  it("treats a revoked session as logged out and drops the file", async () => {
    const { manager, sessionPath } = await setup();
    await fs.writeFile(sessionPath, "dead", { mode: 0o600 });
    const fake = makeFake();
    fake.checkAuthorization.mockRejectedValue(new SessionRevokedError({ request: undefined }));
    const factory = vi.fn((_data: string): TelegramClient => fake as unknown as TelegramClient);
    const m2 = new TelegramManager({ sessionPath, clientFactory: factory });
    await m2.connect();
    expect(m2.getStatus()).toMatchObject({ transport: "connected", authorized: false });
    await expect(fs.access(sessionPath)).rejects.toThrow();
  });

  it("surfaces FloodWait with seconds instead of hanging", async () => {
    const fake = makeFake();
    fake.connect.mockRejectedValue(new FloodWaitError({ request: undefined, capture: 25 }));
    const { manager } = await setup(fake);
    await expect(manager.connect()).rejects.toThrow("25s");
    expect(manager.getStatus().transport).toBe("disconnected");
  });
});

// ── QR login ────────────────────────────────────────────────────────────────

describe("TelegramManager QR login", () => {
  it("publishes a tg:// payload, persists session, clears QR on success", async () => {
    const fake = makeFake();
    fake.signInUserWithQrCode.mockImplementation(async (_creds, params) => {
      await params.qrCode?.({ token: Buffer.from("tok123"), expires: 30 });
      return USER;
    });
    const { manager, sessionPath } = await setup(fake);
    await manager.connect();
    const attempt = manager.startQrLogin();
    await attempt;
    expect(manager.getStatus()).toMatchObject({ authorized: true, loginStep: "none", qr: null, error: null });
    expect(manager.getConnectedUser()?.id).toBe("777000");
    expect(await fs.readFile(sessionPath, "utf8")).toBe("saved-session");
    expect(fake.destroy).not.toHaveBeenCalled();
  });

  it("exposes the exact tg://login payload while pending", async () => {
    let release!: (u: unknown) => void;
    const fake = makeFake();
    fake.signInUserWithQrCode.mockImplementation(async (_creds, params) => {
      await params.qrCode?.({ token: Buffer.from("tok123"), expires: 30 });
      return new Promise((resolve) => { release = resolve; });
    });
    const { manager } = await setup(fake);
    await manager.connect();
    const attempt = manager.startQrLogin();
    await vi.waitFor(() => expect(manager.getQRCode()).not.toBeNull());
    const expected = `tg://login?token=${Buffer.from("tok123").toString("base64url")}`;
    expect(manager.getQRCode()).toBe(expected);
    expect(manager.getStatus().loginStep).toBe("qr_pending");
    release(USER);
    await attempt;
  });

  it("records failures safely and resets the step", async () => {
    const fake = makeFake();
    fake.signInUserWithQrCode.mockRejectedValue(new Error("network down"));
    const { manager } = await setup(fake);
    await manager.connect();
    await expect(manager.startQrLogin()).rejects.toThrow("QR login failed");
    expect(manager.getStatus()).toMatchObject({ loginStep: "none", qr: null, authorized: false });
    expect(manager.getLastError()).toContain("QR login failed");
  });

  it("cancelLogin aborts the attempt and clears state", async () => {
    const seen: { signal: AbortSignal | null } = { signal: null };
    const fake = makeFake();
    fake.signInUserWithQrCode.mockImplementation(async (_creds, params) => {
      seen.signal = params.abortSignal ?? null;
      await params.qrCode?.({ token: Buffer.from("t"), expires: 30 });
      await new Promise<unknown>((_resolve, reject) => {
        params.abortSignal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const { manager } = await setup(fake);
    await manager.connect();
    const attempt = manager.startQrLogin();
    await vi.waitFor(() => expect(manager.getQRCode()).not.toBeNull());
    await manager.cancelLogin();
    await attempt; // resolves silently — cancellation is not an error
    expect(seen.signal?.aborted).toBe(true);
    expect(manager.getStatus()).toMatchObject({ loginStep: "none", qr: null, authorized: false });
  });
});

// ── Phone + code + 2FA ──────────────────────────────────────────────────────

describe("TelegramManager phone login", () => {
  async function phoneSetup() {
    const s = await setup();
    await s.manager.connect();
    return s;
  }

  it("sends a code and moves to awaiting_code", async () => {
    const { fake, manager } = await phoneSetup();
    await manager.startPhoneLogin("+5516999999999");
    expect(fake.sendCode).toHaveBeenCalledTimes(1);
    expect(manager.getStatus().loginStep).toBe("awaiting_code");
  });

  it("submitCode authorizes and never retains the code", async () => {
    const { fake, manager } = await phoneSetup();
    fake.invoke.mockResolvedValue({ user: USER });
    await manager.startPhoneLogin("+5516999999999");
    await manager.submitCode("12345");
    expect(manager.getStatus()).toMatchObject({ authorized: true, loginStep: "none" });
    const sent = fake.invoke.mock.calls[0]![0] as { phoneCode: string };
    expect(sent.phoneCode).toBe("12345");
    expect(JSON.stringify(manager.getStatus())).not.toContain("12345");
  });

  it("moves to awaiting_password on 2FA with a hint", async () => {
    const { fake, manager } = await phoneSetup();
    fake.invoke
      .mockRejectedValueOnce(new SessionPasswordNeededError({ request: undefined }))
      .mockResolvedValueOnce({ hint: "your dog" });
    await manager.startPhoneLogin("+5516999999999");
    await manager.submitCode("12345");
    expect(manager.getStatus()).toMatchObject({ loginStep: "awaiting_password", passwordHint: "your dog" });
  });

  it("keeps awaiting_code on invalid code with a safe message", async () => {
    const { fake, manager } = await phoneSetup();
    fake.invoke.mockRejectedValue(new PhoneCodeInvalidError({ request: undefined }));
    await manager.startPhoneLogin("+5516999999999");
    await expect(manager.submitCode("00000")).rejects.toThrow("Invalid verification code");
    expect(manager.getStatus().loginStep).toBe("awaiting_code");
  });

  it("submitPassword authorizes and never exposes the password", async () => {
    const { fake, manager } = await phoneSetup();
    fake.invoke.mockRejectedValueOnce(new SessionPasswordNeededError({ request: undefined }));
    fake.signInWithPassword.mockResolvedValue(USER);
    await manager.startPhoneLogin("+5516999999999");
    await manager.submitCode("12345");
    await manager.submitPassword("s3cret");
    expect(manager.getStatus()).toMatchObject({ authorized: true, loginStep: "none", passwordHint: null });
    expect(JSON.stringify(manager.getStatus())).not.toContain("s3cret");
  });

  it("stays put on wrong 2FA password", async () => {
    const { fake, manager } = await phoneSetup();
    fake.invoke.mockRejectedValueOnce(new SessionPasswordNeededError({ request: undefined }));
    fake.signInWithPassword.mockRejectedValue(new PasswordHashInvalidError({ request: undefined }));
    await manager.startPhoneLogin("+5516999999999");
    await manager.submitCode("12345");
    await expect(manager.submitPassword("wrong")).rejects.toThrow("Incorrect 2FA password");
    expect(manager.getStatus().loginStep).toBe("awaiting_password");
  });
});

// ── Disconnect ──────────────────────────────────────────────────────────────

describe("TelegramManager disconnect", () => {
  it("is idempotent and destroys once", async () => {
    const { fake, manager } = await setup();
    await manager.connect();
    await manager.disconnect();
    expect(manager.getStatus()).toMatchObject({ transport: "disconnected", authorized: false });
    await manager.disconnect();
    expect(fake.destroy).toHaveBeenCalledTimes(1);
  });
});

// ── Singleton ───────────────────────────────────────────────────────────────

describe("getTelegramManager registry", () => {
  it("returns the same instance per user and distinct instances per user", async () => {
    const { getTelegramManager, destroyTelegramManager, __resetTelegramManagerForTests } = await import(
      "../lib/telegram.js"
    );
    expect(getTelegramManager("user-a")).toBe(getTelegramManager("user-a"));
    expect(getTelegramManager("user-a")).not.toBe(getTelegramManager("user-b"));
    await destroyTelegramManager("user-a");
    __resetTelegramManagerForTests();
  });

  it("rejects anonymous identities instead of falling back", async () => {
    const { getTelegramManager, __resetTelegramManagerForTests } = await import("../lib/telegram.js");
    expect(() => getTelegramManager("")).toThrow("authenticated userId");
    __resetTelegramManagerForTests();
  });

  it("threads userId into isolated session paths via the registry", async () => {
    const { getTelegramManager, __resetTelegramManagerForTests } = await import("../lib/telegram.js");
    const a = getTelegramManager("user-a");
    const b = getTelegramManager("user-b");
    expect(a.getSessionPath()).not.toBe(b.getSessionPath());
    expect(a.getSessionPath()).toMatch(/\.telegram_sessions\/[0-9a-f]{64}\/session$/);
    expect(path.basename(path.dirname(a.getSessionPath()))).not.toBe(".telegram_session");
    __resetTelegramManagerForTests();
  });
});

describe("TelegramManager groups & participants", () => {
  const SUPER_ENTITY = { className: "Channel", id: "100", accessHash: "secret-hash", title: "Devs", megagroup: true };
  const BASIC_ENTITY = { className: "Chat", id: "200", title: "Family", participantsCount: 2 };

  function dialogsFake() {
    return makeFake({
      getDialogs: vi.fn(async () => [{ entity: SUPER_ENTITY }, { entity: BASIC_ENTITY }]),
    });
  }

  async function authorizedSetup(fake?: Fake) {
    const s = await setup(fake);
    s.fake.checkAuthorization.mockResolvedValue(true);
    await s.manager.connect();
    return s;
  }

  it("requires authentication for groups and participants", async () => {
    const { manager } = await setup();
    await expect(manager.getGroups()).rejects.toThrow("authentication is required");
    await expect(manager.getParticipantsByGroupId("100")).rejects.toThrow("authentication is required");
    const s = await setup();
    await s.manager.connect(); // transport up, still logged out
    await expect(s.manager.getGroups()).rejects.toThrow("authentication is required");
  });

  it("getGroups returns sorted summaries without internals", async () => {
    const { manager } = await authorizedSetup(dialogsFake());
    const groups = await manager.getGroups();
    expect(groups).toEqual([
      { id: "100", title: "Devs", kind: "supergroup" },
      { id: "200", title: "Family", kind: "group", participantCount: 2 },
    ]);
    const text = JSON.stringify(groups);
    expect(text).not.toContain("accessHash");
    expect(text).not.toContain("secret-hash");
    expect(JSON.parse(text)).toEqual(groups);
  });

  it("getGroupById resolves deterministically, unknown rejects", async () => {
    const { manager } = await authorizedSetup(dialogsFake());
    expect(await manager.getGroupById("200")).toMatchObject({ title: "Family", kind: "group" });
    await expect(manager.getGroupById("000")).rejects.toThrow('Telegram group "000" was not found.');
  });

  it("enumerates supergroup participants reusing the cached entity", async () => {
    const fake = dialogsFake();
    fake.invoke.mockResolvedValue({
      className: "channels.ChannelParticipants",
      participants: [{ className: "ChannelParticipantAdmin", userId: "11" }],
      users: [{ className: "User", id: "11", firstName: "Ada", username: "ada" }],
    });
    const { manager } = await authorizedSetup(fake);
    await manager.getGroups();
    const result = await manager.getParticipantsByGroupId("100");
    expect(result.group).toMatchObject({ id: "100", title: "Devs" });
    expect(result.participants).toEqual([
      { telegramId: "11", firstName: "Ada", lastName: "", username: "ada", phone: "", isAdmin: true, isOwner: false },
    ]);
    // discovery ran once; the entity (with accessHash) was reused server-side
    expect(fake.getDialogs).toHaveBeenCalledTimes(1);
    const req = fake.invoke.mock.calls[0]![0] as { channel: unknown };
    expect(req.channel).toBe(SUPER_ENTITY);
  });

  it("re-runs discovery on cache miss and enumerates basic groups", async () => {
    const fake = dialogsFake();
    fake.invoke.mockResolvedValue({
      className: "messages.ChatFull",
      fullChat: {
        participants: {
          className: "ChatParticipants",
          participants: [{ className: "ChatParticipantCreator", userId: "22" }],
        },
      },
      users: [{ className: "User", id: "22", firstName: "Bo" }],
    });
    const { manager } = await authorizedSetup(fake);
    // no prior getGroups: lookup re-discovers, then enumerates
    const result = await manager.getParticipantsByGroupId("200");
    expect(result.participants).toEqual([
      { telegramId: "22", firstName: "Bo", lastName: "", username: "", phone: "", isAdmin: true, isOwner: true },
    ]);
    expect(fake.getDialogs).toHaveBeenCalledTimes(1);
  });

  it("surfaces unavailable enumeration instead of empty results", async () => {
    const fake = dialogsFake();
    const { ChatAdminRequiredError } = await import("teleproto/errors");
    fake.invoke.mockRejectedValue(new ChatAdminRequiredError({ request: undefined }));
    const { manager } = await authorizedSetup(fake);
    await expect(manager.getParticipantsByGroupId("100")).rejects.toThrow(
      "Participant enumeration is not available",
    );
  });

  it("disconnect clears cached entities", async () => {
    const { fake, manager } = await authorizedSetup(dialogsFake());
    await manager.getGroups();
    await manager.disconnect();
    await expect(manager.getGroups()).rejects.toThrow("authentication is required");
    expect(fake.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("TelegramManager exportGroupById", () => {
  const SUPER_ENTITY = { className: "Channel", id: "100", accessHash: "h", title: "Devs", megagroup: true };

  function exportSetup() {
    return setup(
      makeFake({
        getDialogs: vi.fn(async () => [{ entity: SUPER_ENTITY }]),
      }),
    );
  }

  async function authorizedExportSetup() {
    const s = await exportSetup();
    s.fake.checkAuthorization.mockResolvedValue(true);
    await s.manager.connect();
    return s;
  }

  it("exports by ID reusing lookup and enumeration", async () => {
    const { fake, manager } = await authorizedExportSetup();
    fake.invoke.mockResolvedValue({
      className: "channels.ChannelParticipants",
      participants: [{ className: "ChannelParticipant", userId: "11" }],
      users: [{ className: "User", id: "11", firstName: "Ada" }],
    });
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tg-exp-"));
    const out = path.join(tmp, "out.csv");
    try {
      const result = await manager.exportGroupById("100", { outputFile: out });
      expect(result).toMatchObject({
        groupId: "100",
        groupTitle: "Devs",
        participantCount: 1,
        filename: "out.csv",
        filePath: out,
      });
      const text = await fs.readFile(out, "utf8");
      expect(text).toContain("TELEGRAM_ID;NOME;SOBRENOME;USERNAME;NUMERO;ADMIN;OWNER");
      expect(text).toContain("11;Ada;;;;false;false");
      expect(fake.destroy).not.toHaveBeenCalled();
      expect(manager.getStatus().authorized).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("derives a namespaced default path from the resolved title", async () => {
    const { fake, manager } = await authorizedExportSetup();
    fake.invoke.mockResolvedValue({
      className: "channels.ChannelParticipants",
      participants: [],
      users: [],
    });
    const tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "tg-cwd-"));
    const previousCwd = process.cwd();
    process.chdir(tmpCwd);
    try {
      const result = await manager.exportGroupById("100");
      expect(result.filePath).toBe(path.join("output", "telegram-Devs.csv"));
      expect(result.filename).toBe("telegram-Devs.csv");
    } finally {
      process.chdir(previousCwd);
      await fs.rm(tmpCwd, { recursive: true, force: true });
    }
  });

  it("writes nothing when enumeration is refused", async () => {
    const { fake, manager } = await authorizedExportSetup();
    const { ChatAdminRequiredError } = await import("teleproto/errors");
    fake.invoke.mockRejectedValue(new ChatAdminRequiredError({ request: undefined }));
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tg-exp-"));
    try {
      await expect(
        manager.exportGroupById("100", { outputFile: path.join(tmp, "nope.csv") }),
      ).rejects.toThrow("not available");
      expect(await fs.readdir(tmp)).toEqual([]);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("surfaces CSV write failures without destroying the client", async () => {
    const { fake, manager } = await authorizedExportSetup();
    fake.invoke.mockResolvedValue({
      className: "channels.ChannelParticipants",
      participants: [],
      users: [],
    });
    const blocker = path.join(tmpDir, "blocker");
    await fs.writeFile(blocker, "x");
    await expect(
      manager.exportGroupById("100", { outputFile: path.join(blocker, "out.csv") }),
    ).rejects.toThrow();
    expect(fake.destroy).not.toHaveBeenCalled();
  });
});

describe("TelegramManager exportGroupById filtering", () => {
  const SUPER_ENTITY = { className: "Channel", id: "100", accessHash: "h", title: "Devs", megagroup: true };

  async function filteringSetup() {
    const s = await setup(
      makeFake({
        getDialogs: vi.fn(async () => [{ entity: SUPER_ENTITY }]),
      }),
    );
    s.fake.checkAuthorization.mockResolvedValue(true);
    await s.manager.connect();
    s.fake.invoke.mockResolvedValue({
      className: "channels.ChannelParticipants",
      participants: [
        { className: "ChannelParticipant", userId: "11" },
        { className: "ChannelParticipant", userId: "12" },
      ],
      users: [
        { className: "User", id: "11", firstName: "Ada", phone: "+5516999999999" },
        { className: "User", id: "12", firstName: "Bo" },
      ],
    });
    return s;
  }

  it("exports everyone by default and only numbered contacts when flagged", async () => {
    const { manager } = await filteringSetup();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tg-filter-"));
    try {
      const all = await manager.exportGroupById("100", { outputFile: path.join(tmp, "all.csv") });
      expect(all.participantCount).toBe(2);
      const filtered = await manager.exportGroupById("100", {
        outputFile: path.join(tmp, "filtered.csv"),
        excludeHiddenPhone: true,
      });
      expect(filtered.participantCount).toBe(1);
      const text = await fs.readFile(path.join(tmp, "filtered.csv"), "utf8");
      expect(text).toContain("Ada");
      expect(text).not.toContain("12;Bo");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("TelegramManager concurrent connections (M4: no global slot)", () => {
  it("connects two users simultaneously on isolated sessions", async () => {
    const first = await setup();
    const second = await setup();
    const managerA = new TelegramManager({
      userId: "alice",
      sessionsRoot: first.sessionRoot,
      clientFactory: first.factory,
    });
    const managerB = new TelegramManager({
      userId: "bob",
      sessionsRoot: second.sessionRoot,
      clientFactory: second.factory,
    });
    await Promise.all([managerA.connect(), managerB.connect()]);
    expect(managerA.getStatus().transport).toBe("connected");
    expect(managerB.getStatus().transport).toBe("connected");
    expect(managerA.getSessionPath()).not.toBe(managerB.getSessionPath());
  });

  it("same-user concurrent connects still share one attempt", async () => {
    const s = await setup();
    const manager = new TelegramManager({
      userId: "alice",
      sessionsRoot: s.sessionRoot,
      clientFactory: s.factory,
    });
    await Promise.all([manager.connect(), manager.connect()]);
    expect(s.fake.connect).toHaveBeenCalledTimes(1);
  });
});

// ── M4: per-user physical session isolation ─────────────────────────────────

function userManager(
  userId: string,
  sessionRoot: string,
  fake?: Fake,
): { fake: Fake; manager: TelegramManager } {
  const f = fake ?? makeFake();
  const factory = vi.fn((_data: string): TelegramClient => f as unknown as TelegramClient);
  const manager = new TelegramManager({ userId, sessionsRoot: sessionRoot, clientFactory: factory });
  return { fake: f, manager };
}

describe("TelegramManager per-user session isolation (M4)", () => {
  it("derives distinct session files per user, never the legacy path", async () => {
    const root = path.join(tmpDir, "iso-roots");
    const a = new TelegramManager({ userId: "alice", sessionsRoot: root, clientFactory: (() => { throw new Error("no client"); }) as never });
    const b = new TelegramManager({ userId: "bob", sessionsRoot: root, clientFactory: (() => { throw new Error("no client"); }) as never });
    expect(a.getSessionPath()).toMatch(new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[0-9a-f]{64}/session$`));
    expect(a.getSessionPath()).not.toBe(b.getSessionPath());
    expect(a.getSessionPath()).not.toContain(".telegram_session");
  });

  it("persists each authorized session in its own file", async () => {
    const root = path.join(tmpDir, "iso-persist");
    const a = userManager("alice", root);
    const b = userManager("bob", root);
    a.fake.signInUserWithQrCode.mockResolvedValue({ id: "1", firstName: "A" });
    b.fake.signInUserWithQrCode.mockResolvedValue({ id: "2", firstName: "B" });
    await a.manager.connect();
    await b.manager.connect();
    await a.manager.startQrLogin();
    await b.manager.startQrLogin();
    const fileA = a.manager.getSessionPath();
    const fileB = b.manager.getSessionPath();
    expect(await fs.readFile(fileA, "utf8")).toBe("saved-session");
    expect(await fs.readFile(fileB, "utf8")).toBe("saved-session");
    expect(fileA).not.toBe(fileB);
    // A cannot read B's session through any manager API surface
    expect(JSON.stringify(a.manager.getStatus())).not.toContain(fileB);
  });

  it("reuses the same user's session file on reconnect", async () => {
    const root = path.join(tmpDir, "iso-reuse");
    const first = userManager("alice", root);
    first.fake.checkAuthorization.mockResolvedValue(true);
    await first.manager.connect();
    expect(first.manager.getStatus().authorized).toBe(true);

    const seen: string[] = [];
    const second = userManager("alice", root);
    second.fake.checkAuthorization.mockImplementation(async () => {
      seen.push("checked");
      return true;
    });
    // capture the sessionData handed to the factory
    let captured = "";
    const factory = vi.fn((data: string): TelegramClient => {
      captured = data;
      return second.fake as unknown as TelegramClient;
    });
    const third = new TelegramManager({ userId: "alice", sessionsRoot: root, clientFactory: factory });
    await third.connect();
    expect(captured).toBe("saved-session");
    expect(third.getStatus().authorized).toBe(true);
    expect(seen).toEqual(["checked"]);
  });

  it("holds simultaneous QR states without cross-talk", async () => {
    const root = path.join(tmpDir, "iso-qr");
    const pendingQr = (
      fake: Fake,
      token: string,
    ): { seen: { signal: AbortSignal | null } } => {
      const seen: { signal: AbortSignal | null } = { signal: null };
      fake.signInUserWithQrCode.mockImplementation(async (_creds, params) => {
        seen.signal = params.abortSignal ?? null;
        await params.qrCode?.({ token: Buffer.from(token), expires: 30 });
        await new Promise<unknown>((_resolve, reject) => {
          params.abortSignal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      });
      return { seen };
    };
    const a = userManager("alice", root);
    const b = userManager("bob", root);
    const seenA = pendingQr(a.fake, "token-A");
    const seenB = pendingQr(b.fake, "token-B");
    await a.manager.connect();
    await b.manager.connect();
    const attemptA = a.manager.startQrLogin();
    const attemptB = b.manager.startQrLogin();
    await vi.waitFor(() => expect(a.manager.getQRCode()).not.toBeNull());
    await vi.waitFor(() => expect(b.manager.getQRCode()).not.toBeNull());
    expect(a.manager.getQRCode()).toContain(Buffer.from("token-A").toString("base64url"));
    expect(b.manager.getQRCode()).toContain(Buffer.from("token-B").toString("base64url"));
    expect(a.manager.getQRCode()).not.toBe(b.manager.getQRCode());
    await a.manager.cancelLogin();
    await b.manager.cancelLogin();
    await attemptA;
    await attemptB;
    expect(seenA.seen.signal?.aborted).toBe(true);
    expect(seenB.seen.signal?.aborted).toBe(true);
    expect(a.manager.getStatus().loginStep).toBe("none");
    expect(b.manager.getStatus().loginStep).toBe("none");
  });

  it("keeps phone/code and 2FA flows isolated per user", async () => {
    const root = path.join(tmpDir, "iso-auth");
    const a = userManager("alice", root);
    const b = userManager("bob", root);
    await a.manager.connect();
    await b.manager.connect();
    // A advances to awaiting_code while B stays idle, then to 2FA
    a.fake.invoke.mockRejectedValueOnce(new SessionPasswordNeededError({ request: undefined }));
    await a.manager.startPhoneLogin("+5511000000001");
    expect(a.manager.getStatus().loginStep).toBe("awaiting_code");
    expect(b.manager.getStatus().loginStep).toBe("none");
    await b.manager.startPhoneLogin("+5511000000002");
    await a.manager.submitCode("11111");
    expect(a.manager.getStatus().loginStep).toBe("awaiting_password");
    expect(b.manager.getStatus().loginStep).toBe("awaiting_code");
    // A's password failure does not touch B
    a.fake.signInWithPassword.mockRejectedValue(new PasswordHashInvalidError({ request: undefined }));
    await expect(a.manager.submitPassword("wrong")).rejects.toThrow("Incorrect 2FA password");
    expect(b.manager.getStatus()).toMatchObject({ loginStep: "awaiting_code", authorized: false });
    // B completes independently
    b.fake.invoke.mockResolvedValue({ user: USER });
    await b.manager.submitCode("22222");
    expect(b.manager.getStatus()).toMatchObject({ authorized: true, loginStep: "none" });
    expect(a.manager.getStatus()).toMatchObject({ authorized: false, loginStep: "awaiting_password" });
  });

  it("revoking A clears only A's file and state", async () => {
    const root = path.join(tmpDir, "iso-revoke");
    const a = userManager("alice", root);
    const b = userManager("bob", root);
    await a.manager.connect();
    await b.manager.connect();
    const fileA = a.manager.getSessionPath();
    const fileB = b.manager.getSessionPath();
    await fs.mkdir(path.dirname(fileA), { recursive: true });
    await fs.writeFile(fileA, "session-a");
    await fs.mkdir(path.dirname(fileB), { recursive: true });
    await fs.writeFile(fileB, "session-b");
    // A's next authorization check reports a dead session
    a.fake.checkAuthorization.mockRejectedValue(new SessionRevokedError({ request: undefined }));
    const again = new TelegramManager({
      userId: "alice",
      sessionsRoot: root,
      clientFactory: vi.fn((): TelegramClient => a.fake as unknown as TelegramClient),
    });
    await again.connect();
    expect(again.getStatus()).toMatchObject({ authorized: false, transport: "connected" });
    await expect(fs.access(fileA)).rejects.toThrow();
    expect(await fs.readFile(fileB, "utf8")).toBe("session-b");
    expect(b.manager.getStatus().transport).toBe("connected");
  });

  it("disconnecting A leaves B connected with its session intact", async () => {
    const root = path.join(tmpDir, "iso-disc");
    const a = userManager("alice", root);
    const b = userManager("bob", root);
    await a.manager.connect();
    await b.manager.connect();
    await a.manager.disconnect();
    expect(a.manager.getStatus()).toMatchObject({ transport: "disconnected", authorized: false });
    expect(b.manager.getStatus()).toMatchObject({ transport: "connected" });
    expect(b.fake.destroy).not.toHaveBeenCalled();
  });
});

describe("TelegramManager per-user export output (M5)", () => {
  function exportSetup() {
    return setup(
      makeFake({
        getDialogs: vi.fn(async () => [
          { entity: { className: "Channel", id: "100", accessHash: "h", title: "Devs", megagroup: true } },
        ]),
      }),
    );
  }

  async function authorizedExportSetup(userId: string) {
    const s = await exportSetup();
    s.fake.checkAuthorization.mockResolvedValue(true);
    const manager = new TelegramManager({
      userId,
      sessionsRoot: s.sessionRoot,
      clientFactory: s.factory,
    });
    await manager.connect();
    return { ...s, manager };
  }

  it("writes default exports inside the user's telegram namespace", async () => {
    const { fake, manager } = await authorizedExportSetup("alice");
    fake.invoke.mockResolvedValue({
      className: "channels.ChannelParticipants",
      participants: [{ className: "ChannelParticipant", userId: "11" }],
      users: [{ className: "User", id: "11", firstName: "Ada" }],
    });
    const tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "tg-user-"));
    const previousCwd = process.cwd();
    process.chdir(tmpCwd);
    try {
      const result = await manager.exportGroupById("100");
      expect(result.filePath).toMatch(/^output[/\\][0-9a-f]{64}[/\\]telegram[/\\]telegram-Devs\.csv$/);
      expect(result.filename).toBe("telegram-Devs.csv");
    } finally {
      process.chdir(previousCwd);
      await fs.rm(tmpCwd, { recursive: true, force: true });
    }
  });
});

describe("TelegramManager late callbacks after destroy (M6)", () => {
  it("a late QR callback cannot repopulate a destroyed manager", async () => {
    let qrCallback: ((t: { token: Buffer; expires: number }) => Promise<void>) | null = null;
    const fake = makeFake();
    fake.signInUserWithQrCode.mockImplementation(async (_creds, params) => {
      qrCallback = params.qrCode ?? null;
      await params.qrCode?.({ token: Buffer.from("tok"), expires: 30 });
      await new Promise(() => {});
    });
    const { manager } = await setup(fake);
    await manager.connect();
    const attempt = manager.startQrLogin();
    await vi.waitFor(() => expect(manager.getQRCode()).not.toBeNull());
    await manager.disconnect();
    await qrCallback!({ token: Buffer.from("late"), expires: 30 });
    await manager.cancelLogin().catch(() => {});
    expect(manager.getStatus()).toMatchObject({
      transport: "disconnected",
      authorized: false,
      loginStep: "none",
      qr: null,
      user: null,
    });
    expect(manager.getConnectedUser()).toBeNull();
    void attempt;
  });

  it("concurrent destroy calls destroy the client once", async () => {
    const { fake, manager } = await setup();
    await manager.connect();
    await Promise.all([manager.disconnect(), manager.disconnect()]);
    expect(fake.destroy).toHaveBeenCalledTimes(1);
    expect(manager.getStatus().transport).toBe("disconnected");
  });
});
