import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { hashPassword } from "./hash.js";
import { loadAppUsers, findAppUser } from "./users.js";

let saved: string | undefined;

beforeEach(() => {
  saved = process.env.TELEZAP_USERS;
  delete process.env.TELEZAP_USERS;
});

afterEach(() => {
  if (saved === undefined) delete process.env.TELEZAP_USERS;
  else process.env.TELEZAP_USERS = saved;
});

describe("loadAppUsers", () => {
  it("returns empty when unconfigured", () => {
    expect(loadAppUsers()).toEqual([]);
  });

  it("parses username:hash pairs", async () => {
    const hash = await hashPassword("pw");
    process.env.TELEZAP_USERS = `revi:${hash}, grazi:${hash} `;
    const users = loadAppUsers();
    expect(users.map((u) => ({ id: u.id, username: u.username }))).toEqual([
      { id: "revi", username: "revi" },
      { id: "grazi", username: "grazi" },
    ]);
    expect(users[0]!.passwordHash).toBe(hash);
  }, 15000);

  it("rejects malformed and duplicate entries", () => {
    process.env.TELEZAP_USERS = "no-separator";
    expect(() => loadAppUsers()).toThrow("username:hash");
    process.env.TELEZAP_USERS = "a:h1,a:h2";
    expect(() => loadAppUsers()).toThrow('Duplicate username');
  });

  it("findAppUser returns undefined for unknown names", async () => {
    const hash = await hashPassword("pw");
    process.env.TELEZAP_USERS = `revi:${hash}`;
    const users = loadAppUsers();
    expect(findAppUser(users, "revi")?.id).toBe("revi");
    expect(findAppUser(users, "nobody")).toBeUndefined();
  }, 15000);
});
