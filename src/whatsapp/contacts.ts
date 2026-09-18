import type { Client } from "whatsapp-web.js";
import type { GroupParticipantSummary } from "./participants.js";
import { logger } from "../utils/logger.js";

// ── Installed API inspection (whatsapp-web.js 1.34.7) ───────────────────────
// Contact as defined in node_modules/whatsapp-web.js/index.d.ts and
// src/structures/Contact.js:
//   id: ContactId { server, user, _serialized }
//   number: string            // data.userid  — phone number, may be "" for LID
//   name?: string             // saved by current user, may be undefined
//   pushname: string          // public pushname (types: required string, runtime may be undefined)
//   shortName?: string        // shortened version of name
// Limits discovered:
//   - No guaranteed `phone` field separate from `number`; `number` is the canonical phone.
//   - LID contacts have _serialized like `123@lid` but `number` may be empty / not phone.
//   - `name`/`pushname`/`number` can be undefined/null at runtime; we normalize to "".
//   - `id._serialized` is the reliable opaque identifier for the contact.
// Decision: use number, name, pushname (not shortName) for ResolvedContact; shortName is redundant.

// ── Internal model ───────────────────────────────────────────────────────────

/**
 * Contact resolved from a participant.
 * `whatsappId` is the participant's opaque ID (preserved, not derived from contact).
 * `name`/`pushname`/`number` are normalized to "" when unavailable — safe for Phase 5 CSV.
 * `isAdmin`/`isSuperAdmin` are copied from participant, not recalculated.
 */
