import { describe, it, expect } from "vitest";
import { normalizeRadio } from "../normalizer";

describe("normalizeRadio receive-side metrics", () => {
  it("parses the new RX fields from a camelCase block", () => {
    const radio = normalizeRadio({
      state: "connected",
      snrDb: 28,
      noiseDbm: -90,
      lossPercent: 1.5,
      mcsIndex: 2,
      mcsLadderCap: 3,
      rxSilentSeconds: 0.3,
    });
    expect(radio).not.toBeNull();
    expect(radio!.snrDb).toBe(28);
    expect(radio!.noiseDbm).toBe(-90);
    expect(radio!.lossPercent).toBe(1.5);
    expect(radio!.mcsIndex).toBe(2);
    expect(radio!.mcsLadderCap).toBe(3);
    expect(radio!.rxSilentSeconds).toBe(0.3);
  });

  it("defaults the new RX fields to null when absent (older agents)", () => {
    const radio = normalizeRadio({ state: "connected" });
    expect(radio).not.toBeNull();
    expect(radio!.snrDb).toBeNull();
    expect(radio!.noiseDbm).toBeNull();
    expect(radio!.lossPercent).toBeNull();
    expect(radio!.mcsIndex).toBeNull();
    expect(radio!.mcsLadderCap).toBeNull();
    expect(radio!.rxSilentSeconds).toBeNull();
  });

  it("coerces non-finite RX values to null", () => {
    const radio = normalizeRadio({
      state: "connected",
      snrDb: "nope",
      rxSilentSeconds: Infinity,
    });
    expect(radio!.snrDb).toBeNull();
    expect(radio!.rxSilentSeconds).toBeNull();
  });
});

describe("normalizeRadio video-tx liveness", () => {
  it("parses the video-tx stall fields from a camelCase block", () => {
    const radio = normalizeRadio({
      state: "connected",
      txVideoStalled: true,
      txVideoStallKills: 2,
      txVideoRecvqBytes: 4195072,
    });
    expect(radio!.txVideoStalled).toBe(true);
    expect(radio!.txVideoStallKills).toBe(2);
    expect(radio!.txVideoRecvqBytes).toBe(4195072);
  });

  it("defaults the video-tx fields to null when absent (older agents)", () => {
    const radio = normalizeRadio({ state: "connected" });
    expect(radio!.txVideoStalled).toBeNull();
    expect(radio!.txVideoStallKills).toBeNull();
    expect(radio!.txVideoRecvqBytes).toBeNull();
  });

  it("keeps an explicit false stall flag distinct from absent", () => {
    const radio = normalizeRadio({ state: "connected", txVideoStalled: false });
    expect(radio!.txVideoStalled).toBe(false);
  });
});

describe("normalizeRadio channel rendezvous + hop state", () => {
  it("parses the home channel, band, reg domain, and tx/monitor flags", () => {
    const radio = normalizeRadio({
      state: "connected",
      homeChannel: 149,
      channel: 161,
      band: "u-nii-3",
      regDomain: "US",
      monitorActive: true,
      txActive: true,
      peerLink: "linked",
      hopState: "locked",
    });
    expect(radio!.homeChannel).toBe(149);
    expect(radio!.band).toBe("u-nii-3");
    expect(radio!.regDomain).toBe("US");
    expect(radio!.monitorActive).toBe(true);
    expect(radio!.txActive).toBe(true);
    expect(radio!.peerLink).toBe("linked");
    expect(radio!.hopState).toBe("locked");
  });

  it("defaults the rendezvous fields to null when absent (older agents)", () => {
    const radio = normalizeRadio({ state: "connected" });
    expect(radio!.homeChannel).toBeNull();
    expect(radio!.band).toBeNull();
    expect(radio!.regDomain).toBeNull();
    expect(radio!.monitorActive).toBeNull();
    expect(radio!.txActive).toBeNull();
    expect(radio!.peerLink).toBeNull();
    expect(radio!.hopState).toBeNull();
  });

  it("rejects unknown peerLink and hopState values to null", () => {
    const radio = normalizeRadio({
      state: "connected",
      peerLink: "frobnicating",
      hopState: "warp",
    });
    expect(radio!.peerLink).toBeNull();
    expect(radio!.hopState).toBeNull();
  });

  it("keeps an explicit false txActive distinct from absent", () => {
    const radio = normalizeRadio({ state: "connected", txActive: false });
    expect(radio!.txActive).toBe(false);
  });
});

describe("normalizeRadio ground receive acquisition", () => {
  it("parses the acquire-state, channel-lock, and rate fields", () => {
    const radio = normalizeRadio({
      state: "connected",
      acquireState: "locked",
      channelLocked: true,
      reacquireKills: 3,
      rxZombieKills: 1,
      validRxPacketsPerS: 480,
    });
    expect(radio!.acquireState).toBe("locked");
    expect(radio!.channelLocked).toBe(true);
    expect(radio!.reacquireKills).toBe(3);
    expect(radio!.rxZombieKills).toBe(1);
    expect(radio!.validRxPacketsPerS).toBe(480);
  });

  it("defaults the acquisition fields to null when absent (older agents)", () => {
    const radio = normalizeRadio({ state: "connected" });
    expect(radio!.acquireState).toBeNull();
    expect(radio!.channelLocked).toBeNull();
    expect(radio!.reacquireKills).toBeNull();
    expect(radio!.rxZombieKills).toBeNull();
    expect(radio!.validRxPacketsPerS).toBeNull();
  });

  it("accepts the hyphenated no-peer acquire state", () => {
    const radio = normalizeRadio({ state: "connected", acquireState: "no-peer" });
    expect(radio!.acquireState).toBe("no-peer");
  });

  it("rejects an unknown acquire state to null", () => {
    const radio = normalizeRadio({ state: "connected", acquireState: "warp" });
    expect(radio!.acquireState).toBeNull();
  });

  it("keeps an explicit false channelLocked distinct from absent", () => {
    const radio = normalizeRadio({ state: "connected", channelLocked: false });
    expect(radio!.channelLocked).toBe(false);
  });

  it("coerces a zero valid-rx rate to a real zero, not null", () => {
    const radio = normalizeRadio({
      state: "connected",
      validRxPacketsPerS: 0,
    });
    expect(radio!.validRxPacketsPerS).toBe(0);
  });
});

