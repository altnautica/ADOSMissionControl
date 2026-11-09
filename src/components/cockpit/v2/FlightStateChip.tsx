"use client";

/**
 * The flight-state chip (top bar, left): who flies the drone and how, in the
 * shared spec's words and colours. Tapping it opens the Mode sheet. Its
 * button (Take control, Resume) fires the matching built-in; NOT READY with
 * the readiness item `setup_needed` red links to the aircraft setup wizard.
 *
 * @module cockpit/v2/FlightStateChip
 * @license GPL-3.0-only
 */

import { useState } from "react";
import Link from "next/link";

import { useFlightStateChip, usePilotState } from "@/lib/cockpit/use-pilot-state";
import { useGroundStationLink } from "@/lib/cockpit/ground-station-link";
import { specString } from "@/lib/cockpit/spec-strings";
import { activate, buildSkillContext } from "@/lib/skills";
import { ModeSheet } from "./ModeSheet";
import { AIRCRAFT_SETUP_HREF } from "@/components/shared/AircraftSetupBanner";

const BUTTON_LABEL: Record<string, { label: string; skill: string }> = {
  take_control: { label: "Take control", skill: "take_control" },
  resume: { label: "Resume", skill: "resume" },
};

export function FlightStateChip({
  droneId,
  groundStationLink,
}: {
  droneId: string;
  /** Override of the detected ground-station link (tests); by default the
   * node registry decides whether the drone is reached through a ground
   * station, which is when the Mode sheet offers ELRS. */
  groundStationLink?: boolean;
}) {
  const chip = useFlightStateChip(droneId);
  const { pilot } = usePilotState(droneId);
  const detectedLink = useGroundStationLink(droneId);
  const viaGroundStation = groundStationLink ?? detectedLink;
  const [open, setOpen] = useState(false);
  const button = chip.button ? BUTTON_LABEL[chip.button] : undefined;
  const setupLink =
    chip.button === "setup_link_when_setup_needed" &&
    (pilot?.readiness.some((r) => r.id === "setup_needed" && !r.ok) ?? false);

  return (
    <>
      <div className="flex items-center gap-1.5" data-testid="flight-state-chip" data-chip={chip.id}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="glass-pill flex min-h-12 flex-col items-start justify-center px-3 py-1 text-left"
          style={{ opacity: chip.dim ? 0.55 : 1, boxShadow: `inset 3px 0 0 ${chip.color}` }}
        >
          <span className="text-xs font-bold tracking-wide" style={{ color: chip.color }}>
            {chip.text}
          </span>
          {chip.secondary.length > 0 && (
            <span className="flex gap-2 text-[10px] font-semibold uppercase tracking-wide">
              {chip.secondary.map((s) => (
                <span key={s.text} style={{ color: s.color }}>
                  {s.text}
                </span>
              ))}
            </span>
          )}
        </button>
        {button && (
          <button
            type="button"
            className="glass-pill min-h-12 px-3 text-xs font-semibold text-text-primary"
            onClick={() => void activate(button.skill, buildSkillContext(droneId))}
          >
            {button.label}
          </button>
        )}
        {setupLink && (
          <Link
            href={AIRCRAFT_SETUP_HREF}
            data-testid="chip-setup-link"
            className="glass-pill flex min-h-12 items-center px-3 text-xs font-semibold text-text-primary"
          >
            {specString("setup.wizard.entry.set_up_aircraft")}
          </Link>
        )}
      </div>
      {open && (
        <ModeSheet
          droneId={droneId}
          pilot={pilot}
          groundStationLink={viaGroundStation}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
