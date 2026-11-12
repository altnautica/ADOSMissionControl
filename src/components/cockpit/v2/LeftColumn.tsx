"use client";

/**
 * The left column, vertically centred in its grid zone: Take off / Land,
 * Return home and Pause, 56 px targets (48 px at compact). In portrait it is
 * a row under the video. Each fires its built-in through the shared skill
 * pipeline, so the spec's confirm tier and gates apply.
 *
 * Each button is its icon with the built-in's short label under it
 * (`builtin.short.<id>`) at the classes the spec's `left_column.labels`
 * names; elsewhere (compact) it is the icon only. The full label stays the
 * accessible name. On a TV the label is never smaller than `label_min_px`.
 *
 * The column believes only a fresh pilot frame (`pilotFresh`, re-read on a
 * 500 ms tick): armed comes from the fresh pilot, else the FC heartbeat. An
 * armed aircraft counts as on the ground only when `vehicleLanded` says so;
 * with its landed state unknown the column offers Land, which is harmless on
 * the ground. A frozen frame never routes Take off or
 * "Launch here" to the pilot or keeps the launch step strip up.
 *
 * @module cockpit/v2/LeftColumn
 * @license GPL-3.0-only
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowDownToLine, ArrowUpFromLine, Home, Pause } from "lucide-react";

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import tokens from "@/lib/cockpit-spec/tokens.json";
import { LaunchSheet } from "@/components/cockpit/v2/LaunchSheet";
import { LaunchStepsRunning } from "@/components/cockpit/v2/LaunchSteps";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { pilotFresh } from "@/lib/hud/pilot-fresh";
import { pilotStreamOpen, usePilotLinkStore } from "@/lib/input/pilot-stream";
import { specBuiltin } from "@/lib/cockpit/spec-builtins";
import { specOrAppText, specString } from "@/lib/cockpit/spec-strings";
import { activate, buildSkillContext, useSkillRegistry } from "@/lib/skills";
import { vehicleLanded } from "@/lib/skills/flight-facts";
import { useDroneStore } from "@/stores/drone-store";
import { useFlightGrid } from "@/components/cockpit/flight/flight-context";
import { rectStyle, type FlightGridClass } from "@/components/cockpit/flight/flight-grid";
import { useFlightSheet } from "@/components/cockpit/flight/flight-sheet";
import { liveLaunchRequest, useLaunchRequestStore } from "@/stores/launch-request-store";

/** How often the column re-reads the pilot frame's age (ms). */
const PILOT_TICK_MS = 500;

interface LeftColumnZoneSpec {
  id: string;
  labels?: { show_at?: string[] };
}

const LABELS_AT: readonly string[] =
  (layoutSpec.zones as unknown as LeftColumnZoneSpec[]).find((z) => z.id === "left_column")?.labels?.show_at ?? [];
const TV_LABEL_MIN_PX = layoutSpec.classes.tv.label_min_px;

/** Whether the left column shows its short labels at this grid class. */
export function leftColumnLabels(cls: FlightGridClass): boolean {
  return LABELS_AT.includes(cls);
}

/** The recovery built-ins whose registry state the column reflects. A press
 *  still dispatches, so the refusal toast explains a disabled one. */
const STATEFUL_BUILTINS: Record<string, true> = { land: true, rth: true, pause: true };

function ColumnButton({
  id,
  droneId,
  icon,
  label,
  ...rest
}: {
  id: string;
  droneId: string;
  icon: ReactNode;
  label: CSSProperties | null;
  onClick: () => void;
  "aria-expanded"?: boolean;
  "data-sheet-trigger"?: string;
}) {
  const t = useTranslations();
  const state = useSkillRegistry((s) =>
    STATEFUL_BUILTINS[id] ? s.states.get(droneId)?.get(id) : undefined,
  );
  const disabled = state?.kind === "disabled";
  const reason = disabled && state.reason ? specOrAppText(t, state.reason) : null;
  const name = specBuiltin(id).label;
  return (
    <button
      type="button"
      className="fs-btn fs-col-target"
      data-builtin={id}
      aria-label={name}
      aria-disabled={disabled || undefined}
      title={reason ?? name}
      {...rest}
    >
      {icon}
      {label && (
        <span className="fs-col-label" data-testid={`left-col-label-${id}`} style={label}>
          {specString(`builtin.short.${id}`)}
        </span>
      )}
    </button>
  );
}

