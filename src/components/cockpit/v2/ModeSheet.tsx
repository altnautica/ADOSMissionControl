"use client";

/**
 * The Mode sheet, opened from the flight-state chip (shared spec
 * `flight-state.json` › `mode_sheet`): profile, control mode, avoidance,
 * who flies (hand to FC, take control), VTOL transition and the advanced FC
 * modes. Every change goes to the drone's pilot as a `pilot.v1` action; an FC
 * mode goes through the set-mode built-in so its confirm tier applies.
 *
 * Text comes from the shared spec strings, hold durations from `layout.json`
 * `holds_ms`. A picked segment shows as pending at once, until the pilot
 * answers; a refusal is shown in words.
 *
 * @module cockpit/v2/ModeSheet
 * @license GPL-3.0-only
 */

import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import flightStateSpec from "@/lib/cockpit-spec/flight-state.json";
import type { PilotState } from "@/lib/hud/cockpit-frames";
import { refusalText } from "@/lib/hud/refusal";
import { specString } from "@/lib/cockpit/spec-strings";
import { requestPilotAction, type PilotActionName } from "@/lib/input/pilot-stream";
import { activate, buildSkillContext, SPEC_HOLD_MS, stopMotionSkills } from "@/lib/skills";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { HoldButton } from "./HoldButton";
import { useFlightGrid } from "@/components/cockpit/flight/flight-context";
import { FlightSheetPortal, sheetPlacement, useSheetDismiss } from "@/components/cockpit/flight/flight-sheet";

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

const pill = (active: boolean, pending = false) =>
  cn(
    "min-h-12 flex-1 rounded-md border px-3 text-sm font-medium",
    active
      ? "border-accent-primary bg-accent-primary/20 text-text-primary"
      : pending
        ? "animate-pulse border-dashed border-accent-primary text-text-primary"
        : "border-border-default text-text-secondary hover:text-text-primary",
  );

