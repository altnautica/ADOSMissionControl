"use client";

/**
 * @module cockpit/hud/HudSummary
 * @description A visually hidden text summary of the HUD (attitude, speed,
 * altitude, heading) for assistive technology. The drawn instruments are
 * `aria-hidden` graphics; this is their text equivalent.
 *
 * The text refreshes at most once a second, never per frame, in a polite
 * status region: a screen reader announces it when it changes without
 * interrupting other speech, and the operator can also read it on demand.
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { HudInstruments } from "@/lib/hud-readings";
import type { AltitudeReference } from "@/stores/cockpit-store";

/** Summary refresh period, ms. */
export const HUD_SUMMARY_PERIOD_MS = 1000;

/** The `cockpit.hud` translator, as far as the summary uses it. */
type HudTranslator = (key: string, values?: Record<string, string>) => string;

interface SummaryInput {
  reading: HudInstruments;
  speed: number | null;
  alt: number | null;
  altitudeRef: AltitudeReference;
  t: HudTranslator;
}

function summaryText({ reading, speed, alt, altitudeRef, t }: SummaryInput): string {
  // Each value carries its unit, or reads "no data" without one.
  const n = (v: number | null, digits: number, unit: string) =>
    v === null || !Number.isFinite(v) ? t("noData") : `${v.toFixed(digits)}${unit}`;
  const ref = altitudeRef === "msl" ? t("msl") : t("rel");
  return t("summary", {
    pitch: n(reading.pitch, 0, "°"),
    roll: n(reading.roll, 0, "°"),
    speed: n(speed, 1, " m/s"),
    alt: n(alt, 0, ` m ${ref}`),
    heading: n(reading.heading, 0, "°"),
  });
}

type HudSummaryProps = Omit<SummaryInput, "t">;

export function HudSummary({ reading, speed, alt, altitudeRef }: HudSummaryProps) {
  const t = useTranslations("cockpit.hud");
  const latest = useRef<SummaryInput>({ reading, speed, alt, altitudeRef, t });
  useEffect(() => {
    latest.current = { reading, speed, alt, altitudeRef, t };
  }, [reading, speed, alt, altitudeRef, t]);

  const [text, setText] = useState(() =>
    summaryText({ reading, speed, alt, altitudeRef, t }),
  );

  useEffect(() => {
    const id = window.setInterval(
      () => setText(summaryText(latest.current)),
      HUD_SUMMARY_PERIOD_MS,
    );
    return () => window.clearInterval(id);
  }, []);

  return (
    <p className="sr-only" role="status" aria-live="polite" data-testid="hud-summary">
      {text}
    </p>
  );
}
