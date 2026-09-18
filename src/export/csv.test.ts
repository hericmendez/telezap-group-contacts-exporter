import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exportCsv, sanitizeFilename, resolveOutputPath, CSV_HEADERS } from "./csv.js";
import type { ResolvedContact } from "../whatsapp/contacts.js";

function contact(overrides: Partial<ResolvedContact> & { whatsappId: string }): ResolvedContact {
  return {
    name: "Test",
    pushname: "Push",
    number: "123",
    isAdmin: false,
    isSuperAdmin: false,
    ...overrides,
  };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "csv-test-"));
}

async function readCsvOutput(file: string): Promise<{ bom: boolean; content: string; lines: string[] }> {
  const buf = await fs.promises.readFile(file);
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const content = bom ? buf.slice(3).toString("utf8") : buf.toString("utf8");
  const lines = content.split("\n");
  return { bom, content, lines };
}

// ── Headers 1-3 ─────────────────────────────────────────────────────────────

describe("CSV headers", () => {
  it("1. correct header names", () => {
    expect(CSV_HEADERS).toEqual([
      "WHATSAPP_ID",
      "NOME",
      "NOME_WHATSAPP",
      "NUMERO",
      "ADMIN",
      "SUPER_ADMIN",
    ]);
  });

  it("2. correct header order", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    await exportCsv([], file);
    const { content } = await readCsvOutput(file);
    expect(content.split("\n")[0]).toBe("WHATSAPP_ID;NOME;NOME_WHATSAPP;NUMERO;ADMIN;SUPER_ADMIN");
  });

  it("3. semicolon delimiter", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    await exportCsv([contact({ whatsappId: "1@c.us", name: "A", pushname: "B", number: "1" })], file);
    const { content } = await readCsvOutput(file);
    const header = content.split("\n")[0]!;
    expect(header.split(";")).toHaveLength(6);
    expect(header).not.toContain(",");
  });
});

// ── Rows 4-10 ───────────────────────────────────────────────────────────────

describe("CSV rows", () => {
  it("4. one normal contact", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    await exportCsv([contact({ whatsappId: "5516999999999@c.us", name: "João Silva", pushname: "João", number: "5516999999999", isAdmin: false, isSuperAdmin: false })], file);
    const { content } = await readCsvOutput(file);
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("5516999999999@c.us;João Silva;João;5516999999999;false;false");
  });

  it("5. multiple contacts", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    await exportCsv(
      [contact({ whatsappId: "1@c.us", name: "A" }), contact({ whatsappId: "2@c.us", name: "B" })],
      file,
    );
    const { lines } = await readCsvOutput(file);
    expect(lines.filter((l) => l.trim() !== "")).toHaveLength(3); // header + 2
  });

  it("6. empty contacts array produces header-only CSV", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "empty.csv");
    await exportCsv([], file);
    const { content } = await readCsvOutput(file);
    expect(content.trim()).toBe("WHATSAPP_ID;NOME;NOME_WHATSAPP;NUMERO;ADMIN;SUPER_ADMIN");
  });

  it("7. boolean values are lowercase true/false", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    await exportCsv([contact({ whatsappId: "1@c.us", isAdmin: true, isSuperAdmin: false })], file);
    const { content } = await readCsvOutput(file);
    expect(content).toContain(";true;false");
    expect(content).not.toContain("TRUE");
    expect(content).not.toContain("FALSE");
    expect(content).not.toContain(";1;");
  });

  it("8. empty fields remain empty", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    await exportCsv([contact({ whatsappId: "123@lid", name: "", pushname: "", number: "", isAdmin: false, isSuperAdmin: false })], file);
    const { content } = await readCsvOutput(file);
    expect(content.split("\n")[1]).toBe("123@lid;;;;false;false");
  });

  it("9. @c.us IDs remain unchanged", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    await exportCsv([contact({ whatsappId: "5516999999999@c.us" })], file);
    const { content } = await readCsvOutput(file);
    expect(content).toContain("5516999999999@c.us");
  });

  it("10. @lid IDs remain unchanged", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    await exportCsv([contact({ whatsappId: "123456789@lid" })], file);
    const { content } = await readCsvOutput(file);
    expect(content).toContain("123456789@lid");
  });
});

// ── Encoding 11-13 ──────────────────────────────────────────────────────────

