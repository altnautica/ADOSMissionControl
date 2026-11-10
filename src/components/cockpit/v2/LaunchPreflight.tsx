"use client";

/**
 * @module cockpit/v2/LaunchPreflight
 * @description The Launch sheet's pre-flight section. Launch arms the
 * aircraft, so it sits behind the same first-arm gate as the flight
 * controller's Arm and Take off: the spec pre-flight checklist passed for
 * this drone. Until it is, the sheet shows this section open, naming every
 * item not yet passing, with "Checks done" to pass it once nothing fails
 * ("Fix the failing checks" while something does); the hold stays disabled.
 *
 * @license GPL-3.0-only
 */

import { TriangleAlert } from "lucide-react";

import { firstArmAllowed, type PreflightState } from "@/lib/cockpit/preflight";
import { specString } from "@/lib/cockpit/spec-strings";
import { useChecklistStore } from "@/stores/checklist-store";

const STATE_COLOR: Record<PreflightState, string> = {
  pass: "var(--hud-good)",
  warn: "var(--hud-warn)",
  fail: "var(--hud-crit)",
};

export function LaunchPreflight({ droneId }: { droneId: string }) {
  const items = useChecklistStore((s) => (s.droneId === droneId ? s.preflight : null));
  const passPreflight = useChecklistStore((s) => s.passPreflight);
  const allowed = items !== null && firstArmAllowed(items);
  const open = (items ?? []).filter((i) => i.state !== "pass");

  return (
    <section data-testid="launch-preflight" role="status" className="mb-3 rounded bg-white/5 p-2 text-xs">
      <h3 className="mb-1 font-semibold">{specString("flow.preflight.title")}</h3>
      {!allowed && <p className="mb-1 text-text-secondary">{specString("flow.preflight.blocked")}</p>}
      {open.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1" data-testid="launch-preflight-items">
          {open.map((item) => (
            <li key={item.id} data-state={item.state} className="flex items-center gap-2">
              <TriangleAlert size={13} aria-hidden="true" style={{ color: STATE_COLOR[item.state] }} />
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        data-testid="launch-preflight-done"
        disabled={!allowed}
        onClick={() => passPreflight(droneId)}
        className="min-h-[40px] w-full rounded bg-white/10 px-3 font-semibold disabled:opacity-50"
      >
        {allowed ? specString("flow.preflight.done") : specString("flow.preflight.fix")}
      </button>
    </section>
  );
}
