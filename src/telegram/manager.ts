import { Api, TelegramClient } from "teleproto";
import * as path from "node:path";
import {
  AuthKeyUnregisteredError,
  FloodWaitError,
  PasswordHashInvalidError,
  PhoneCodeExpiredError,
  PhoneCodeInvalidError,
  PhoneNumberInvalidError,
  SessionPasswordNeededError,
  SessionRevokedError,
} from "teleproto/errors";
import { logger } from "../utils/logger.js";
import { loadTelegramConfig } from "./config.js";
import {
  fetchGroupRecordById,
  fetchGroupRecords,
  type TelegramGroupRecord,
  type TelegramGroupSummary,
} from "./group.js";
import { fetchParticipantsForRecord, type TelegramParticipant } from "./participants.js";
import { exportTelegramCsv, resolveTelegramOutputPath } from "../export/telegram-csv.js";
import { exportDirForUser } from "../export/paths.js";
import {
  DEFAULT_TELEGRAM_SESSION_PATH,
  TELEGRAM_SESSIONS_ROOT,
  clearTelegramSession,
  loadTelegramSession,
  saveTelegramSession,
  telegramSessionScopeForUser,
} from "./session.js";
import { buildTelegramClient, logTelegramError } from "./client.js";

// ── Public contract ─────────────────────────────────────────────────────────
// Transport state and login-step state are separate axes: Telegram login is
// multi-step while WhatsApp's is event-driven, so no forced symmetry.

/** Low-level connection state (TCP/MTProto), independent of authorization. */
export type TelegramTransport = "disconnected" | "connecting" | "connected";

/** Where a login attempt currently stands (`none` = no attempt running). */
export type TelegramLoginStep =
  | "none"
  | "qr_pending"
  | "awaiting_phone"
  | "awaiting_code"
  | "awaiting_password";

/** Safe subset of a Telegram user for UI display. IDs are strings (64-bit). */
export interface TelegramConnectedUser {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
}

/**
 * Serializable status snapshot. Plain values only — never the client,
 * entities, session strings, hashes, tokens, codes, or passwords.
 */
export interface TelegramStatus {
  transport: TelegramTransport;
  authorized: boolean;
  loginStep: TelegramLoginStep;
  /** `tg://login?token=…` payload for the frontend to render, else null. */
  qr: string | null;
  user: TelegramConnectedUser | null;
  /** 2FA password hint (not the password) while awaiting_password. */
  passwordHint: string | null;
  error: string | null;
}

export interface TelegramManagerOptions {
  sessionPath?: string;
  /**
   * Base directory used when deriving a per-user session scope. Defaults to
   * the production root; tests point it at a temp dir. Only used when no
   * explicit `sessionPath` is given.
   */
  sessionsRoot?: string;
  /**
   * Authenticated app user owning this manager's session. When set (the
   * registry always sets it), the session file is isolated per user and is
   * never the legacy global path. Omit only for the legacy global behavior.
   */
  userId?: string;
  clientFactory?: (sessionData: string, apiId: number, apiHash: string) => TelegramClient;
}

/** Plain server-side export result. Routes strip `filePath` before responding. */
export interface TelegramExportResult {
  groupId: string;
  groupTitle: string;
  participantCount: number;
  filename: string;
  filePath: string;
}

export interface TelegramExportOptions {
  /** Explicit CSV destination (tests/admin). Defaults to the group-derived path. */
  outputFile?: string;
  /**
   * Exclude participants whose phone is unavailable/hidden before writing
   * the CSV. Enumeration itself is untouched — this filters the export rows
   * (and the reported count) at the domain boundary.
   */
  excludeHiddenPhone?: boolean;
}

// ── Safe error mapping (never forward raw MTProto errors) ───────────────────

function toSafeMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && /^(Missing|Invalid) TELEGRAM_[A-Z_]+/.test(err.message)) {
    // Already-safe configuration guidance from loadTelegramConfig (values never included).
    return err.message;
  }
  if (err instanceof FloodWaitError) {
    return `Telegram is rate-limiting requests. Try again in ${err.seconds}s.`;
  }
  if (err instanceof PhoneNumberInvalidError) {
    return "Invalid phone number. Use the international format, e.g. +5516999999999.";
  }
  if (err instanceof PhoneCodeInvalidError) {
    return "Invalid verification code. Check the code and try again.";
  }
  if (err instanceof PhoneCodeExpiredError) {
    return "Verification code expired. Request a new code and try again.";
  }
  if (err instanceof PasswordHashInvalidError) {
    return "Incorrect 2FA password. Try again.";
  }
  return fallback;
}

