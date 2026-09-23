/**
 * Every iNav panel backed by named settings loads against the firmware's own
 * setting table.
 *
 * `tests/fixtures/inav-setting-names.json` lists every setting name the iNav
 * settings table (src/main/fc/settings.yaml, master) defines. The stub FC
 * refuses any other name the way MSP2_COMMON_SETTING does, so a panel that
 * asks for a name the firmware lacks fails its Read here exactly as it would
 * on a real flight controller — instead of passing against a stub that
 * answers any name.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { renderWithIntl } from "../helpers/intl-wrapper";
import { NavPidPanel } from "@/components/fc/inav/NavPidPanel";
import { NavConfigPanel } from "@/components/fc/inav/NavConfigPanel";
import { INavFailsafePanel } from "@/components/fc/inav/INavFailsafePanel";
import { RateDynamicsPanel } from "@/components/fc/inav/RateDynamicsPanel";
import { useDroneManager } from "@/stores/drone-manager";
import { SettingsError } from "@/lib/protocol/msp/settings";
import FIRMWARE_SETTING_NAMES from "../fixtures/inav-setting-names.json";

vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => ({ isArmed: false, lockMessage: "" }),
}));

vi.mock("@/hooks/use-unsaved-guard", () => ({
  useUnsavedGuard: () => undefined,
}));

const FIRMWARE = new Set<string>(FIRMWARE_SETTING_NAMES);

/** A settings capability that knows exactly the firmware's names. */
function firmwareProtocol(requested: string[]) {
  const check = (name: string) => {
    requested.push(name);
    if (!FIRMWARE.has(name)) throw new SettingsError(`Failed to read setting "${name}"`, name);
  };
  return {
    settings: {
      getSetting: vi.fn(async (name: string) => {
        check(name);
        return { type: "uint8" as const, value: 1 };
      }),
      setSetting: vi.fn().mockResolvedValue({ success: true, resultCode: 0, message: "OK" }),
      getSettingInfo: vi.fn(async (name: string) => {
        check(name);
        return {
          name, pgId: 0, type: 0, section: 0, mode: 0, min: 0, max: 255,
          index: 0, profileCurrent: 0, profileCount: 1,
        };
      }),
      enumerate: vi.fn().mockResolvedValue([]),
    },
  };
}

const PANELS: [string, ComponentType][] = [
  ["NavPidPanel", NavPidPanel],
  ["NavConfigPanel", NavConfigPanel],
  ["INavFailsafePanel", INavFailsafePanel],
  ["RateDynamicsPanel", RateDynamicsPanel],
];

describe("iNav named-setting panels against the firmware setting table", () => {
  beforeEach(() => {
    useDroneManager.setState({ getSelectedProtocol: () => null } as never);
  });

  it("the fixture is the firmware table, not a hand-picked subset", () => {
    expect(FIRMWARE.size).toBeGreaterThan(500);
    // Names the firmware does not define, which panels once asked for.
    expect(FIRMWARE.has("nav_mc_pos_xy_i")).toBe(false);
    expect(FIRMWARE.has("nav_mc_surface_p")).toBe(false);
  });

  it.each(PANELS)("%s reads only settings the firmware defines", async (_name, Panel) => {
    const requested: string[] = [];
    const protocol = firmwareProtocol(requested);
    useDroneManager.setState({ getSelectedProtocol: () => protocol } as never);

    renderWithIntl(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: /read/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /write to fc/i })).toBeDefined());
    expect(requested.length).toBeGreaterThan(0);
    expect(requested.filter((n) => !FIRMWARE.has(n))).toEqual([]);
  });
});
