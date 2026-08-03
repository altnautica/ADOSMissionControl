"use client";

/**
 * @module StatusTextCard
 * @description The rolling STATUSTEXT feed tile for the drone Overview FC band.
 * Subscribes to the selected drone's `DroneProtocol.onStatusText` stream and
 * keeps a small ring of the most recent lines with their MAVLink severity, so
 * prearm failures / mode changes / FC messages are visible on the Overview
 * without opening the Logs tab. Empty until the FC sends a line (Rule 44 — no
 * fabricated entries).
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusDot, type StatusLevel } from "@/components/ui/status-dot";
import { useDroneManager } from "@/stores/drone-manager";

const MAX_LINES = 6;

interface StatusLine {
  id: number;
  severity: number;
  text: string;
}

/** MAVLink SEVERITY (0 emergency … 7 debug) → status dot level. */
function severityLevel(sev: number): StatusLevel {
  if (sev <= 2) return "critical";
  if (sev === 3) return "serious";
  if (sev === 4) return "warning";
  return "idle";
}

interface StatusTextCardProps {
  className?: string;
}

export function StatusTextCard({ className }: StatusTextCardProps) {
  const t = useTranslations("nodeConsole");
  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const selectedId = useDroneManager((s) => s.selectedDroneId);
  const [lines, setLines] = useState<StatusLine[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    // Clear the feed when the selected drone changes so a prior drone's
    // messages never show under the new one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLines([]);
    const protocol = getProtocol();
    if (!protocol) return;
    const unsub = protocol.onStatusText((data) => {
      setLines((prev) => {
        const next = [
          ...prev,
          { id: idRef.current++, severity: data.severity, text: data.text },
        ];
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      });
    });
    return unsub;
  }, [getProtocol, selectedId]);

  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-lg border border-border-default bg-bg-secondary p-4",
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <ScrollText className="h-3.5 w-3.5 text-text-tertiary" />
        <span className="text-xs font-medium text-text-secondary">
          {t("statusText.title")}
        </span>
      </div>

      {lines.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-[11px] text-text-tertiary">
          {t("statusText.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {lines.map((line) => (
            <li key={line.id} className="flex items-start gap-1.5">
              <StatusDot
                status={severityLevel(line.severity)}
                size="xs"
                className="mt-1 flex-shrink-0"
              />
              <span className="break-words font-mono text-[11px] leading-tight text-text-secondary">
                {line.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