export interface ResolvedContact {
  whatsappId: string;
  name: string;
  pushname: string;
  number: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

// ── Compatibility boundary ───────────────────────────────────────────────────

type ContactLike = {
  id?: { _serialized?: string };
  name?: string | null;
  pushname?: string | null;
  shortName?: string | null;
  number?: string | null;
  // we intentionally ignore other fields
};

function normalizeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Pure mapper: participant + contact → ResolvedContact.
 * Preserves participant whatsappId (opaque, not replaced by contact.id).
 * Normalizes missing contact fields to "".
 * Does not mutate inputs.
 */
export function toResolvedContact(
  participant: GroupParticipantSummary,
  contact: ContactLike | null | undefined,
): ResolvedContact {
  // contact may be null/undefined on unresolved — treat as placeholder
  if (!contact) {
    return {
      whatsappId: participant.whatsappId,
      name: "",
      pushname: "",
      number: "",
      isAdmin: participant.isAdmin,
      isSuperAdmin: participant.isSuperAdmin,
    };
  }
  return {
    whatsappId: participant.whatsappId,
    name: normalizeString(contact.name),
    pushname: normalizeString(contact.pushname),
    number: normalizeString(contact.number),
    isAdmin: participant.isAdmin,
    isSuperAdmin: participant.isSuperAdmin,
  };
}

function toPlaceholder(participant: GroupParticipantSummary): ResolvedContact {
  return {
    whatsappId: participant.whatsappId,
    name: "",
    pushname: "",
    number: "",
    isAdmin: participant.isAdmin,
    isSuperAdmin: participant.isSuperAdmin,
  };
}

// ── Per-participant resolution ───────────────────────────────────────────────

/**
 * Resolve a single participant via `client.getContactById(participant.whatsappId)`.
 * On success: returns mapped ResolvedContact.
 * On individual failure: logs warning, returns placeholder (does not throw).
 * Only throws for fatal client-level issues (missing client / method).
 */
export async function resolveParticipant(
  client: Client,
  participant: GroupParticipantSummary,
): Promise<ResolvedContact> {
  if (!client || typeof (client as unknown as { getContactById?: unknown }).getContactById !== "function") {
    throw new Error("WhatsApp client is not available for contact resolution.");
  }
  try {
    const contact = await client.getContactById(participant.whatsappId);
    if (!contact) {
      logger.warn(`Contact resolution warning: could not resolve ${participant.whatsappId}`);
      return toPlaceholder(participant);
    }
    return toResolvedContact(participant, contact as unknown as ContactLike);
  } catch (err) {
    // Individual lookup failure — warn, continue with placeholder
    logger.warn(`Contact resolution warning: could not resolve ${participant.whatsappId}`);
    // Do not log stack for ordinary per-contact failures
    void err;
    return toPlaceholder(participant);
  }
}

// ── Batch resolution ─────────────────────────────────────────────────────────

/**
 * Resolve all participants sequentially.
 * Sequential is chosen for whatsapp-web.js/Puppeteer safety: avoids concurrent
 * `getContactById` calls overwhelming the underlying page and yields deterministic ordering.
 * No concurrency framework is introduced.
 *
 * - Preserves input order.
 * - Avoids duplicate lookups via per-whatsappId cache (defensive, Phase 3 already deduped).
 * - Never discards a participant — unresolved become placeholders.
 * - Returns ResolvedContact[] in input order (length === input length).
 */
export async function resolveParticipants(
  client: Client,
  participants: GroupParticipantSummary[],
): Promise<ResolvedContact[]> {
  const { contacts } = await resolveParticipantsWithStats(client, participants);
  return contacts;
}

export interface ResolutionStats {
  contacts: ResolvedContact[];
  resolvedCount: number;
  unresolvedCount: number;
}

/**
 * Batch resolve with stats for CLI reporting.
 * Tracks per-input resolved vs unresolved (unresolved = getContactById failure/empty).
 * Defensive cache avoids duplicate lookups but counts each input occurrence for
 * `resolvedCount`/`unresolvedCount` (so 100 participants with 1 failure → 99/1).
 */
export async function resolveParticipantsWithStats(
  client: Client,
  participants: GroupParticipantSummary[],
): Promise<ResolutionStats> {
  if (!client || typeof (client as unknown as { getContactById?: unknown }).getContactById !== "function") {
    throw new Error("WhatsApp client is not available for contact resolution.");
  }
  // Defensive: do not mutate input
  const input = [...participants];
  // Cache resolved contact per whatsappId to avoid duplicate lookups
  const cache = new Map<string, ResolvedContact>();
  // Track whether cached value was resolved or unresolved (placeholder due to failure)
  const cacheIsResolved = new Map<string, boolean>();
  const results: ResolvedContact[] = [];
  let resolvedCount = 0;
  let unresolvedCount = 0;

  for (const p of input) {
    const cached = cache.get(p.whatsappId);
    if (cached !== undefined) {
      const wasResolved = cacheIsResolved.get(p.whatsappId)!;
      results.push(cached);
      if (wasResolved) resolvedCount++;
      else unresolvedCount++;
      continue;
    }
    // Use low-level getContactById to distinguish fatal vs individual failure
    // We inline logic to count accurately instead of delegating to resolveParticipant (which already logs)
    let contact: ContactLike | null | undefined = null;
    let succeeded = false;
    try {
      const raw = await client.getContactById(p.whatsappId);
      if (raw) {
        contact = raw as unknown as ContactLike;
        succeeded = true;
      } else {
        succeeded = false;
      }
    } catch {
      succeeded = false;
    }
    let resolved: ResolvedContact;
    if (succeeded) {
      resolved = toResolvedContact(p, contact);
      resolvedCount++;
    } else {
      logger.warn(`Contact resolution warning: could not resolve ${p.whatsappId}`);
      resolved = toPlaceholder(p);
      unresolvedCount++;
    }
    cache.set(p.whatsappId, resolved);
    cacheIsResolved.set(p.whatsappId, succeeded);
    results.push(resolved);
  }
  // Remove the stray debug log: we logged info per resolved above which would flood terminal for 1000 participants.
  // Instead, caller logs summary `Contacts resolved/unresolved`.
  return { contacts: results, resolvedCount, unresolvedCount };
}
