/**
 * @module command/system/calibration-launcher.test
 * @description A calibration tile opens this node's Configure tab on the
 * Calibration panel in place. It used to be a plain link to a settings route
 * that has no calibration panel, and the full document load it caused tore
 * down the live MAVLink and agent sessions.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CalibrationLauncher } from "../CalibrationLauncher";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";

afterEach(() => {
  cleanup();
  useUiStore.getState().setPendingDetailTab(null);
  useSettingsStore.getState().setLastActivePanel("outputs");
});

describe("CalibrationLauncher", () => {
  it("opens the Configure tab on the Calibration panel without leaving the page", () => {
    useSettingsStore.getState().setLastActivePanel("outputs");
    render(<CalibrationLauncher />);

    // No tile is a document link.
    expect(document.querySelector("a[href]")).toBeNull();

    fireEvent.click(screen.getByText("Compass"));

    expect(useUiStore.getState().pendingDetailTab).toBe("configure");
    expect(useSettingsStore.getState().lastActivePanel).toBe("calibrate");
  });
});
