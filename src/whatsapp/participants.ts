import type { Client } from "whatsapp-web.js";

// ── Internal model (boundary after whatsapp-web.js) ─────────────────────────

/**
 * Stable summary of a group participant.
 * `whatsappId` is opaque — preserved exactly as `participant.id._serialized`
 * (may be `...@c.us` or newer forms like `...@lid`). Never parsed.
 * Contains only participant identity + admin flags; no name/number (Phase 4).
 */
export interface GroupParticipantSummary {
  whatsappId: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

// ── whatsapp-web.js compatibility boundary ───────────────────────────────────

/**
 * Minimal shape of a participant as exposed by `GroupChat.participants`.
 * whatsapp-web.js types are sometimes incomplete for LIDs; we isolate the
 * unsafe surface here and document the reason.
 */
type WhatsappParticipantLike = {
  id:
    | string
    | {
        _serialized?: string;
        _serializedAlt?: string;
        // some runtimes expose `id` nested or as stringifiable object
        toString(): string;
      };
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
};

type GroupChatLike = {
  id?: unknown;
  participants?: unknown;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractWhatsappId(rawId: WhatsappParticipantLike["id"]): string {
  if (typeof rawId === "string") return rawId;
  if (rawId && typeof rawId === "object") {
    const maybe = rawId as { _serialized?: unknown; _serializedAlt?: unknown };
    if (typeof maybe._serialized === "string" && maybe._serialized.length > 0) {
      return maybe._serialized;
    }
    if (typeof maybe._serializedAlt === "string" && maybe._serializedAlt.length > 0) {
      return maybe._serializedAlt;
    }
  }
  // Fallback: stringify but treat as opaque — do not parse.
  return String(rawId);
}

// ── Pure mapping ─────────────────────────────────────────────────────────────

/**
 * Convert a whatsapp-web.js participant to a stable summary.
 * Preserves serialized ID unchanged, copies admin flags (defaults to false).
 * Does not mutate the source object.
 */
export function participantToSummary(participant: WhatsappParticipantLike): GroupParticipantSummary {
  // Defensive copy — do not mutate source
  const whatsappId = extractWhatsappId(participant.id);
  return {
    whatsappId,
    isAdmin: Boolean(participant.isAdmin),
    isSuperAdmin: Boolean(participant.isSuperAdmin),
  };
}

/**
 * Deduplicate participants by `whatsappId`, preserving first occurrence
 * and original order. Deterministic.
 */
export function deduplicateParticipants(
  participants: GroupParticipantSummary[],
): GroupParticipantSummary[] {
  const seen = new Set<string>();
  const result: GroupParticipantSummary[] = [];
  for (const p of participants) {
    if (!seen.has(p.whatsappId)) {
      seen.add(p.whatsappId);
      result.push(p);
    }
  }
  return result;
}

/**
 * Extract and deduplicate participants from a GroupChat-like object.
 * Source is `group.participants` only — never scrapes messages.
 * Throws if participants are missing/unexpected (so caller can fail clearly
 * instead of silently producing an empty list). Returns empty array only for
 * a genuinely empty participant collection.
 */
export function extractParticipants(group: GroupChatLike): GroupParticipantSummary[] {
  if (!group || typeof group !== "object") {
    throw new Error("Group does not expose participants as expected.");
  }
  const raw = (group as { participants?: unknown }).participants;
  if (raw === undefined || raw === null) {
    throw new Error("Group does not expose participants as expected.");
  }
  if (!Array.isArray(raw)) {
    throw new Error("Group participants is not an array.");
  }
  // Empty list is valid (empty group)
  if (raw.length === 0) return [];

  const mapped = (raw as WhatsappParticipantLike[]).map((p) => participantToSummary(p));
  return deduplicateParticipants(mapped);
}

/**
 * Fetch participants via the WhatsApp client for a given group id.
 * Used after group discovery: `discoverGroupByName` gives id, then this
 * fetches the full GroupChat to access `participants`. Does not call
 * `client.getChats()` again — only `client.getChatById`.
 */
export async function fetchParticipantsByGroupId(
  client: Client,
  groupId: string,
): Promise<GroupParticipantSummary[]> {
  const chat = await client.getChatById(groupId);
  // Runtime check: ensure it's a group (has participants)
  return extractParticipants(chat as unknown as GroupChatLike);
}
