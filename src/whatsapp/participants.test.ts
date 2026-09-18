import { describe, it, expect, vi } from "vitest";
import {
  participantToSummary,
  deduplicateParticipants,
  extractParticipants,
  fetchParticipantsByGroupId,
  type GroupParticipantSummary,
} from "./participants.js";

function makeParticipant(overrides: {
  id: string | { _serialized: string };
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
}) {
  return {
    id: overrides.id,
    isAdmin: overrides.isAdmin,
    isSuperAdmin: overrides.isSuperAdmin,
  } as unknown as Parameters<typeof participantToSummary>[0];
}

describe("participantToSummary — pure mapping", () => {
  it("extracts a normal participant", () => {
    const p = makeParticipant({ id: { _serialized: "5516999999999@c.us" }, isAdmin: true, isSuperAdmin: false });
    const s = participantToSummary(p);
    expect(s).toEqual({
      whatsappId: "5516999999999@c.us",
      isAdmin: true,
      isSuperAdmin: false,
    });
  });

  it("preserves serialized WhatsApp ID unchanged (opaque)", () => {
    const id = "5516999999999@c.us";
    const p = makeParticipant({ id: { _serialized: id } });
    expect(participantToSummary(p).whatsappId).toBe(id);
  });

  it("preserves isAdmin", () => {
    const admin = participantToSummary(makeParticipant({ id: { _serialized: "1@c.us" }, isAdmin: true }));
    const notAdmin = participantToSummary(makeParticipant({ id: { _serialized: "2@c.us" }, isAdmin: false }));
    expect(admin.isAdmin).toBe(true);
    expect(notAdmin.isAdmin).toBe(false);
  });

  it("preserves isSuperAdmin", () => {
    const superAdmin = participantToSummary(
      makeParticipant({ id: { _serialized: "1@c.us" }, isSuperAdmin: true }),
    );
    const notSuper = participantToSummary(
      makeParticipant({ id: { _serialized: "2@c.us" }, isSuperAdmin: false }),
    );
    expect(superAdmin.isSuperAdmin).toBe(true);
    expect(notSuper.isSuperAdmin).toBe(false);
  });

  it("supports non-@c.us identifier such as LID", () => {
    const lid = "123456789012345@lid";
    const p = makeParticipant({ id: { _serialized: lid }, isAdmin: false });
    const s = participantToSummary(p);
    expect(s.whatsappId).toBe(lid);
    expect(s.whatsappId).toContain("@lid");
  });

  it("handles missing/optional participant properties safely (defaults to false)", () => {
    const p = makeParticipant({ id: { _serialized: "noflags@c.us" } });
    const s = participantToSummary(p);
    expect(s.isAdmin).toBe(false);
    expect(s.isSuperAdmin).toBe(false);
  });

  it("handles string id fallback", () => {
    const p = makeParticipant({ id: "stringid@c.us" as unknown as { _serialized: string } });
    const s = participantToSummary(p as never);
    expect(s.whatsappId).toBe("stringid@c.us");
  });

  it("does not mutate the source participant object", () => {
    const p = makeParticipant({ id: { _serialized: "immut@c.us" }, isAdmin: true });
    const original = JSON.stringify(p);
    participantToSummary(p);
    expect(JSON.stringify(p)).toBe(original);
  });
});

describe("deduplicateParticipants", () => {
  it("deduplicates duplicate WhatsApp IDs, keeping first occurrence", () => {
    const participants: GroupParticipantSummary[] = [
      { whatsappId: "1@c.us", isAdmin: false, isSuperAdmin: false },
      { whatsappId: "2@c.us", isAdmin: true, isSuperAdmin: false },
      { whatsappId: "1@c.us", isAdmin: true, isSuperAdmin: true }, // duplicate, different flags
      { whatsappId: "3@lid", isAdmin: false, isSuperAdmin: false },
      { whatsappId: "2@c.us", isAdmin: false, isSuperAdmin: false }, // duplicate
    ];
    const deduped = deduplicateParticipants(participants);
    expect(deduped).toHaveLength(3);
    expect(deduped.map((p) => p.whatsappId)).toEqual(["1@c.us", "2@c.us", "3@lid"]);
    // keeps first occurrence's flags
    expect(deduped[0]!.isAdmin).toBe(false);
    expect(deduped[1]!.isAdmin).toBe(true);
  });

  it("preserves participant order", () => {
    const participants: GroupParticipantSummary[] = [
      { whatsappId: "c@c.us", isAdmin: false, isSuperAdmin: false },
      { whatsappId: "a@c.us", isAdmin: false, isSuperAdmin: false },
      { whatsappId: "b@c.us", isAdmin: false, isSuperAdmin: false },
    ];
    const deduped = deduplicateParticipants(participants);
    expect(deduped.map((p) => p.whatsappId)).toEqual(["c@c.us", "a@c.us", "b@c.us"]);
  });

  it("does not deduplicate by name/admin — only whatsappId", () => {
    const participants: GroupParticipantSummary[] = [
      { whatsappId: "1@c.us", isAdmin: false, isSuperAdmin: false },
      { whatsappId: "2@c.us", isAdmin: false, isSuperAdmin: false },
      { whatsappId: "3@c.us", isAdmin: false, isSuperAdmin: false },
    ];
    // same admin flags but different IDs should stay distinct
    expect(deduplicateParticipants(participants)).toHaveLength(3);
  });
});

