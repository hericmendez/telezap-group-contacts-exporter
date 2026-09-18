import { describe, it, expect, vi } from "vitest";
import {
  findGroupByName,
  chatToGroupSummary,
  fetchGroupSummaries,
  discoverGroupByName,
  fetchGroupSummaryById,
  GroupNotFoundError,
  AmbiguousGroupError,
  type GroupSummary,
} from "./group.js";

function makeSummary(overrides: Partial<GroupSummary> & { name: string; id: string }): GroupSummary {
  return {
    isGroup: true,
    participantCount: 10,
    ...overrides,
  };
}

describe("findGroupByName — pure selection", () => {
  it("selects exactly one matching group", () => {
    const groups: GroupSummary[] = [
      makeSummary({ id: "1@g.us", name: "Alpha", participantCount: 5 }),
      makeSummary({ id: "2@g.us", name: "My Group", participantCount: 42 }),
      makeSummary({ id: "3@g.us", name: "Beta" }),
    ];
    const found = findGroupByName(groups, "My Group");
    expect(found.id).toBe("2@g.us");
    expect(found.name).toBe("My Group");
  });

  it("ignores non-group chats", () => {
    const groups: GroupSummary[] = [
      { id: "1@c.us", name: "My Group", isGroup: false, participantCount: 1 },
      makeSummary({ id: "2@g.us", name: "My Group", participantCount: 7 }),
    ];
    const found = findGroupByName(groups, "My Group");
    expect(found.id).toBe("2@g.us");
  });

  it("throws GroupNotFoundError when there is no match", () => {
    const groups: GroupSummary[] = [
      makeSummary({ id: "1@g.us", name: "Alpha" }),
      makeSummary({ id: "2@g.us", name: "Beta" }),
    ];
    expect(() => findGroupByName(groups, "My Group")).toThrow(GroupNotFoundError);
    expect(() => findGroupByName(groups, "My Group")).toThrow('Group "My Group" was not found.');
  });

  it("throws when all chats are non-groups", () => {
    const groups: GroupSummary[] = [
      { id: "1@c.us", name: "My Group", isGroup: false },
      { id: "2@c.us", name: "My Group", isGroup: false },
    ];
    expect(() => findGroupByName(groups, "My Group")).toThrow(GroupNotFoundError);
  });

  it("throws AmbiguousGroupError when there are multiple matches", () => {
    const groups: GroupSummary[] = [
      makeSummary({ id: "1@g.us", name: "My Group", participantCount: 42 }),
      makeSummary({ id: "2@g.us", name: "My Group", participantCount: 17 }),
    ];
    expect(() => findGroupByName(groups, "My Group")).toThrow(AmbiguousGroupError);
    try {
      findGroupByName(groups, "My Group");
    } catch (err) {
      expect((err as AmbiguousGroupError).message).toContain('Multiple WhatsApp groups named "My Group" were found.');
      expect((err as AmbiguousGroupError).message).toContain("1. My Group — 42 participants — 1@g.us");
      expect((err as AmbiguousGroupError).message).toContain("2. My Group — 17 participants — 2@g.us");
      expect((err as AmbiguousGroupError).groups).toHaveLength(2);
    }
  });

  it("uses exact matching — not fuzzy", () => {
    const groups: GroupSummary[] = [
      makeSummary({ id: "1@g.us", name: "My Group" }),
      makeSummary({ id: "2@g.us", name: "My Group 2026" }),
      makeSummary({ id: "3@g.us", name: "My Group - Admin" }),
    ];
    const found = findGroupByName(groups, "My Group");
    expect(found.id).toBe("1@g.us");
    expect(() => findGroupByName(groups, "my group")).toThrow(GroupNotFoundError);
    expect(() => findGroupByName(groups, " My Group")).toThrow(GroupNotFoundError);
  });

  it("preserves participantCount when available", () => {
    const groups: GroupSummary[] = [
      makeSummary({ id: "1@g.us", name: "Solo", participantCount: 99 }),
    ];
    const found = findGroupByName(groups, "Solo");
    expect(found.participantCount).toBe(99);
  });

  it("preserves group ID as opaque", () => {
    const opaqueId = "120363123456789012@g.us";
    const groups: GroupSummary[] = [makeSummary({ id: opaqueId, name: "Opaque" })];
    const found = findGroupByName(groups, "Opaque");
    expect(found.id).toBe(opaqueId);
  });
});

describe("chatToGroupSummary", () => {
  it("creates expected GroupSummary from chat with string id", () => {
    const chat = { id: "123@g.us", name: "Test Group", isGroup: true, participants: [1, 2, 3] };
    const summary = chatToGroupSummary(chat as never);
    expect(summary).toEqual({ id: "123@g.us", name: "Test Group", isGroup: true, participantCount: 3 });
  });

  it("preserves _serialized id", () => {
    const chat = { id: { _serialized: "456@g.us" }, name: "G", isGroup: true };
    const summary = chatToGroupSummary(chat as never);
    expect(summary.id).toBe("456@g.us");
  });

  it("uses groupMetadata participants when participants absent", () => {
    const chat = {
      id: "789@g.us",
      name: "Meta",
      isGroup: true,
      groupMetadata: { participants: [1, 2] },
    };
    const summary = chatToGroupSummary(chat as never);
    expect(summary.participantCount).toBe(2);
  });

  it("returns undefined participantCount when unavailable", () => {
    const chat = { id: "000@g.us", name: "Empty", isGroup: true };
    const summary = chatToGroupSummary(chat as never);
    expect(summary.participantCount).toBeUndefined();
  });
});

