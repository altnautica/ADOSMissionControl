"use client";

/**
 * @module cockpit/NavSourceChip
 * @description Safety-band item 6: what the EKF navigates on, as one chip
 * (source icon, source label, quality word), coloured by quality. Replaces
 * the band's GPS cell. A report older than 2 s reads `NAV —` (muted). At the
 * `compact` width the quality word moves into the popover; the label is
 * never truncated. Click, tap or Enter opens {@link NavSourcePopover}.
 *
 * @license GPL-3.0-only
 */

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Compass, Satellite, ScanLine, Waves, type LucideIcon } from "lucide-react";

import type { NavSourceKind, NavSourceResult, NavTone } from "@/lib/vision/nav-source";
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

/** Translated chip label and quality word for a resolved source. */
export function useNavSourceText(): (r: NavSourceResult) => { label: string; word: string | null } {
  const t = useTranslations("hud.nav");
  return (r) => {
    const word = r.quality ? t(`q.${r.quality}`) : null;
    switch (r.kind) {
      case "stale":
        return { label: t("stale"), word: null };
      case "dr":
        return { label: t("dr"), word };
      case "ext":
        return { label: t("ext"), word };
      case "flow":
        return { label: t("flow"), word };
      case "gps": {
        const fix = t(`fix.${r.fix ?? "none"}`);
        return {
          label: r.sats !== undefined ? t("gps", { fix, sats: r.sats }) : t("gpsNoSats", { fix }),
          word,
        };
      }
    }
  };
}

export function NavSourceChip({ droneId }: { droneId: string }) {
  const t = useTranslations("hud.nav");
  const view = useNavSource(droneId);
  const widthClass = useCockpitWidthClass();
  const text = useNavSourceText()(view.result);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const { kind, tone } = view.result;
  const Icon = KIND_ICON[kind];
  const color = NAV_TONE_COLOR[tone];
  const showWord = widthClass !== "compact" && text.word !== null;

  return (
    <div className="stat navchip" data-testid="cockpit-nav" data-kind={kind} data-tone={tone}>
      <button
        ref={anchorRef}
        type="button"
        className="navchip-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t("chipLabel")}: ${text.label}${text.word ? ` ${text.word}` : ""}`}
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
