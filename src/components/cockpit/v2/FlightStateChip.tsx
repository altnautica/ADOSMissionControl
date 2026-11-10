"use client";

/**
 * The flight-state chip (top bar, left): who flies the drone and how, in the
 * shared spec's words and colours. Tapping it opens the Mode sheet. Its
 * button (Take control, Resume) fires the matching built-in, and Abort on a
 * running launch holds the aircraft as the launch step strip's Abort does;
 * NOT READY with the readiness item `setup_needed` red links to the aircraft
 * setup wizard.
 *
 * The chip never takes more than {@link CHIP_MAX_FRAC} of the top bar: a
 * longer text ends in an ellipsis and the full text stays in its title and
 * accessible name. At the compact classes it shows its compact face, the
 * state text alone without the secondary lines.
 *
 * @module cockpit/v2/FlightStateChip
 * @license GPL-3.0-only
 */

import { useFlightSheet } from "@/components/cockpit/flight/flight-sheet";
import Link from "next/link";

import { useFlightStateChip, usePilotState } from "@/lib/cockpit/use-pilot-state";
import { useGroundStationLink } from "@/lib/cockpit/ground-station-link";
import { specString } from "@/lib/cockpit/spec-strings";
import { requestPilotAction } from "@/lib/input/pilot-stream";
import { activate, buildSkillContext } from "@/lib/skills";
import { ModeSheet } from "./ModeSheet";
import { AIRCRAFT_SETUP_HREF } from "@/components/shared/AircraftSetupBanner";

/** The largest share of the top bar's width the chip may take. */
export const CHIP_MAX_FRAC = 0.4;

/** The chip's button: its spec text key and what it does. */
const CHIP_BUTTON: Record<string, { label: string; run: (droneId: string) => void }> = {
  take_control: { label: "flow.take_control", run: (id) => void activate("take_control", buildSkillContext(id)) },
  resume: { label: "flow.resume", run: (id) => void activate("resume", buildSkillContext(id)) },
  // The same action as the launch sheet's and step strip's Abort.
  abort: { label: "flow.launch.abort", run: () => void requestPilotAction("pause") },
};

export function FlightStateChip({
  droneId,
  groundStationLink,
  barWidth,
  compact = false,
}: {
  droneId: string;
  /** Override of the detected ground-station link (tests); by default the
   * node registry decides whether the drone is reached through a ground
   * station, which is when the Mode sheet offers ELRS. */
  groundStationLink?: boolean;
  /** The top bar's width in px; the chip is capped at its share of it. */
  barWidth?: number;
  /** Compact face: the state text only. */
  compact?: boolean;
}) {
  const chip = useFlightStateChip(droneId);
  const { pilot } = usePilotState(droneId);
  const detectedLink = useGroundStationLink(droneId);
  const viaGroundStation = groundStationLink ?? detectedLink;
  const [open, setOpen] = useFlightSheet("mode");
  const button = chip.button ? CHIP_BUTTON[chip.button] : undefined;
  const setupLink =
    chip.button === "setup" &&
    (pilot?.readiness.some((r) => r.id === "setup_needed" && !r.ok) ?? false);
  const secondary = compact ? [] : chip.secondary;
  const fullText = [chip.text, ...chip.secondary.map((s) => s.text)].join(" · ");
  const maxWidth = barWidth !== undefined && barWidth > 0 ? Math.floor(barWidth * CHIP_MAX_FRAC) : undefined;

  return (
    <>
      <div
        className="fs-chip-wrap"
        data-testid="flight-state-chip"
        data-chip={chip.ruleId}
        data-face={compact ? "compact" : "full"}
        data-max-frac={CHIP_MAX_FRAC}
        style={{ maxWidth, minWidth: 0, flex: "0 1 auto" }}
      >
        <button
          type="button"
          data-sheet-trigger="mode"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={specString("chip.aria", { text: fullText })}
          title={fullText}
          className="fs-chip"
          style={
            {
              opacity: chip.dim ? 0.55 : 1,
              "--chip-color": chip.color,
              minWidth: 0,
              maxWidth: "100%",
              overflow: "hidden",
            } as React.CSSProperties
          }
        >
          <span
            className="fs-chip-text"
            data-testid="flight-state-chip-text"
            style={{ color: chip.color, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {chip.text}
          </span>
          {secondary.length > 0 && (
            <span className="fs-chip-sub" aria-hidden="true">
              {secondary.map((s) => (
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
            data-testid="chip-action"
            data-action={chip.button ?? undefined}
            className="fs-btn fs-hit fs-chip-action"
            onClick={() => button.run(droneId)}
          >
            {specString(button.label)}
          </button>
        )}
        {setupLink && (
          <Link
            href={AIRCRAFT_SETUP_HREF}
            data-testid="chip-setup-link"
            className="fs-btn fs-hit fs-chip-action"
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