describe("extractParticipants — group-level", () => {
  it("returns empty list for genuinely empty participant collection", () => {
    const group = { participants: [] };
    expect(extractParticipants(group as never)).toEqual([]);
  });

  it("extracts and deduplicates from group.participants", () => {
    const group = {
      participants: [
        { id: { _serialized: "1@c.us" }, isAdmin: false },
        { id: { _serialized: "2@c.us" }, isAdmin: true, isSuperAdmin: true },
        { id: { _serialized: "1@c.us" }, isAdmin: false }, // duplicate
      ],
    };
    const result = extractParticipants(group as never);
    expect(result).toHaveLength(2);
    expect(result[0]!.whatsappId).toBe("1@c.us");
    expect(result[1]!.whatsappId).toBe("2@c.us");
    expect(result[1]!.isSuperAdmin).toBe(true);
  });

  it("preserves order from WhatsApp", () => {
    const group = {
      participants: [
        { id: { _serialized: "3@c.us" } },
        { id: { _serialized: "1@c.us" } },
        { id: { _serialized: "2@c.us" } },
      ],
    };
    const result = extractParticipants(group as never);
    expect(result.map((p) => p.whatsappId)).toEqual(["3@c.us", "1@c.us", "2@c.us"]);
  });

  it("fails clearly when participants missing", () => {
    expect(() => extractParticipants({} as never)).toThrow(
      "Group does not expose participants as expected.",
    );
    expect(() => extractParticipants({ participants: null } as never)).toThrow();
    expect(() => extractParticipants({ participants: "not-array" } as never)).toThrow(
      "Group participants is not an array.",
    );
  });

  it("does not mutate source group", () => {
    const group = {
      participants: [{ id: { _serialized: "a@c.us" }, isAdmin: true }],
    };
    const original = JSON.stringify(group);
    extractParticipants(group as never);
    expect(JSON.stringify(group)).toBe(original);
  });

  it("handles LID participants alongside c.us", () => {
    const group = {
      participants: [
        { id: { _serialized: "5519@c.us" } },
        { id: { _serialized: "123@lid" } },
      ],
    };
    const result = extractParticipants(group as never);
    expect(result.map((p) => p.whatsappId)).toEqual(["5519@c.us", "123@lid"]);
  });
});

describe("fetchParticipantsByGroupId — mocked client", () => {
  it("fetches via getChatById and extracts", async () => {
    const client = {
      getChatById: vi.fn(async (id: string) => ({
        id,
        participants: [
          { id: { _serialized: "1@c.us" }, isAdmin: false },
          { id: { _serialized: "2@c.us" }, isAdmin: true },
        ],
      })),
    } as unknown as import("whatsapp-web.js").Client;
    const result = await fetchParticipantsByGroupId(client, "123@g.us");
    expect(client.getChatById).toHaveBeenCalledWith("123@g.us");
    expect(result).toHaveLength(2);
    expect(result[0]!.whatsappId).toBe("1@c.us");
  });

  it("deduplicates via client fetch", async () => {
    const client = {
      getChatById: vi.fn(async () => ({
        participants: [
          { id: { _serialized: "dup@c.us" } },
          { id: { _serialized: "dup@c.us" } },
          { id: { _serialized: "other@c.us" } },
        ],
      })),
    } as unknown as import("whatsapp-web.js").Client;
    const result = await fetchParticipantsByGroupId(client, "x@g.us");
    expect(result).toHaveLength(2);
  });

  it("propagates missing participants error", async () => {
    const client = {
      getChatById: vi.fn(async () => ({ id: "x@g.us" })),
    } as unknown as import("whatsapp-web.js").Client;
    await expect(fetchParticipantsByGroupId(client, "x@g.us")).rejects.toThrow(
      "Group does not expose participants as expected.",
    );
  });
});
