/**
 * Radio / network activity wording. Each case mirrors what the agent emits:
 * `radio.bind` opens a session (it is not a pairing outcome), and a reg-gate
 * verdict is `ok` | `blocked` | `failed`.
 */

import { describe, expect, it } from "vitest";

import { summarizeRadioNetworkEvent } from "../radio-network-events";

describe("summarizeRadioNetworkEvent", () => {
  it("formats a reg re-pin with both countries and no leading em dash", () => {
    const { summary, severity } = summarizeRadioNetworkEvent(
      "radio.reg_reasserted",
      { from_country: "BO", to_country: "US", channel_permitted: true },
    );
    expect(summary).toBe("Regulatory domain re-pinned BO to US");
    expect(summary).not.toContain("—");
    expect(severity).toBe("success");
  });

  it("warns when a reg re-pin lands on a non-permitted channel", () => {
    const { severity } = summarizeRadioNetworkEvent("radio.reg_reasserted", {
      from_country: "BO",
      to_country: "US",
      channel_permitted: false,
    });
    expect(severity).toBe("warning");
  });

  it("maps a passing reg-gate verdict to success", () => {
    const { summary, severity } = summarizeRadioNetworkEvent("radio.reg_gate", {
      result: "ok",
    });
    expect(summary).toBe("Reg-gate passed");
    expect(severity).toBe("success");
  });

  it("maps a blocked reg-gate verdict to a warning", () => {
    const { summary, severity } = summarizeRadioNetworkEvent("radio.reg_gate", {
      result: "blocked",
      reason: "channel not permitted",
    });
    expect(summary).toBe("Reg-gate blocked: channel not permitted");
    expect(severity).toBe("warning");
  });

  it("never reports a failed reg-gate verdict as a success", () => {
    const { summary, severity } = summarizeRadioNetworkEvent("radio.reg_gate", {
      result: "failed",
      reason: "eeprom_override",
    });
    expect(summary).toBe("Reg-gate failed, bring-up continued: eeprom_override");
    expect(severity).toBe("warning");
  });

  it("reports a bind session start, not a pairing success", () => {
    const { summary } = summarizeRadioNetworkEvent("radio.bind", {
      role: "gs",
      session_id: "s1",
    });
    expect(summary).toBe("Bind session started");
  });

  it("maps every bind_failed reason enum to a readable error line", () => {
    const cases: Array<[string, string]> = [
      ["no_tx_key", "no transmit key"],
      ["reg_blocked", "regulatory domain blocked"],
      ["no_peer", "peer not found"],
      ["no_peer_proof", "no verified peer (phantom pairing)"],
      ["stale_key", "stale key, none transferred"],
      ["timeout", "bind timeout"],
      ["interrupted", "bind interrupted"],
      ["other", "unknown error"],
    ];
    for (const [reason, text] of cases) {
      const { summary, severity } = summarizeRadioNetworkEvent(
        "radio.bind_failed",
        { reason },
      );
      expect(summary).toBe(`Bind failed: ${text}`);
      expect(severity).toBe("error");
    }
  });

  it("falls back to a generic line for an unknown bind_failed reason", () => {
    const { summary } = summarizeRadioNetworkEvent("radio.bind_failed", {
      reason: "brand_new_token",
    });
    expect(summary).toBe("Bind failed: unknown error");
  });

  it("flags an rf_unverified entry as an error with the USB speed", () => {
    const { summary, severity } = summarizeRadioNetworkEvent(
      "radio.rf_unverified",
      { state: "entry", usb_speed_mbps: 480 },
    );
    expect(summary).toBe("Link unverified: TX active, no reception (USB 480 Mbps)");
    expect(severity).toBe("error");
  });

  it("treats an rf_unverified clear as recovery", () => {
    const { summary, severity } = summarizeRadioNetworkEvent(
      "radio.rf_unverified",
      { state: "clear", episode_s: 42 },
    );
    expect(summary).toBe("Link verified: reception confirmed");
    expect(severity).toBe("success");
  });

  it("summarizes a WiFi self-heal with the failure count", () => {
    const { summary, severity } = summarizeRadioNetworkEvent(
      "network.wifi_reassociated",
      { consecutive_failures: 2 },
    );
    expect(summary).toBe("Onboard WiFi re-associated (gateway unreachable x2)");
    expect(severity).toBe("warning");
  });

  it("falls back to the raw kind for an unknown event", () => {
    const { summary } = summarizeRadioNetworkEvent("radio.future_kind", {});
    expect(summary).toBe("radio.future_kind");
  });
});
