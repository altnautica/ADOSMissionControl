"use client";

/**
 * @module HudOfflineFallback
 * @description Suspense fallback for the HDMI kiosk HUD. Renders a minimal
 * dark banner while the HUD bootstraps. After timeoutMs elapses without the
 * real HUD mounting, switches to a clearer "unreachable" message. Dark theme
 * only, no external deps beyond React. Suitable for Chromium kiosk on HDMI.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";

interface HudOfflineFallbackProps {
  timeoutMs?: number;
}

export function HudOfflineFallback({ timeoutMs = 3000 }: HudOfflineFallbackProps) {
  const [elapsedS, setElapsedS] = useState(0);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const startedAt = Date.now();
    const tick = setInterval(() => {
      setElapsedS(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    const t = setTimeout(() => setExpired(true), timeoutMs);
    return () => {
      clearInterval(tick);
      clearTimeout(t);
    };
  }, [timeoutMs]);

  return (
    <div className="w-full h-full bg-media text-on-media font-mono flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 px-6 py-8 rounded border border-on-media/20 bg-scrim/60">
        <div className="text-sm uppercase tracking-wider text-on-media/90">
          {expired ? "Agent unreachable" : "Agent offline"}
        </div>
        <div className="text-xs text-on-media/60">
          {expired
            ? `No response for ${elapsedS}s. Check the ground station agent.`
            : "Retrying..."}
        </div>
        <div className="text-[10px] text-on-media/40">
          elapsed {elapsedS}s
        </div>
      </div>
    </div>
  );
}
