/**
 * @module fc/parameters/partial-batch-write.test
 * @description A parameter batch over a lossy link lands PARTIALLY. What the
 * grid shows afterwards has to be the vehicle's real state: the writes the FC
 * acknowledged are no longer pending, the ones it refused still are, and the
 * toast says how many of how many landed. The panel used to report the whole
 * batch as failed, leave every row marked modified with its old value, and
 * claim a flash commit nothing had confirmed.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { CommandResult, ParameterValue } from "@/lib/protocol/types";
import { useDroneStore } from "@/stores/drone-store";
import { useArmedConfirmStore } from "@/stores/armed-confirm-store";
import { useParamSafetyStore } from "@/stores/param-safety-store";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const toast = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));

vi.mock("@/lib/protocol/param-metadata", () => ({
  loadParamMetadata: async () => new Map(),
}));

/** The panel's children, reduced to the surface this test drives: the modified
 * map it renders, the Save button, and the confirm dialog's onConfirm. */
vi.mock("../ParameterGrid", () => ({
  ParameterGrid: ({
    parameters,
    modified,
    onModify,
  }: {
    parameters: ParameterValue[];
    modified: Map<string, number>;
    onModify: (name: string, value: number) => void;
  }) => (
    <div>
      <div data-testid="pending">
        {[...modified.entries()].map(([n, v]) => `${n}=${v}`).join(",")}
      </div>
      <div data-testid="values">
        {parameters.map((p) => `${p.name}=${p.value}`).join(",")}
      </div>
      {parameters.map((p) => (
        <button
          key={p.name}
          data-testid={`edit-${p.name}`}
          onClick={() => onModify(p.name, p.value + 10)}
        >
          edit
        </button>
      ))}
    </div>
  ),
}));

vi.mock("../ParameterSearchFilter", () => ({
  ParameterSearchFilter: ({
    onSave,
    onResetDefaults,
    resetBlocked,
  }: {
    onSave: () => void;
    onResetDefaults: () => void;
    resetBlocked?: boolean;
  }) => (
    <div>
      <button data-testid="save" onClick={onSave}>
        save
      </button>
      <button
        data-testid="reset"
        disabled={resetBlocked === true}
        onClick={onResetDefaults}
      >
        reset
      </button>
    </div>
  ),
}));

vi.mock("../../shared/WriteConfirmDialog", () => ({
  WriteConfirmDialog: ({
    open,
    onConfirm,
  }: {
    open: boolean;
    onConfirm: () => void;
  }) =>
    open ? (
      <button data-testid="confirm" onClick={onConfirm}>
        confirm
      </button>
    ) : null,
}));

vi.mock("@/components/ui/modal", () => ({
  Modal: () => null,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: () => null,
}));
vi.mock("../FavoritesQuickAccess", () => ({
  FavoritesQuickAccess: () => null,
}));

const PARAMS: ParameterValue[] = [
  { name: "ATC_RAT_PIT_P", value: 1, type: 9, index: 0, count: 3 },
  { name: "ATC_RAT_RLL_P", value: 2, type: 9, index: 1, count: 3 },
  { name: "WPNAV_SPEED", value: 500, type: 9, index: 2, count: 3 },
];

/** Names the FC refuses on this run. */
let refuse = new Set<string>();
let flashResult: CommandResult | null = null;
const written: Array<[string, number]> = [];

const protocol = {
  isConnected: true,
  onParameter: () => () => {},
  getAllParameters: async () => PARAMS.map((p) => ({ ...p })),
  setParameter: async (name: string, value: number): Promise<CommandResult> => {
    if (refuse.has(name)) {
      return { success: false, resultCode: 4, message: "timeout" };
    }
    written.push([name, value]);
    return { success: true, resultCode: 0, message: "ok" };
  },
  commitParamsToFlash: async (): Promise<CommandResult> => {
    if (!flashResult) throw new Error("no flash");
    return flashResult;
  },
  reboot: async (): Promise<CommandResult> => ({
    success: true,
    resultCode: 0,
    message: "ok",
  }),
};

