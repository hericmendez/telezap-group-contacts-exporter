import { describe, it, expect, vi } from "vitest";
import bigInt from "big-integer";
import type { TelegramClient } from "teleproto";
import {
  entityToGroupRecord,
  fetchGroupRecordById,
  fetchGroups,
  sortGroupRecords,
  TelegramGroupNotFoundError,
  type TelegramGroupRecord,
} from "./group.js";

function chat(overrides: Record<string, unknown> = {}) {
  return {
    className: "Chat",
    id: bigInt("111"),
    title: "Family",
    participantsCount: 8,
    ...overrides,
  };
}

function channel(overrides: Record<string, unknown> = {}) {
  return {
    className: "Channel",
    id: bigInt("222"),
    accessHash: bigInt("999"),
    title: "Devs",
    megagroup: true,
    participantsCount: 42,
    ...overrides,
  };
}

function clientWithDialogs(entities: unknown[]) {
  return {
    getDialogs: vi.fn(async () => entities.map((entity) => ({ entity }))),
  } as unknown as TelegramClient;
}

describe("entityToGroupRecord", () => {
  it("maps a basic group with exact string id", () => {
    const record = entityToGroupRecord(chat({ id: bigInt("12345678901234567890") }));
    expect(record?.summary).toEqual({ id: "12345678901234567890", title: "Family", kind: "group", participantCount: 8 });
    expect(record?.entity).toBeDefined();
    // no accessHash anywhere near the public summary
    expect(JSON.stringify(record?.summary)).not.toContain("accessHash");
  });

  it("maps a supergroup", () => {
    const record = entityToGroupRecord(channel());
    expect(record?.summary).toMatchObject({ id: "222", title: "Devs", kind: "supergroup" });
  });

  it("excludes broadcast channels, gigagroups, monoforums", () => {
    expect(entityToGroupRecord(channel({ broadcast: true, megagroup: false }))).toBeNull();
    expect(entityToGroupRecord(channel({ gigagroup: true }))).toBeNull();
    expect(entityToGroupRecord(channel({ monoforum: true }))).toBeNull();
    expect(entityToGroupRecord(channel({ megagroup: false }))).toBeNull();
  });

  it("excludes left, deactivated, migrated, and partial entities", () => {
    expect(entityToGroupRecord(chat({ left: true }))).toBeNull();
    expect(entityToGroupRecord(chat({ deactivated: true }))).toBeNull();
    expect(entityToGroupRecord(chat({ migratedTo: {} }))).toBeNull();
    expect(entityToGroupRecord(channel({ left: true }))).toBeNull();
    expect(entityToGroupRecord(channel({ min: true }))).toBeNull();
    expect(entityToGroupRecord({ className: "User", id: bigInt("1") })).toBeNull();
    expect(entityToGroupRecord(null)).toBeNull();
  });

  it("normalizes missing titles without inventing identity", () => {
    const record = entityToGroupRecord(chat({ title: undefined }));
    expect(record?.summary.title).toBe("Unnamed group");
    expect(record?.summary.id).toBe("111");
  });
});

describe("fetchGroups", () => {
  it("returns eligible groups, keeps duplicates, sorts by title then id", async () => {
    const client = clientWithDialogs([
      channel({ id: bigInt("30"), title: "Zulu" }),
      chat({ id: bigInt("10"), title: "Alpha" }),
      channel({ broadcast: true, megagroup: false, id: bigInt("99"), title: "News" }),
      chat({ id: bigInt("20"), title: "Alpha" }),
      { className: "User", id: bigInt("40") },
    ]);
    const groups = await fetchGroups(client);
    expect(groups.map((g) => [g.title, g.id, g.kind])).toEqual([
      ["Alpha", "10", "group"],
      ["Alpha", "20", "group"],
      ["Zulu", "30", "supergroup"],
    ]);
  });
});

describe("fetchGroupRecordById", () => {
  it("finds by opaque id and keeps the entity server-side", async () => {
    const entity = channel({ id: bigInt("555") });
    const client = clientWithDialogs([entity, chat()]);
    const record = await fetchGroupRecordById(client, "555");
    expect(record.summary).toMatchObject({ id: "555", kind: "supergroup" });
    expect(record.entity).toBe(entity);
  });

  it("rejects unknown, empty, and channel ids", async () => {
    const client = clientWithDialogs([chat()]);
    await expect(fetchGroupRecordById(client, "000")).rejects.toThrow(TelegramGroupNotFoundError);
    await expect(fetchGroupRecordById(client, "   ")).rejects.toThrow(TelegramGroupNotFoundError);
  });
});

describe("sortGroupRecords", () => {
  it("is stable and deterministic", () => {
    const records: TelegramGroupRecord[] = [
      { summary: { id: "b", title: "Same", kind: "group" }, entity: {} },
      { summary: { id: "a", title: "Same", kind: "group" }, entity: {} },
    ];
    const sorted = sortGroupRecords(records);
    expect(sorted.map((r) => r.summary.id)).toEqual(["a", "b"]);
    // input not mutated
    expect(records[0]!.summary.id).toBe("b");
  });
});
