/**
 * Tests for the pure self-heal event summaries: guardian link transitions,
 * repair-rung phrasing, camera-recovery episode steps, delegation to the
 * shared radio/network summarizer for the overlapping kinds, and defensive
 * reads of sparse / forward-versioned payloads.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import {
  SELF_HEAL_EVENT_KINDS,
  mapSelfHealEvents,
  repairRungPhrase,
  summarizeSelfHealEvent,
} from "@/lib/agent/self-heal-events";
import { summarizeRadioNetworkEvent } from "@/lib/agent/radio-network-events";
import type { EventsRow } from "@/lib/agent/agent-client/logging";

describe("summarizeSelfHealEvent", () => {
  it("words the guardian link transitions by reported state", () => {
    expect(
      summarizeSelfHealEvent("network.link_health_check", {
        state: "healthy",
        interface: "eth0",
      }),
    ).toEqual({ summary: "Management link healthy (eth0)", severity: "success" });
    expect(
      summarizeSelfHealEvent("network.link_health_check", {
        state: "degraded",
        interface: "eth0",
      }),
    ).toEqual({
      summary: "Management link degraded, no data path (eth0)",
      severity: "warning",
    });
    expect(
      summarizeSelfHealEvent("network.link_health_check", { state: "down" }),
    ).toEqual({ summary: "Management link down", severity: "error" });
    // Sparse payload: no fabricated state.
    expect(
      summarizeSelfHealEvent("network.link_health_check", undefined),
    ).toEqual({ summary: "Management link state changed", severity: "warning" });
  });

  it("phrases the repair rung and never leaks an unknown token", () => {
    expect(
      summarizeSelfHealEvent("network.link_repair_attempt", {
        rung: "renew_dhcp",
        interface: "eth0",
      }),
    ).toEqual({
      summary: "Management-link repair: renewing DHCP (eth0)",
      severity: "warning",
    });
    expect(
      summarizeSelfHealEvent("network.link_repair_attempt", {
        rung: "quantum_flux",
      }),
    ).toEqual({
      summary: "Management-link repair: running a repair step",
      severity: "warning",
    });
    expect(
      summarizeSelfHealEvent("network.link_repair_exhausted", {
        interface: "wlan0",
      }).severity,
    ).toBe("error");
  });

  it("words the camera recovery episode by reported state", () => {
    expect(
      summarizeSelfHealEvent("camera.usb_recovery", { state: "success" }),
    ).toEqual({ summary: "Camera USB recovery succeeded", severity: "success" });
    expect(
      summarizeSelfHealEvent("camera.usb_recovery", {
        state: "rebinding",
        attempt: 2,
        max_attempts: 3,
      }),
    ).toEqual({
      summary: "Camera USB recovery: re-binding the device (attempt 2 of 3)",
      severity: "warning",
    });
    expect(
      summarizeSelfHealEvent("camera.usb_recovery", {
        state: "exhausted",
        attempt: 3,
        max_attempts: 3,
      }).severity,
    ).toBe("error");
    expect(
      summarizeSelfHealEvent("camera.usb_recovery", {
        state: "needs_hub_reset",
      }).summary,
    ).toMatch(/physical reseat/);
    expect(
      summarizeSelfHealEvent("camera.power_contention", undefined).severity,
    ).toBe("warning");
  });

  it("delegates the shared kinds to the radio/network summarizer", () => {
    for (const kind of ["network.wifi_reassociated", "radio.reg_reasserted"]) {
      const data = { consecutive_failures: 2, to_country: "US" };
      expect(summarizeSelfHealEvent(kind, data)).toEqual(
        summarizeRadioNetworkEvent(kind, data),
      );
    }
  });

  it("falls back to the raw kind for an unknown event", () => {
    expect(summarizeSelfHealEvent("future.kind", {})).toEqual({
      summary: "future.kind",
      severity: "warning",
    });
  });
});

describe("repairRungPhrase", () => {
  it("maps every guardian rung and returns null on unknowns", () => {
    expect(repairRungPhrase("reassert_reg")).toMatch(/regulatory/);
    expect(repairRungPhrase("exhausted")).toMatch(/hardware-level/);
    expect(repairRungPhrase("nope")).toBeNull();
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
    const items = mapSelfHealEvents(rows, 2);
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
