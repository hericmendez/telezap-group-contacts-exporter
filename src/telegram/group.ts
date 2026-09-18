import type { TelegramClient } from "teleproto";

// ── Installed API findings (teleproto@1.229.0, tl/generated/api.d.ts) ───────
// Discovery: client.getDialogs({}) → Dialog[] with .entity (Api.Chat |
// Api.Channel | Api.User), .isGroup/.isChannel helpers, .id (BigInteger).
//   Api.Chat (basic group): id, title, participantsCount, left?,
//     deactivated?, migratedTo? — NO accessHash.
//   Api.Channel: id, accessHash?, title, megagroup?, broadcast?, gigagroup?,
//     forum?, monoforum?, left?, min? — accessHash present on full entities.
// Classification uses the `className` string ("Chat"/"Channel") plus flags,
// so it works on real instances and stays honest about what was inspected.

// ── Public model (browser-safe: opaque string id, no accessHash) ────────────

export type TelegramGroupKind = "group" | "supergroup";

export interface TelegramGroupSummary {
  /** Opaque decimal peer id. Never a number (64-bit IDs exceed safety). */
  id: string;
  /** Presentation only — never an identifier. */
  title: string;
  kind: TelegramGroupKind;
  participantCount?: number;
}

/**
 * Server-side record: public summary plus the live entity needed for later
 * calls (carries accessHash where Telegram provides one). Never leaves the
 * server — no accessHash, entities, or peers in any API response.
 */
export interface TelegramGroupRecord {
  summary: TelegramGroupSummary;
  /** Opaque teleproto entity (Api.Chat | Api.Channel). Server-side only. */
  entity: unknown;
}

// ── Errors (domain-level, safe messages for HTTP mapping) ───────────────────

export class TelegramGroupNotFoundError extends Error {
  constructor(groupId: string) {
    super(`Telegram group "${groupId}" was not found.`);
    this.name = "TelegramGroupNotFoundError";
  }
}

// ── Classification ──────────────────────────────────────────────────────────

type EntityLike = {
  className?: string;
  left?: boolean;
  deactivated?: boolean;
  migratedTo?: unknown;
  megagroup?: boolean;
  broadcast?: boolean;
  gigagroup?: boolean;
  monoforum?: boolean;
  min?: boolean;
  id?: unknown;
  title?: unknown;
  participantsCount?: unknown;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Map one dialog entity to an eligible group record, or null when the entity
 * is not an exportable group (direct chats, broadcast channels, gigagroups,
 * monoforums, left/deactivated/migrated chats, partial `min` entities).
 * Rules come from entity flags — never from titles.
 */
export function entityToGroupRecord(entity: EntityLike | null | undefined): TelegramGroupRecord | null {
  if (!entity || typeof entity !== "object") return null;
  if (entity.min) return null; // partial entity: title/accessHash unreliable
  if (entity.left) return null;

  const id = entity.id === null || entity.id === undefined ? "" : String(entity.id);
  if (!id) return null;

  if (entity.className === "Chat") {
    if (entity.deactivated) return null;
    if (entity.migratedTo) return null; // vestige: the supergroup lists separately
    const summary: TelegramGroupSummary = { id, title: asText(entity.title) || "Unnamed group", kind: "group" };
    if (typeof entity.participantsCount === "number") summary.participantCount = entity.participantsCount;
    return { summary, entity };
  }

  if (entity.className === "Channel") {
    if (entity.broadcast || entity.gigagroup || entity.monoforum) return null;
    if (!entity.megagroup) return null; // not a supergroup (unknown future kind)
    const summary: TelegramGroupSummary = { id, title: asText(entity.title) || "Unnamed group", kind: "supergroup" };
    if (typeof entity.participantsCount === "number") summary.participantCount = entity.participantsCount;
    return { summary, entity };
  }

  return null;
}

/**
 * Deterministic ordering at the domain boundary: title, then id.
 * Telegram dialog order is recency-based and unstable for our purpose.
 */
export function sortGroupRecords(records: TelegramGroupRecord[]): TelegramGroupRecord[] {
  return [...records].sort((a, b) => {
    const byTitle = a.summary.title.localeCompare(b.summary.title);
    if (byTitle !== 0) return byTitle;
    return a.summary.id < b.summary.id ? -1 : a.summary.id > b.summary.id ? 1 : 0;
  });
}

// ── Discovery & lookup ──────────────────────────────────────────────────────

type DialogLike = { entity?: EntityLike | null };

/**
 * Fetch accessible groups via the account's dialogs. One mechanism for both
 * listing and later ID lookup (the record keeps the entity with its
 * accessHash), so no IDs are brute-forced and no per-member entity fetch
 * is needed. Sorted deterministically; duplicate titles all returned.
 */
export async function fetchGroupRecords(client: TelegramClient): Promise<TelegramGroupRecord[]> {
  const dialogs = (await client.getDialogs({})) as DialogLike[];
  const records: TelegramGroupRecord[] = [];
  for (const dialog of dialogs ?? []) {
    const record = entityToGroupRecord(dialog?.entity);
    if (record) records.push(record);
  }
  return sortGroupRecords(records);
}

/** Public summaries only — the shape the API returns. */
export async function fetchGroups(client: TelegramClient): Promise<TelegramGroupSummary[]> {
  const records = await fetchGroupRecords(client);
  return records.map((r) => ({ ...r.summary }));
}

/**
 * Deterministic lookup by opaque ID through the same discovery list.
 * Unknown/empty IDs, channels-as-groups, and unsupported entities all
 * surface as TelegramGroupNotFoundError (→ HTTP 404).
 */
export async function fetchGroupRecordById(
  client: TelegramClient,
  groupId: string,
): Promise<TelegramGroupRecord> {
  const target = groupId.trim();
  if (!target) {
    throw new TelegramGroupNotFoundError(groupId);
  }
  const records = await fetchGroupRecords(client);
  const found = records.find((r) => r.summary.id === target);
  if (!found) {
    throw new TelegramGroupNotFoundError(target);
  }
  return found;
}
