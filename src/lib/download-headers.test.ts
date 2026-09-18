import { describe, it, expect } from "vitest";
import { contentDispositionAttachment, toAsciiFilename } from "./download-headers.js";

describe("toAsciiFilename", () => {
  it("keeps ASCII names intact", () => {
    expect(toAsciiFilename("telegram-Fazendinha.csv")).toBe("telegram-Fazendinha.csv");
  });

  it("replaces non-ASCII with underscores and strips quotes", () => {
    expect(toAsciiFilename('telegram-Família "x".csv')).toBe("telegram-Fam_lia x.csv");
  });

  it("falls back for empty/degenerate names", () => {
    expect(toAsciiFilename("")).toBe("download.csv");
    expect(toAsciiFilename("日本語")).toBe("___");
  });
});

describe("contentDispositionAttachment", () => {
  const cases: Array<[string, string]> = [
    ["Fazendinha", "telegram-Fazendinha.csv"],
    ["Minha Família", "telegram-Minha Família.csv"],
    ["Família ❤️", "telegram-Família ❤️.csv"],
    ["日本語", "telegram-日本語.csv"],
    ["Grupo 😀", "telegram-Grupo 😀.csv"],
  ];

  it.each(cases)("serves %s safely", (_label, filename) => {
    const value = contentDispositionAttachment(filename);
    // ByteString-safe: the Headers constructor throws on raw Unicode
    const headers = new Headers({ "Content-Disposition": value });
    expect(headers.get("Content-Disposition")).toBe(value);
    expect(value).toMatch(/^attachment; filename="[^"]+"; filename\*=UTF-8''.+$/);
    // original name recoverable from filename*
    const encoded = value.split("filename*=UTF-8''")[1]!;
    expect(decodeURIComponent(encoded)).toBe(filename);
  });

  it("keeps an ASCII fallback alongside the UTF-8 name", () => {
    const value = contentDispositionAttachment("telegram-Grupo 😀.csv");
    expect(value).toContain('filename="telegram-Grupo __.csv"');
  });
});
