import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getWhatsAppManager,
  destroyWhatsAppManager,
  destroyAllWhatsAppManagers,
  __resetManagerForTests,
} from "./whatsapp.js";
import {
  getTelegramManager,
  destroyTelegramManager,
  destroyAllTelegramManagers,
  __resetTelegramManagerForTests,
} from "./telegram.js";
import {
  shutdownAllManagers,
  registerProcessShutdownHandlers,
  __resetLifecycleForTests,
} from "./lifecycle.js";

beforeEach(() => {
  __resetManagerForTests();
  __resetTelegramManagerForTests();
  __resetLifecycleForTests();
});

describe("destroyAll managers", () => {
  it("disconnects every manager and empties both registries", async () => {
    const waA = getWhatsAppManager("user-a");
    const waB = getWhatsAppManager("user-b");
    const tgA = getTelegramManager("user-a");
    const waDisconnect = vi.spyOn(waA, "disconnect");
    const waBDisconnect = vi.spyOn(waB, "disconnect");
    const tgDisconnect = vi.spyOn(tgA, "disconnect");

    const wa = await destroyAllWhatsAppManagers();
    expect(wa.destroyed.sort()).toEqual(["user-a", "user-b"]);
    expect(wa.errors).toEqual([]);
    expect(waDisconnect).toHaveBeenCalledTimes(1);
    expect(waBDisconnect).toHaveBeenCalledTimes(1);

    const tg = await destroyAllTelegramManagers();
    expect(tg.destroyed).toEqual(["user-a"]);
    expect(tg.errors).toEqual([]);
    expect(tgDisconnect).toHaveBeenCalledTimes(1);

    // registries are empty: fresh instances are created afterwards
    expect(getWhatsAppManager("user-a")).not.toBe(waA);
    expect(getTelegramManager("user-a")).not.toBe(tgA);
  });

  it("one failing manager does not block the others", async () => {
    const good = getWhatsAppManager("good");
    const bad = getWhatsAppManager("bad");
    vi.spyOn(bad, "disconnect").mockRejectedValueOnce(new Error("browser stuck"));
    const result = await destroyAllWhatsAppManagers();
    expect(result.destroyed).toEqual(["good"]);
    expect(result.errors).toEqual([{ userId: "bad", message: "browser stuck" }]);
    // failed entry was still dropped from the registry
    expect(getWhatsAppManager("bad")).not.toBe(bad);
  });

  it("empty registries destroy cleanly", async () => {
    expect(await destroyAllWhatsAppManagers()).toEqual({ destroyed: [], errors: [] });
    expect(await destroyAllTelegramManagers()).toEqual({ destroyed: [], errors: [] });
  });

  it("destroying one user never touches another user's manager", async () => {
    const a = getTelegramManager("user-a");
    const b = getTelegramManager("user-b");
    const bDisconnect = vi.spyOn(b, "disconnect");
    await destroyTelegramManager("user-a");
    expect(bDisconnect).not.toHaveBeenCalled();
    expect(getTelegramManager("user-b")).toBe(b);
    expect(a).not.toBe(getTelegramManager("user-a"));
  });

  it("recreated managers keep the same session and output scopes", async () => {
    const wa1 = getWhatsAppManager("user-a");
    const tg1 = getTelegramManager("user-a");
    const waScope = wa1.getSessionScope();
    const tgPath = tg1.getSessionPath();
    await destroyWhatsAppManager("user-a");
    await destroyTelegramManager("user-a");
    const wa2 = getWhatsAppManager("user-a");
    const tg2 = getTelegramManager("user-a");
    expect(wa2).not.toBe(wa1);
    expect(tg2).not.toBe(tg1);
    // persistence lives in the filesystem layout, not the object
    expect(wa2.getSessionScope()).toEqual(waScope);
    expect(tg2.getSessionPath()).toBe(tgPath);
  });
});

describe("shutdownAllManagers", () => {
  it("shuts down both platforms and is idempotent", async () => {
    getWhatsAppManager("user-a");
    getTelegramManager("user-a");
    getTelegramManager("user-b");
    const first = await shutdownAllManagers();
    expect(first.whatsapp.destroyed).toEqual(["user-a"]);
    expect(first.telegram.destroyed.sort()).toEqual(["user-a", "user-b"]);
    expect(first.whatsapp.errors).toEqual([]);
    expect(first.telegram.errors).toEqual([]);
    // second call is a no-op: single effective run
    const second = await shutdownAllManagers();
    expect(second).toEqual({
      whatsapp: { destroyed: [], errors: [] },
      telegram: { destroyed: [], errors: [] },
    });
  });

  it("records one platform's failure without blocking the other", async () => {
    const bad = getWhatsAppManager("bad");
    vi.spyOn(bad, "disconnect").mockRejectedValueOnce(new Error("nope"));
    getTelegramManager("good");
    const summary = await shutdownAllManagers();
    expect(summary.whatsapp.errors).toEqual([{ userId: "bad", message: "nope" }]);
    expect(summary.telegram.destroyed).toEqual(["good"]);
  });
});

describe("registerProcessShutdownHandlers", () => {
  it("registers SIGINT/SIGTERM exactly once across repeated calls", () => {
    const before = process.listenerCount("SIGINT") + process.listenerCount("SIGTERM");
    registerProcessShutdownHandlers();
    registerProcessShutdownHandlers();
    registerProcessShutdownHandlers();
    const after = process.listenerCount("SIGINT") + process.listenerCount("SIGTERM");
    expect(after - before).toBe(2);
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
  });
});