describe("fetchGroupSummaries / discoverGroupByName (mocked client)", () => {
  it("fetchGroupSummaries filters non-groups and maps to GroupSummary", async () => {
    const client = {
      getChats: vi.fn(async () => [
        { id: { _serialized: "1@g.us" }, name: "Group A", isGroup: true, participants: [1, 2] },
        { id: { _serialized: "2@c.us" }, name: "Not a group", isGroup: false },
        { id: { _serialized: "3@g.us" }, name: "Group B", isGroup: true, groupMetadata: { participants: [1] } },
      ]),
    } as unknown as import("whatsapp-web.js").Client;
    const summaries = await fetchGroupSummaries(client);
    expect(summaries).toHaveLength(2);
    expect(summaries.map((s) => s.id)).toEqual(["1@g.us", "3@g.us"]);
    expect(summaries[0]!.participantCount).toBe(2);
    expect(summaries[1]!.participantCount).toBe(1);
  });

  it("discoverGroupByName returns correct group via client", async () => {
    const client = {
      getChats: vi.fn(async () => [
        { id: { _serialized: "a@g.us" }, name: "My Group", isGroup: true, participants: [1, 2, 3] },
        { id: { _serialized: "b@g.us" }, name: "Other", isGroup: true },
      ]),
    } as unknown as import("whatsapp-web.js").Client;
    const group = await discoverGroupByName(client, "My Group");
    expect(group.id).toBe("a@g.us");
    expect(group.name).toBe("My Group");
    expect(group.participantCount).toBe(3);
  });

  it("discoverGroupByName throws GroupNotFoundError via client", async () => {
    const client = {
      getChats: vi.fn(async () => [{ id: { _serialized: "a@g.us" }, name: "Other", isGroup: true }]),
    } as unknown as import("whatsapp-web.js").Client;
    await expect(discoverGroupByName(client, "Missing")).rejects.toThrow(GroupNotFoundError);
  });

  it("discoverGroupByName throws AmbiguousGroupError via client", async () => {
    const client = {
      getChats: vi.fn(async () => [
        { id: { _serialized: "a@g.us" }, name: "Dup", isGroup: true },
        { id: { _serialized: "b@g.us" }, name: "Dup", isGroup: true },
      ]),
    } as unknown as import("whatsapp-web.js").Client;
    await expect(discoverGroupByName(client, "Dup")).rejects.toThrow(AmbiguousGroupError);
  });
});

describe("fetchGroupSummaryById (mocked client)", () => {
  const groupChat = {
    id: { _serialized: "120363423663114428@g.us" },
    name: "Fazendinha",
    isGroup: true,
    participants: [{}, {}],
  };

  it("resolves a group by its opaque ID, passing it intact", async () => {
    const getChatById = vi.fn(async () => groupChat);
    const client = { getChatById } as unknown as import("whatsapp-web.js").Client;
    const summary = await fetchGroupSummaryById(client, "120363423663114428@g.us");
    expect(getChatById).toHaveBeenCalledWith("120363423663114428@g.us");
    expect(summary).toMatchObject({
      id: "120363423663114428@g.us",
      name: "Fazendinha",
      isGroup: true,
    });
  });

  it("throws GroupNotFoundError when the library lookup fails", async () => {
    const client = {
      getChatById: vi.fn(async () => {
        throw new Error("ProtocolError: something internal");
      }),
    } as unknown as import("whatsapp-web.js").Client;
    await expect(fetchGroupSummaryById(client, "000@g.us")).rejects.toThrow(GroupNotFoundError);
    await expect(fetchGroupSummaryById(client, "000@g.us")).rejects.toThrow('Group "000@g.us" was not found.');
  });

  it("throws GroupNotFoundError for chats that are not groups", async () => {
    const client = {
      getChatById: vi.fn(async () => ({
        id: { _serialized: "999@c.us" },
        name: "Direct Chat",
        isGroup: false,
      })),
    } as unknown as import("whatsapp-web.js").Client;
    await expect(fetchGroupSummaryById(client, "999@c.us")).rejects.toThrow(GroupNotFoundError);
  });

  it("throws GroupNotFoundError for empty IDs without calling the client", async () => {
    const getChatById = vi.fn(async () => groupChat);
    const client = { getChatById } as unknown as import("whatsapp-web.js").Client;
    await expect(fetchGroupSummaryById(client, "   ")).rejects.toThrow(GroupNotFoundError);
    expect(getChatById).not.toHaveBeenCalled();
  });
});
