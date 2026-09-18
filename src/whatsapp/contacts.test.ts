import { describe, it, expect, vi } from "vitest";
import {
  toResolvedContact,
  resolveParticipant,
  resolveParticipants,
  resolveParticipantsWithStats,
  type ResolvedContact,
} from "./contacts.js";
import type { GroupParticipantSummary } from "./participants.js";

function participant(overrides: Partial<GroupParticipantSummary> & { whatsappId: string }): GroupParticipantSummary {
  return {
    isAdmin: false,
    isSuperAdmin: false,
    ...overrides,
  };
}

function mockContact(overrides: {
  id?: { _serialized: string };
  name?: string | null;
  pushname?: string | null;
  number?: string | null;
} = {}) {
  return {
    id: overrides.id ?? { _serialized: "any@c.us" },
    name: overrides.name ?? undefined,
    pushname: overrides.pushname ?? undefined,
    number: overrides.number ?? undefined,
  };
}

function mockClient(map: Record<string, unknown | Error>) {
  return {
    getContactById: vi.fn(async (id: string) => {
      const val = map[id];
      if (val instanceof Error) throw val;
      if (val === null) return null;
      if (val === undefined) throw new Error("not found");
      return val;
    }),
    getChats: vi.fn(async () => []),
  } as unknown as import("whatsapp-web.js").Client;
}

// ── Contact mapping 1-7 ───────────────────────────────────────────────────────

describe("toResolvedContact / resolveParticipant — mapping", () => {
  it("1. resolves a normal contact", async () => {
    const p = participant({ whatsappId: "5516999999999@c.us", isAdmin: true });
    const contact = mockContact({ name: "João Silva", pushname: "João", number: "5516999999999" });
    const client = mockClient({ "5516999999999@c.us": contact });
    const r = await resolveParticipant(client, p);
    expect(r).toEqual({
      whatsappId: "5516999999999@c.us",
      name: "João Silva",
      pushname: "João",
      number: "5516999999999",
      isAdmin: true,
      isSuperAdmin: false,
    });
  });

  it("2. preserves participant whatsappId", async () => {
    const p = participant({ whatsappId: "123@lid" });
    const contact = mockContact({ id: { _serialized: "different@lid" }, name: "X", pushname: "Y", number: "999" });
    const r = toResolvedContact(p, contact as never);
    expect(r.whatsappId).toBe("123@lid");
    expect(r.whatsappId).not.toBe("different@lid");
  });

  it("3. extracts contact name", async () => {
    const p = participant({ whatsappId: "1@c.us" });
    const c = mockContact({ name: "Saved Name", pushname: "Push", number: "1" });
    expect(toResolvedContact(p, c as never).name).toBe("Saved Name");
  });

  it("4. extracts pushname", async () => {
    const p = participant({ whatsappId: "1@c.us" });
    const c = mockContact({ pushname: "PublicPush" });
    expect(toResolvedContact(p, c as never).pushname).toBe("PublicPush");
  });

  it("5. extracts number", async () => {
    const p = participant({ whatsappId: "1@c.us" });
    const c = mockContact({ number: "5511999999999" });
    expect(toResolvedContact(p, c as never).number).toBe("5511999999999");
  });

  it("6. preserves isAdmin", async () => {
    const admin = participant({ whatsappId: "1@c.us", isAdmin: true });
    const notAdmin = participant({ whatsappId: "2@c.us", isAdmin: false });
    const c = mockContact({});
    expect(toResolvedContact(admin, c as never).isAdmin).toBe(true);
    expect(toResolvedContact(notAdmin, c as never).isAdmin).toBe(false);
  });

  it("7. preserves isSuperAdmin", async () => {
    const superAdmin = participant({ whatsappId: "1@c.us", isSuperAdmin: true });
    const notSuper = participant({ whatsappId: "2@c.us", isSuperAdmin: false });
    const c = mockContact({});
    expect(toResolvedContact(superAdmin, c as never).isSuperAdmin).toBe(true);
    expect(toResolvedContact(notSuper, c as never).isSuperAdmin).toBe(false);
  });
});

// ── LID 8-10 ──────────────────────────────────────────────────────────────────