export function LeftColumn({ droneId }: { droneId: string }) {
  const fcArmed = useDroneStore((s) => s.armState === "armed");
  const { pilot: frame, receivedAt } = usePilotState(droneId);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), PILOT_TICK_MS);
    return () => clearInterval(t);
  }, []);
  // Only a fresh pilot frame says anything; a frozen one is no pilot at all.
  const pilot = pilotFresh(receivedAt, now) ? frame : null;
  const armed = pilot ? pilot.armed : fcArmed;
  const onGround = !armed || vehicleLanded(droneId, now) === true;
  const fire = (id: string) => void activate(id, buildSkillContext(droneId));
  // With the drone's pilot reachable, Take off opens the Launch sheet (one
  // hold runs checks, arm, take-off and the after-take-off action); without
  // it, Take off is the plain built-in.
  usePilotLinkStore((s) => s.connected);
  const viaPilot = pilotStreamOpen(droneId) && pilot !== null;
  const [launchOpen, setLaunchOpen] = useFlightSheet("launch");
  // The Launch sheet is a ground sheet: it closes once the drone is flying.
  useEffect(() => {
    if (!onGround) setLaunchOpen(false);
  }, [onGround, setLaunchOpen]);
  // "Launch here" on a map: open the sheet, which takes the point. A request
  // the sheet cannot use (flying, no pilot, or picked too long ago) is dropped.
  const launchRequested = useLaunchRequestStore((s) => s.pending?.droneId === droneId);
  useEffect(() => {
    if (!launchRequested) return;
    const live = liveLaunchRequest(useLaunchRequestStore.getState().pending, droneId) !== null;
    if (live && onGround && viaPilot) setLaunchOpen(true);
    else useLaunchRequestStore.getState().consume();
  }, [launchRequested, droneId, onGround, viaPilot, setLaunchOpen]);
  const sequence = pilot?.sequence ?? null;
  const sequenceRunning = sequence !== null && sequence.step !== "done";
  const grid = useFlightGrid();
  const rect = grid.zones.left_column;
  if (!rect) return null;
  const row = grid.cls === "portrait";
  // The short label under each icon where the spec shows it; at least the
  // TV minimum on a TV.
  const label: CSSProperties | null = leftColumnLabels(grid.cls)
    ? grid.cls === "tv"
      ? { fontSize: `${Math.max(TV_LABEL_MIN_PX, tokens.chrome.type.label_px * grid.scale)}px` }
      : {}
    : null;

  return (
    <div
      className={`fs-col fs-col-left${row ? " fs-col-row" : ""}`}
      data-zone="left_column"
      data-testid="left-column"
      data-labels={label ? "true" : "false"}
      style={{ ...rectStyle(rect), "--fs-target": `${grid.target}px` } as CSSProperties}
    >
      <div className="fs-col-stack">
        {onGround ? (
          <ColumnButton
            id="takeoff"
            droneId={droneId}
            icon={<ArrowUpFromLine size={18} aria-hidden />}
            label={label}
            data-sheet-trigger="launch"
            aria-expanded={viaPilot ? launchOpen : undefined}
            onClick={() => (viaPilot ? setLaunchOpen((o) => !o) : fire("takeoff"))}
          />
        ) : (
          <ColumnButton id="land" droneId={droneId} icon={<ArrowDownToLine size={18} aria-hidden />} label={label} onClick={() => fire("land")} />
        )}
        <ColumnButton id="rth" droneId={droneId} icon={<Home size={18} aria-hidden />} label={label} onClick={() => fire("rth")} />
        <ColumnButton id="pause" droneId={droneId} icon={<Pause size={18} aria-hidden />} label={label} onClick={() => fire("pause")} />
      </div>
      {launchOpen && viaPilot && (
        <LaunchSheet droneId={droneId} pilot={pilot} onClose={() => setLaunchOpen(false)} />
      )}
      {!launchOpen && sequenceRunning && <LaunchStepsRunning sequence={sequence} />}
    </div>
  );
}
