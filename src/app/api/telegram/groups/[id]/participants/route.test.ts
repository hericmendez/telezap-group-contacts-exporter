import { describe, it, expect, vi, beforeEach } from "vitest";
import { authedRequest, resetAuthForTests } from "../../../../../../auth/test-utils.js";
import { GET } from "./route.js";
import { getTelegramManager } from "../../../../../../lib/telegram.js";
import { TelegramGroupNotFoundError } from "../../../../../../telegram/group.js";
import {
  TelegramFloodError,
  TelegramParticipantsUnavailableError,
} from "../../../../../../telegram/participants.js";

vi.mock("../../../../../../lib/telegram.js", () => ({
  getTelegramManager: vi.fn(),
}));

const mockedManager = vi.mocked(getTelegramManager);

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthForTests();
});

const RESULT = {
  group: { id: "100", title: "Devs", kind: "supergroup" },
  participants: [
    { telegramId: "11", firstName: "Ada", lastName: "", username: "ada", phone: "", isAdmin: true, isOwner: false },
    { telegramId: "12", firstName: "", lastName: "", username: "", phone: "", isAdmin: false, isOwner: false },
  ],
};

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function stubManager(impl: (id: string) => Promise<typeof RESULT>) {
  const manager = {
    getParticipantsByGroupId: vi.fn(impl),
  } as unknown as import("../../../../../../telegram/manager.js").TelegramManager;
  mockedManager.mockReturnValue(manager);
  return manager;
}

describe("GET /api/telegram/groups/:id/participants", () => {
  it("returns groupId plus serializable participants, no internals", async () => {
    const manager = stubManager(async () => RESULT);
    const res = await GET(authedRequest("http://localhost/x"), context("100"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ groupId: "100", participants: RESULT.participants });
    expect(manager.getParticipantsByGroupId).toHaveBeenCalledWith("100");
    const text = JSON.stringify(body);
    for (const secret of ["accessHash", "TEST_SESSION", "TEST_API_HASH", "TEST_CODE", "TEST_PASSWORD"]) {
      expect(text).not.toContain(secret);
    }
    expect(JSON.parse(text)).toEqual(body);
  });

  it("returns 404 for unknown groups", async () => {
    stubManager(async (id: string) => {
      throw new TelegramGroupNotFoundError(id);
    });
    const res = await GET(authedRequest("http://localhost/x"), context("000"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when enumeration is unavailable", async () => {
    stubManager(async () => {
      throw new TelegramParticipantsUnavailableError();
    });
    const res = await GET(authedRequest("http://localhost/x"), context("100"));
    expect(res.status).toBe(403);
  });

  it("returns 429 with the wait duration on FloodWait", async () => {
    stubManager(async () => {
      throw new TelegramFloodError(42);
    });
    const res = await GET(authedRequest("http://localhost/x"), context("100"));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("42s") });
  });

  it("returns 401 when authentication is required", async () => {
    stubManager(async () => {
      throw new Error("Telegram authentication is required. Connect and log in first.");
    });
    const res = await GET(authedRequest("http://localhost/x"), context("100"));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/telegram/groups/:id/participants identity", () => {
  it("enumerates through the requesting user's manager with its group id", async () => {
    const calls: string[] = [];
    mockedManager.mockImplementation(((userId: string) =>
      ({
        getParticipantsByGroupId: vi.fn(async (groupId: string) => {
          calls.push(`${userId}:${groupId}`);
          return { group: { id: groupId }, participants: [] };
        }),
      }) as unknown as import("../../../../../../telegram/manager.js").TelegramManager) as never);
    const res = await GET(
      authedRequest("http://localhost/api/telegram/groups/777/participants", undefined, "user-b"),
      context("777"),
    );
    expect(mockedManager).toHaveBeenCalledWith("user-b");
    expect(calls).toEqual(["user-b:777"]);
    expect(res.status).toBe(200);
  });
});