describe("normalizeRadio adapter injection status", () => {
  it("parses the nested adapter chipset and injection flag", () => {
    const radio = normalizeRadio({
      state: "connected",
      adapterChipset: "RTL8812EU",
      adapterInjectionOk: true,
    });
    expect(radio!.adapterChipset).toBe("RTL8812EU");
    expect(radio!.adapterInjectionOk).toBe(true);
  });

  it("keeps an explicit injection-failure false distinct from absent", () => {
    const radio = normalizeRadio({
      state: "connected",
      adapterInjectionOk: false,
    });
    expect(radio!.adapterInjectionOk).toBe(false);
  });

  it("defaults the adapter fields to null when absent (older agents)", () => {
    const radio = normalizeRadio({ state: "connected" });
    expect(radio!.adapterChipset).toBeNull();
    expect(radio!.adapterInjectionOk).toBeNull();
  });

  it("falls back to the top-level wfbAdapter* keys when nested ones are absent", () => {
    const radio = normalizeRadio({
      state: "connected",
      wfbAdapterChipset: "RTL8812EU",
      wfbAdapterInjectionOk: false,
    });
    expect(radio!.adapterChipset).toBe("RTL8812EU");
    expect(radio!.adapterInjectionOk).toBe(false);
  });
});

describe("normalizeRadio link diagnosis", () => {
  it("parses each valid link-diagnosis verdict", () => {
    for (const diag of [
      "deaf",
      "mis_keyed",
      "jammed",
      "healthy",
      "searching",
    ] as const) {
      const radio = normalizeRadio({ state: "connected", linkDiag: diag });
      expect(radio!.linkDiag).toBe(diag);
    }
  });

  it("parses the received-frame counters from a camelCase block", () => {
    const radio = normalizeRadio({
      state: "connected",
      linkDiag: "mis_keyed",
      packetsAll: 1200,
      decryptErrors: 340,
    });
    expect(radio!.linkDiag).toBe("mis_keyed");
    expect(radio!.packetsAll).toBe(1200);
    expect(radio!.decryptErrors).toBe(340);
  });

  it("rejects an unknown link-diagnosis verdict to null", () => {
    const radio = normalizeRadio({ state: "connected", linkDiag: "warp" });
    expect(radio!.linkDiag).toBeNull();
  });

  it("defaults the diagnosis fields to null when absent (older agents)", () => {
    const radio = normalizeRadio({ state: "connected" });
    expect(radio!.linkDiag).toBeNull();
    expect(radio!.packetsAll).toBeNull();
    expect(radio!.decryptErrors).toBeNull();
  });

  it("keeps a zero decrypt-error count as a real zero, not null", () => {
    const radio = normalizeRadio({
      state: "connected",
      packetsAll: 500,
      decryptErrors: 0,
    });
    expect(radio!.packetsAll).toBe(500);
    expect(radio!.decryptErrors).toBe(0);
  });

  it("coerces non-finite counters to null", () => {
    const radio = normalizeRadio({
      state: "connected",
      packetsAll: "nope",
      decryptErrors: Infinity,
    });
    expect(radio!.packetsAll).toBeNull();
    expect(radio!.decryptErrors).toBeNull();
  });
});

describe("normalizeRadio transmit-proof verdict", () => {
  it("parses an explicit unproven transmit path", () => {
    const radio = normalizeRadio({ state: "connected", rfUnverified: true });
    expect(radio!.rfUnverified).toBe(true);
  });

  it("keeps an explicit proven false distinct from absent", () => {
    const radio = normalizeRadio({ state: "connected", rfUnverified: false });
    expect(radio!.rfUnverified).toBe(false);
  });

  it("reads an absent verdict as null, never as a proven false", () => {
    const radio = normalizeRadio({ state: "connected" });
    expect(radio!.rfUnverified).toBeNull();
  });

  it("reads an explicit null verdict as null", () => {
    const radio = normalizeRadio({ state: "connected", rfUnverified: null });
    expect(radio!.rfUnverified).toBeNull();
  });

  it("coerces a non-boolean verdict to null", () => {
    for (const raw of ["true", 1, 0, {}, []]) {
      const radio = normalizeRadio({ state: "connected", rfUnverified: raw });
      expect(radio!.rfUnverified).toBeNull();
    }
  });
});

describe("normalizeRadio PHY-muted flag", () => {
  it("parses an explicit muted PHY", () => {
    const radio = normalizeRadio({ state: "connected", phyMuted: true });
    expect(radio!.phyMuted).toBe(true);
  });

  it("keeps an explicit false distinct from absent", () => {
    const radio = normalizeRadio({ state: "connected", phyMuted: false });
    expect(radio!.phyMuted).toBe(false);
  });

  it("defaults to null when absent (older agents)", () => {
    const radio = normalizeRadio({ state: "connected" });
    expect(radio!.phyMuted).toBeNull();
  });

  it("coerces a non-boolean to null", () => {
    const radio = normalizeRadio({ state: "connected", phyMuted: "yes" });
    expect(radio!.phyMuted).toBeNull();
  });
});