function isSessionDead(err: unknown): boolean {
  return err instanceof AuthKeyUnregisteredError || err instanceof SessionRevokedError;
}

type RawUserLike = {
  id?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  username?: unknown;
};

function toConnectedUser(user: unknown): TelegramConnectedUser {
  const raw = (user ?? {}) as RawUserLike;
  const asText = (value: unknown): string => (typeof value === "string" ? value : "");
  // id may be a 64-bit BigInteger — stringify, never Number().
  return {
    id: raw.id === null || raw.id === undefined ? "" : String(raw.id),
    firstName: asText(raw.firstName),
    lastName: asText(raw.lastName),
    username: asText(raw.username),
  };
}

// ── Manager ─────────────────────────────────────────────────────────────────

/**
 * Owns one server-side teleproto TelegramClient per process: transport
 * lifecycle, stepwise login (QR / phone+code / 2FA), and local session
 * persistence. Independent from WhatsAppManager by design.
 *
 * Verification codes and the 2FA password exist only as arguments inside
 * the submit call — they are never stored on the instance, logged,
 * persisted, or returned.
 */
export class TelegramManager {
  private client: TelegramClient | null = null;
  private transport: TelegramTransport = "disconnected";
  private authorized = false;
  private loginStep: TelegramLoginStep = "none";
  private currentQr: string | null = null;
  private user: TelegramConnectedUser | null = null;
  private passwordHint: string | null = null;
  private lastError: string | null = null;

  private connectPromise: Promise<void> | null = null;
  private loginPromise: Promise<void> | null = null;
  private loginAbort: AbortController | null = null;

  // Pending phone-login state (server-side only, cleared on completion).
  private pendingPhone: string | null = null;
  private pendingPhoneCodeHash: string | null = null;

  // Server-side group records (entities carry accessHash). Refreshed on
  // every getGroups(); single misses re-run discovery. Never exposed.
  private groupEntities = new Map<string, TelegramGroupRecord>();

  private readonly sessionPath: string;
  private readonly clientFactory: (sessionData: string, apiId: number, apiHash: string) => TelegramClient;
  private readonly userId: string | null;

  constructor(options?: TelegramManagerOptions) {
    // Precedence: explicit sessionPath (tests/advanced) > derived per-user
    // scope (registry path) > legacy global default.
    const derived = options?.userId
      ? telegramSessionScopeForUser(options.userId, options.sessionsRoot).filePath
      : null;
    this.userId = options?.userId ?? null;
    this.sessionPath = options?.sessionPath ?? derived ?? DEFAULT_TELEGRAM_SESSION_PATH;
    this.clientFactory = options?.clientFactory ?? ((data, id, hash) => buildTelegramClient(data, id, hash));
  }

  /**
   * This manager's session file. Observability for M4 (proves which physical
   * session a manager owns without reading secrets).
   */
  getSessionPath(): string {
    return this.sessionPath;
  }

  // ── State inspection (plain values only) ──────────────────────────────────

  getStatus(): TelegramStatus {
    return {
      transport: this.transport,
      authorized: this.authorized,
      loginStep: this.loginStep,
      qr: this.currentQr,
      user: this.user ? { ...this.user } : null,
      passwordHint: this.passwordHint,
      error: this.lastError,
    };
  }

  /** Raw QR payload (`tg://login?token=…`) for the frontend to render. */
  getQRCode(): string | null {
    return this.currentQr;
  }