describe("LID handling", () => {
  it("8. resolves a participant whose ID is @lid", async () => {
    const p = participant({ whatsappId: "123456789012345@lid" });
    const contact = mockContact({ name: "Lid User", pushname: "LidPush", number: "" });
    const client = mockClient({ "123456789012345@lid": contact });
    const r = await resolveParticipant(client, p);
    expect(r.whatsappId).toBe("123456789012345@lid");
    expect(r.name).toBe("Lid User");
  });

  it("9. verifies the LID remains unchanged", async () => {
    const p = participant({ whatsappId: "999@lid" });
    const contact = mockContact({ id: { _serialized: "999@lid" }, name: "A" });
    const r = toResolvedContact(p, contact as never);
    expect(r.whatsappId).toBe("999@lid");
  });

  it("10. verifies phone number does not replace the ID", async () => {
    const p = participant({ whatsappId: "123@lid" });
    const contact = mockContact({ number: "5511999999999", pushname: "Push" });
    const r = toResolvedContact(p, contact as never);
    expect(r.whatsappId).toBe("123@lid");
    expect(r.number).toBe("5511999999999");
    expect(r.whatsappId).not.toBe(r.number);
  });
});

// ── Missing fields 11-13 ──────────────────────────────────────────────────────

describe("missing fields normalization", () => {
  it("11. missing name becomes \"\"", () => {
    const p = participant({ whatsappId: "1@c.us" });
    expect(toResolvedContact(p, { pushname: "P", number: "1" } as never).name).toBe("");
    expect(toResolvedContact(p, { name: null } as never).name).toBe("");
    expect(toResolvedContact(p, { name: undefined } as never).name).toBe("");
  });

  it("12. missing pushname becomes \"\"", () => {
    const p = participant({ whatsappId: "1@c.us" });
    expect(toResolvedContact(p, { name: "N", number: "1" } as never).pushname).toBe("");
    expect(toResolvedContact(p, { pushname: null } as never).pushname).toBe("");
  });

  it("13. missing number becomes \"\"", () => {
    const p = participant({ whatsappId: "1@c.us" });
    expect(toResolvedContact(p, { name: "N", pushname: "P" } as never).number).toBe("");
    expect(toResolvedContact(p, { number: null } as never).number).toBe("");
    expect(toResolvedContact(p, { number: undefined } as never).number).toBe("");
  });
});

// ── Failure handling 14-17 ────────────────────────────────────────────────────

describe("failure handling", () => {
  it("14. one failed lookup does not abort the whole batch", async () => {
    const participants = [
      participant({ whatsappId: "1@c.us" }),
      participant({ whatsappId: "2@c.us" }),
      participant({ whatsappId: "3@c.us" }),
    ];
    const client = mockClient({
      "1@c.us": mockContact({ name: "A" }),
      "2@c.us": new Error("not found"),
      "3@c.us": mockContact({ name: "C" }),
    });
    const results = await resolveParticipants(client, participants);
    expect(results).toHaveLength(3);
    expect(results[0]!.name).toBe("A");
    expect(results[1]!.whatsappId).toBe("2@c.us");
    expect(results[2]!.name).toBe("C");
  });

  it("15. unresolved participant remains represented", async () => {
    const p = participant({ whatsappId: "missing@c.us" });
    const client = mockClient({ "missing@c.us": new Error("fail") });
    const r = await resolveParticipant(client, p);
    expect(r.whatsappId).toBe("missing@c.us");
    expect(r.name).toBe("");
    expect(r.pushname).toBe("");
    expect(r.number).toBe("");
  });

  it("16. unresolved participant retains admin metadata", async () => {
    const p = participant({ whatsappId: "admin@lid", isAdmin: true, isSuperAdmin: true });
    const client = mockClient({ "admin@lid": new Error("fail") });
    const r = await resolveParticipant(client, p);
    expect(r.isAdmin).toBe(true);
    expect(r.isSuperAdmin).toBe(true);
  });

  it("17. resolution summary/counts are correct", async () => {
    const participants = [
      participant({ whatsappId: "1@c.us" }),
      participant({ whatsappId: "2@c.us" }),
      participant({ whatsappId: "3@c.us" }),
      participant({ whatsappId: "4@c.us" }),
    ];
    const client = mockClient({
      "1@c.us": mockContact({ name: "A" }),
      "2@c.us": new Error("fail"),
      "3@c.us": mockContact({ name: "C" }),
      "4@c.us": null, // also unresolved
    });
    const { contacts, resolvedCount, unresolvedCount } = await resolveParticipantsWithStats(client, participants);
    expect(contacts).toHaveLength(4);
    expect(resolvedCount).toBe(2);
    expect(unresolvedCount).toBe(2);
    expect(resolvedCount + unresolvedCount).toBe(4);
  });
});

// ── Ordering 18 ───────────────────────────────────────────────────────────────

