"use client";

/**
 * @module cockpit/NavSourceChip
 * @description Safety-band item 6: what the EKF navigates on, as one chip
 * (source icon, source label, quality word), coloured by quality. Replaces
 * the band's GPS cell. A report older than 2 s reads `NAV —` (muted). At the
 * `compact` width the quality word moves into the popover; the label is
 * never truncated. Click, tap or Enter opens {@link NavSourcePopover}. In the
 * Menu the chip keeps its own open state, so the popover opens over the Menu
 * without closing it.
 *
 * @license GPL-3.0-only
 */

import { useRef, useState } from "react";
import { useFlightSheet } from "@/components/cockpit/flight/flight-sheet";
import { Compass, Satellite, ScanLine, Waves, type LucideIcon } from "lucide-react";

import { specString } from "@/lib/cockpit/spec-strings";
import type { NavSourceKind, NavTone } from "@/lib/hud/nav-source";
import { navSourceText } from "./nav-source-text";
import { useCockpitWidthClass } from "@/hooks/use-cockpit-width-class";
import { useNavSource } from "@/hooks/use-nav-source";
import { NavSourcePopover } from "./NavSourcePopover";

const KIND_ICON: Readonly<Record<NavSourceKind, LucideIcon>> = {
  dr: Compass,
  ext: ScanLine,
  gps: Satellite,
  flow: Waves,
  stale: Satellite,
};

export const NAV_TONE_COLOR: Readonly<Record<NavTone, string>> = {
  good: "var(--hud-good)",
  warn: "var(--hud-warn)",
  crit: "var(--hud-crit)",
  muted: "var(--hud-muted)",
};

export function NavSourceChip({ droneId, inMenu = false }: { droneId: string; inMenu?: boolean }) {
  const view = useNavSource(droneId);
  const widthClass = useCockpitWidthClass();
  const text = navSourceText(view.result);
  const sheet = useFlightSheet("nav_source");
  const local = useState(false);
  const [open, setOpen] = inMenu ? local : sheet;
  const anchorRef = useRef<HTMLButtonElement>(null);

  const { kind, tone } = view.result;
  const Icon = KIND_ICON[kind];
  const color = NAV_TONE_COLOR[tone];
  const showWord = widthClass !== "compact" && text.word !== null;

  return (
    <div className="stat navchip" data-testid="cockpit-nav" data-item="nav_source" data-kind={kind} data-tone={tone}>
      <button
        ref={anchorRef}
        type="button"
        className="navchip-btn fs-hit"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${specString("cockpit.status.source.nav_source")}: ${text.label}${text.word ? ` ${text.word}` : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon size={12} aria-hidden="true" style={{ color }} />
        <span className="v" style={{ color }}>{text.label}</span>
        {showWord && (
          <span className="navchip-q" style={{ color }}>{text.word}</span>
        )}
      </button>
      {open && (
        <NavSourcePopover
          droneId={droneId}
          view={view}
          anchor={anchorRef}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
