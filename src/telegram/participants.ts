import bigInt from "big-integer";
import { Api, type TelegramClient } from "teleproto";
import { FloodWaitError } from "teleproto/errors";
import type { TelegramGroupRecord } from "./group.js";

// ── Installed API findings (teleproto@1.229.0) ──────────────────────────────
// Supergroups: client.invoke(new Api.channels.GetParticipants({ channel,
//   filter: ChannelParticipantsRecent, offset, limit, hash })) →
//   channels.ChannelParticipants { count, participants, users }.
//   Plain offset/limit pagination (no cursor math); `hash` is an ETag-like
//   optimization — 0 disables caching for export enumeration.
// Basic groups: client.invoke(new Api.messages.GetFullChat({ chatId })) →
//   messages.ChatFull { fullChat: { participants }, users }. participants is
//   ChatParticipants { participants: ChatParticipant*[] } or
//   ChatParticipantsForbidden (no enumeration possible).
// IDs are `long` = BigInteger: String(id) at the boundary, never Number().

// ── Public model ────────────────────────────────────────────────────────────

export interface TelegramParticipant {
  /** Opaque decimal user id — the reliable identity. Never a number. */
  telegramId: string;
  firstName: string;
  lastName: string;
  username: string;
  /** Often "" — Telegram privacy hides phones from non-contacts. */
  phone: string;
  isAdmin: boolean;
  isOwner: boolean;
}

// ── Errors (domain-level, safe messages for HTTP mapping) ───────────────────

export class TelegramParticipantsUnavailableError extends Error {
  constructor(message = "Participant enumeration is not available for this group.") {
    super(message);
    this.name = "TelegramParticipantsUnavailableError";
  }
}

export class TelegramFloodError extends Error {
  readonly seconds: number;
  constructor(seconds: number) {
    super(`Telegram is rate-limiting requests. Try again in ${seconds}s.`);
    this.name = "TelegramFloodError";
    this.seconds = seconds;
  }
}

// ── Pagination policy (documented, deterministic, testable) ─────────────────

export const PARTICIPANT_PAGE_LIMIT = 200;
export const PARTICIPANT_MAX_PAGES = 500;

// ── Mapping ─────────────────────────────────────────────────────────────────

type UserLike = {
  className?: string;
  id?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  username?: unknown;
  usernames?: Array<{ username?: unknown }>;
  phone?: unknown;
  // other Telegram flags (bot, deleted, verified, …) are ignored by the model
  [extra: string]: unknown;
};

type ParticipantLike = {
  className?: string;
  userId?: unknown;
};

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

function usernameOf(user: UserLike): string {
  const multi = Array.isArray(user.usernames)
    ? user.usernames.map((u) => textOf(u?.username)).find((s) => s.length > 0)
    : undefined;
  return multi ?? textOf(user.username);
}

/** Role from the actual participant constructor — never from names/labels. */
export function channelRoleOf(className: string | undefined): { isAdmin: boolean; isOwner: boolean } {
  if (className === "ChannelParticipantCreator") return { isAdmin: true, isOwner: true };
  if (className === "ChannelParticipantAdmin") return { isAdmin: true, isOwner: false };
  return { isAdmin: false, isOwner: false };
}

export function basicRoleOf(className: string | undefined): { isAdmin: boolean; isOwner: boolean } {
  if (className === "ChatParticipantCreator") return { isAdmin: true, isOwner: true };
  if (className === "ChatParticipantAdmin") return { isAdmin: true, isOwner: false };
  return { isAdmin: false, isOwner: false };
}

/**
 * Map one Telegram user to the stable model. Missing fields become "" —
 * never "undefined"/"null". Bots, deleted, and userEmpty entries stay rows
 * when an id is present; a null user becomes a placeholder (id preserved).
 */
export function toTelegramParticipant(
  user: UserLike | null | undefined,
  telegramId: string,
  role: { isAdmin: boolean; isOwner: boolean },
): TelegramParticipant {
  if (!user || typeof user !== "object" || user.className === "UserEmpty") {
    return { telegramId, firstName: "", lastName: "", username: "", phone: "", ...role };
  }
  return {
    telegramId,
    firstName: textOf(user.firstName),
    lastName: textOf(user.lastName),
    username: usernameOf(user),
    phone: textOf(user.phone),
    ...role,
  };
}

// ── Error translation (RPC → domain; no raw internals leak) ─────────────────

const UNAVAILABLE_NAMES = new Set([
  "ChatAdminRequiredError",
  "ChannelPrivateError",
  "ChannelInvalidError",
]);