  getConnectedUser(): TelegramConnectedUser | null {
    return this.authorized && this.user ? { ...this.user } : null;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Connect the transport and resume the persisted session when valid.
   * Resolves with transport `connected`; `authorized` tells whether a login
   * is still needed. Concurrent calls share one attempt; safe when already up.
   */
  async connect(): Promise<void> {
    if (this.authorized && this.transport === "connected") return;
    if (this.connectPromise) return this.connectPromise;

    // Reserve the attempt synchronously (before any await) so concurrent
    // callers observe connectPromise and share a single client creation.
    // Everything fallible — including config loading — happens inside run()
    // so failures always land on status.error instead of vanishing.
    let run!: () => Promise<void>;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      run = async (): Promise<void> => {
        try {
          const config = loadTelegramConfig();
          const sessionData = (await loadTelegramSession(this.sessionPath)) ?? "";
          this.client = this.clientFactory(sessionData, config.apiId, config.apiHash);
          const client = this.client;
          this.transport = "connecting";
          this.lastError = null;
          await client.connect();
          let authed = false;
          try {
            authed = await client.checkAuthorization();
          } catch (err) {
            if (isSessionDead(err)) {
              // Persisted session was revoked — drop it and continue logged out.
              await clearTelegramSession(this.sessionPath);
              authed = false;
            } else {
              throw err;
            }
          }
          if (authed) {
            this.user = toConnectedUser(await client.getMe());
            await this.persistSession(client);
            this.authorized = true;
          }
          this.transport = "connected";
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      void run();
    });

    const attempt = this.connectPromise;
    try {
      await attempt;
    } catch (err) {
      logTelegramError("connect", err);
      if (this.connectPromise === attempt) this.connectPromise = null;
      this.transport = "disconnected";
      this.lastError = toSafeMessage(err, "Could not connect to Telegram. Check the network and try again.");
      throw new Error(this.lastError);
    }
  }

  /**
   * Abort any login, destroy the client, return to `disconnected`.
   * Idempotent — concurrent or repeated calls destroy at most once.
   */
  async disconnect(): Promise<void> {
    // Abort any in-flight login first so its late callbacks (QR refresh,
    // authorization) cannot repopulate the state being torn down. The abort
    // path resolves silently, so no unhandled rejection escapes.
    const controller = this.loginAbort;
    this.cancelLoginState();
    controller?.abort();
    const client = this.client;
    this.client = null;
    this.connectPromise = null;
    this.currentQr = null;
    this.passwordHint = null;
    this.lastError = null;
    this.authorized = false;
    this.loginStep = "none";
    this.user = null;
    this.transport = "disconnected";
    this.groupEntities = new Map();
    if (client) {
      try {
        await client.destroy();
        logger.info("Telegram client destroyed.");
      } catch (err) {
        logTelegramError("destroy", err);
      }
    }
  }

  // ── QR login (primary UI flow; server owns refresh) ───────────────────────

  /**
   * Start QR login. Resolves on authorization; the UI tracks progress via
   * polling getStatus() (`qr_pending` + fresh `qr` payload, auto-refreshed
   * ~30s by the library loop). Concurrent calls share one attempt.
   */
  async startQrLogin(): Promise<void> {
    const client = this.requireTransport();
    if (this.authorized) return;
    if (this.loginPromise) return this.loginPromise;

    const config = loadTelegramConfig();
    this.beginLogin("qr_pending");
    const controller = new AbortController();
    this.loginAbort = controller;

    const attempt = client
      .signInUserWithQrCode(
        { apiId: config.apiId, apiHash: config.apiHash },
        {
          qrCode: async ({ token }: { token: Buffer; expires: number }) => {
            // Short-lived auth material: kept in memory only, never logged/stored.
            this.currentQr = `tg://login?token=${token.toString("base64url")}`;
          },
          onError: async (err: Error) => {
            this.lastError = toSafeMessage(err, "Telegram QR login failed. Try again.");
            return true; // stop the loop; the rejection below settles the attempt
          },
          abortSignal: controller.signal,
        },
      )
      .then(async (user) => {
        await this.onAuthorized(client, user);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          this.cancelLoginState();
          return;
        }
        logTelegramError("QR login", err);
        this.cancelLoginState();
        this.lastError = toSafeMessage(err, "Telegram QR login failed. Try again.");
        throw new Error(this.lastError);
      })
      .finally(() => {
        if (this.loginPromise === attempt) this.loginPromise = null;
        if (this.loginAbort === controller) this.loginAbort = null;
      });

    this.loginPromise = attempt;
    return attempt;
  }

