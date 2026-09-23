/**
 * Sensor calibration quick-launch row inside the System tab Hardware
 * section. Each tile switches this node's detail view to the Configure tab
 * with the Calibration panel open, in place: the live MAVLink and agent
 * sessions stay up, which a full page navigation would tear down.
 *
 * @license GPL-3.0-only
 */

"use client";

import { Activity, Compass, RotateCw, Radio, ArrowRight } from "lucide-react";

import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";

/** The node-detail tab that hosts the FC panels, and the panel id
 * `FcPanelRouter` renders the calibration wizards for. */
const CONFIGURE_TAB = "configure";
const CALIBRATE_PANEL = "calibrate";

const CALIBRATION_TILES: { label: string; icon: typeof Activity }[] = [
  { label: "Accelerometer", icon: Activity },
  { label: "Compass", icon: Compass },
  { label: "Gyroscope", icon: RotateCw },
  { label: "Level Horizon", icon: Activity },
  { label: "RC Input", icon: Radio },
];

export function CalibrationLauncher() {
  const setLastActivePanel = useSettingsStore((s) => s.setLastActivePanel);
  const setPendingDetailTab = useUiStore((s) => s.setPendingDetailTab);

  const openCalibration = () => {
    // The Configure tab opens on the last active FC panel, so the panel is
    // chosen before the tab switch mounts it.
    setLastActivePanel(CALIBRATE_PANEL);
    setPendingDetailTab(CONFIGURE_TAB);
  };

  return (
    <div className="border border-border-default rounded-lg p-4 bg-bg-secondary">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3">
        Sensor Calibration
      </h4>
      <div className="flex flex-wrap gap-2">
        {CALIBRATION_TILES.map(({ label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onClick={openCalibration}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border-default rounded-lg hover:border-accent-primary hover:text-accent-primary text-text-secondary transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          >
            <Icon size={12} />
            {label}
            <ArrowRight size={10} className="text-text-tertiary" />
          </button>
        ))}
      </div>
      <p className="text-[10px] text-text-tertiary mt-2">
        Opens the calibration wizards in the Configure tab
      </p>
    </div>
  );
}
