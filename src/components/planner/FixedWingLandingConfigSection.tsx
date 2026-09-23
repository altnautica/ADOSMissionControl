/**
 * @module FixedWingLandingConfigSection
 * @description Fixed-wing landing pattern configuration UI.
 * Exposes the landing point, final-approach heading, glide slope, approach
 * altitude and speed for the straight-in approach and landing sequence. The
 * approach distance follows from the altitude and glide slope and is shown,
 * not edited.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { usePatternStore } from "@/stores/pattern-store";
import { fixedWingApproachDistance, landingApproachHeading } from "@/lib/patterns/landing-generator";
import { LandingPointPicker } from "./LandingPointPicker";

export function FixedWingLandingConfig() {
  const t = useTranslations("planner");
  const config = usePatternStore((s) => s.fixedWingLandingConfig);
  const update = usePatternStore((s) => s.updateFixedWingLandingConfig);
  const approachDistance = fixedWingApproachDistance(config.loiterAltitude ?? 60, config.glideSlopeAngle ?? 5);
  return (
    <>
      <LandingPointPicker
        landingPoint={config.landingPoint}
        onChange={(landingPoint) => update({ landingPoint })}
      />
      <Input label={t("approachHeading")} type="number" unit="deg" placeholder="0-360"
        value={config.approachHeading === undefined ? "" : String(config.approachHeading)}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          update({ approachHeading: Number.isFinite(v) ? v : undefined });
        }} />
      {landingApproachHeading(config.approachHeading) === null && (
        <p className="text-[10px] text-status-warning">{t("approachHeadingRequired")}</p>
      )}
      <Input label={t("glideSlopeAngle")} type="number" unit="deg" value={String(config.glideSlopeAngle ?? 5)}
        onChange={(e) => update({ glideSlopeAngle: parseFloat(e.target.value) || 5 })} />
      <div className="grid grid-cols-2 gap-2">
        <Input label={t("loiterAltitude")} type="number" unit="m" value={String(config.loiterAltitude ?? 60)}
          onChange={(e) => update({ loiterAltitude: parseFloat(e.target.value) || 60 })} />
        <Input label={t("speedMs")} type="number" unit="m/s" value={String(config.speed ?? 15)}
          onChange={(e) => update({ speed: parseFloat(e.target.value) || 15 })} />
      </div>
      <div className="flex items-center justify-between text-[10px] font-mono">
        <span className="text-text-secondary">{t("approachDistance")}</span>
        <span className="text-text-primary">{approachDistance === null ? "—" : `${Math.round(approachDistance)} m`}</span>
      </div>
    </>
  );
}