describe("CSV encoding", () => {
  it("11. UTF-8 BOM is present", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    await exportCsv([contact({ whatsappId: "1@c.us" })], file);
    const buf = await fs.promises.readFile(file);
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
  });

  it("12. accented Portuguese characters survive", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    await exportCsv(
      [contact({ whatsappId: "1@c.us", name: "João Gonçalves", pushname: "Márcia André" })],
      file,
    );
    const { content } = await readCsvOutput(file);
    expect(content).toContain("João Gonçalves");
    expect(content).toContain("Márcia André");
  });

  it("13. arbitrary Unicode survives", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    await exportCsv([contact({ whatsappId: "1@c.us", name: "Ω≈ç√∫", pushname: "🎉" })], file);
    const { content } = await readCsvOutput(file);
    expect(content).toContain("Ω≈ç√∫");
    expect(content).toContain("🎉");
  });
});

// ── Escaping 14-17 ──────────────────────────────────────────────────────────

describe("CSV escaping", () => {
  it("14. semicolon inside a field", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    await exportCsv([contact({ whatsappId: "1@c.us", name: 'João; "O Rei"', pushname: "P", number: "1" })], file);
    const { content } = await readCsvOutput(file);
    // Should be quoted with doubled quotes
    expect(content).toContain('"João; ""O Rei"""');
  });

  it("15. quotes inside a field", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    await exportCsv([contact({ whatsappId: "1@c.us", name: 'Say "Hello"', pushname: "P" })], file);
    const { content } = await readCsvOutput(file);
    expect(content).toContain('"Say ""Hello"""');
  });

  it("16. newline inside a field", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    await exportCsv([contact({ whatsappId: "1@c.us", name: "Line1\nLine2" })], file);
    const buf = await fs.promises.readFile(file);
    const text = buf.slice(3).toString("utf8"); // skip BOM
    expect(text).toContain('"Line1\nLine2"');
  });

  it("17. combination of quote + delimiter + newline + carriage return", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    const tricky = 'A;B"C\r\nD';
    await exportCsv([contact({ whatsappId: "1@c.us", name: tricky })], file);
    const buf = await fs.promises.readFile(file);
    const text = buf.slice(3).toString("utf8");
    // Should be quoted and quotes doubled, with \r preserved inside quotes
    expect(text).toContain('"A;B""C\r\nD"');
  });

  it("carriage return alone is quoted", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    await exportCsv([contact({ whatsappId: "1@c.us", name: "a\rb" })], file);
    const buf = await fs.promises.readFile(file);
    const text = buf.slice(3).toString("utf8");
    expect(text).toContain('"a\rb"');
  });
});

// ── Filesystem 18-24 ────────────────────────────────────────────────────────

describe("CSV filesystem", () => {
  it("18. output directory is created if missing", async () => {
    const base = tmpDir();
    const nested = path.join(base, "a", "b", "c");
    const file = path.join(nested, "out.csv");
    await exportCsv([contact({ whatsappId: "1@c.us" })], file);
    expect(fs.existsSync(nested)).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
  });

  it("19. file is actually created", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "created.csv");
    await exportCsv([contact({ whatsappId: "1@c.us" })], file);
    expect(fs.existsSync(file)).toBe(true);
    const stat = await fs.promises.stat(file);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("20. generated filename has .csv", () => {
    expect(sanitizeFilename("My Group") + ".csv").toMatch(/\.csv$/);
    const p = resolveOutputPath("My Group", "output");
    expect(p).toMatch(/\.csv$/);
  });

  it("21. invalid filename characters are sanitized", () => {
    expect(sanitizeFilename("My/Group")).toBe("My_Group");
    expect(sanitizeFilename("My\\Group")).toBe("My_Group");
    expect(sanitizeFilename("My:Group")).toBe("My_Group");
    expect(sanitizeFilename("My*Group")).toBe("My_Group");
    expect(sanitizeFilename("My?Group")).toBe("My_Group");
    expect(sanitizeFilename('My"Group')).toBe("My_Group");
    expect(sanitizeFilename("My<Group>")).toBe("My_Group_");
    expect(sanitizeFilename("My|Group")).toBe("My_Group");
  });

  it("22. path traversal attempts cannot escape the output directory", () => {
    const p1 = resolveOutputPath("../escape", "output");
    const p2 = resolveOutputPath("..", "output");
    const p3 = resolveOutputPath("../something.csv", "output");
    for (const p of [p1, p2, p3]) {
      const resolved = path.resolve(p);
      const dir = path.resolve("output");
      expect(resolved.startsWith(dir + path.sep) || resolved === dir).toBe(true);
      expect(p).not.toContain("..");
    }
  });

  it("23. empty/whitespace group names use the documented fallback", () => {
    expect(sanitizeFilename("")).toBe("whatsapp-group");
    expect(sanitizeFilename("   ")).toBe("whatsapp-group");
    expect(sanitizeFilename(".")).toBe("whatsapp-group");
    expect(sanitizeFilename("..")).toBe("whatsapp-group");
    const p = resolveOutputPath("", "output");
    expect(p).toBe(path.join("output", "whatsapp-group.csv"));
  });

  it("24. long group names are handled safely (truncated)", () => {
    const long = "a".repeat(200);
    const sanitized = sanitizeFilename(long);
    expect(sanitized.length).toBeLessThanOrEqual(100);
    expect(sanitized.length).toBeGreaterThan(0);
    const p = resolveOutputPath(long, "output");
    expect(p.length).toBeLessThan(300);
  });

  it("Unicode filenames handled safely", async () => {
    const name = "áéíóú ç ã";
    const sanitized = sanitizeFilename(name);
    expect(sanitized).toBe(name);
    const dir = tmpDir();
    const file = path.join(dir, `${sanitized}.csv`);
    await exportCsv([contact({ whatsappId: "1@c.us" })], file);
    expect(fs.existsSync(file)).toBe(true);
  });
});

