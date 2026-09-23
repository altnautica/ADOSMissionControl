/**
 * Pending flash writes and the flight-safety rule the write dialog, the
 * disconnect guard and the flash banner share.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useParamSafetyStore } from "@/stores/param-safety-store";
import { isCriticalParam } from "@/lib/protocol/critical-params";

beforeEach(() => useParamSafetyStore.getState().clear());

describe("commitFlash", () => {
  it("hands subscribers a new, empty pending set", () => {
    const store = useParamSafetyStore.getState();
    store.trackWrite("SR0_EXTRA1", 2, 4, "streams");
    const before = useParamSafetyStore.getState().pendingWrites;
    let seen: Map<string, unknown> | null = null;
    const unsub = useParamSafetyStore.subscribe((s) => { seen = s.pendingWrites; });
    store.commitFlash();
    unsub();
    expect(seen).not.toBe(before);
    expect(useParamSafetyStore.getState().pendingWrites.size).toBe(0);
    expect(before.size).toBe(1);
  });
});

describe("isCriticalParam", () => {
  it.each([
    "FS_THR_ENABLE", "BATT_FS_LOW_ACT", "BATT_CAPACITY", "ATC_RAT_RLL_P", "BRD_SAFETY_DEFLT",
    "RC7_OPTION", "THR_FAILSAFE", "COM_RC_LOSS_T", "GF_ACTION", "NAV_RCL_ACT",
  ])("flags %s", (name) => {
    expect(isCriticalParam(name)).toBe(true);
  });

  it.each(["RC7_MIN", "SR0_EXTRA1", "NTF_LED_BRIGHT"])("does not flag %s", (name) => {
    expect(isCriticalParam(name)).toBe(false);
  });

  it("drives the pending-critical check", () => {
    useParamSafetyStore.getState().trackWrite("RC8_OPTION", 0, 31, "rc");
    expect(useParamSafetyStore.getState().hasCriticalPending()).toBe(true);
  });
});
