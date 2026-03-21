/**
 * @module ConnectionBanner
 * @description Top-center banner showing ADS-B connection quality status.
 * Shows stale/disconnected warnings and brief "Connected" confirmation.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useRef } from "react";
import { useTrafficStore } from "@/stores/traffic-store";
import { cn } from "@/lib/utils";

export function ConnectionBanner() {
  const t = useTranslations("airTraffic");
  const connectionQuality = useTrafficStore((s) => s.connectionQuality);
  const lastUpdate = useTrafficStore((s) => s.lastUpdate);
  const [showGood, setShowGood] = useState(false);
  const prevQualityRef = useRef(connectionQuality);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show brief "Connected" when quality recovers to good
  useEffect(() => {
    if (connectionQuality === "good" && prevQualityRef.current !== "good") {
      setShowGood(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setShowGood(false), 3000);
    }
    prevQualityRef.current = connectionQuality;
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [connectionQuality]);

  const staleSeconds = lastUpdate ? Math.round((Date.now() - lastUpdate) / 1000) : 0;

  if (connectionQuality === "good" && !showGood) return null;

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
      <div
        className={cn(
          "px-3 py-1.5 rounded-lg backdrop-blur-md text-[10px] font-mono border",
          connectionQuality === "good" && "bg-green-500/10 border-green-500/30 text-green-400",
          connectionQuality === "degraded" && "bg-yellow-500/10 border-yellow-500/30 text-yellow-400",
          connectionQuality === "disconnected" && "bg-red-500/10 border-red-500/30 text-red-400",
        )}
      >
        {connectionQuality === "good" && t("connected")}
        {connectionQuality === "degraded" && t("adsbStale", { seconds: staleSeconds })}
        {connectionQuality === "disconnected" && t("disconnectedCached")}
      </div>
    </div>
  );
}
