/**
 * The ground station's link key state (`/api/video/config` →
 * `hopping.key_status`), pinned from the wire to the label and tone.
 *
 * A ground that never received the shared key stays in cold start; the radio
 * tab only shows that if the normaliser keeps the value and the label maps it
 * to a warning.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { normalizeHopKeyStatus } from "@/stores/agent-capabilities/normalize-radio";
import {
  hopKeyStatusLabel,
  hopKeyStatusTone,
} from "@/components/hardware/radio/labels";
import type { RadioHopKeyStatus } from "@/lib/api/ground-station/types";
import { DEMO_VIDEO_CONFIG } from "@/mock/agent/client-extras";

const STATUSES: readonly RadioHopKeyStatus[] = ["bound", "cold_start", "key_unavailable"];

const EN = JSON.parse(
  readFileSync(resolve(__dirname, "../../locales/en.json"), "utf-8"),
) as Record<string, never>;

/** Stand-in for the next-intl hook, scoped to the "hardware.radio" namespace. */
function radioT(key: string): string {
  const parts = ["hardware", "radio", ...key.split(".")];
  let node: unknown = EN;
  for (const part of parts) {
    if (node === null || typeof node !== "object") return "";
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : "";
}

const t = radioT as unknown as Parameters<typeof hopKeyStatusLabel>[0];

describe("hop key status", () => {
  it("keeps every value the agent reports", () => {
    for (const status of STATUSES) {
      expect(normalizeHopKeyStatus({ key_status: status })).toBe(status);
    }
  });

  it("reads absent, null and unknown values as not reported", () => {
    expect(normalizeHopKeyStatus(undefined)).toBeNull();
    expect(normalizeHopKeyStatus(null)).toBeNull();
    expect(normalizeHopKeyStatus({ enabled: true, history: [] })).toBeNull();
    expect(normalizeHopKeyStatus({ key_status: null })).toBeNull();
    expect(normalizeHopKeyStatus({ key_status: "warp" })).toBeNull();
  });

  it("labels each state in plain operator copy", () => {
    expect(radioT("hopKeyLabel")).toBe("Link key");
    expect(hopKeyStatusLabel(t, "bound")).toBe("Bound");
    expect(hopKeyStatusLabel(t, "cold_start")).toBe("Waiting for key (cold start)");
    expect(hopKeyStatusLabel(t, "key_unavailable")).toBe("Key unavailable");
  });

  it("warns on cold start and an unreadable key", () => {
    expect(hopKeyStatusTone("bound")).toBe("success");
    expect(hopKeyStatusTone("cold_start")).toBe("warning");
    expect(hopKeyStatusTone("key_unavailable")).toBe("warning");
  });

  it("the demo ground station reports a bound key", () => {
    expect(normalizeHopKeyStatus(DEMO_VIDEO_CONFIG.hopping)).toBe("bound");
  });
});
