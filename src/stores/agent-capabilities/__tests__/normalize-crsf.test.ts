import { describe, it, expect } from "vitest";
import { normalizeCrsf } from "../normalizer";

describe("normalizeCrsf absent / malformed block", () => {
  it("maps an absent block to null (an older agent never emits crsf)", () => {
    expect(normalizeCrsf(undefined)).toBeNull();
    expect(normalizeCrsf(null)).toBeNull();
  });

  it("maps a non-object to null", () => {
    for (const raw of ["", "crsf", 0, 42, true, []]) {
      expect(normalizeCrsf(raw)).toBeNull();
    }
  });

  it("returns a block (not null) for an empty object, with every field null", () => {
    const crsf = normalizeCrsf({});
    expect(crsf).not.toBeNull();
    expect(crsf!.state).toBeNull();
    expect(crsf!.rssiDbm).toBeNull();
    expect(crsf!.lqUplink).toBeNull();
    expect(crsf!.lqDownlink).toBeNull();
    expect(crsf!.snrDb).toBeNull();
    expect(crsf!.band).toBeNull();
    expect(crsf!.packetRateHz).toBeNull();
    expect(crsf!.txPowerMw).toBeNull();
    expect(crsf!.txFramesPerS).toBeNull();
    expect(crsf!.rxFramesPerS).toBeNull();
    expect(crsf!.rfUnverified).toBeNull();
    expect(crsf!.flyable).toBeNull();
    expect(crsf!.mode).toBeNull();
    expect(crsf!.fcCommandDownGated).toBeNull();
    expect(crsf!.channelSource).toBeNull();
    expect(crsf!.pic).toBeNull();
    expect(crsf!.relayRole).toBeNull();
  });
});

describe("normalizeCrsf coarse state", () => {
  it("preserves each known lane state", () => {
    for (const state of [
      "unconfigured",
      "ready",
      "link_ok",
      "degraded",
      "rf_unverified",
      "disabled",
    ] as const) {
      expect(normalizeCrsf({ state })!.state).toBe(state);
    }
  });

  it("preserves the rf_unverified state as itself, not connected or down", () => {
    // A transmitting lane with unconfirmed reception must read as itself.
    expect(normalizeCrsf({ state: "rf_unverified" })!.state).toBe("rf_unverified");
  });

  it("maps an unknown or null state to null (never fabricated)", () => {
    expect(normalizeCrsf({ state: "warp" })!.state).toBeNull();
    expect(normalizeCrsf({ state: null })!.state).toBeNull();
    expect(normalizeCrsf({ state: 3 })!.state).toBeNull();
    expect(normalizeCrsf({})!.state).toBeNull();
  });
});

describe("normalizeCrsf numeric link stats", () => {
  it("parses the camelCase heartbeat casing", () => {
    const crsf = normalizeCrsf({
      state: "link_ok",
      rssiDbm: -72,
      lqUplink: 98,
      lqDownlink: 95,
      snrDb: 9,
      packetRateHz: 150,
      txFramesPerS: 150,
      rxFramesPerS: 50,
    })!;
    expect(crsf.rssiDbm).toBe(-72);
    expect(crsf.lqUplink).toBe(98);
    expect(crsf.lqDownlink).toBe(95);
    expect(crsf.snrDb).toBe(9);
    expect(crsf.packetRateHz).toBe(150);
    expect(crsf.txFramesPerS).toBe(150);
    expect(crsf.rxFramesPerS).toBe(50);
  });

  it("parses the snake_case LAN-sidecar casing", () => {
    const crsf = normalizeCrsf({
      state: "link_ok",
      rssi_dbm: -72,
      lq_uplink: 98,
      lq_downlink: 95,
      snr_db: 9,
      packet_rate_hz: 150,
      tx_frames_per_s: 150,
      rx_frames_per_s: 50,
    })!;
    expect(crsf.rssiDbm).toBe(-72);
    expect(crsf.lqUplink).toBe(98);
    expect(crsf.lqDownlink).toBe(95);
    expect(crsf.snrDb).toBe(9);
    expect(crsf.packetRateHz).toBe(150);
    expect(crsf.txFramesPerS).toBe(150);
    expect(crsf.rxFramesPerS).toBe(50);
  });

  it("maps absent numeric fields to null, never a fabricated 0", () => {
    const crsf = normalizeCrsf({ state: "ready" })!;
    expect(crsf.rssiDbm).toBeNull();
    expect(crsf.lqUplink).toBeNull();
    expect(crsf.snrDb).toBeNull();
    expect(crsf.packetRateHz).toBeNull();
  });

  it("coerces non-finite numbers to null", () => {
    const crsf = normalizeCrsf({
      rssiDbm: "nope",
      snrDb: Infinity,
      packetRateHz: NaN,
    })!;
    expect(crsf.rssiDbm).toBeNull();
    expect(crsf.snrDb).toBeNull();
    expect(crsf.packetRateHz).toBeNull();
  });

  it("keeps a real zero rate as zero, not null", () => {
    const crsf = normalizeCrsf({ rxFramesPerS: 0, packetRateHz: 0 })!;
    expect(crsf.rxFramesPerS).toBe(0);
    expect(crsf.packetRateHz).toBe(0);
  });
});

