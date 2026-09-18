import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadTelegramConfig } from "./config.js";

let savedId: string | undefined;
let savedHash: string | undefined;

beforeEach(() => {
  savedId = process.env.TELEGRAM_API_ID;
  savedHash = process.env.TELEGRAM_API_HASH;
  delete process.env.TELEGRAM_API_ID;
  delete process.env.TELEGRAM_API_HASH;
});

afterEach(() => {
  if (savedId === undefined) delete process.env.TELEGRAM_API_ID;
  else process.env.TELEGRAM_API_ID = savedId;
  if (savedHash === undefined) delete process.env.TELEGRAM_API_HASH;
  else process.env.TELEGRAM_API_HASH = savedHash;
});

describe("loadTelegramConfig", () => {
  it("loads numeric id and hash", () => {
    process.env.TELEGRAM_API_ID = "123456";
    process.env.TELEGRAM_API_HASH = "abc";
    expect(loadTelegramConfig()).toEqual({ apiId: 123456, apiHash: "abc" });
  });

  it("rejects missing values without echoing secrets", () => {
    process.env.TELEGRAM_API_HASH = "supersecret";
    expect(() => loadTelegramConfig()).toThrow("Missing TELEGRAM_API_ID");
    try {
      loadTelegramConfig();
    } catch (err) {
      expect(String(err)).not.toContain("supersecret");
    }
    process.env.TELEGRAM_API_ID = "1";
    delete process.env.TELEGRAM_API_HASH;
    expect(() => loadTelegramConfig()).toThrow("Missing TELEGRAM_API_HASH");
  });

  it("rejects non-numeric ids", () => {
    process.env.TELEGRAM_API_ID = "not-a-number";
    process.env.TELEGRAM_API_HASH = "abc";
    expect(() => loadTelegramConfig()).toThrow("Invalid TELEGRAM_API_ID");
  });
});
