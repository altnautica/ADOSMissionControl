/**
 * @module drone-metadata-defaults.test
 * @description A drone profile carries only what the operator entered: an
 * unentered serial, compute module or weight class stays empty so the info
 * cards show "—", and the per-connect profiles earlier versions persisted for
 * direct-connect sessions are dropped on upgrade.
 * @license GPL-3.0-only
 */

import { beforeEach, describe, expect, it } from "vitest";

import { useDroneMetadataStore } from "@/stores/drone-metadata-store";

beforeEach(() => {
  useDroneMetadataStore.setState({ profiles: {} });
});

describe("drone profile defaults", () => {
  it("leaves unentered identity and vehicle fields empty", () => {
    useDroneMetadataStore.getState().ensureProfile("node:abc123", { displayName: "Survey 1" });
    const p = useDroneMetadataStore.getState().profiles["node:abc123"];
    expect(p.displayName).toBe("Survey 1");
    expect(p.serial).toBe("");
    expect(p.computeModule).toBe("");
    expect(p.weightClass).toBe("");
  });
});

describe("drone profile migration to v4", () => {
  const migrate = useDroneMetadataStore.persist.getOptions().migrate!;

  it("drops direct-connect session profiles and the synthesised serial", async () => {
    const persisted = {
      profiles: {
        "fc:k3j9qz": { droneId: "fc:k3j9qz", serial: "ALT-FC:K3J9QZ", computeModule: "RPi CM4" },
        "node:abc123": { droneId: "node:abc123", serial: "ALT-NODE:ABC123" },
        "node:def456": { droneId: "node:def456", serial: "SN-0042" },
      },
    };
    const state = (await migrate(persisted, 3)) as unknown as {
      profiles: Record<string, { serial: string }>;
    };
    expect(Object.keys(state.profiles).sort()).toEqual(["node:abc123", "node:def456"]);
    expect(state.profiles["node:abc123"].serial).toBe("");
    // An operator-entered serial is kept.
    expect(state.profiles["node:def456"].serial).toBe("SN-0042");
  });
});