describe("normalizeCrsf transmit power (mW, both reach paths)", () => {
  it("reads tx_power_mw from the snake_case LAN sidecar", () => {
    expect(normalizeCrsf({ tx_power_mw: 100 })!.txPowerMw).toBe(100);
  });

  it("reads txPowerMw from the camelCase cloud heartbeat", () => {
    // The heartbeat now carries the real TX power: the block was renamed from
    // the old always-null txPowerDbm projection to tx_power_mw, so a
    // cloud-reached node surfaces it — never derived from a phantom key.
    const crsf = normalizeCrsf({ state: "link_ok", txPowerMw: 250 })!;
    expect(crsf.txPowerMw).toBe(250);
  });

  it("maps an absent or non-finite TX power to null, never a fabricated 0", () => {
    expect(normalizeCrsf({ state: "ready" })!.txPowerMw).toBeNull();
    expect(normalizeCrsf({ tx_power_mw: null })!.txPowerMw).toBeNull();
    expect(normalizeCrsf({ txPowerMw: NaN })!.txPowerMw).toBeNull();
  });

  it("keeps a real zero mW as zero, not null", () => {
    expect(normalizeCrsf({ tx_power_mw: 0 })!.txPowerMw).toBe(0);
  });
});

describe("normalizeCrsf transmit-proof verdict (tri-state)", () => {
  it("preserves an explicit true", () => {
    expect(normalizeCrsf({ rfUnverified: true })!.rfUnverified).toBe(true);
    expect(normalizeCrsf({ rf_unverified: true })!.rfUnverified).toBe(true);
  });

  it("keeps an explicit proven-false distinct from absent", () => {
    expect(normalizeCrsf({ rfUnverified: false })!.rfUnverified).toBe(false);
    expect(normalizeCrsf({ rf_unverified: false })!.rfUnverified).toBe(false);
  });

  it("reads an absent verdict as null, never a fabricated proven-false", () => {
    expect(normalizeCrsf({ state: "ready" })!.rfUnverified).toBeNull();
  });

  it("reads an explicit null verdict as null", () => {
    expect(normalizeCrsf({ rfUnverified: null })!.rfUnverified).toBeNull();
    expect(normalizeCrsf({ rf_unverified: null })!.rfUnverified).toBeNull();
  });

  it("maps a non-boolean verdict to null", () => {
    for (const raw of ["true", 1, 0, {}, []]) {
      expect(normalizeCrsf({ rfUnverified: raw })!.rfUnverified).toBeNull();
    }
  });
});

describe("normalizeCrsf flyable + pic (LAN-sidecar only)", () => {
  it("parses the flyable arm-safety flag from the LAN sidecar", () => {
    expect(normalizeCrsf({ flyable: true })!.flyable).toBe(true);
    expect(normalizeCrsf({ flyable: false })!.flyable).toBe(false);
  });

  it("reads flyable + pic as null over the heartbeat (the projection drops them)", () => {
    const crsf = normalizeCrsf({ state: "link_ok", rssiDbm: -60 })!;
    expect(crsf.flyable).toBeNull();
    expect(crsf.pic).toBeNull();
  });

  it("maps a non-boolean flyable to null", () => {
    expect(normalizeCrsf({ flyable: "yes" })!.flyable).toBeNull();
  });

  it("parses the pic arbiter string", () => {
    expect(normalizeCrsf({ pic: "ground" })!.pic).toBe("ground");
    expect(normalizeCrsf({ pic: "" })!.pic).toBeNull();
  });
});

