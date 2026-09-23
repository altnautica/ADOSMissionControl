/**
 * @module map/context-menu/actions/utility
 * @description Utility action handlers: copy coordinates, copy distance and
 * bearing from the connected drone. Each reports what happened; where the
 * clipboard is unavailable (a non-secure http:// origin) or refuses the
 * write, the report carries the text so the operator can still read it.
 * @license GPL-3.0-only
 */

import type { MenuPosition, MenuReport } from "../types";

async function copyText(label: string, text: string, report: MenuReport): Promise<void> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard) {
    report(`Clipboard unavailable on this origin. ${label}: ${text}`, "info");
    return;
  }
  try {
    await clipboard.writeText(text);
    report(`Copied ${label}: ${text}`, "success");
  } catch {
    report(`Copy failed. ${label}: ${text}`, "warning");
  }
}

export function handleCopyCoords(menuPos: MenuPosition, report: MenuReport): Promise<void> {
  return copyText("coordinates", `${menuPos.lat.toFixed(7)}, ${menuPos.lon.toFixed(7)}`, report);
}

interface MeasureArgs {
  distLabel: string;
  bearingDeg: number;
  report: MenuReport;
}

export function handleMeasureFromDrone({ distLabel, bearingDeg, report }: MeasureArgs): Promise<void> {
  return copyText("distance from drone", `${distLabel} at ${Math.round(bearingDeg)}°`, report);
}