// ── Data integrity 25+ ──────────────────────────────────────────────────────

describe("CSV data integrity", () => {
  it("25. row count equals contact count + header", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    const contacts = [contact({ whatsappId: "1@c.us" }), contact({ whatsappId: "2@c.us" }), contact({ whatsappId: "3@c.us" })];
    await exportCsv(contacts, file);
    const { content } = await readCsvOutput(file);
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(4);
  });

  it("26. unresolved/empty contact fields are still exported", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    const unresolved = contact({ whatsappId: "123@lid", name: "", pushname: "", number: "", isAdmin: true, isSuperAdmin: false });
    await exportCsv([unresolved], file);
    const { content } = await readCsvOutput(file);
    expect(content).toContain("123@lid;;;;true;false");
  });

  it("27. admin metadata survives", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    await exportCsv(
      [
        contact({ whatsappId: "1@c.us", isAdmin: true, isSuperAdmin: true }),
        contact({ whatsappId: "2@c.us", isAdmin: false, isSuperAdmin: false }),
      ],
      file,
    );
    const { content } = await readCsvOutput(file);
    expect(content).toContain("1@c.us;Test;Push;123;true;true");
    expect(content).toContain("2@c.us;Test;Push;123;false;false");
  });

  it("28. participant order survives", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "out.csv");
    const contacts = [contact({ whatsappId: "c@c.us" }), contact({ whatsappId: "a@c.us" }), contact({ whatsappId: "b@c.us" })];
    await exportCsv(contacts, file);
    const { content } = await readCsvOutput(file);
    const lines = content.trim().split("\n");
    expect(lines[1]!.startsWith("c@c.us")).toBe(true);
    expect(lines[2]!.startsWith("a@c.us")).toBe(true);
    expect(lines[3]!.startsWith("b@c.us")).toBe(true);
  });

  it("sanitizeFilename examples from spec are safe", () => {
    const cases: [string, string][] = [
      ["My Group", "My Group"],
      ["My/Group", "My_Group"],
      ["My\\Group", "My_Group"],
      ["My:Group", "My_Group"],
      ["My*Group", "My_Group"],
      ["My?Group", "My_Group"],
      ['My"Group', "My_Group"],
      ["My<Group>", "My_Group_"],
      ["My|Group", "My_Group"],
      ["../escape", "__escape"],
      ["..", "whatsapp-group"],
      [".", "whatsapp-group"],
      ["   ", "whatsapp-group"],
      ["áéíóú ç ã", "áéíóú ç ã"],
    ];
    for (const [input, expected] of cases) {
      const sanitized = sanitizeFilename(input);
      expect(sanitized).toBe(expected);
      const p = resolveOutputPath(input, "output");
      expect(path.resolve(p).startsWith(path.resolve("output") + path.sep)).toBe(true);
    }
  });
});
