import { describe, it, expect } from "vitest";
import { normalizeCapabilities } from "../normalizer";

describe("normalizeCapabilities managementLink clamp", () => {
  it("keeps a well-formed object with a known state", () => {
    const ml = {
      state: "degraded",
      iface: "eth0",
      transport: "ethernet",
      backend: "networkd",
      carrier: true,
      hasLease: true,
      gatewayReachable: false,
      repairing: true,
      lastRung: "renew_dhcp",
      lastRepairAt: null,
      repairsInWindow: 1,
    };
    const caps = normalizeCapabilities({ tier: 4, managementLink: ml });
    expect(caps.managementLink?.state).toBe("degraded");
    expect(caps.managementLink?.iface).toBe("eth0");
    expect(caps.managementLink?.gatewayReachable).toBe(false);
  });

  it("accepts each known state", () => {
    for (const state of ["healthy", "degraded", "down"] as const) {
      const caps = normalizeCapabilities({
        tier: 4,
        managementLink: { state },
      });
      expect(caps.managementLink?.state).toBe(state);
    }
  });

  it("round-trips a legacy heartbeat (no field) to undefined", () => {
    const caps = normalizeCapabilities({ tier: 4 });
    expect(caps.managementLink).toBeUndefined();
  });

  it("normalizes an unknown state to undefined (card stays hidden)", () => {
    const caps = normalizeCapabilities({
      tier: 4,
      managementLink: { state: "weird" },
    });
    expect(caps.managementLink).toBeUndefined();
  });

  it("normalizes a non-object value to undefined", () => {
    expect(
      normalizeCapabilities({ tier: 4, managementLink: "down" })
        .managementLink,
    ).toBeUndefined();
    expect(
      normalizeCapabilities({ tier: 4, managementLink: null }).managementLink,
    ).toBeUndefined();
  });
});

describe("normalizeCapabilities mgmtLinkMode (reach-back) clamp", () => {
  it("keeps each known reach-back mode", () => {
    for (const mode of ["primary", "wifi_heartbeat", "none"] as const) {
      const caps = normalizeCapabilities({ tier: 4, mgmtLinkMode: mode });
      expect(caps.mgmtLinkMode).toBe(mode);
    }
  });

  it("carries the failover interface + reason as strings", () => {
    const caps = normalizeCapabilities({
      tier: 4,
      mgmtLinkMode: "wifi_heartbeat",
      mgmtFailoverIface: "wlan0",
      mgmtFailoverReason: "primary_carrier_down",
    });
    expect(caps.mgmtFailoverIface).toBe("wlan0");
    expect(caps.mgmtFailoverReason).toBe("primary_carrier_down");
  });

  it("normalizes an unknown / absent mode to undefined (implies primary)", () => {
    expect(
      normalizeCapabilities({ tier: 4, mgmtLinkMode: "weird" }).mgmtLinkMode,
    ).toBeUndefined();
    expect(normalizeCapabilities({ tier: 4 }).mgmtLinkMode).toBeUndefined();
  });
});

describe("normalizeCapabilities usbRehomeState clamp", () => {
  it("keeps each known rehome state + the attempt count", () => {
    for (const state of [
      "idle",
      "rehoming",
      "guard_blocked",
    ] as const) {
      const caps = normalizeCapabilities({
        tier: 4,
        usbRehomeState: state,
        usbRehomeAttempts: 2,
      });
      expect(caps.usbRehomeState).toBe(state);
      expect(caps.usbRehomeAttempts).toBe(2);
    }
  });

  it("normalizes an unknown / absent state to undefined", () => {
    expect(
      normalizeCapabilities({ tier: 4, usbRehomeState: "weird" })
        .usbRehomeState,
    ).toBeUndefined();
    expect(normalizeCapabilities({ tier: 4 }).usbRehomeState).toBeUndefined();
  });
});
