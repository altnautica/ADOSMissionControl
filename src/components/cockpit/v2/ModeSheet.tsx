"use client";

/**
 * The Mode sheet, opened from the flight-state chip (shared spec
 * `flight-state.json` › `mode_sheet`): profile, control mode, avoidance,
 * hand to FC, VTOL transition and the advanced FC modes. Every change goes to
 * the drone's pilot as a `pilot.v1` action; an FC mode goes through the
 * set-mode built-in so its confirm tier applies.
 *
 * @module cockpit/v2/ModeSheet
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { X } from "lucide-react";

import flightStateSpec from "@/lib/cockpit-spec/flight-state.json";
import type { PilotState } from "@/lib/hud/cockpit-frames";
import { requestPilotAction, type PilotActionName } from "@/lib/input/pilot-stream";
import { activate, buildSkillContext, stopMotionSkills } from "@/lib/skills";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { HoldButton } from "./HoldButton";

const SHEET = flightStateSpec.mode_sheet;

interface ModeSheetProps {
  droneId: string;
  pilot: PilotState | null;
  /** The drone is reached through a ground station (ELRS is offered only then). */
  groundStationLink: boolean;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{title}</h3>
      {children}
    </section>
  );
}

const pill = (active: boolean) =>
  cn(
    "min-h-12 flex-1 rounded-md border px-3 text-sm font-medium",
    active
      ? "border-accent-primary bg-accent-primary/20 text-text-primary"
      : "border-border-default text-text-secondary hover:text-text-primary",
  );

export function ModeSheet({ droneId, pilot, groundStationLink, onClose }: ModeSheetProps) {
  const { toast } = useToast();
  const act = (name: PilotActionName, args?: Record<string, unknown>) => {
    // A control-mode change or a hand-over to the FC ends any motion skill.
    if (name.startsWith("control_mode:") || name === "hand_to_fc") {
      void stopMotionSkills(buildSkillContext(droneId));
    }
    void requestPilotAction(name, args).then((r) => {
      if (!r.ok) toast(`${name}: ${r.err ?? "refused"}`, "error");
    });
  };

  const controlModes = SHEET.control_mode.values.filter(
    (v) => v !== "elrs" || groundStationLink || pilot?.controlMode === "elrs",
  );
  const handValues =
    pilot?.vehicleClass === "fixedwing" ? SHEET.hand_to_fc.plane_values : SHEET.hand_to_fc.values;
  const fcModes = useMemo(() => buildSkillContext(droneId).availableModes, [droneId]);

  return (
    <div
      role="dialog"
      aria-label="Mode"
      data-testid="mode-sheet"
      className="glass-panel absolute right-3 top-14 z-50 flex max-h-[80%] w-[360px] max-w-[92%] flex-col gap-4 overflow-y-auto p-4"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">Mode</h2>
        <button type="button" aria-label="Close" onClick={onClose} className="p-2">
          <X size={16} />
        </button>
      </header>

      <Section title="Profile">
        <div className="flex gap-2">
          {SHEET.profile.values.map((v, i) => (
            <button
              key={v}
              type="button"
              className={pill(pilot?.profile === v)}
              onClick={() => act(`profile:${v as "cine" | "normal" | "sport"}`)}
            >
              {SHEET.profile.labels[i]}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Control">
        <div className="flex gap-2">
          {controlModes.map((v) => {
            const i = SHEET.control_mode.values.indexOf(v);
            return (
              <HoldButton
                key={v}
                holdMs={pilot?.controlMode === v ? 0 : SHEET.control_mode.confirm.ms}
                className={pill(pilot?.controlMode === v)}
                onFire={() => act(`control_mode:${v as "ados" | "fc_manual" | "elrs"}`)}
                title={SHEET.control_mode.labels[i]}
              >
                {SHEET.control_mode.labels[i]}
              </HoldButton>
            );
          })}
        </div>
        {pilot?.controlMode && (
          <p className="text-[11px] leading-snug text-text-secondary">
            {(SHEET.control_mode.explain as Record<string, string>)[pilot.controlMode]}
          </p>
        )}
      </Section>

      {pilot?.vehicleClass !== "fixedwing" && (
        <Section title="Avoidance">
          <div className="flex gap-2">
            {SHEET.avoidance.values.map((v, i) => (
              <HoldButton
                key={v}
                holdMs={v === "off" && pilot?.avoid !== "off" ? SHEET.avoidance.confirm_off.ms : 0}
                className={pill(pilot?.avoid === v)}
                onFire={() => act(`avoid:${v as "brake" | "bypass" | "off"}`)}
                title={SHEET.avoidance.labels[i]}
              >
                {SHEET.avoidance.labels[i]}
              </HoldButton>
            ))}
          </div>
        </Section>
      )}

      <Section title="Hand to FC">
        <div className="flex gap-2">
          {handValues.map((v) => {
            const i = SHEET.hand_to_fc.values.indexOf(v);
            return (
              <HoldButton
                key={v}
                holdMs={1500}
                className={pill(false)}
                onFire={() => act("hand_to_fc", { mode: v })}
                title={SHEET.hand_to_fc.labels[i]}
              >
                {SHEET.hand_to_fc.labels[i]}
              </HoldButton>
            );
          })}
          <button type="button" className={pill(false)} onClick={() => act("take_control")}>
            Take control
          </button>
        </div>
      </Section>

      {pilot?.vehicleClass === "vtol" && (
        <Section title="VTOL">
          <div className="flex gap-2">
            <HoldButton holdMs={1500} className={pill(false)} onFire={() => act("vtol:fw")}>
              To forward flight
            </HoldButton>
            <HoldButton holdMs={1500} className={pill(false)} onFire={() => act("vtol:mc")}>
              To hover
            </HoldButton>
          </div>
        </Section>
      )}

      <Section title="FC modes (advanced)">
        <div className="grid grid-cols-3 gap-1.5">
          {fcModes.map((mode) => (
            <button
              key={mode}
              type="button"
              className={cn(pill(pilot?.fcModeName?.toUpperCase() === mode), "min-h-10 text-xs")}
              onClick={() => void activate("set-mode", buildSkillContext(droneId), { targetMode: mode })}
            >
              {mode}
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}
