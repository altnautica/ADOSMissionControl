/**
 * @description Tests for the broker-write control-authority resolver.
 *
 * The defect these guard against: a relay session that renders as a live,
 * command-capable link while every FC frame it publishes is silently discarded
 * by the broker. Each case pins one way that lie could come back.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  resolveMqttControlAuthority,
  canPublishFcFrames,
  needsOperatorAttention,
  EXPIRY_WARNING_MS,
  type ControlGrant,
} from "../mqtt-control-authority";

const NOW = 1_700_000_000_000;
const DEVICE = "device-alpha";

function grant(over: Partial<ControlGrant> = {}): ControlGrant {
  return {
    deviceIds: [DEVICE],
    expiresAt: NOW + 60 * 60 * 1000,
    writeConfirmed: true,
    ...over,
  };
}

describe("resolveMqttControlAuthority", () => {
  it("says nothing about a direct link — the broker is not in that path", () => {
    const a = resolveMqttControlAuthority({
      lane: "direct",
      deviceId: DEVICE,
      now: NOW,
    });
    expect(a.reason).toBe("direct-link");
    expect(a.fcFrames).toBe("available");
    expect(canPublishFcFrames(a)).toBe(true);
    expect(needsOperatorAttention(a)).toBe(false);
  });

  it("reports FC frames unavailable on the relay with no grant — today's state", () => {
    const a = resolveMqttControlAuthority({
      lane: "cloud-relay",
      deviceId: DEVICE,
      grant: null,
      now: NOW,
    });
    expect(a.reason).toBe("no-grant");
    expect(a.fcFrames).toBe("unavailable");
    expect(a.videoSignaling).toBe("unavailable");
    expect(canPublishFcFrames(a)).toBe(false);
    expect(needsOperatorAttention(a)).toBe(true);
  });

  it("does not accept a grant issued for a different device", () => {
    const a = resolveMqttControlAuthority({
      lane: "cloud-relay",
      deviceId: DEVICE,
      grant: grant({ deviceIds: ["some-other-device"] }),
      now: NOW,
    });
    expect(a.reason).toBe("no-grant");
    expect(canPublishFcFrames(a)).toBe(false);
  });

  it("accepts a multi-device grant that includes this device", () => {
    const a = resolveMqttControlAuthority({
      lane: "cloud-relay",
      deviceId: DEVICE,
      grant: grant({ deviceIds: ["other", DEVICE, "another"] }),
      now: NOW,
    });
    expect(a.reason).toBe("grant-active");
    expect(canPublishFcFrames(a)).toBe(true);
  });

  it("treats an expired grant as no grant, exactly at the boundary", () => {
    const a = resolveMqttControlAuthority({
      lane: "cloud-relay",
      deviceId: DEVICE,
      grant: grant({ expiresAt: NOW }),
      now: NOW,
    });
    expect(a.reason).toBe("grant-expired");
    expect(canPublishFcFrames(a)).toBe(false);
  });

  it("marks a held-but-unexercised grant as unconfirmed, still usable", () => {
    const a = resolveMqttControlAuthority({
      lane: "cloud-relay",
      deviceId: DEVICE,
      grant: grant({ writeConfirmed: false }),
      now: NOW,
    });
    expect(a.reason).toBe("grant-unconfirmed");
    expect(a.fcFrames).toBe("unconfirmed");
    expect(canPublishFcFrames(a)).toBe(true);
  });

  it("warns before a failed-renewal grant lapses, while control still works", () => {
    const a = resolveMqttControlAuthority({
      lane: "cloud-relay",
      deviceId: DEVICE,
      grant: grant({
        renewalFailed: true,
        expiresAt: NOW + EXPIRY_WARNING_MS - 1,
      }),
      now: NOW,
    });
    expect(a.reason).toBe("grant-expiring");
    // The point of the warning: still commandable, and the operator is told.
    expect(canPublishFcFrames(a)).toBe(true);
    expect(needsOperatorAttention(a)).toBe(true);
  });

  it("does not warn on a healthy grant that simply has not been renewed yet", () => {
    const a = resolveMqttControlAuthority({
      lane: "cloud-relay",
      deviceId: DEVICE,
      grant: grant({ expiresAt: NOW + EXPIRY_WARNING_MS - 1 }),
      now: NOW,
    });
    expect(a.reason).toBe("grant-active");
    expect(needsOperatorAttention(a)).toBe(false);
  });

  it("never reports ready while a grant is being obtained", () => {
    const a = resolveMqttControlAuthority({
      lane: "cloud-relay",
      deviceId: DEVICE,
      grant: null,
      minting: true,
      now: NOW,
    });
    expect(a.reason).toBe("provisioning");
    expect(a.fcFrames).toBe("provisioning");
    // Provisioning is not readiness. This assertion stops a spinner from being
    // mistaken for authority.
    expect(canPublishFcFrames(a)).toBe(false);
  });

  it("re-mints over an expired grant rather than reporting it usable", () => {
    const a = resolveMqttControlAuthority({
      lane: "cloud-relay",
      deviceId: DEVICE,
      grant: grant({ expiresAt: NOW - 1 }),
      minting: true,
      now: NOW,
    });
    expect(a.reason).toBe("provisioning");
    expect(canPublishFcFrames(a)).toBe(false);
  });

  it("keeps video signaling in lockstep with FC frames", () => {
    // Both ride the same credential, so they can never legitimately disagree.
    // A surface showing video as startable while FC frames are refused would be
    // reporting an authority split that does not exist.
    for (const g of [
      null,
      grant(),
      grant({ writeConfirmed: false }),
      grant({ expiresAt: NOW - 1 }),
    ]) {
      const a = resolveMqttControlAuthority({
        lane: "cloud-relay",
        deviceId: DEVICE,
        grant: g,
        now: NOW,
      });
      expect(a.videoSignaling).toBe(a.fcFrames);
    }
  });
});
