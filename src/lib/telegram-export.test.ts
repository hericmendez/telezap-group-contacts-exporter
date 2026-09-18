import { describe, it, expect, beforeEach } from "vitest";
import {
  setLastTelegramExport,
  getLastTelegramExport,
  __resetLastTelegramExportForTests,
  type TelegramLastExport,
} from "./telegram-export.js";
import {
  setLastExport,
  getLastExport,
  __resetLastExportForTests,
} from "./last-export.js";

beforeEach(() => {
  __resetLastTelegramExportForTests();
  __resetLastExportForTests();
});

function entry(overrides: Partial<TelegramLastExport> = {}): TelegramLastExport {
  return {
    filePath: "output/telegram-A.csv",
    filename: "telegram-A.csv",
    groupId: "100",
    groupTitle: "A",
    participantCount: 3,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function waEntry(groupName = "WA"): { filePath: string; groupName: string; createdAt: string } {
  return { filePath: "output/WA.csv", groupName, createdAt: "t" };
}

describe("Telegram last-export slot (per user)", () => {
  it("stores and replaces the latest export per user", () => {
    expect(getLastTelegramExport("nobody")).toBeNull();
    setLastTelegramExport("alice", entry());
    setLastTelegramExport("alice", entry({ groupId: "200", filename: "telegram-B.csv" }));
    expect(getLastTelegramExport("alice")).toMatchObject({ groupId: "200", filename: "telegram-B.csv" });
  });

  it("keeps users isolated from each other", () => {
    setLastTelegramExport("alice", entry({ groupId: "100" }));
    expect(getLastTelegramExport("bob")).toBeNull();
    setLastTelegramExport("bob", entry({ groupId: "200" }));
    expect(getLastTelegramExport("alice")).toMatchObject({ groupId: "100" });
    expect(getLastTelegramExport("bob")).toMatchObject({ groupId: "200" });
  });

  it("never touches the WhatsApp slot", () => {
    setLastExport("alice", waEntry());
    setLastTelegramExport("alice", entry());
    expect(getLastExport("alice")).toMatchObject({ filePath: "output/WA.csv" });
    expect(getLastTelegramExport("alice")).toMatchObject({ filePath: "output/telegram-A.csv" });
  });

  it("rejects anonymous identities", () => {
    expect(() => setLastTelegramExport("", entry())).toThrow("authenticated userId");
    expect(() => getLastTelegramExport(undefined as unknown as string)).toThrow("authenticated userId");
  });
});