export function ModeSheet({ droneId, pilot, groundStationLink, onClose }: ModeSheetProps) {
  const { toast } = useToast();
  // The action sent and not yet answered: its segment shows as pending.
  const [pending, setPending] = useState<string | null>(null);
  const act = (name: PilotActionName, label: string, args?: Record<string, unknown>) => {
    // A control-mode change or a hand-over to the FC ends any motion skill.
    if (name.startsWith("control_mode:") || name === "hand_to_fc") {
      void stopMotionSkills(buildSkillContext(droneId));
    }
    const key = args?.mode ? `${name}:${String(args.mode)}` : name;
    setPending(key);
    void requestPilotAction(name, args).then((r) => {
      setPending((p) => (p === key ? null : p));
      if (!r.ok) toast(specString("flow.mode.result.failed", { label, reason: refusalText(r.err) }), "error");
    });
  };

  const controlModes = SHEET.control_mode.values.filter(
    (v) => v !== "elrs" || groundStationLink || pilot?.controlMode === "elrs",
  );
  const handValues =
    pilot?.vehicleClass === "fixedwing" ? SHEET.hand_to_fc.plane_values : SHEET.hand_to_fc.values;
  const fcModes = useMemo(() => buildSkillContext(droneId).availableModes, [droneId]);
  const ref = useRef<HTMLDivElement>(null);
  useSheetDismiss(ref, onClose, "[data-sheet-trigger='mode']");
  const place = sheetPlacement(useFlightGrid(), "left");

  return (
    <FlightSheetPortal>
      <div
        ref={ref}
        role="dialog"
        aria-label={specString("flow.mode.title")}
        data-testid="mode-sheet"
        style={place}
        className="glass-panel absolute z-50 flex max-h-[calc(100%-var(--fs-bar-b)-16px)] w-[360px] max-w-[calc(100%-16px)] flex-col gap-4 overflow-y-auto p-4"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">{specString("flow.mode.title")}</h2>
          <button type="button" aria-label={specString("cockpit.close")} onClick={onClose} className="p-2">
            <X size={16} />
          </button>
        </header>

        {!pilot && (
          <p data-testid="mode-no-pilot" className="text-[11px] leading-snug text-text-secondary">
            {specString("flow.mode.no_pilot")}
          </p>
        )}

        <Section title={specString("flow.mode.section.profile")}>
          <div className="flex gap-2">
            {SHEET.profile.values.map((v, i) => {
              const name = `profile:${v as "cine" | "normal" | "sport"}` as const;
              return (
                <button
                  key={v}
                  type="button"
                  data-pending={pending === name || undefined}
                  className={pill(pilot?.profile === v, pending === name)}
                  onClick={() => act(name, SHEET.profile.labels[i])}
                >
                  {SHEET.profile.labels[i]}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title={specString("flow.mode.section.control_mode")}>
          <div className="flex gap-2">
            {controlModes.map((v) => {
              const i = SHEET.control_mode.values.indexOf(v);
              const name = `control_mode:${v as "ados" | "fc_manual" | "elrs"}` as const;
              return (
                <HoldButton
                  key={v}
                  holdMs={pilot?.controlMode === v ? 0 : SHEET.control_mode.confirm.ms}
                  className={pill(pilot?.controlMode === v, pending === name)}
                  onFire={() => act(name, SHEET.control_mode.labels[i])}
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

        <Section title={specString("flow.mode.section.avoidance")}>
          {pilot?.vehicleClass === "fixedwing" ? (
            <p data-testid="fixedwing-avoid-note" className="text-[11px] leading-snug text-text-secondary">
              {specString("pilot.avoid.fixedwing_note")}
            </p>
          ) : (
            <div className="flex gap-2">
              {SHEET.avoidance.values.map((v, i) => {
                const name = `avoid:${v as "brake" | "bypass" | "off"}` as const;
                return (
                  <HoldButton
                    key={v}
                    holdMs={v === "off" && pilot?.avoid !== "off" ? SHEET.avoidance.confirm_off.ms : 0}
                    className={pill(pilot?.avoid === v, pending === name)}
                    onFire={() => act(name, SHEET.avoidance.labels[i])}
                    title={SHEET.avoidance.labels[i]}
                  >
                    {SHEET.avoidance.labels[i]}
                  </HoldButton>
                );
              })}
            </div>
          )}
        </Section>

        <Section title={specString("flow.mode.section.who_flies")}>
          <div className="flex flex-wrap gap-2">
            {handValues.map((v) => {
              const i = SHEET.hand_to_fc.values.indexOf(v);
              const label = SHEET.hand_to_fc.labels[i];
              return (
                <HoldButton
                  key={v}
                  holdMs={SPEC_HOLD_MS.hand_to_fc}
                  className={pill(false, pending === `hand_to_fc:${v}`)}
                  onFire={() => act("hand_to_fc", label, { mode: v })}
                  title={specString("flow.mode.hand_to_fc_aria", { mode: label })}
                >
                  {specString("flow.mode.hand_to_fc_button", { mode: label })}
                </HoldButton>
              );
            })}
            {/* Refused during an FC failsafe, as Pause is: change mode first. */}
            <HoldButton
              holdMs={SPEC_HOLD_MS.take_control}
              className={pill(false, pending === "take_control")}
              disabled={pilot?.fcFailsafe === true}
              title={pilot?.fcFailsafe === true ? refusalText("failsafe") : undefined}
              data-testid="mode-take-control"
              onFire={() => act("take_control", specString("flow.take_control"))}
            >
              {specString("flow.mode.take_control")}
            </HoldButton>
          </div>
        </Section>

        {pilot?.vehicleClass === "vtol" && (
          <Section title={specString("flow.mode.section.vtol")}>
            <div className="flex gap-2">
              <HoldButton
                holdMs={SPEC_HOLD_MS.vtol_transition}
                className={pill(false, pending === "vtol:fw")}
                onFire={() => act("vtol:fw", specString("flow.mode.vtol.to_fw"))}
              >
                {specString("flow.mode.vtol.to_fw")}
              </HoldButton>
              <HoldButton
                holdMs={SPEC_HOLD_MS.vtol_transition}
                className={pill(false, pending === "vtol:mc")}
                onFire={() => act("vtol:mc", specString("flow.mode.vtol.to_mc"))}
              >
                {specString("flow.mode.vtol.to_mc")}
              </HoldButton>
            </div>
          </Section>
        )}

        <Section title={specString("flow.mode.section.fc_modes")}>
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
    </FlightSheetPortal>
  );
}
