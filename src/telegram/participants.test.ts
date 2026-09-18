import { describe, it, expect, vi } from "vitest";
import bigInt from "big-integer";
import type { TelegramClient } from "teleproto";
import {
  FloodWaitError,
  ChatAdminRequiredError,
} from "teleproto/errors";
import {
  basicRoleOf,
  channelRoleOf,
  fetchBasicGroupParticipants,
  fetchSupergroupParticipants,
  PARTICIPANT_MAX_PAGES,
  toParticipantsError,
  toTelegramParticipant,
  TelegramFloodError,
  TelegramParticipantsUnavailableError,
} from "./participants.js";

function user(overrides: Record<string, unknown> = {}) {
  return {
    className: "User",
    id: bigInt("1001"),
    firstName: "John",
    lastName: "Doe",
    username: "john",
    phone: "+5516999999999",
    ...overrides,
  };
}

describe("toTelegramParticipant", () => {
  it("maps a full user with exact string id", () => {
    const p = toTelegramParticipant(user({ id: bigInt("98765432109876543210") }), "98765432109876543210", {
      isAdmin: false,
      isOwner: false,
    });
    expect(p).toEqual({
      telegramId: "98765432109876543210",
      firstName: "John",
      lastName: "Doe",
      username: "john",
      phone: "+5516999999999",
      isAdmin: false,
      isOwner: false,
    });
  });

  it("normalizes missing fields to empty strings", () => {
    const p = toTelegramParticipant(
      { className: "User", id: bigInt("5") },
      "5",
      { isAdmin: true, isOwner: false },
    );
    expect(p).toEqual({
      telegramId: "5",
      firstName: "",
      lastName: "",
      username: "",
      phone: "",
      isAdmin: true,
      isOwner: false,
    });
    expect(JSON.stringify(p)).not.toContain("undefined");
  });

  it("prefers the usernames vector and keeps bots/deleted as rows", () => {
    const p = toTelegramParticipant(
      user({ username: undefined, usernames: [{ username: "jdoe" }], bot: true, id: bigInt("7") }),
      "7",
      { isAdmin: false, isOwner: false },
    );
    expect(p.username).toBe("jdoe");
    const deleted = toTelegramParticipant(
      { className: "User", id: bigInt("8"), deleted: true },
      "8",
      { isAdmin: false, isOwner: false },
    );
    expect(deleted.telegramId).toBe("8");
  });

  it("preserves placeholders for missing/userEmpty users", () => {
    expect(
      toTelegramParticipant(null, "9", { isAdmin: false, isOwner: false }).telegramId,
    ).toBe("9");
    expect(
      toTelegramParticipant({ className: "UserEmpty", id: bigInt("10") }, "10", {
        isAdmin: false,
        isOwner: false,
      }),
    ).toMatchObject({ telegramId: "10", firstName: "" });
  });
});

describe("role mapping", () => {
  it("maps channel participant variants from constructor info", () => {
    expect(channelRoleOf("ChannelParticipantCreator")).toEqual({ isAdmin: true, isOwner: true });
    expect(channelRoleOf("ChannelParticipantAdmin")).toEqual({ isAdmin: true, isOwner: false });
    expect(channelRoleOf("ChannelParticipant")).toEqual({ isAdmin: false, isOwner: false });
    expect(channelRoleOf("ChannelParticipantSelf")).toEqual({ isAdmin: false, isOwner: false });
    expect(channelRoleOf("ChannelParticipantBanned")).toEqual({ isAdmin: false, isOwner: false });
    expect(channelRoleOf("ChannelParticipantLeft")).toEqual({ isAdmin: false, isOwner: false });
    expect(channelRoleOf(undefined)).toEqual({ isAdmin: false, isOwner: false });
  });

  it("maps basic-group participant variants", () => {
    expect(basicRoleOf("ChatParticipantCreator")).toEqual({ isAdmin: true, isOwner: true });
    expect(basicRoleOf("ChatParticipantAdmin")).toEqual({ isAdmin: true, isOwner: false });
    expect(basicRoleOf("ChatParticipant")).toEqual({ isAdmin: false, isOwner: false });
  });
});

function pageResult(entries: Array<{ id: string; className: string }>, withUsers = true) {
  return {
    className: "channels.ChannelParticipants",
    count: entries.length,
    participants: entries.map((e) => ({ className: e.className, userId: bigInt(e.id) })),
    users: withUsers
      ? entries.map((e) => user({ id: bigInt(e.id), firstName: `N${e.id}` }))
      : [],
  };
}

function supergroupClient(pages: Array<ReturnType<typeof pageResult>> | Error) {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      invoke: vi.fn(async (req: unknown) => {
        calls.push(req);
        if (pages instanceof Error) throw pages;
        const page = pages.shift();
        if (!page) throw new Error("unexpected extra page");
        return page;
      }),
    } as unknown as TelegramClient,
  };
}