const droneState = {
  selectedDroneId: "d1",
  drones: new Map([
    [
      String("d1"),
      {
        protocol,
        vehicleInfo: null,
        // The control-authority hook classifies the lane from this.
        transport: { type: "serial", canCommand: true },
      },
    ],
  ]),
  getSelectedProtocol: () => protocol,
  getSelectedDrone: () => ({ protocol, vehicleInfo: null }),
};

vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: Object.assign(
    (selector?: (s: unknown) => unknown) =>
      selector ? selector(droneState) : droneState,
    { getState: () => droneState },
  ),
}));

const settingsState = { paramColumns: {}, favoriteParams: [] as string[] };
vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) =>
    selector(settingsState),
}));

const uiState = { pendingParamSearch: null, setPendingParamSearch: () => {} };
vi.mock("@/stores/ui-store", () => ({
  useUiStore: (selector: (s: unknown) => unknown) => selector(uiState),
}));

import { ParametersPanel, invalidateParamCache } from "../ParametersPanel";

/** Render, wait for the initial download, then stage one edit per parameter
 * through the grid's own onModify — the same path a cell edit takes. */
async function renderWithEdits() {
  render(<ParametersPanel />);
  await waitFor(() =>
    expect(screen.getByTestId("values").textContent).toContain("ATC_RAT_PIT_P"),
  );
  for (const p of PARAMS) fireEvent.click(screen.getByTestId(`edit-${p.name}`));
  expect(screen.getByTestId("pending").textContent).toBe(
    "ATC_RAT_PIT_P=11,ATC_RAT_RLL_P=12,WPNAV_SPEED=510",
  );
}

async function save() {
  fireEvent.click(screen.getByTestId("save"));
  fireEvent.click(await screen.findByTestId("confirm"));
}

beforeEach(() => {
  invalidateParamCache();
  useDroneStore.setState({ armState: "disarmed", connectionState: "connected" });
  useArmedConfirmStore.setState({ open: false, context: null, _resolve: null });
  useParamSafetyStore.getState().clear();
  toast.mockClear();
  written.length = 0;
  refuse = new Set();
  flashResult = {
    success: true,
    resultCode: 0,
    acknowledged: false,
    message: "sent",
  };
});

describe("ParametersPanel batch write outcome", () => {
  it("commits the writes that landed, keeps only the failures pending, and counts both", async () => {
    refuse = new Set(["WPNAV_SPEED"]);
    await renderWithEdits();
    await save();

    await waitFor(() =>
      expect(screen.getByTestId("pending").textContent).toBe(
        "WPNAV_SPEED=510",
      ),
    );
    // The two that landed now read the vehicle's values; the refused one keeps
    // its old value AND stays pending, so the grid stops lying either way.
    expect(screen.getByTestId("values").textContent).toBe(
      "ATC_RAT_PIT_P=11,ATC_RAT_RLL_P=12,WPNAV_SPEED=500",
    );
    expect(written).toEqual([
      ["ATC_RAT_PIT_P", 11],
      ["ATC_RAT_RLL_P", 12],
    ]);
    // The failure is reported by the shared PanelHeader, the same surface every
    // FC panel reports its errors on.
    expect(
      screen.getByTitle("Failed to write 1 of 3 param(s): WPNAV_SPEED: timeout"),
    ).toBeTruthy();
    expect(toast).toHaveBeenCalledWith(
      "Wrote 2/3 parameter(s) to FC; flash commit sent (unacknowledged)",
      "info",
    );
  });

  it("does not claim a flash commit the FC never confirmed", async () => {
    flashResult = { success: false, resultCode: -1, message: "Not connected" };
    await renderWithEdits();
    await save();

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "Wrote 3/3 parameter(s) to FC — flash commit FAILED, changes are RAM-only",
        "error",
      ),
    );
  });

  it("claims flash only on an acknowledged commit", async () => {
    flashResult = {
      success: true,
      resultCode: 0,
      acknowledged: true,
      message: "ok",
    };
    await renderWithEdits();
    await save();

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "Wrote 3/3 parameter(s) to FC and saved to flash",
        "success",
      ),
    );
  });

  it("reports a total failure as a failure and writes nothing to the grid", async () => {
    refuse = new Set(PARAMS.map((p) => p.name));
    await renderWithEdits();
    await save();

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "Failed to write 3 parameter(s)",
        "error",
      ),
    );
    expect(screen.getByTestId("values").textContent).toBe(
      "ATC_RAT_PIT_P=1,ATC_RAT_RLL_P=2,WPNAV_SPEED=500",
    );
    expect(screen.getByTestId("pending").textContent).toBe(
      "ATC_RAT_PIT_P=11,ATC_RAT_RLL_P=12,WPNAV_SPEED=510",
    );
  });
});

