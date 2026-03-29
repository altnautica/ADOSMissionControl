/**
 * @module OfflineBadge
 * @description Shows "OFFLINE" badge when browser has no network connectivity.
 * Renders in the top-right corner of any map container.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useEffect } from "react";
import { WifiOff } from "lucide-react";

export function OfflineBadge() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="absolute top-3 right-3 z-[1000] flex items-center gap-1 px-2 py-1 bg-status-warning/20 border border-status-warning/40 rounded text-[10px] font-mono font-semibold text-status-warning">
      <WifiOff size={10} />
      OFFLINE
    </div>
  );
}