describe("fetchSupergroupParticipants", () => {
  it("returns one page and maps roles", async () => {
    const { client, calls } = supergroupClient([
      pageResult([
        { id: "1", className: "ChannelParticipantCreator" },
        { id: "2", className: "ChannelParticipantAdmin" },
        { id: "3", className: "ChannelParticipant" },
      ]),
    ]);
    const out = await fetchSupergroupParticipants(client, { id: "x" });
    expect(out.map((p) => [p.telegramId, p.isAdmin, p.isOwner])).toEqual([
      ["1", true, true],
      ["2", true, false],
      ["3", false, false],
    ]);
    const req = calls[0] as { offset: number; limit: number; filter: { className: string } };
    expect(req.offset).toBe(0);
    expect(req.limit).toBe(200);
    expect(req.filter.className).toBe("ChannelParticipantsRecent");
  });

  it("paginates across exact page boundaries until a short page", async () => {
    const full = Array.from({ length: 200 }, (_, i) => ({ id: `${i + 1}`, className: "ChannelParticipant" }));
    const { client, calls } = supergroupClient([pageResult(full), pageResult([{ id: "201", className: "ChannelParticipant" }])]);
    const out = await fetchSupergroupParticipants(client, { id: "x" });
    expect(out).toHaveLength(201);
    expect((calls[1] as { offset: number }).offset).toBe(200);
  });

  it("returns [] for an empty group (not an error)", async () => {
    const { client } = supergroupClient([pageResult([])]);
    expect(await fetchSupergroupParticipants(client, { id: "x" })).toEqual([]);
  });

  it("dedupes by telegramId preserving order", async () => {
    const { client } = supergroupClient([pageResult([
      { id: "1", className: "ChannelParticipant" },
      { id: "1", className: "ChannelParticipant" },
      { id: "2", className: "ChannelParticipant" },
    ])]);
    const out = await fetchSupergroupParticipants(client, { id: "x" });
    expect(out.map((p) => p.telegramId)).toEqual(["1", "2"]);
  });

  it("fails fast on FloodWait with the duration and a single call", async () => {
    const { client, calls } = supergroupClient(
      new FloodWaitError({ request: undefined, capture: 31 }),
    );
    const err = await fetchSupergroupParticipants(client, { id: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TelegramFloodError);
    expect((err as TelegramFloodError).seconds).toBe(31);
    expect(calls).toHaveLength(1);
  });

  it("maps admin-required to unavailable, not empty", async () => {
    const { client } = supergroupClient(new ChatAdminRequiredError({ request: undefined }));
    await expect(fetchSupergroupParticipants(client, { id: "x" })).rejects.toThrow(
      TelegramParticipantsUnavailableError,
    );
  });

  it("cannot loop forever on endless full pages", async () => {
    const full = pageResult(Array.from({ length: 200 }, (_, i) => ({ id: `${i}`, className: "ChannelParticipant" })));
    let calls = 0;
    const client = {
      invoke: vi.fn(async () => {
        calls++;
        return full;
      }),
    } as unknown as TelegramClient;
    await expect(fetchSupergroupParticipants(client, { id: "x" })).rejects.toThrow();
    expect(calls).toBe(PARTICIPANT_MAX_PAGES);
  }, 30000);
});

describe("fetchBasicGroupParticipants", () => {
  function basicClient(response: unknown) {
    return {
      invoke: vi.fn(async () => response),
    } as unknown as TelegramClient;
  }

  it("maps ids, roles, and the collocated users vector", async () => {
    const client = basicClient({
      className: "messages.ChatFull",
      fullChat: {
        participants: {
          className: "ChatParticipants",
          participants: [
            { className: "ChatParticipantCreator", userId: bigInt("1") },
            { className: "ChatParticipant", userId: bigInt("2") },
          ],
        },
      },
      users: [user({ id: bigInt("1"), firstName: "Owner" }), user({ id: bigInt("2"), phone: undefined })],
    });
    const out = await fetchBasicGroupParticipants(client, bigInt("77"));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ telegramId: "1", firstName: "Owner", isOwner: true });
    expect(out[1]).toMatchObject({ telegramId: "2", phone: "" });
  });

  it("rejects forbidden full chats instead of faking emptiness", async () => {
    const client = basicClient({
      className: "messages.ChatFull",
      fullChat: { participants: { className: "ChatParticipantsForbidden", chatId: bigInt("77") } },
      users: [],
    });
    await expect(fetchBasicGroupParticipants(client, bigInt("77"))).rejects.toThrow(
      TelegramParticipantsUnavailableError,
    );
  });

  it("preserves ids missing from the users vector as placeholders", async () => {
    const client = basicClient({
      className: "messages.ChatFull",
      fullChat: {
        participants: {
          className: "ChatParticipants",
          participants: [{ className: "ChatParticipant", userId: bigInt("42") }],
        },
      },
      users: [],
    });
    const out = await fetchBasicGroupParticipants(client, bigInt("77"));
    expect(out).toEqual([
      { telegramId: "42", firstName: "", lastName: "", username: "", phone: "", isAdmin: false, isOwner: false },
    ]);
  });
});

describe("toParticipantsError", () => {
  it("passes domain errors through and wraps the unknown safely", () => {
    const flood = toParticipantsError(new FloodWaitError({ request: undefined, capture: 7 }));
    expect(flood).toBeInstanceOf(TelegramFloodError);
    expect((flood as TelegramFloodError).seconds).toBe(7);
    const wrapped = toParticipantsError(new Error("weird internal boom"));
    expect(wrapped.message).not.toContain("weird internal boom");
  });
});
