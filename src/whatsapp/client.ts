import { Client, LocalAuth } from "whatsapp-web.js";
import { createHash } from "node:crypto";
import * as qrcode from "qrcode-terminal";
import { logger } from "../utils/logger.js";

// ── Pure helpers (testable without WhatsApp) ────────────────────────────────

export function formatAuthFailureMessage(reason: string): string {
  return `WhatsApp authentication failed: ${reason}`;
}

export function formatDisconnectMessage(reason: string): string {
  return `WhatsApp disconnected: ${reason}`;
}

export function formatShutdownMessage(signal: string): string {
  return `Shutdown requested (${signal})...`;
}

// ── Shutdown coordination ───────────────────────────────────────────────────

let shutdownHandlersRegistered = false;
let shuttingDown = false;

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function hasShutdownHandlersRegistered(): boolean {
  return shutdownHandlersRegistered;
}

/** Reset internal flags — public only for tests. */
export function __resetShutdownStateForTests(): void {
  shuttingDown = false;
  shutdownHandlersRegistered = false;
}

export async function destroyClientGracefully(client: Client): Promise<void> {
  try {
    await client.destroy();
    logger.info("WhatsApp client destroyed.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Error while destroying client: ${msg}`);
  }
}

export function registerGracefulShutdown(client: Client): void {
  if (shutdownHandlersRegistered) return;
  shutdownHandlersRegistered = true;

  const handleSignal = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(formatShutdownMessage(signal));
    await destroyClientGracefully(client);
    process.exit(0);
  };

  // Use `once` to avoid duplicate invocations; guard above prevents duplicate registration.
  process.once("SIGINT", () => void handleSignal("SIGINT"));
  process.once("SIGTERM", () => void handleSignal("SIGTERM"));
}

// ── Session scope (M3: physical isolation per app user) ─────────────────────

/**
 * Where one WhatsAppManager keeps its LocalAuth data. A scope is fully
 * determined by the authenticated app user id (or legacy default) — never
 * by request bodies, query strings, or client-controlled values.
 */
export interface WhatsAppSessionScope {
  /** LocalAuth dataPath. Unique per user; the legacy scope keeps ".wwebjs_auth". */
  dataPath: string;
  /**
   * LocalAuth clientId (alphanumeric + `__-`, enforced by the library).
   * The unique dataPath alone already isolates storage
   * (`<dataPath>/session` vs `<dataPath>/session-<clientId>`); clientId adds
   * a distinct client identity for auditability, at the cost of one nesting
   * level. Absent only for the legacy scope (byte-identical legacy behavior).
   */
  clientId?: string;
}

/** Pre-M3 behavior, preserved for the CLI and the unmigrated legacy session. */
export const LEGACY_WHATSAPP_SESSION_SCOPE: WhatsAppSessionScope = {
  dataPath: ".wwebjs_auth",
};

/** Root directory holding one subdirectory per app user. Gitignored. */
export const WHATSAPP_SESSIONS_ROOT = ".whatsapp_sessions";

/**
 * Deterministic, filesystem-safe scope for an authenticated app user:
 * `sha256("telezap:whatsapp-session:v1:" + userId)` hex. One-way (no
 * username in paths), collision-resistant, `[0-9a-f]` only — safe against
 * traversal even for hostile userIds.
 */
export function whatsappSessionScopeForUser(userId: string): WhatsAppSessionScope {
  if (!userId || typeof userId !== "string" || !userId.trim()) {
    throw new Error("whatsappSessionScopeForUser requires a non-empty userId.");
  }
  const hex = createHash("sha256").update(`telezap:whatsapp-session:v1:${userId}`, "utf8").digest("hex");
  return {
    dataPath: `${WHATSAPP_SESSIONS_ROOT}/${hex}`,
    clientId: `wa-${hex.slice(0, 16)}`,
  };
}

// ── Client creation ─────────────────────────────────────────────────────────

/**
 * Build the raw `whatsapp-web.js` client with persistent `LocalAuth`, without
 * attaching any lifecycle listeners. Shared by the legacy `createClient()`
 * (CLI) and the `WhatsAppManager` (which wires its own stateful listeners),
 * so session configuration exists in exactly one place.
 */
export function buildClient(scope: WhatsAppSessionScope = LEGACY_WHATSAPP_SESSION_SCOPE): Client {
  return new Client({
    authStrategy: new LocalAuth({
      dataPath: scope.dataPath,
      ...(scope.clientId ? { clientId: scope.clientId } : {}),
    }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });
}

/**
 * Create and configure the WhatsApp Web client with LocalAuth and lifecycle handlers.
 * Does NOT call `client.initialize()` — caller is responsible for that.
 */
export function createClient(): Client {
  const client = buildClient();

  client.on("qr", (qr: string) => {
    logger.info("QR code received. Scan it with WhatsApp.");
    logger.info("Scan the QR code with WhatsApp:");
    qrcode.generate(qr, { small: true });
    logger.info("Waiting for authentication...");
  });

  client.on("authenticated", () => {
    logger.info("Authenticated.");
  });

  client.on("ready", () => {
    logger.info("WhatsApp client ready.");
    logger.info("Client is ready. Press Ctrl+C to exit.");
  });

  client.on("auth_failure", (message: string) => {
    logger.error(formatAuthFailureMessage(message));
  });

  client.on("disconnected", (reason: string) => {
    logger.warn(formatDisconnectMessage(reason));
  });

  return client;
}

/**
 * Wait until the client emits `ready`. Rejects on `auth_failure`.
 * Must be called before or right after `client.initialize()` — caller should create the promise before initializing to avoid race.
 */
export function waitForReady(client: Client): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onReady = (): void => {
      cleanup();
      resolve();
    };
    const onAuthFailure = (message: string): void => {
      cleanup();
      reject(new Error(formatAuthFailureMessage(message)));
    };
    const cleanup = (): void => {
      client.removeListener("ready", onReady);
      client.removeListener("auth_failure", onAuthFailure);
    };
    client.once("ready", onReady);
    client.once("auth_failure", onAuthFailure);
  });
}