  /** Abort a running login attempt (QR/phone). Silent when idle. */
  async cancelLogin(): Promise<void> {
    const pending = this.loginPromise;
    const controller = this.loginAbort;
    // Clear state first so late callbacks cannot repopulate it.
    this.cancelLoginState();
    controller?.abort();
    if (pending) {
      try {
        await pending;
      } catch {
        // rejection already recorded; cancellation itself is not an error
      }
    }
  }

  // ── Phone + code login (fallback) ─────────────────────────────────────────

  /** Send the verification code. Moves to `awaiting_code`. */
  async startPhoneLogin(phoneNumber: string): Promise<void> {
    const client = this.requireTransport();
    if (this.authorized) return;
    await this.cancelLogin();
    const phone = phoneNumber.trim();
    if (!phone) {
      throw new Error("Missing phone number. Use the international format, e.g. +5516999999999.");
    }
    const config = loadTelegramConfig();
    this.beginLogin("awaiting_phone");
    try {
      const { phoneCodeHash } = await client.sendCode(
        { apiId: config.apiId, apiHash: config.apiHash },
        phone,
      );
      this.pendingPhone = phone;
      this.pendingPhoneCodeHash = phoneCodeHash;
      this.loginStep = "awaiting_code";
      this.lastError = null;
    } catch (err) {
      logTelegramError("send code", err);
      this.cancelLoginState();
      this.lastError = toSafeMessage(err, "Could not send the verification code. Try again.");
      throw new Error(this.lastError);
    }
  }

  /**
   * Submit the verification code. The code lives only in this call.
   * Success → authorized; 2FA → `awaiting_password`; bad code → message.
   */
  async submitCode(code: string): Promise<void> {
    const client = this.requireTransport();
    if (this.authorized) return;
    if (this.loginStep !== "awaiting_code" || !this.pendingPhone || !this.pendingPhoneCodeHash) {
      throw new Error("No pending verification code. Request a code first.");
    }
    const trimmed = code.trim();
    if (!trimmed) {
      throw new Error("Missing verification code.");
    }
    const phoneNumber = this.pendingPhone;
    const phoneCodeHash = this.pendingPhoneCodeHash;
    try {
      const result = (await client.invoke(
        new Api.auth.SignIn({ phoneNumber, phoneCodeHash, phoneCode: trimmed }),
      )) as { user?: unknown };
      await this.onAuthorized(client, result?.user);
    } catch (err) {
      if (err instanceof SessionPasswordNeededError) {
        this.pendingPhoneCodeHash = null;
        this.loginStep = "awaiting_password";
        this.passwordHint = await this.readPasswordHint(client);
        this.lastError = null;
        return;
      }
      logTelegramError("sign in", err);
      if (err instanceof PhoneCodeExpiredError) {
        // The hash is dead — a fresh code is required.
        this.pendingPhoneCodeHash = null;
        this.loginStep = "awaiting_phone";
      }
      this.lastError = toSafeMessage(err, "Sign-in failed. Try again.");
      throw new Error(this.lastError);
    }
  }

  /**
   * Submit the 2FA password. Transient only: function argument, never stored
   * on the instance, never logged, never returned.
   */
  async submitPassword(password: string): Promise<void> {
    const client = this.requireConnectedClientForLogin();
    if (!password) {
      throw new Error("Missing 2FA password.");
    }
    const config = loadTelegramConfig();
    try {
      const user = await client.signInWithPassword(
        { apiId: config.apiId, apiHash: config.apiHash },
        {
          password: async () => password,
          onError: async (err: Error) => {
            this.lastError = toSafeMessage(err, "2FA sign-in failed. Try again.");
            return true;
          },
        },
      );
      await this.onAuthorized(client, user);
    } catch (err) {
      logTelegramError("2FA sign in", err);
      this.lastError = toSafeMessage(err, "2FA sign-in failed. Try again.");
      throw new Error(this.lastError);
    }
  }

  // ── Groups & participants (Phase 15; auth state required) ────────────────

  private requireAuthorizedClient(): TelegramClient {
    if (!this.client || this.transport !== "connected" || !this.authorized) {
      throw new Error("Telegram authentication is required. Connect and log in first.");
    }
    return this.client;
  }