export function toParticipantsError(err: unknown): Error {
  if (err instanceof FloodWaitError) {
    return new TelegramFloodError(err.seconds);
  }
  if (err instanceof TelegramFloodError || err instanceof TelegramParticipantsUnavailableError) {
    return err;
  }
  const name = err instanceof Error ? err.name : "";
  if (UNAVAILABLE_NAMES.has(name)) {
    return new TelegramParticipantsUnavailableError(
      "Participant enumeration is not available for this group with the current account.",
    );
  }
  return new Error("Could not enumerate Telegram participants. Try again later.");
}

// ── Enumeration ─────────────────────────────────────────────────────────────

type ChannelPage = {
  className?: string;
  participants?: ParticipantLike[];
  users?: UserLike[];
};

function indexUsers(users: UserLike[] | undefined): Map<string, UserLike> {
  const map = new Map<string, UserLike>();
  for (const user of users ?? []) {
    if (user && typeof user === "object" && user.id !== null && user.id !== undefined) {
      map.set(String(user.id), user);
    }
  }
  return map;
}

/**
 * Enumerate a supergroup sequentially (Recent filter = what ordinary members
 * may see; admin-only filters are out of scope). Stops when a page is short,
 * errors when the offset cannot advance or pages exceed the cap — never loops
 * forever. Deduplicates by telegramId, preserving first-seen order.
 */
export async function fetchSupergroupParticipants(
  client: TelegramClient,
  channel: unknown,
): Promise<TelegramParticipant[]> {
  const out: TelegramParticipant[] = [];
  const seen = new Set<string>();
  let offset = 0;

  for (let page = 1; page <= PARTICIPANT_MAX_PAGES; page++) {
    let res: ChannelPage;
    try {
      res = (await client.invoke(
        new Api.channels.GetParticipants({
          channel: channel as never,
          filter: new Api.ChannelParticipantsRecent(),
          offset,
          limit: PARTICIPANT_PAGE_LIMIT,
          hash: bigInt(0),
        }),
      )) as ChannelPage;
    } catch (err) {
      throw toParticipantsError(err);
    }

    const participants = Array.isArray(res?.participants) ? res.participants : null;
    if (!participants) {
      throw new Error("Could not enumerate Telegram participants. Try again later.");
    }
    const usersById = indexUsers(res.users);

    for (const entry of participants) {
      const id = entry?.userId === null || entry?.userId === undefined ? "" : String(entry.userId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(toTelegramParticipant(usersById.get(id) ?? null, id, channelRoleOf(entry?.className)));
    }

    if (participants.length < PARTICIPANT_PAGE_LIMIT) return out;
    const next = offset + participants.length;
    if (next <= offset) {
      throw new Error("Could not enumerate Telegram participants. Try again later.");
    }
    offset = next;
  }

  throw new Error("Could not enumerate Telegram participants. Try again later.");
}

type FullChatResponse = {
  fullChat?: { participants?: { className?: string; participants?: ParticipantLike[] } };
  users?: UserLike[];
};

/**
 * Enumerate a basic group via messages.GetFullChat. The response carries its
 * own `users` vector, so no per-member lookup (and no accessHash juggling)
 * is needed. Forbidden full chats become an explicit "unavailable" error —
 * never a fake empty list.
 */
export async function fetchBasicGroupParticipants(
  client: TelegramClient,
  chatId: unknown,
): Promise<TelegramParticipant[]> {
  let res: FullChatResponse;
  try {
    res = (await client.invoke(new Api.messages.GetFullChat({ chatId: chatId as never }))) as unknown as FullChatResponse;
  } catch (err) {
    throw toParticipantsError(err);
  }

  const container = res?.fullChat?.participants;
  if (!container || container.className === "ChatParticipantsForbidden") {
    throw new TelegramParticipantsUnavailableError(
      "Participant enumeration is not available for this group with the current account.",
    );
  }
  if (!Array.isArray(container.participants)) {
    throw new Error("Could not enumerate Telegram participants. Try again later.");
  }

  const usersById = indexUsers(res.users);
  const out: TelegramParticipant[] = [];
  const seen = new Set<string>();
  for (const entry of container.participants) {
    const id = entry?.userId === null || entry?.userId === undefined ? "" : String(entry.userId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(toTelegramParticipant(usersById.get(id) ?? null, id, basicRoleOf(entry?.className)));
  }
  return out;
}

/** Dispatch by group kind; the entity travels inside the server-side record. */
export async function fetchParticipantsForRecord(
  client: TelegramClient,
  record: TelegramGroupRecord,
): Promise<TelegramParticipant[]> {
  if (record.summary.kind === "supergroup") {
    return fetchSupergroupParticipants(client, record.entity);
  }
  const entity = record.entity as { id?: unknown };
  return fetchBasicGroupParticipants(client, entity?.id);
}
