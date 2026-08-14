/**
 * Tests for the feature-dot model's translation contract: the module is pure,
 * so a resolved dot carries translation KEYS and the rendering component
 * resolves them. A key that no locale defines renders as a raw key (or throws
 * `MISSING_MESSAGE`) at runtime, which no component test would catch for a
 * signal the fixture never pins, so every key is checked against `en.json`
 * here.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  SIGNAL_ALLOWLIST,
  SIGNAL_META,
  resolveFeatureDot,
  signalLabelKey,
  type SignalKey,
} from "@/lib/nodes/node-feature-dots";

const EN = JSON.parse(
  readFileSync(resolve(__dirname, "../../../locales/en.json"), "utf-8"),
) as Record<string, unknown>;

/** Resolve a dotted key inside the `nodeConsole` namespace, as `t()` would. */
function nodeConsole(key: string): unknown {
  let cur: unknown = EN.nodeConsole;
  for (const part of key.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const ALL_SIGNALS = Object.keys(SIGNAL_META) as SignalKey[];

describe("node feature dots", () => {
  it("every signal has a label key the nodeConsole namespace defines", () => {
    for (const signal of ALL_SIGNALS) {
      expect(typeof nodeConsole(signalLabelKey(signal)), signal).toBe("string");
    }
  });

  it("every profile's pinnable signals are covered by the label keys", () => {
    for (const [profile, signals] of Object.entries(SIGNAL_ALLOWLIST)) {
      for (const signal of signals) {
        expect(
          typeof nodeConsole(signalLabelKey(signal)),
          `${profile}/${signal}`,
        ).toBe("string");
      }
    }
  });

  it("the tooltip pattern takes both a signal and a state placeholder", () => {
    const pattern = nodeConsole("signalTooltip");
    expect(typeof pattern).toBe("string");
    expect(pattern as string).toContain("{signal}");
    expect(pattern as string).toContain("{state}");
  });

  it("a fresh link resolves to a verified healthy state key", () => {
    const dot = resolveFeatureDot("link", { lastSeen: Date.now() });
    expect(dot.known).toBe(true);
    expect(dot.level).toBe("good");
    expect(dot.labelKey).toBe("signals.link");
    expect(dot.stateKey).toBe("signalState.good");
    expect(typeof nodeConsole(dot.stateKey)).toBe("string");
  });

  it("a link that has never been seen resolves to the offline state key", () => {
    const dot = resolveFeatureDot("link", {});
    expect(dot.known).toBe(true);
    expect(dot.stateKey).toBe("signalState.offline");
    expect(typeof nodeConsole(dot.stateKey)).toBe("string");
  });

  it("an unverifiable signal carries the honest no-reading state key", () => {
    for (const signal of ALL_SIGNALS.filter((s) => s !== "link")) {
      const dot = resolveFeatureDot(signal, { lastSeen: Date.now() });
      expect(dot.known, signal).toBe(false);
      expect(dot.stateKey, signal).toBe("signalState.unknown");
    }
    expect(typeof nodeConsole("signalState.unknown")).toBe("string");
  });

  it("every status band a dot can carry has a state key", () => {
    for (const level of [
      "good",
      "warning",
      "serious",
      "critical",
      "idle",
      "offline",
    ]) {
      expect(typeof nodeConsole(`signalState.${level}`), level).toBe("string");
    }
  });
});
