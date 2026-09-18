import type { Client } from "whatsapp-web.js";
import * as qrcode from "qrcode-terminal";
import { logger } from "../utils/logger.js";
import {
  buildClient,
  formatAuthFailureMessage,
  formatDisconnectMessage,
  LEGACY_WHATSAPP_SESSION_SCOPE,
  whatsappSessionScopeForUser,
  type WhatsAppSessionScope,
} from "./client.js";
import {
  discoverGroupByName,
  fetchGroupSummaries,
  fetchGroupSummaryById,
  type GroupSummary,
} from "./group.js";
import { fetchParticipantsByGroupId } from "./participants.js";
import { resolveParticipantsWithStats } from "./contacts.js";
import { exportCsv, resolveOutputPath } from "../export/csv.js";
import { exportDirForUser } from "../export/paths.js";

// ── Public contract (consumed by the CLI and the Next.js API routes) ────────

/**
 * Explicit lifecycle states of the WhatsApp connection.
 *
 * - `disconnected`: no live client (initial state, after `disconnect()`,
 *   or after a `disconnected` event).
 * - `connecting`: `initialize()` in flight, waiting for QR scan / auth / ready.
 * - `qr`: a QR code is available via `getQRCode()` and awaits scanning.
 * - `connected`: `ready` was emitted — the client can be used for groups/export.
 * - `auth_failed`: `auth_failure` was emitted — see `error` in `getStatus()`.
 */
export type WhatsAppConnectionStatus =
  | "disconnected"
  | "connecting"
  | "qr"
  | "connected"
  | "auth_failed";

/**
 * Snapshot of the connection. Contains only plain values — never objects
 * from `whatsapp-web.js` — so it can be serialized directly by a future API.
 */
export interface WhatsAppStatus {
  status: WhatsAppConnectionStatus;
  /** Connected account number (`client.info.wid.user`), or `null` when unavailable. */
  number: string | null;
  /** Raw QR string from the `qr` event, or `null` when none is pending. */
  qr: string | null;
  /** Last failure message (`auth_failure`, `disconnected`, init error), or `null`. */
  error: string | null;
}

/**
 * Structured result of a group export — enough for a future HTTP route
 * to answer the frontend without parsing logs.
 */
export interface ExportResult {
  groupName: string;
  groupId: string;
  participantCount: number;
  resolvedCount: number;
  unresolvedCount: number;
  outputPath: string;
}

export interface ExportOptions {
  /** Explicit CSV destination. Defaults to `output/<sanitized-group-name>.csv`. */
  outputFile?: string;
}

export interface WhatsAppManagerOptions {
  /**
   * Print QR codes to the terminal via `qrcode-terminal` (useful for the CLI).
   * The raw QR string is always captured regardless of this flag, so a future
   * web frontend can retrieve it via `getQRCode()`.
   * @default true
   */
  showQrInTerminal?: boolean;
  /**
   * Factory for the underlying client. Receives this manager's session scope
   * (derived from `userId`, or the legacy scope). Defaults to the real
   * `whatsapp-web.js` client with persistent `LocalAuth`. Zero-arg factories
   * keep working: extra arguments are simply ignored.
   */
  clientFactory?: (scope: WhatsAppSessionScope) => Client;
  /**
   * Authenticated app user owning this manager's session. When set, the
   * manager uses an isolated LocalAuth scope; when omitted, the legacy
   * global `.wwebjs_auth` scope (CLI behavior, unchanged).
   */
  userId?: string;
}

// ── Manager ─────────────────────────────────────────────────────────────────

/**
 * Owns a single live `whatsapp-web.js` client for one authenticated app user
 * and keeps explicit connection state from the real client events (`qr`,
 * `authenticated`, `ready`, `auth_failure`, `disconnected`). Its LocalAuth
 * session scope is derived from `userId` (isolated per user); without a
 * userId it uses the legacy global `.wwebjs_auth` scope (CLI behavior).
 *
 * Orchestrates the existing modules (`group.ts`, `participants.ts`,
 * `contacts.ts`, `export/csv.ts`) without absorbing their logic, and never
 * destroys the client as part of an export — the client stays alive so
 * future consumers (CLI today, HTTP API later) can reuse it.
 */
export class WhatsAppManager {
  private client: Client | null = null;
  private connectionStatus: WhatsAppConnectionStatus = "disconnected";
  private currentQr: string | null = null;
  private lastError: string | null = null;
  private connectPromise: Promise<void> | null = null;
  private shutdownHandlersAttached = false;
  /**
   * Generation counter against late callbacks: disconnect() bumps it, and
   * every lifecycle handler ignores events from a previous generation so a
   * torn-down client can never resurrect manager state.
   */
  private epoch = 0;

  private readonly showQrInTerminal: boolean;
  private readonly clientFactory: (scope: WhatsAppSessionScope) => Client;
  private readonly sessionScope: WhatsAppSessionScope;
  private readonly userId: string | null;

