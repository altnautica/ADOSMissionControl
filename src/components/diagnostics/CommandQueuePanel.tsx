"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { ListOrdered } from "lucide-react";

// Known MAV_CMD names for display
const CMD_NAMES: Record<number, string> = {
  176: "DO_SET_MODE",
  400: "COMPONENT_ARM_DISARM",
  20: "RETURN_TO_LAUNCH",
  21: "LAND",
  22: "TAKEOFF",
  241: "PREFLIGHT_REBOOT",
  245: "PREFLIGHT_STORAGE",
  246: "PREFLIGHT_CALIBRATION",
  252: "SET_MESSAGE_INTERVAL",
  511: "REQUEST_MESSAGE",
  519: "REQUEST_AUTOPILOT_CAPABILITIES",
  520: "REQUEST_PROTOCOL_VERSION",
  183: "DO_SET_SERVO",
  310: "DO_MOTOR_TEST",
  178: "DO_CHANGE_SPEED",
  192: "DO_REPOSITION",
  193: "DO_PAUSE_CONTINUE",
  179: "DO_SET_HOME",
  160: "DO_FENCE_ENABLE",
  31: "FLIGHT_TERMINATION",
};

function getCommandName(cmd: number): string {
  return CMD_NAMES[cmd] ?? `CMD_${cmd}`;
}

export function CommandQueuePanel() {
  const tq = useTranslations("diagnostics.commandQueuePanel");
  const snapshot = useDiagnosticsStore((s) => s.commandQueueSnapshot);
  const updateSnapshot = useDiagnosticsStore((s) => s.updateCommandQueueSnapshot);
  const protocol = useDroneManager(selectSelectedProtocol);
  // Clock for the age column; ticks only while something is pending.
  const [now, setNow] = useState(() => Date.now());

  // Poll the pending-command queue every 500ms. The adapter reports only what
  // is pending; nothing counts sent/acknowledged/failed commands, so no totals
  // are shown. The store is written only when the pending set changed.
  useEffect(() => {
    const getSnapshot = protocol?.getCommandQueueSnapshot?.bind(protocol);
    if (!getSnapshot) return;
    const interval = setInterval(() => {
      const qs = getSnapshot();
      if (qs.entries.length > 0) setNow(Date.now());
      const prev = useDiagnosticsStore.getState().commandQueueSnapshot;
      const unchanged =
        prev.pendingCount === qs.pendingCount &&
        prev.entries.length === qs.entries.length &&
        prev.entries.every((e, i) => e.ticket === qs.entries[i].ticket && e.retryCount === qs.entries[i].retryCount);
      if (unchanged) return;
      updateSnapshot({
        pendingCount: qs.pendingCount,
        entries: qs.entries.map((e) => ({
          ticket: e.ticket,
          command: e.command,
          commandName: getCommandName(e.command),
          sentAt: e.sentAt,
          retryCount: e.retryCount,
        })),
      });
    }, 500);
    return () => clearInterval(interval);
  }, [protocol, updateSnapshot]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border-default bg-bg-secondary">
        <ListOrdered size={14} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-primary">{tq("commandQueue")}</span>
        <span className="text-[10px] text-text-tertiary font-mono">
          {snapshot.pendingCount} pending
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Pending queue entries */}
        {snapshot.entries.length === 0 ? (
          <div className="text-center py-6">
            <span className="text-[10px] text-text-tertiary">{tq("noPendingCommands")}</span>
          </div>
        ) : (
          <div className="space-y-1">
            {snapshot.entries.map((entry) => (
              <div
                key={entry.ticket}
                className="flex items-center gap-2 px-2 py-1 bg-bg-tertiary/30 rounded text-[10px] font-mono"
              >
                <span className="text-accent-primary">{entry.commandName}</span>
                <span className="text-text-tertiary">({entry.command})</span>
                <span className="ml-auto text-text-tertiary">
                  {(Math.max(0, now - entry.sentAt) / 1000).toFixed(1)}s
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
