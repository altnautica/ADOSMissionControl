/**
 * Tests for the pure self-heal event summaries: guardian link transitions,
 * repair-rung phrasing, camera-recovery episode steps, the regulatory /
 * onboard-WiFi kinds, and defensive reads of sparse / forward-versioned
 * payloads. Wording is resolved through a translator scoped to
 * `nodeSettings.selfHeal`; the test builds one from the canonical `en.json`
 * so the assertions verify the real i18n keys + interpolation, not a
 * hardcoded English string in the module.
 *
 * @license GPL-3.0-only
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SELF_HEAL_EVENT_KINDS,
  mapSelfHealEvents,
  repairRungPhrase,
  summarizeSelfHealEvent,
  type SelfHealTranslator,
} from "@/lib/agent/self-heal-events";
import type { EventsRow } from "@/lib/agent/agent-client/logging";

// A translator over the canonical en.json selfHeal subtree with simple
// `{name}` interpolation — exactly the shape next-intl resolves at runtime.
const EN = JSON.parse(
  readFileSync(resolve(__dirname, "../../locales/en.json"), "utf-8"),
) as { nodeSettings: { selfHeal: Record<string, unknown> } };
const SELF_HEAL = EN.nodeSettings.selfHeal;

const t: SelfHealTranslator = (key, values) => {
  let cur: unknown = SELF_HEAL;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      cur = undefined;
      break;
    }
  }
  let out = typeof cur === "string" ? cur : key;
  if (values) {
    for (const [k, v] of Object.entries(values)) {
      out = out.split(`{${k}}`).join(String(v));
    }
  }
  return out;
};

describe("summarizeSelfHealEvent", () => {
  it("words the guardian link transitions by reported state", () => {
    expect(
      summarizeSelfHealEvent(t, "network.link_health_check", {
        state: "healthy",
        interface: "eth0",
      }),
    ).toEqual({ summary: "Management link healthy (eth0)", severity: "success" });
    expect(
      summarizeSelfHealEvent(t, "network.link_health_check", {
        state: "degraded",
        interface: "eth0",
      }),
    ).toEqual({
      summary: "Management link degraded, no data path (eth0)",
      severity: "warning",
    });
    expect(
      summarizeSelfHealEvent(t, "network.link_health_check", { state: "down" }),
    ).toEqual({ summary: "Management link down", severity: "error" });
    // Sparse payload: no fabricated state.
    expect(
      summarizeSelfHealEvent(t, "network.link_health_check", undefined),
    ).toEqual({ summary: "Management link state changed", severity: "warning" });
  });

  it("phrases the repair rung and never leaks an unknown token", () => {
    expect(
      summarizeSelfHealEvent(t, "network.link_repair_attempt", {
        rung: "renew_dhcp",
        interface: "eth0",
      }),
    ).toEqual({
      summary: "Management-link repair: renewing DHCP (eth0)",
      severity: "warning",
    });
    expect(
      summarizeSelfHealEvent(t, "network.link_repair_attempt", {
        rung: "quantum_flux",
      }),
    ).toEqual({
      summary: "Management-link repair: running a repair step",
      severity: "warning",
    });
    expect(
      summarizeSelfHealEvent(t, "network.link_repair_exhausted", {
        interface: "wlan0",
      }).severity,
    ).toBe("error");
  });

  it("words the camera recovery episode by reported state", () => {
    expect(
      summarizeSelfHealEvent(t, "camera.usb_recovery", { state: "success" }),
    ).toEqual({ summary: "Camera USB recovery succeeded", severity: "success" });
    expect(
      summarizeSelfHealEvent(t, "camera.usb_recovery", {
        state: "rebinding",
        attempt: 2,
        max_attempts: 3,
      }),
    ).toEqual({
      summary: "Camera USB recovery: re-binding the device (attempt 2 of 3)",
      severity: "warning",
    });
    expect(
      summarizeSelfHealEvent(t, "camera.usb_recovery", {
        state: "exhausted",
        attempt: 3,
        max_attempts: 3,
      }).severity,
    ).toBe("error");
    expect(
      summarizeSelfHealEvent(t, "camera.usb_recovery", {
        state: "needs_hub_reset",
      }).summary,
    ).toMatch(/physical reseat/);
    expect(
      summarizeSelfHealEvent(t, "camera.power_contention", undefined).severity,
    ).toBe("warning");
  });

  it("words the regulatory + onboard-WiFi kinds locally", () => {
    expect(
      summarizeSelfHealEvent(t, "radio.reg_reasserted", { to_country: "US" }),
    ).toEqual({
      summary: "Regulatory domain re-pinned to US",
      severity: "success",
    });
    expect(
      summarizeSelfHealEvent(t, "radio.reg_reasserted", {
        from_country: "IN",
        to_country: "US",
        channel_permitted: false,
      }),
    ).toEqual({
      summary: "Regulatory domain re-pinned IN to US",
      severity: "warning",
    });
    expect(
      summarizeSelfHealEvent(t, "network.wifi_reassociated", {
        consecutive_failures: 2,
      }),
    ).toEqual({
      summary: "Onboard Wi-Fi re-associated (gateway unreachable x2)",
      severity: "warning",
    });
  });

  it("falls back to the raw kind for an unknown event", () => {
    expect(summarizeSelfHealEvent(t, "future.kind", {})).toEqual({
      summary: "future.kind",
      severity: "warning",
    });
  });
});

describe("repairRungPhrase", () => {
  it("maps every guardian rung and returns null on unknowns", () => {
    expect(repairRungPhrase(t, "reassert_reg")).toMatch(/regulatory/);
    expect(repairRungPhrase(t, "exhausted")).toMatch(/hardware-level/);
    expect(repairRungPhrase(t, "nope")).toBeNull();
  });
});

describe("mapSelfHealEvents", () => {
  it("sorts newest-first and caps the list", () => {
    const rows: EventsRow[] = [1, 2, 3].map((i) => ({
      ts: `2026-07-22T10:0${i}:00Z`,
      ts_us: i * 1_000_000,
      kind: "camera.usb_recovery",
      data: { state: "success" },
    }));
    const items = mapSelfHealEvents(t, rows, 2);
    expect(items).toHaveLength(2);
    expect(items[0].tsUs).toBe(3_000_000);
    expect(items[1].tsUs).toBe(2_000_000);
  });

  it("queries a stable, exhaustive kind list", () => {
    // The kind list is the wire contract with the durable store's
    // event_kind filter; a rename here silently empties the feed.
    expect([...SELF_HEAL_EVENT_KINDS]).toEqual([
      "network.wifi_reassociated",
      "network.link_health_check",
      "network.link_repair_attempt",
      "network.link_repair_exhausted",
      "camera.usb_recovery",
      "camera.power_contention",
      "radio.reg_reasserted",
    ]);
  });
});
