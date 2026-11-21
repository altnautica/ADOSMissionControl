"use client";

/**
 * @module cockpit/flight/SensingChip
 * @description The top bar's sensing chip: what the pilot sees obstacles
 * with and the speed that still stops inside the range it sees clear
 * (`pilot.sensing`, "Sensing: 3D lidar · ≤ 4.2 m/s"). Nothing while the pilot
 * reports no sensing (an older agent).
 * @license GPL-3.0-only
 */

import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { sensingChipText } from "@/lib/hud/sensing";

export function SensingChip({ droneId }: { droneId: string }) {
  const { pilot } = usePilotState(droneId);
  const sensing = pilot?.sensing ?? null;
  const text = sensingChipText(sensing);
  if (!sensing || !text) return null;
  return (
    <div className="stat" data-testid="sensing-chip" data-tier={sensing.tier} title={text}>
      <span className="v">{text}</span>
    </div>
  );
}