describe("normalizeCrsf command-down gate (tri-state, both casings)", () => {
  it("preserves an explicit gated verdict from either casing", () => {
    expect(normalizeCrsf({ fcCommandDownGated: true })!.fcCommandDownGated).toBe(
      true,
    );
    expect(
      normalizeCrsf({ fc_command_down_gated: true })!.fcCommandDownGated,
    ).toBe(true);
  });

  it("keeps an explicit open (not-gated) verdict distinct from absent", () => {
    expect(
      normalizeCrsf({ fcCommandDownGated: false })!.fcCommandDownGated,
    ).toBe(false);
    expect(
      normalizeCrsf({ fc_command_down_gated: false })!.fcCommandDownGated,
    ).toBe(false);
  });

  it("reads an absent or explicit-null gate as null, never a fabricated open", () => {
    expect(normalizeCrsf({ state: "ready" })!.fcCommandDownGated).toBeNull();
    expect(
      normalizeCrsf({ fcCommandDownGated: null })!.fcCommandDownGated,
    ).toBeNull();
  });

  it("maps a non-boolean gate to null", () => {
    for (const raw of ["true", 1, 0, {}, []]) {
      expect(
        normalizeCrsf({ fcCommandDownGated: raw })!.fcCommandDownGated,
      ).toBeNull();
    }
  });
});

describe("normalizeCrsf string fields", () => {
  it("parses band / mode / channelSource / relayRole (either casing)", () => {
    const camel = normalizeCrsf({
      band: "2.4",
      mode: "mavlink_elrs",
      channelSource: "api",
      relayRole: "origin",
    })!;
    expect(camel.band).toBe("2.4");
    expect(camel.mode).toBe("mavlink_elrs");
    expect(camel.channelSource).toBe("api");
    expect(camel.relayRole).toBe("origin");

    const snake = normalizeCrsf({
      band: "900",
      mode: "crsf_rc",
      channel_source: "joystick",
      relay_role: "relay",
    })!;
    expect(snake.channelSource).toBe("joystick");
    expect(snake.relayRole).toBe("relay");
  });

  it("maps an empty or absent string to null", () => {
    const crsf = normalizeCrsf({ band: "", mode: null })!;
    expect(crsf.band).toBeNull();
    expect(crsf.mode).toBeNull();
    expect(crsf.channelSource).toBeNull();
    expect(crsf.relayRole).toBeNull();
  });
});

describe("normalizeCrsf full-block fidelity across both casings", () => {
  it("folds the raw snake_case LAN sidecar onto the CrsfState shape", () => {
    const crsf = normalizeCrsf({
      v: 1,
      state: "link_ok",
      rssi_dbm: -72,
      lq_uplink: 98,
      lq_downlink: 95,
      snr_db: 9,
      band: "2.4",
      packet_rate_hz: 150,
      tx_power_mw: 100,
      tx_frames_per_s: 150,
      rx_frames_per_s: 50,
      rf_unverified: false,
      flyable: true,
      mode: "crsf_rc",
      channel_source: "joystick",
      pic: "ground",
      relay_role: "origin",
    })!;
    expect(crsf).toEqual({
      state: "link_ok",
      rssiDbm: -72,
      lqUplink: 98,
      lqDownlink: 95,
      snrDb: 9,
      band: "2.4",
      packetRateHz: 150,
      txPowerMw: 100,
      txFramesPerS: 150,
      rxFramesPerS: 50,
      rfUnverified: false,
      flyable: true,
      mode: "crsf_rc",
      // A CRSF RC-channel lane has no MAVLink command-down concept, so the
      // sidecar omits the gate and it folds to null (no verdict).
      fcCommandDownGated: null,
      channelSource: "joystick",
      pic: "ground",
      relayRole: "origin",
    });
  });

  it("folds the camelCase heartbeat projection (carries TX power + gate, drops flyable+pic)", () => {
    const crsf = normalizeCrsf({
      v: 1,
      state: "rf_unverified",
      rssiDbm: -80,
      lqUplink: 70,
      lqDownlink: null,
      snrDb: null,
      band: "900",
      packetRateHz: 50,
      txPowerMw: 100,
      txFramesPerS: 50,
      rxFramesPerS: 0,
      rfUnverified: true,
      mode: "mavlink_elrs",
      // The command-down gate rides the heartbeat too (a safety verdict must be
      // visible over the cloud path), so a MAVLink-over-ELRS lane carries it.
      fcCommandDownGated: true,
      channelSource: "api",
      relayRole: null,
    })!;
    expect(crsf).toEqual({
      state: "rf_unverified",
      rssiDbm: -80,
      lqUplink: 70,
      lqDownlink: null,
      snrDb: null,
      band: "900",
      packetRateHz: 50,
      txPowerMw: 100, // the heartbeat carries the real TX power in mW
      txFramesPerS: 50,
      rxFramesPerS: 0,
      rfUnverified: true,
      flyable: null, // dropped by the projection → no verdict over the cloud
      mode: "mavlink_elrs",
      fcCommandDownGated: true, // safety gate is kept over the heartbeat
      channelSource: "api",
      pic: null, // dropped by the projection
      relayRole: null,
    });
  });
});