describe("ParametersPanel FC panel write conventions", () => {
  it("asks for confirmation before writing to an armed vehicle, and honours a cancel", async () => {
    useDroneStore.setState({ armState: "armed", connectionState: "armed" });
    await renderWithEdits();
    await save();

    // The shared armed-confirm dialog is open and names this panel's batch.
    await waitFor(() =>
      expect(useArmedConfirmStore.getState().open).toBe(true),
    );
    expect(useArmedConfirmStore.getState().context).toEqual({
      panelId: "parameters",
      paramNames: ["ATC_RAT_PIT_P", "ATC_RAT_RLL_P", "WPNAV_SPEED"],
    });
    // Nothing has been written while the operator is being asked.
    expect(written).toEqual([]);

    useArmedConfirmStore.getState().cancel();
    await waitFor(() =>
      expect(useArmedConfirmStore.getState().open).toBe(false),
    );
    expect(written).toEqual([]);
    // The edits survive the cancel: nothing was silently discarded.
    expect(screen.getByTestId("pending").textContent).toBe(
      "ATC_RAT_PIT_P=11,ATC_RAT_RLL_P=12,WPNAV_SPEED=510",
    );
  });

  it("writes after the operator confirms an armed write", async () => {
    useDroneStore.setState({ armState: "armed", connectionState: "armed" });
    await renderWithEdits();
    await save();

    await waitFor(() =>
      expect(useArmedConfirmStore.getState().open).toBe(true),
    );
    useArmedConfirmStore.getState().confirm();

    await waitFor(() => expect(written).toHaveLength(3));
  });

  it("does not interrupt a disarmed write", async () => {
    await renderWithEdits();
    await save();

    await waitFor(() => expect(written).toHaveLength(3));
    expect(useArmedConfirmStore.getState().open).toBe(false);
  });

  it("records each landed write as pending until a flash commit clears it", async () => {
    // The grid's own pending highlight and the reboot banner read this store;
    // this panel used to write nothing to it, so its feedback was the exact
    // opposite of the identical write from a curated FC panel.
    flashResult = { success: false, resultCode: -1, message: "Not connected" };
    await renderWithEdits();
    await save();

    await waitFor(() => expect(written).toHaveLength(3));
    const pending = useParamSafetyStore.getState().pendingWrites;
    expect([...pending.keys()].sort()).toEqual([
      "ATC_RAT_PIT_P",
      "ATC_RAT_RLL_P",
      "WPNAV_SPEED",
    ]);
    expect(pending.get("ATC_RAT_PIT_P")).toMatchObject({
      panel: "parameters",
      oldValue: 1,
      newValue: 11,
    });
  });

  it("blocks a factory reset of every parameter while the vehicle is armed", async () => {
    useDroneStore.setState({ armState: "armed", connectionState: "armed" });
    await renderWithEdits();
    expect(
      (screen.getByTestId("reset") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("guards navigation away from unsaved edits", async () => {
    const added = vi.spyOn(window, "addEventListener");
    await renderWithEdits();
    expect(
      added.mock.calls.some(([type]) => type === "beforeunload"),
    ).toBe(true);
    added.mockRestore();
  });
});
