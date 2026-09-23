/**
 * @module fc/parameters/param-compare-apply.test
 * @description Applying a .param file is a batch of parameter writes and owes
 * the operator the same contract as the grid's Save: an armed vehicle gets one
 * confirmation before anything is sent, every landed write is recorded as
 * pending, the flash commit's real outcome is reported, and a partial batch
 * still refreshes the grid for the writes that landed.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { CommandResult } from "@/lib/protocol/types";
import type { ParamMetadata } from "@/lib/protocol/param-metadata";
import { useDroneStore } from "@/stores/drone-store";
import { useArmedConfirmStore } from "@/stores/armed-confirm-store";
import { useParamSafetyStore } from "@/stores/param-safety-store";

const toast = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));

let refuse = new Set<string>();
let flashResult: CommandResult | null = null;
const written: Array<[string, number]> = [];

const protocol = {
  setParameter: async (name: string, value: number): Promise<CommandResult> => {
    if (refuse.has(name)) return { success: false, resultCode: 4, message: "timeout" };
    written.push([name, value]);
    return { success: true, resultCode: 0, message: "ok" };
  },
  commitParamsToFlash: async (): Promise<CommandResult> => {
    if (!flashResult) throw new Error("no flash");
    return flashResult;
  },
};

const droneState = { getSelectedProtocol: () => protocol };
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: Object.assign(
    (selector?: (s: unknown) => unknown) => (selector ? selector(droneState) : droneState),
    { getState: () => droneState },
  ),
}));

import { ParamCompare } from "../ParamCompare";

const FC = new Map<string, number>([
  ["ATC_RAT_PIT_P", 1],
  ["WPNAV_SPEED", 500],
]);
const META = new Map<string, ParamMetadata>([
  ["WPNAV_SPEED", { rebootRequired: true } as ParamMetadata],
]);

async function loadFileAndApply(onApplied = vi.fn()) {
  const { container } = render(
    <ParamCompare fcParams={FC} metadata={META} onApplied={onApplied} />,
  );
  const input = container.querySelector("input[type=file]") as HTMLInputElement;
  const file = new File(["ATC_RAT_PIT_P,11\nWPNAV_SPEED,510\n"], "other.param");
  fireEvent.change(input, { target: { files: [file] } });
  const apply = await screen.findByRole("button", { name: /Apply 2 Parameters/ });
  fireEvent.click(apply);
  return onApplied;
}

beforeEach(() => {
  useDroneStore.setState({ armState: "disarmed", connectionState: "connected" });
  useArmedConfirmStore.setState({ open: false, context: null, _resolve: null });
  useParamSafetyStore.getState().clear();
  toast.mockClear();
  written.length = 0;
  refuse = new Set();
  flashResult = { success: true, resultCode: 0, acknowledged: true, message: "ok" };
});

describe("ParamCompare apply", () => {
  it("asks for one armed confirmation before writing, and a cancel writes nothing", async () => {
    useDroneStore.setState({ armState: "armed", connectionState: "armed" });
    const onApplied = await loadFileAndApply();

    await waitFor(() => expect(useArmedConfirmStore.getState().open).toBe(true));
    expect(useArmedConfirmStore.getState().context).toEqual({
      panelId: "parameters",
      paramNames: ["ATC_RAT_PIT_P", "WPNAV_SPEED"],
    });
    expect(written).toEqual([]);

    useArmedConfirmStore.getState().cancel();
    await waitFor(() => expect(useArmedConfirmStore.getState().open).toBe(false));
    expect(written).toEqual([]);
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("writes after an armed confirmation and records each write as pending", async () => {
    useDroneStore.setState({ armState: "armed", connectionState: "armed" });
    flashResult = { success: false, resultCode: -1, message: "Not connected" };
    await loadFileAndApply();
    await waitFor(() => expect(useArmedConfirmStore.getState().open).toBe(true));
    useArmedConfirmStore.getState().confirm();

    await waitFor(() => expect(written).toHaveLength(2));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "Wrote 2/2 parameter(s) to FC — flash commit FAILED, changes are RAM-only",
        "error",
      ),
    );
    // A failed commit leaves both writes pending: they are RAM-only.
    expect([...useParamSafetyStore.getState().pendingWrites.keys()].sort()).toEqual([
      "ATC_RAT_PIT_P",
      "WPNAV_SPEED",
    ]);
  });

  it("refreshes the grid on a partial batch and reports the reboot need of what landed", async () => {
    refuse = new Set(["ATC_RAT_PIT_P"]);
    const onApplied = await loadFileAndApply();

    await waitFor(() =>
      expect(onApplied).toHaveBeenCalledWith({ allLanded: false, rebootRequired: true }),
    );
    expect(written).toEqual([["WPNAV_SPEED", 510]]);
    expect(toast).toHaveBeenCalledWith(
      "Wrote 1/2 parameter(s) to FC and saved to flash. Failed: ATC_RAT_PIT_P: timeout",
      "info",
    );
    // The failure stays selected for a retry; the landed one is no longer offered.
    expect(await screen.findByRole("button", { name: /Apply 1 Parameter$/ })).toBeTruthy();
  });
});
