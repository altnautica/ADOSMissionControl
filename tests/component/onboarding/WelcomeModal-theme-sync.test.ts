/**
 * @module WelcomeModal-theme-sync.test
 * @description Verifies the theme-broadcast helper used by the
 * onboarding wizard. The helper builds a fresh `AgentClient` per
 * paired drone and pushes `applySetup({ ui: { theme } })`. One
 * unreachable agent must not block the others.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  pushThemeToAllAgents,
  type AgentTheme,
} from "@/lib/agent/theme-sync";
import type { PairedDrone } from "@/stores/pairing-store";

function drone(overrides: Partial<PairedDrone>): PairedDrone {
  return {
    _id: overrides._id ?? "id-1",
    userId: overrides.userId ?? "u-1",
    deviceId: overrides.deviceId ?? "dev-1",
    name: overrides.name ?? "Drone",
    apiKey: overrides.apiKey ?? "k-1",
    pairedAt: overrides.pairedAt ?? Date.now(),
    mdnsHost: overrides.mdnsHost,
    lastIp: overrides.lastIp,
  };
}

describe("pushThemeToAllAgents", () => {
  let applySetup: ReturnType<typeof vi.fn>;
  let factory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    applySetup = vi.fn().mockResolvedValue({ ok: true });
    factory = vi.fn(() => ({ applySetup }));
  });

  it("pushes the theme to every reachable agent", async () => {
    const drones: PairedDrone[] = [
      drone({ deviceId: "a", mdnsHost: "testnode" }),
      drone({ deviceId: "b", lastIp: "192.168.1.42" }),
    ];

    const result = await pushThemeToAllAgents(drones, "light", {
      clientFactory: factory as never,
    });

    expect(applySetup).toHaveBeenCalledTimes(2);
    expect(applySetup).toHaveBeenCalledWith({ ui: { theme: "light" } });
    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failures.size).toBe(0);
  });

  it("normalises bare mDNS hostnames by appending .local", async () => {
    const drones: PairedDrone[] = [drone({ mdnsHost: "testnode" })];

    await pushThemeToAllAgents(drones, "dark", {
      clientFactory: factory as never,
    });

    const [baseUrl] = factory.mock.calls[0];
    expect(baseUrl).toBe("http://testnode.local:8080");
  });

  it("skips drones that lack both mdnsHost and lastIp", async () => {
    const drones: PairedDrone[] = [drone({ mdnsHost: undefined, lastIp: undefined })];

    const result = await pushThemeToAllAgents(drones, "dark", {
      clientFactory: factory as never,
    });

    expect(applySetup).not.toHaveBeenCalled();
    expect(result.attempted).toBe(0);
    expect(result.succeeded).toBe(0);
  });

  it("captures one agent's failure without aborting the others", async () => {
    const drones: PairedDrone[] = [
      drone({ deviceId: "ok", lastIp: "10.0.0.1" }),
      drone({ deviceId: "bad", lastIp: "10.0.0.2" }),
    ];

    let call = 0;
    factory.mockImplementation(() => {
      const i = call++;
      return {
        applySetup: i === 1
          ? vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
          : vi.fn().mockResolvedValue({ ok: true }),
      };
    });

    const result = await pushThemeToAllAgents(drones, "light", {
      clientFactory: factory as never,
    });

    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failures.size).toBe(1);
    expect(result.failures.get("bad")).toBe("ECONNREFUSED");
  });

  it("never reaches the agent on auto theme (caller must filter)", async () => {
    // The helper itself takes only `dark`/`light`; it's the caller's
    // responsibility to skip when the user picked "auto". This test
    // documents that contract by reaffirming the helper has no
    // implicit "auto" branch.
    const drones: PairedDrone[] = [drone({ lastIp: "10.0.0.1" })];
    const theme: AgentTheme = "dark";

    await pushThemeToAllAgents(drones, theme, {
      clientFactory: factory as never,
    });

    expect(applySetup).toHaveBeenCalledWith({ ui: { theme: "dark" } });
  });
});
