import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  exportTelegramCsv,
  resolveTelegramOutputPath,
  TELEGRAM_CSV_HEADERS,
  _internal,
} from "./telegram-csv.js";
import type { TelegramParticipant } from "../telegram/participants.js";

function participant(overrides: Partial<TelegramParticipant> = {}): TelegramParticipant {
  return {
    telegramId: "12345678901234567890",
    firstName: "João",
    lastName: "Silva",
    username: "joao",
    phone: "+5516999999999",
    isAdmin: false,
    isOwner: false,
    ...overrides,
  };
}

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tg-csv-"));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("Telegram CSV schema", () => {
  it("freezes headers in order", () => {
    expect([...TELEGRAM_CSV_HEADERS]).toEqual([
      "TELEGRAM_ID",
      "NOME",
      "SOBRENOME",
      "USERNAME",
      "NUMERO",
      "ADMIN",
      "OWNER",
    ]);
  });

  it("writes BOM, semicolon rows, lowercase booleans, exact IDs", async () => {
    const out = path.join(tmpDir, "a.csv");
    await exportTelegramCsv(
      [
        participant({ isAdmin: true, isOwner: true }),
        participant({ telegramId: "7", firstName: "", lastName: "", username: "", phone: "" }),
      ],
      out,
    );
    const raw = await fs.readFile(out);
    expect([raw[0], raw[1], raw[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = raw.toString("utf8");
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe("TELEGRAM_ID;NOME;SOBRENOME;USERNAME;NUMERO;ADMIN;OWNER");
    expect(lines[1]).toBe("12345678901234567890;João;Silva;joao;+5516999999999;true;true");
    expect(lines[2]).toBe("7;;;;;false;false");
  });

  it("escapes delimiters, quotes, newlines, CR and preserves Unicode", async () => {
    const out = path.join(tmpDir, "b.csv");
    await exportTelegramCsv(
      [participant({ firstName: 'A; "B"\nC\rd日本語❤️', username: "u;ser" })],
      out,
    );
    const text = (await fs.readFile(out)).toString("utf8");
    expect(text).toContain('"A; ""B""\nC\rd日本語❤️"');
    expect(text).toContain('"u;ser"');
  });

  it("writes header only for empty lists", async () => {
    const out = path.join(tmpDir, "c.csv");
    await exportTelegramCsv([], out);
    const text = (await fs.readFile(out)).toString("utf8");
    expect(text.trim().split("\n")).toHaveLength(1);
  });

  it("creates missing directories", async () => {
    const out = path.join(tmpDir, "deep", "nested", "x.csv");
    await exportTelegramCsv([participant()], out);
    expect((await fs.stat(out)).isFile()).toBe(true);
  });
});

describe("Telegram output path", () => {
  it("namespaces with telegram- and reuses sanitization", () => {
    expect(resolveTelegramOutputPath("Minha Família", tmpDir)).toBe(
      path.join(tmpDir, "telegram-Minha Família.csv"),
    );
    expect(resolveTelegramOutputPath("../escape", tmpDir)).toBe(
      path.join(tmpDir, "telegram-__escape.csv"),
    );
    expect(resolveTelegramOutputPath("   ", tmpDir)).toBe(
      path.join(tmpDir, "telegram-telegram-group.csv"),
    );
  });

  it("never escapes the output directory", () => {
    const out = resolveTelegramOutputPath("../../etc", tmpDir);
    expect(path.resolve(out).startsWith(path.resolve(tmpDir) + path.sep)).toBe(true);
  });

  it("exposes the delimiter and prefix for tests", () => {
    expect(_internal.FIELD_DELIMITER).toBe(";");
    expect(_internal.FILENAME_PREFIX).toBe("telegram-");
  });
});