describe("ordering", () => {
  it("18. participant order is preserved", async () => {
    const order = ["c@c.us", "a@c.us", "b@c.us"];
    const participants = order.map((id) => participant({ whatsappId: id }));
    const client = mockClient({
      "c@c.us": mockContact({ name: "C" }),
      "a@c.us": mockContact({ name: "A" }),
      "b@c.us": mockContact({ name: "B" }),
    });
    const results = await resolveParticipants(client, participants);
    expect(results.map((r) => r.whatsappId)).toEqual(order);
    expect(results.map((r) => r.name)).toEqual(["C", "A", "B"]);
  });
});

// ── Lookup behavior 19-20 ────────────────────────────────────────────────────

describe("lookup behavior", () => {
  it("19. getContactById receives exactly the participant's opaque ID", async () => {
    const p = participant({ whatsappId: "opaque123@lid" });
    const client = mockClient({ "opaque123@lid": mockContact({}) });
    await resolveParticipant(client, p);
    expect(client.getContactById).toHaveBeenCalledWith("opaque123@lid");
    expect(client.getContactById).toHaveBeenCalledTimes(1);
  });

  it("20. batch calls getContactById per opaque ID, not getChats", async () => {
    const participants = [participant({ whatsappId: "1@c.us" }), participant({ whatsappId: "2@lid" })];
    const client = mockClient({
      "1@c.us": mockContact({}),
      "2@lid": mockContact({}),
    });
    await resolveParticipants(client, participants);
    expect(client.getContactById).toHaveBeenCalledWith("1@c.us");
    expect(client.getContactById).toHaveBeenCalledWith("2@lid");
    expect(client.getChats).not.toHaveBeenCalled();
  });

  it("does not infer phone numbers from IDs", async () => {
    const p = participant({ whatsappId: "5511999999999@c.us" });
    const contact = mockContact({ number: "different" });
    const r = toResolvedContact(p, contact as never);
    expect(r.number).toBe("different");
    expect(r.whatsappId).toBe("5511999999999@c.us");
  });
});

// ── Client failure 21 ────────────────────────────────────────────────────────

describe("fatal client failure", () => {
  it("21. fatal client-level failure is propagated", async () => {
    const p = participant({ whatsappId: "1@c.us" });
    const badClient = {} as unknown as import("whatsapp-web.js").Client;
    await expect(resolveParticipant(badClient, p)).rejects.toThrow(
      "WhatsApp client is not available for contact resolution.",
    );
    await expect(resolveParticipants(badClient, [p])).rejects.toThrow();
    await expect(resolveParticipantsWithStats(badClient, [p])).rejects.toThrow();
  });

  it("does not mutate GroupParticipantSummary", async () => {
    const p = participant({ whatsappId: "1@c.us", isAdmin: true });
    const original = JSON.stringify(p);
    const client = mockClient({ "1@c.us": mockContact({ name: "N" }) });
    await resolveParticipant(client, p);
    expect(JSON.stringify(p)).toBe(original);
  });

  it("does not mutate mocked Contact objects", async () => {
    const p = participant({ whatsappId: "1@c.us" });
    const contact = mockContact({ name: "Original", pushname: "P", number: "123" });
    const original = JSON.stringify(contact);
    const client = mockClient({ "1@c.us": contact });
    await resolveParticipant(client, p);
    expect(JSON.stringify(contact)).toBe(original);
  });

  it("avoids duplicate lookups for duplicate whatsappIds", async () => {
    const participants = [
      participant({ whatsappId: "dup@c.us" }),
      participant({ whatsappId: "dup@c.us" }),
      participant({ whatsappId: "other@c.us" }),
    ];
    const client = mockClient({
      "dup@c.us": mockContact({ name: "Dup" }),
      "other@c.us": mockContact({ name: "Other" }),
    });
    const results = await resolveParticipants(client, participants);
    expect(client.getContactById).toHaveBeenCalledTimes(2); // not 3
    expect(results).toHaveLength(3);
    expect(results[0]!.whatsappId).toBe("dup@c.us");
    expect(results[1]!.whatsappId).toBe("dup@c.us");
    expect(results[0]!.name).toBe("Dup");
    expect(results[1]!.name).toBe("Dup");
  });

  it("does not use getChats for contact resolution (pure getContactById)", async () => {
    const p = participant({ whatsappId: "1@c.us" });
    const client = mockClient({ "1@c.us": mockContact({}) });
    await resolveParticipant(client, p);
    expect((client as unknown as { getChats?: unknown }).getChats).not.toHaveBeenCalled();
  });
});
