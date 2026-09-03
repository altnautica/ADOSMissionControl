"use client";

import { useTranslations } from "next-intl";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { cn } from "@/lib/utils";
import { Satellite } from "lucide-react";
import type { GpsData } from "@/lib/types";

/**
 * MAVLink GPS_FIX_TYPE -> its `indicators.gpsFix.*` key plus severity colour.
 * Fix types above 6 (STATIC, PPP) have no entry and fall back to 0, which is
 * the pre-existing behaviour of this indicator.
 */
const FIX_TYPES: Record<number, { key: string; color: string }> = {
  0: { key: "noGps", color: "text-text-tertiary" },
  1: { key: "noFix", color: "text-status-error" },
  2: { key: "fix2d", color: "text-status-warning" },
  3: { key: "fix3d", color: "text-status-success" },
  4: { key: "dgps", color: "text-status-success" },
  5: { key: "rtkFloat", color: "text-accent-primary" },
  6: { key: "rtk", color: "text-accent-primary" },
};

function GpsRow({ label, data }: { label: string; data: GpsData }) {
  const t = useTranslations("indicators.gpsFix");
  // "sats"/"HDOP" are shared GPS column abbreviations; they live under the
  // CAN test-utility GPS block, which is the only place they are already
  // translated in every locale.
  const tUnits = useTranslations("canConfig.testUtilities.gpsFix");
  const fix = FIX_TYPES[data.fixType] ?? FIX_TYPES[0];
  const hdopColor = data.hdop < 1.5 ? "text-status-success"
    : data.hdop < 3.0 ? "text-status-warning"
    : "text-status-error";

  return (
    <div className="flex items-center gap-2">
      <Satellite size={12} className={fix.color} />
      <span className="text-[10px] font-mono text-text-tertiary w-6">{label}</span>
      <span className={cn("text-[10px] font-mono font-medium", fix.color)}>
        {t(fix.key)}
      </span>
      <span className="text-[10px] font-mono text-text-secondary">
        {data.satellites} {tUnits("sats")}
      </span>
      <span className={cn("text-[10px] font-mono", hdopColor)}>
        {tUnits("hdop")} {data.hdop.toFixed(1)}
      </span>
    </div>
  );
}

/**
 * GPS status display: fix type, satellite count, HDOP.
 * Shows GPS2 alongside GPS1 when available.
 */
export function GpsSkyView({ className }: { className?: string }) {
  const t = useTranslations("indicators.gpsFix");
  const gps = useTelemetryStore((s) => s.gps);
  const gps2 = useTelemetryStore((s) => s.gps2);
  const latest = gps.latest();
  const latest2 = gps2.latest();

  if (!latest) {
    return (
      <div className={cn("flex items-center gap-1 text-text-tertiary", className)}>
        <Satellite size={12} />
        <span className="text-[10px] font-mono">{t("noGps")}</span>
      </div>
    );
  }

  // Single GPS: show inline
  if (!latest2) {
    return (
      <div className={cn("space-y-0", className)}>
        <GpsRow label="GPS1" data={latest} />
      </div>
    );
  }

  // Dual GPS: stacked layout
  return (
    <div className={cn("space-y-0.5", className)}>
      <GpsRow label="GPS1" data={latest} />
      <GpsRow label="GPS2" data={latest2} />
    </div>
  );
}