  constructor(options?: WhatsAppManagerOptions) {
    this.showQrInTerminal = options?.showQrInTerminal ?? true;
    this.userId = options?.userId ?? null;
    this.sessionScope =
      options?.userId ? whatsappSessionScopeForUser(options.userId) : LEGACY_WHATSAPP_SESSION_SCOPE;
    this.clientFactory = options?.clientFactory ?? ((scope) => buildClient(scope));
  }

  /**
   * This manager's LocalAuth session scope. Observability for M3 (proves
   * which physical session a manager owns without touching the browser).
   */
  getSessionScope(): WhatsAppSessionScope {
    return { ...this.sessionScope };
  }

  // ── State inspection (no whatsapp-web.js objects leak) ────────────────────

  getStatus(): WhatsAppStatus {
    return {
      status: this.connectionStatus,
      number: this.getConnectedNumber(),
      qr: this.currentQr,
      error: this.lastError,
    };
  }

  /** Raw QR string from the last `qr` event, or `null` when none is pending. */
  getQRCode(): string | null {
    return this.currentQr;
  }

  /**
   * Number of the connected account, taken from the library-provided
   * `client.info.wid.user` (populated after `ready`). Returns `null` unless
   * the manager is `connected` and the library exposes the number.
   */
  getConnectedNumber(): string | null {
    if (this.connectionStatus !== "connected" || !this.client) return null;
    try {
      const info = (this.client as unknown as { info?: { wid?: { user?: unknown } } }).info;
      const user = info?.wid?.user;
      return typeof user === "string" && user.length > 0 ? user : null;
    } catch {
      return null;
    }
  }

