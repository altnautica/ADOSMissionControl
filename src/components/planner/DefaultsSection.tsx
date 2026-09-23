/**
 * @module DefaultsSection
 * @description Default values form for new waypoints — altitude, speed,
 * accept radius, and altitude reference frame.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { AltitudeFrame } from "@/lib/types";

interface DefaultsSectionProps {
  defaultAlt: number;
  defaultSpeed: number;
  defaultAcceptRadius: number;
  defaultFrame: AltitudeFrame;
  onAltChange: (alt: number) => void;
  onSpeedChange: (speed: number) => void;
  onRadiusChange: (radius: number) => void;
  onFrameChange: (frame: AltitudeFrame) => void;
}

export function DefaultsSection({
  defaultAlt,
  defaultSpeed,
  defaultAcceptRadius,
  defaultFrame,
  onAltChange,
  onSpeedChange,
  onRadiusChange,
  onFrameChange,
}: DefaultsSectionProps) {
  const t = useTranslations("planner");

  // Local edit state so the fields are typable; each commits on blur, and stays
  // in sync when the underlying default changes (e.g. loading a plan).
  const [localAlt, setLocalAlt] = useState(String(defaultAlt));
  const [localSpeed, setLocalSpeed] = useState(String(defaultSpeed));
  const [localRadius, setLocalRadius] = useState(String(defaultAcceptRadius));
  useEffect(() => { setLocalAlt(String(defaultAlt)); }, [defaultAlt]);
  useEffect(() => { setLocalSpeed(String(defaultSpeed)); }, [defaultSpeed]);
  useEffect(() => { setLocalRadius(String(defaultAcceptRadius)); }, [defaultAcceptRadius]);

  const FRAME_OPTIONS: { value: AltitudeFrame; label: string }[] = useMemo(() => [
    { value: "relative", label: t("relativeHome") },
    { value: "absolute", label: t("absoluteMsl") },
    { value: "terrain", label: t("terrainFollowing") },
  ], [t]);

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="grid grid-cols-2 gap-2">
        <Input
          label={t("defaultAltitude")}
          type="number"
          unit="m"
          value={localAlt}
          onChange={(e) => setLocalAlt(e.target.value)}
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v > 0) onAltChange(v);
          }}
        />
        <Input
          label={t("defaultSpeed")}
          type="number"
          unit="m/s"
          value={localSpeed}
          onChange={(e) => setLocalSpeed(e.target.value)}
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v > 0) onSpeedChange(v);
          }}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          label={t("acceptRadius")}
          type="number"
          unit="m"
          value={localRadius}
          onChange={(e) => setLocalRadius(e.target.value)}
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v > 0) onRadiusChange(v);
          }}
        />
        <Select
          label={t("altFrame")}
          options={FRAME_OPTIONS}
          value={defaultFrame}
          onChange={(v) => onFrameChange(v as AltitudeFrame)}
        />
      </div>
      {defaultFrame === "terrain" && (
        <p className="text-[10px] text-text-tertiary font-mono px-0.5">
          {t("terrainFollowingHint")}
        </p>
      )}
    </div>
  );
}
