/**
 * The radio / network health panel's live pills: a missing field must never
 * read as healthy, a degraded link must never read green, and an inferred RF
 * verdict must say it is inferred.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import type { RadioState } from "@/lib/api/ground-station/types";
import type { RadioNetworkActivity } from "@/lib/agent/radio-network-events";
import {
  channelReading,
  managementReading,
  reachbackReading,
  regionReading,
  rehomeReading,
  rfLinkReading,
  stackReading,
} from "@/components/command/system/radio-health-reading";

const radio = (fields: Partial<RadioState>): RadioState => fields as RadioState;

describe("regionReading", () => {
  it("reads unrestricted when nothing is pinned", () => {
    expect(regionReading(null)).toEqual({ value: "Unrestricted", unrestricted: true });
    expect(regionReading(radio({ regPosture: null, pinnedRegion: null, regDomain: null }))).toEqual({
      value: "Unrestricted",
      unrestricted: true,
    });
  });

  it("falls back to the legacy regDomain and marks a home-channel pin", () => {
    expect(
      regionReading(radio({ regPosture: null, pinnedRegion: null, regDomain: "US", homeChannel: 149, channel: 149 })),
    ).toEqual({ value: "US (pinned)", unrestricted: false });
    expect(
      regionReading(radio({ regPosture: "pinned", pinnedRegion: "IN", homeChannel: 149, channel: 157 })),
    ).toEqual({ value: "IN", unrestricted: false });
  });

  it("honours an explicit unrestricted posture over a stale region", () => {
    expect(regionReading(radio({ regPosture: "unrestricted", pinnedRegion: "US" })).unrestricted).toBe(true);
  });
});

describe("channelReading", () => {
  it("shows no lock and a muted tone when nothing is reported", () => {
    expect(channelReading(null)).toEqual({ value: "n/a / No lock", tone: "muted" });
  });

  it("reports lock from either the lock flag or the acquirer state", () => {
    expect(channelReading(radio({ channel: 149, freqMhz: 5745, channelLocked: true }))).toEqual({
      value: "Ch 149 (5745 MHz) / Lock OK",
      tone: "success",
    });
    expect(channelReading(radio({ channel: 36, acquireState: "searching" }))).toEqual({
      value: "Ch 36 / Searching",
      tone: "warning",
    });
  });
});

describe("rfLinkReading", () => {
  it("labels an inference as inferred", () => {
    const r = rfLinkReading(radio({ txActive: true, acquireState: "searching", channelLocked: false }), []);
    expect(r.value).toBe("Unverified (inferred)");
    expect(r.tone).toBe("error");
  });

  it("uses the radio's own verdict without an inferred label", () => {
    const r = rfLinkReading(
      radio({ txActive: true, rfUnverified: false, acquireState: "searching", channelLocked: false }),
      [],
    );
    expect(r).toMatchObject({ value: "TX + reception", tone: "success" });
  });

  it("keeps an idle radio muted, unless the newest episode is an unverified entry", () => {
    expect(rfLinkReading(radio({ txActive: false }), []).value).toBe("Idle");
    const entry: RadioNetworkActivity = {
      id: "e1",
      kind: "radio.rf_unverified",
      ts: "2026-01-01T00:00:00Z",
      tsUs: 1,
      summary: "RF unverified",
      severity: "error",
    };
    expect(rfLinkReading(radio({ txActive: false }), [entry]).value).toBe("Unverified (inferred)");
  });
});

describe("stackReading", () => {
  it("never reads an unreported stack as healthy", () => {
    expect(stackReading(undefined)).toEqual({ value: "n/a", tone: "warning" });
    expect(stackReading("ok")).toEqual({ value: "OK", tone: "success" });
    expect(stackReading("no_injection").tone).toBe("warning");
  });
});

describe("managementReading", () => {
  it("hides the pill when the link state is unknown", () => {
    expect(managementReading(undefined).value).toBeNull();
  });

  it("renders a degraded link as a warning, never green", () => {
    const m = managementReading({ state: "degraded", repairing: false } as never);
    expect(m).toMatchObject({ value: "Degraded (no data path)", tone: "warning", note: null });
  });

  it("names the repair rung and interface while repairing", () => {
    const m = managementReading({ state: "down", repairing: true, lastRung: "renew_dhcp", iface: "eth0" } as never);
    expect(m.tone).toBe("error");
    expect(m.note).toBe("Management link down: renewing DHCP (eth0).");
  });
});

describe("reachbackReading", () => {
  it("shows nothing on the primary link", () => {
    expect(reachbackReading("primary", null)).toEqual({ value: null, tone: "warning", note: null });
  });

  it("warns on the WiFi heartbeat and errors with no reach-back", () => {
    expect(reachbackReading("wifi_heartbeat", "wlan1")).toMatchObject({
      value: "WiFi heartbeat (wlan1)",
      tone: "warning",
    });
    expect(reachbackReading("none", null)).toMatchObject({ value: "No reach-back", tone: "error" });
  });
});

describe("rehomeReading", () => {
  it("shows no pill while idle", () => {
    expect(rehomeReading("idle", 0).value).toBeNull();
  });

  it("counts attempts while rehoming and errors when exhausted", () => {
    expect(rehomeReading("rehoming", 2)).toMatchObject({ value: "Rehoming (attempt 2)", tone: "warning" });
    expect(rehomeReading("rehoming", 0).value).toBe("Rehoming");
    const exhausted = rehomeReading("exhausted", 3);
    expect(exhausted.tone).toBe("error");
    expect(exhausted.note).toMatch(/480 Mbps/);
  });
});
