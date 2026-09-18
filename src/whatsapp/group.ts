import type { Client } from "whatsapp-web.js";
import { logger } from "../utils/logger.js";

// ── Internal representation (decoupled from whatsapp-web.js) ────────────────

/**
 * Minimal group metadata preserved for logging / future phases.
 * `id` is opaque WhatsApp group id (e.g. `123@g.us`), `participantCount` may be undefined if unavailable.
 */
export interface GroupSummary {
  id: string;
  name: string;
  participantCount?: number;
  isGroup: boolean;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class GroupNotFoundError extends Error {
  constructor(groupName: string) {
    super(`Group "${groupName}" was not found.`);
    this.name = "GroupNotFoundError";
  }
}

export class AmbiguousGroupError extends Error {
  groups: GroupSummary[];
  constructor(groupName: string, groups: GroupSummary[]) {
    const header = `Multiple WhatsApp groups named "${groupName}" were found.`;
    const hint = "Please identify the group using a more specific selector.";
    const details = groups
      .map((g, idx) => {
        const participants =
          g.participantCount !== undefined ? `${g.participantCount} participants` : "unknown participants";
        return `${idx + 1}. ${g.name} — ${participants} — ${g.id}`;
      })
      .join("\n");
    super(`${header}\n${hint}\n\n${details}\n\nUse a more specific group selector.`);
    this.name = "AmbiguousGroupError";
    this.groups = groups;
  }
}

// ── Pure selection ───────────────────────────────────────────────────────────

/**
 * Pure function: select group by exact name with ambiguity detection.
 * Only chats where `isGroup === true` are considered; non-groups are ignored.
 * Matching is exact (`===`), not fuzzy.
 * Testable without WhatsApp.
 */
export function findGroupByName(groups: GroupSummary[], targetName: string): GroupSummary {
  const matches = groups.filter((g) => g.isGroup && g.name === targetName);
  if (matches.length === 0) throw new GroupNotFoundError(targetName);
  if (matches.length > 1) throw new AmbiguousGroupError(targetName, matches);
  return matches[0]!;
}

// ── Mapping from whatsapp-web.js Chat ────────────────────────────────────────

type WhatsappChatLike = {
  id: string | { _serialized?: string; id?: string; toString(): string };
  name: string;
  isGroup: boolean;
  // whatsapp-web.js exposes participants in various shapes; we handle both.
  participants?: unknown[];
  groupMetadata?: { participants?: unknown[] };
};

function extractChatId(rawId: WhatsappChatLike["id"]): string {
  if (typeof rawId === "string") return rawId;
  if (rawId && typeof rawId === "object") {
    if ("_serialized" in rawId && typeof rawId._serialized === "string") return rawId._serialized;
    if ("id" in rawId && typeof (rawId as { id?: unknown }).id === "string")
      return (rawId as { id: string }).id;
  }
  return String(rawId);
}

function extractParticipantCount(chat: WhatsappChatLike): number | undefined {
  if (Array.isArray(chat.participants)) return chat.participants.length;
  if (chat.groupMetadata && Array.isArray(chat.groupMetadata.participants))
    return chat.groupMetadata.participants.length;
  return undefined;
}

/**
 * Convert a whatsapp-web.js Chat-like object to GroupSummary.
 * Treats `id` as opaque, preserves name/participantCount/isGroup.
 */
export function chatToGroupSummary(chat: WhatsappChatLike): GroupSummary {
  return {
    id: extractChatId(chat.id),
    name: chat.name,
    isGroup: Boolean(chat.isGroup),
    participantCount: extractParticipantCount(chat),
  };
}

// ── Async discovery (requires real Client) ───────────────────────────────────

/**
 * Fetch all group summaries from the authenticated client.
 * Only `chat.isGroup === true` chats are returned.
 */
export async function fetchGroupSummaries(client: Client): Promise<GroupSummary[]> {
  const chats = await client.getChats();
  const groups = chats.filter((chat) => (chat as unknown as { isGroup: boolean }).isGroup === true);
  return groups.map((chat) =>
    chatToGroupSummary(chat as unknown as WhatsappChatLike),
  );
}

/**
 * Discover a single group by exact name via the WhatsApp client.
 * Throws GroupNotFoundError or AmbiguousGroupError on failure.
 */
export async function discoverGroupByName(
  client: Client,
  targetName: string,
): Promise<GroupSummary> {
  const summaries = await fetchGroupSummaries(client);
  return findGroupByName(summaries, targetName);
}

/**
 * Fetch a single group directly by its opaque WhatsApp ID
 * (e.g. `120363423663114428@g.us` — passed through untouched, never parsed).
 * Throws GroupNotFoundError when the ID does not resolve to a group chat,
 * so API consumers get a 404 without leaking `whatsapp-web.js` internals.
 */
export async function fetchGroupSummaryById(
  client: Client,
  groupId: string,
): Promise<GroupSummary> {
  const target = groupId.trim();
  if (!target) {
    throw new GroupNotFoundError(groupId);
  }
  let chat: unknown;
  try {
    chat = await client.getChatById(target);
  } catch {
    throw new GroupNotFoundError(target);
  }
  if (!chat || typeof chat !== "object") {
    throw new GroupNotFoundError(target);
  }
  const summary = chatToGroupSummary(chat as WhatsappChatLike);
  if (!summary.isGroup) {
    throw new GroupNotFoundError(target);
  }
  return summary;
}

// ── Helpers for CLI logging ──────────────────────────────────────────────────

export function logGroupSummary(group: GroupSummary): void {
  logger.info(`Group found: ${group.name}`);
  logger.info(`Group ID: ${group.id}`);
  if (group.participantCount !== undefined) {
    logger.info(`Participants: ${group.participantCount}`);
  } else {
    logger.info("Participants: unknown");
  }
}