  /** Last failure message, if any. Never silently swallowed. */
  getLastError(): string | null {
    return this.lastError;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Initialize the client and wait until it is `connected` (`ready`).
   * Concurrent calls share a single initialization — only one client is
   * ever created per manager. Resolves on `ready`, rejects on
   * `auth_failure`, `disconnected` during connect, or initialization errors.
   * Safe to call when already connected (no-op).
   */
  async connect(): Promise<void> {
    if (this.connectionStatus === "connected") return;
    if (this.connectPromise) return this.connectPromise;

    // Drop a stale client from a previous failed/disconnected attempt so a
    // retry always starts from a fresh instance (single client per manager).
    if (this.client) {
      const stale = this.client;
      this.client = null;
      try {
        await stale.destroy();
      } catch {
        // ignore — stale client teardown must not block reconnecting
      }
    }

    this.client = this.clientFactory(this.sessionScope);
    const client = this.client;
    this.wireClientEvents(client);
    this.connectionStatus = "connecting";
    this.lastError = null;

    const attempt = new Promise<void>((resolve, reject) => {
      const onReady = (): void => {
        cleanup();
        resolve();
      };
      const onAuthFailure = (message: string): void => {
        cleanup();
        reject(new Error(formatAuthFailureMessage(message)));
      };
      const onDisconnected = (reason: string): void => {
        cleanup();
        reject(new Error(formatDisconnectMessage(reason)));
      };
      const cleanup = (): void => {
        client.removeListener("ready", onReady);
        client.removeListener("auth_failure", onAuthFailure);
        client.removeListener("disconnected", onDisconnected);
      };
      client.once("ready", onReady);
      client.once("auth_failure", onAuthFailure);
      client.once("disconnected", onDisconnected);

      // `initialize()` may reject (e.g. browser launch failure) without any
      // lifecycle event firing — settle the waiter explicitly in that case.
      void client.initialize().catch((err: unknown) => {
        cleanup();
        const message = err instanceof Error ? err.message : String(err);
        this.lastError = `Failed to initialize WhatsApp client: ${message}`;
        this.connectionStatus = "disconnected";
        reject(new Error(this.lastError));
      });
    });

    this.connectPromise = attempt;
    try {
      await attempt;
    } catch (err) {
      if (this.connectPromise === attempt) this.connectPromise = null;
      throw err;
    }
  }

  /**
   * Destroy the client and return to `disconnected`. Idempotent — concurrent
   * or repeated calls destroy at most once and never throw.
   */
  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.connectPromise = null;
    this.currentQr = null;
    this.lastError = null;
    this.connectionStatus = "disconnected";
    this.epoch += 1;
    if (client) {
      try {
        await client.destroy();
        logger.info("WhatsApp client destroyed.");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`Error while destroying client: ${msg}`);
      }
    }
  }

  /**
   * Attach `SIGINT`/`SIGTERM` handlers that disconnect cleanly and exit 0.
   * Registered at most once per manager.
   */
  attachProcessShutdownHandlers(): void {
    if (this.shutdownHandlersAttached) return;
    this.shutdownHandlersAttached = true;

    const handleSignal = async (signal: string): Promise<void> => {
      logger.info(`Shutdown requested (${signal})...`);
      await this.disconnect();
      process.exit(0);
    };

    process.once("SIGINT", () => void handleSignal("SIGINT"));
    process.once("SIGTERM", () => void handleSignal("SIGTERM"));
  }

  // ── Operations (require a connected client; never destroy it) ─────────────

  private requireConnectedClient(): Client {
    if (!this.client || this.connectionStatus !== "connected") {
      throw new Error("WhatsApp client is not connected. Call connect() and wait until status is connected.");
    }
    return this.client;
  }

  /** List group chats. Requires `connected` — call `connect()` first. */
  async getGroups(): Promise<GroupSummary[]> {
    return fetchGroupSummaries(this.requireConnectedClient());
  }

  /**
   * Run the full export pipeline (discover group → extract participants →
   * resolve contacts → write CSV) and return a structured result.
   * The client remains connected afterwards for reuse.
   */
  async exportGroup(groupName: string, options?: ExportOptions): Promise<ExportResult> {
    const client = this.requireConnectedClient();
    const target = groupName.trim();
    if (!target) {
      throw new Error('Missing group name. Set GROUP_NAME in .env or pass --group "My Group".');
    }

    // Group discovery by exact name (throws GroupNotFoundError / AmbiguousGroupError).
    const group = await discoverGroupByName(client, target);
    return this.runExportPipeline(client, group, options?.outputFile);
  }

  /**
   * Deterministic variant of `exportGroup()`: resolves the group directly by
   * its opaque WhatsApp ID (e.g. `120363...@g.us`, never parsed), so groups
   * sharing a name are exported unambiguously. Shares the exact same
   * pipeline and result shape; the client stays connected.
   */
  async exportGroupById(groupId: string, options?: ExportOptions): Promise<ExportResult> {
    const client = this.requireConnectedClient();
    const group = await fetchGroupSummaryById(client, groupId);
    return this.runExportPipeline(client, group, options?.outputFile);
  }

  /**
   * Shared pipeline after the target group is resolved: extract participants
   * (`group.participants` only, dedup by WhatsApp ID) → resolve contacts
   * (individual failures → placeholders, never aborts) → write CSV
   * (semicolon, UTF-8 + BOM). Never destroys the client.
   */
  private async runExportPipeline(
    client: Client,
    group: GroupSummary,
    outputFile?: string,
  ): Promise<ExportResult> {
    // Participant extraction.
    const participants = await fetchParticipantsByGroupId(client, group.id);

    // Contact resolution.
    const { contacts, resolvedCount, unresolvedCount } = await resolveParticipantsWithStats(
      client,
      participants,
    );

    // CSV export. Client stays alive. Output resolves inside this user's
    // namespace (M5); legacy callers without a userId keep `output/`.
    const override = outputFile?.trim();
    const outputPath = override ? override : resolveOutputPath(group.name, exportDirForUser(this.userId, "whatsapp"));
    await exportCsv(contacts, outputPath);

    return {
      groupName: group.name,
      groupId: group.id,
      participantCount: participants.length,
      resolvedCount,
      unresolvedCount,
      outputPath,
    };
  }

  // ── Event wiring (single place where client events become state) ──────────

  private wireClientEvents(client: Client): void {
    const epoch = this.epoch;
    const current = (): boolean => epoch === this.epoch;

    client.on("qr", (qr: string) => {
      if (!current()) return;
      // Keep the raw QR string for programmatic retrieval (future web UI
      // renders it; the backend never converts it to an image).
      this.currentQr = qr;
      if (this.connectionStatus !== "connected") this.connectionStatus = "qr";
      logger.info("QR code received. Scan it with WhatsApp.");
      if (this.showQrInTerminal) {
        qrcode.generate(qr, { small: true });
        logger.info("Waiting for authentication...");
      }
    });

    client.on("authenticated", () => {
      if (!current()) return;
      logger.info("Authenticated.");
      this.currentQr = null;
      if (this.connectionStatus !== "connected") this.connectionStatus = "connecting";
    });

    client.on("ready", () => {
      if (!current()) return;
      logger.info("WhatsApp client ready.");
      this.currentQr = null;
      this.lastError = null;
      this.connectionStatus = "connected";
    });

    client.on("auth_failure", (message: string) => {
      if (!current()) return;
      logger.error(formatAuthFailureMessage(message));
      this.currentQr = null;
      this.lastError = formatAuthFailureMessage(message);
      this.connectionStatus = "auth_failed";
    });

    client.on("disconnected", (reason: string) => {
      if (!current()) return;
      logger.warn(formatDisconnectMessage(reason));
      this.currentQr = null;
      this.lastError = formatDisconnectMessage(reason);
      this.connectionStatus = "disconnected";
    });
  }
}
