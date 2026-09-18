import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// Regression test (Phase 12): browsers request /favicon.ico on every page
// load. Without one, the server answers 404 and the console shows
// "Failed to load resource: 404". (Note: src/app/icon.svg was tried first,
// but Next 15's metadata loader cannot process it when the project path
// contains an apostrophe — public/favicon.ico avoids that loader entirely.)
describe("favicon", () => {
  it("ships a valid ICO file served at /favicon.ico", () => {
    const iconPath = path.join(__dirname, "..", "..", "public", "favicon.ico");
    const bytes = fs.readFileSync(iconPath);
    // ICO header: reserved=0, type=1 (ICO), count>=1
    expect(bytes.readUInt16LE(0)).toBe(0);
    expect(bytes.readUInt16LE(2)).toBe(1);
    expect(bytes.readUInt16LE(4)).toBeGreaterThanOrEqual(1);
  });
});
