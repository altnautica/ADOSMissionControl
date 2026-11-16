"use client";

/**
 * The flight-state chip (top bar, left): who flies the drone and how, in the
 * shared spec's words and colours. Tapping it opens the Mode sheet. Its
 * button (Take control, Resume) fires the matching built-in, and Abort on a
 * running launch is the launch sheet's and step strip's Abort (a refusal is
 * toasted with the pilot's reason);
 * NOT READY with the readiness item `setup_needed` red links to the aircraft
 * setup wizard.
 *
 * The chip never takes more than {@link CHIP_MAX_FRAC} of the top bar: a
 * longer text ends in an ellipsis and the full text stays in its title and
 * accessible name. It is one line: a dot in the state colour, the state,
 * then the secondary facts dimmed after " · ", inside a 1 px outline in the
 * state colour. At the compact classes it shows its compact face: the state
 * text with only the parts the sticks need (clearance, a late input, the
 * horizontal and vertical speed).
 *
 * @module cockpit/v2/FlightStateChip
 * @license GPL-3.0-only
 */

import { useFlightSheet } from "@/components/cockpit/flight/flight-sheet";
import Link from "next/link";

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import tokens from "@/lib/cockpit-spec/tokens.json";
import { SEVERITY_VAR, useFlightGrid } from "@/components/cockpit/flight/flight-context";
import { bottomRowLabels } from "@/components/cockpit/flight/flight-grid";
import { useFlightStateChip, usePilotState } from "@/lib/cockpit/use-pilot-state";
import { useGroundStationLink } from "@/lib/cockpit/ground-station-link";
import { specString } from "@/lib/cockpit/spec-strings";
import { activate, buildSkillContext } from "@/lib/skills";
import { refusalText } from "@/lib/hud/refusal";
import { CHIP_COMPACT_PARTS } from "@/lib/hud/flight-state";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { ModeSheet } from "./ModeSheet";
import { useLaunchAbort } from "./LaunchSteps";
import { AIRCRAFT_SETUP_HREF } from "@/components/shared/AircraftSetupBanner";

interface TopBarChipZoneSpec {
  id: string;
  chip?: { max_frac?: number };
}

const SPEC_CHIP_MAX_FRAC = (layoutSpec.zones as unknown as TopBarChipZoneSpec[]).find((z) => z.id === "top_bar")?.chip
  ?.max_frac;
if (typeof SPEC_CHIP_MAX_FRAC !== "number") throw new Error("layout.json: top_bar chip.max_frac is missing");

/** The largest share of the top bar's width the chip may take (spec
 *  `top_bar.chip.max_frac`). */
const CHIP_MAX_FRAC: number = SPEC_CHIP_MAX_FRAC;

/** Secondary-part colours that read as a severity (`tokens.json` chrome). */
const SEVERITY_OF_COLOR: Record<string, "warning" | "critical" | undefined> = {
  [tokens.chrome.severity_warning.toUpperCase()]: "warning",
  [tokens.chrome.severity_critical.toUpperCase()]: "critical",
};

/** The chip's button: its spec text key and what it does. Abort is the
 *  launch Abort every launch surface shares ({@link useLaunchAbort}). */
const CHIP_BUTTON: Record<string, { label: string; run: ((droneId: string) => void) | "abort" }> = {
  take_control: { label: "flow.take_control", run: (id) => void activate("take_control", buildSkillContext(id)) },
  resume: { label: "flow.resume", run: (id) => void activate("resume", buildSkillContext(id)) },
  abort: { label: "flow.launch.abort", run: "abort" },
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
  // The bottom row shows the speeds when it has room for all five readouts;
  // otherwise the chip carries them.
  const grid = useFlightGrid();
  const chip = useFlightStateChip(droneId, { speeds: bottomRowLabels(grid) !== "full" });
  const abortLaunch = useLaunchAbort();
  const { pilot } = usePilotState(droneId);
  const detectedLink = useGroundStationLink(droneId);
  const viaGroundStation = groundStationLink ?? detectedLink;
  const [open, setOpen] = useFlightSheet("mode");
  const button = chip.button ? CHIP_BUTTON[chip.button] : undefined;
  // Take control and Resume are refused during an FC failsafe, as Pause is:
  // the button shows why, and a press still dispatches so the refusal toasts.
  const refused =
    pilot?.fcFailsafe === true && (chip.button === "take_control" || chip.button === "resume")
      ? refusalText("failsafe")
      : null;
  const setupLink =
    chip.button === "setup" &&
    (pilot?.readiness.some((r) => r.id === "setup_needed" && !r.ok) ?? false);
  // While the nav stream has fallen back to the radio, the chip says so in
  // words after its secondary facts.
  const polled = useNavStreamStore((s) => s.byDrone[droneId]?.transport === "poll");
  const reducedRate = polled ? specString("nav.reduced_rate") : null;
  const secondary = compact ? chip.secondary.filter((s) => CHIP_COMPACT_PARTS[s.id]) : chip.secondary;
  const fullText = [chip.text, ...chip.secondary.map((s) => s.text), ...(reducedRate ? [reducedRate] : [])].join(" · ");
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
          {/* The state colour is the dot and the outline; the words stay in
              the chrome text colour, legible at any state. */}
          <span className="fs-dot" aria-hidden="true" data-testid="flight-state-chip-dot" />
          <span className="fs-chip-text" data-testid="flight-state-chip-text">
            {chip.text}
          </span>
          {secondary.length > 0 && (
            // The secondary facts and the control mode follow on the same
            // line, dimmed, and truncate before the state does. A fact in a
            // warning or critical colour (a near obstacle, a late stick
            // input) keeps that colour.
            <span className="fs-chip-sub" data-testid="flight-state-chip-sub" aria-hidden="true">
              {secondary.map((s, i) => {
                const severity = SEVERITY_OF_COLOR[s.color.toUpperCase()];
                return (
                  <span
                    key={i}
                    data-testid="flight-state-chip-part"
                    data-severity={severity}
                    style={severity ? { color: SEVERITY_VAR[severity] } : undefined}
                  >
                    {` · ${s.text}`}
                  </span>
                );
              })}
            </span>
          )}
          {reducedRate && !compact && (
            <span className="fs-chip-sub" style={{ color: "var(--fs-warn)" }} data-testid="flight-state-chip-reduced-rate" aria-hidden="true">
              {` · ${reducedRate}`}
            </span>
          )}
        </button>
        {button && (
          <button
            type="button"
            data-testid="chip-action"
            data-action={chip.button ?? undefined}
            aria-disabled={refused !== null || undefined}
            title={refused ?? undefined}
            className="fs-btn fs-hit fs-chip-action"
            onClick={() => (button.run === "abort" ? void abortLaunch() : button.run(droneId))}
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
