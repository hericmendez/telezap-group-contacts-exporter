import { describe, it, expect, beforeEach } from "vitest";
import {
  setLastExport,
  getLastExport,
  __resetLastExportForTests,
} from "./last-export.js";

beforeEach(() => {
  __resetLastExportForTests();
});

function entry(groupName = "WA"): { filePath: string; groupName: string; createdAt: string } {
  return { filePath: "output/WA.csv", groupName, createdAt: "t" };
}

describe("WhatsApp last-export slot (per user)", () => {
  it("stores and replaces the latest export per user", () => {
    expect(getLastExport("nobody")).toBeNull();
    setLastExport("alice", entry("A"));
    setLastExport("alice", entry("A2"));
    expect(getLastExport("alice")).toMatchObject({ groupName: "A2" });
  });

  it("keeps users isolated from each other", () => {
    setLastExport("alice", entry("A"));
    expect(getLastExport("bob")).toBeNull();
    setLastExport("bob", entry("B"));
    expect(getLastExport("alice")).toMatchObject({ groupName: "A" });
    expect(getLastExport("bob")).toMatchObject({ groupName: "B" });
  });

  it("rejects anonymous identities", () => {
    expect(() => setLastExport("", entry())).toThrow("authenticated userId");
    expect(() => getLastExport(undefined as unknown as string)).toThrow("authenticated userId");
  });
});