  /** List accessible groups/supergroups. Requires authorization. */
  async getGroups(): Promise<TelegramGroupSummary[]> {
    const client = this.requireAuthorizedClient();
    const records = await fetchGroupRecords(client);
    this.groupEntities = new Map(records.map((r) => [r.summary.id, r]));
    return records.map((r) => ({ ...r.summary }));
  }

  /** Deterministic lookup by opaque ID. Requires authorization. */
  async getGroupById(groupId: string): Promise<TelegramGroupSummary> {
    const client = this.requireAuthorizedClient();
    const record = await fetchGroupRecordById(client, groupId);
    this.groupEntities.set(record.summary.id, record);
    return { ...record.summary };
  }

  /**
   * Enumerate participants of one group by opaque ID. Requires
   * authorization. Returns plain serializable values; accessHash and
   * entities never cross the boundary. Refusing enumeration surfaces as a
   * typed error — never as a fake empty list.
   */
  async getParticipantsByGroupId(
    groupId: string,
  ): Promise<{ group: TelegramGroupSummary; participants: TelegramParticipant[] }> {
    const client = this.requireAuthorizedClient();
    const target = groupId.trim();
    let record = this.groupEntities.get(target);
    record ??= await fetchGroupRecordById(client, target);
    this.groupEntities.set(record.summary.id, record);
    const participants = await fetchParticipantsForRecord(client, record);
    return { group: { ...record.summary }, participants };
  }

  // ── Export (Phase 16; auth state required, group ID only) ─────────────────

  /**
   * Export one group's participants to CSV, resolved deterministically by
   * opaque group ID. Reuses group lookup + participant enumeration (no
   * duplication); the client stays connected and failures never produce an
   * empty CSV. `filePath` is server-side — routes must strip it.
   */
  async exportGroupById(
    groupId: string,
    options?: TelegramExportOptions,
  ): Promise<TelegramExportResult> {
    this.requireAuthorizedClient();
    const group = await this.getGroupById(groupId);
    const { participants } = await this.getParticipantsByGroupId(group.id);
    const rows = options?.excludeHiddenPhone
      ? participants.filter((p) => p.phone.trim() !== "")
      : participants;
    const override = options?.outputFile?.trim();
    const outputPath = override
      ? override
      : resolveTelegramOutputPath(group.title, exportDirForUser(this.userId, "telegram"));
    await exportTelegramCsv(rows, outputPath);
    return {
      groupId: group.id,
      groupTitle: group.title,
      participantCount: rows.length,
      filename: path.basename(outputPath),
      filePath: outputPath,
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private requireTransport(): TelegramClient {
    if (!this.client || this.transport !== "connected") {
      throw new Error("Telegram client is not connected. Call connect() first.");
    }
    return this.client;
  }

  private requireConnectedClientForLogin(): TelegramClient {
    const client = this.requireTransport();
    if (this.loginStep !== "awaiting_password") {
      throw new Error("No pending 2FA password request.");
    }
    return client;
  }

  private beginLogin(step: TelegramLoginStep): void {
    this.loginStep = step;
    this.currentQr = null;
    this.passwordHint = null;
    this.lastError = null;
  }

  private cancelLoginState(): void {
    this.loginPromise = null;
    this.loginAbort = null;
    this.loginStep = "none";
    this.currentQr = null;
    this.passwordHint = null;
    this.pendingPhone = null;
    this.pendingPhoneCodeHash = null;
  }

  private async onAuthorized(client: TelegramClient, user: unknown): Promise<void> {
    await this.persistSession(client);
    this.user = toConnectedUser(user);
    this.authorized = true;
    this.cancelLoginState();
    this.lastError = null;
  }

  private async persistSession(client: TelegramClient): Promise<void> {
    try {
      const data = client.session.save();
      if (data) {
        await saveTelegramSession(data, this.sessionPath);
      }
    } catch (err) {
      logTelegramError("persist session", err);
    }
  }

  private async readPasswordHint(client: TelegramClient): Promise<string | null> {
    try {
      const pwd = (await client.invoke(new Api.account.GetPassword())) as { hint?: unknown };
      return typeof pwd?.hint === "string" ? pwd.hint : null;
    } catch (err) {
      logTelegramError("read password hint", err);
      return null;
    }
  }
}
