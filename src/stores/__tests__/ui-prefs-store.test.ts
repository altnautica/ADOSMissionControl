/**
 * @license GPL-3.0-only
 *
 * Migration behaviour for the persisted UI-prefs store.
 *
 * zustand only calls `migrate` when the persisted payload carries a numeric
 * `version` that differs from the configured one (middleware.js: the version
 * check gates the migrate call, and anything else short-circuits to the raw
 * state). So these tests seed an OLDER version deliberately — a payload written
 * at the current version never reaches the handler, and a test that seeded one
 * would pass without exercising anything.
 *
 * The reason the handler has to exist at all: with no `migrate`, zustand logs
 * "couldn't be migrated" and then destructures an undefined migration result,
 * which throws inside rehydration and drops the whole persisted payload. A
 * version bump would silently reset every remembered tab.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const PERSIST_KEY = "altcmd:ui-prefs";

const mem = vi.hoisted(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
  return store;
});

import { useUiPrefsStore } from "../ui-prefs-store";

/** Seed a pre-version-bump payload and force a rehydrate through `migrate`. */
async function rehydrateFrom(state: unknown): Promise<void> {
  mem.set(PERSIST_KEY, JSON.stringify({ state, version: 0 }));
  await useUiPrefsStore.persist.rehydrate();
}

describe("ui-prefs-store migration", () => {
  beforeEach(() => {
    mem.clear();
    useUiPrefsStore.setState({ lastTabByNode: {}, lastAgentPanelByNode: {} });
  });

  it("carries intact preferences across a version bump", async () => {
    await rehydrateFrom({
      lastTabByNode: { "dev-a": "status" },
      lastAgentPanelByNode: { "dev-a": "network" },
    });

    expect(useUiPrefsStore.getState().getLastTab("dev-a")).toBe("status");
    expect(useUiPrefsStore.getState().getLastAgentPanel("dev-a")).toBe(
      "network",
    );
  });

  it("survives a payload whose maps are not objects", async () => {
    // The panel reads these by index on first render, so a non-object here is
    // the difference between "no remembered tab" and a throw during mount.
    await rehydrateFrom({
      lastTabByNode: "corrupt",
      lastAgentPanelByNode: null,
    });

    const s = useUiPrefsStore.getState();
    expect(s.lastTabByNode).toEqual({});
    expect(s.lastAgentPanelByNode).toEqual({});
    expect(() => s.getLastTab("dev-a")).not.toThrow();
    expect(s.getLastTab("dev-a")).toBeUndefined();
  });

  it("survives a payload predating lastAgentPanelByNode", async () => {
    await rehydrateFrom({ lastTabByNode: { "dev-a": "status" } });

    const s = useUiPrefsStore.getState();
    expect(s.getLastTab("dev-a")).toBe("status");
    expect(s.lastAgentPanelByNode).toEqual({});
    expect(() => s.getLastAgentPanel("dev-a")).not.toThrow();
  });

  it("drops non-string entries rather than handing them to a tab lookup", async () => {
    await rehydrateFrom({
      lastTabByNode: { good: "status", bad: 42, alsoBad: null },
      lastAgentPanelByNode: {},
    });

    expect(useUiPrefsStore.getState().lastTabByNode).toEqual({
      good: "status",
    });
  });

  it("still writes and reads after a migrated rehydrate", async () => {
    await rehydrateFrom({ lastTabByNode: "corrupt" });

    useUiPrefsStore.getState().setLastTab("dev-b", "logs");
    expect(useUiPrefsStore.getState().getLastTab("dev-b")).toBe("logs");
  });
});
