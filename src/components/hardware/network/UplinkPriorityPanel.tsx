"use client";

/**
 * @module UplinkPriorityPanel
 * @description Drag-to-reorder uplink priority list, recent failover
 * timeline, and the share-uplink-with-AP-clients toggle.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { UplinkPriorityList } from "@/components/hardware/UplinkPriorityList";
import { HintChip } from "@/components/hardware/HintChip";
import { Toggle } from "@/components/ui/toggle";

function ifaceLabel(iface: string | null): string {
  if (!iface) return "None";
  switch (iface) {
    case "ethernet":
      return "Ethernet";
    case "wifi_client":
      return "WiFi Client";
    case "modem_4g":
      return "4G Modem";
    case "ap":
      return "Access Point";
    default:
      return iface;
  }
}

function formatRelative(ts: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return secs + "s ago";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  const days = Math.floor(hrs / 24);
  return days + "d ago";
}

interface FailoverEntry {
  timestamp: number;
  from: string | null;
  to: string | null;
  reason: string;
}

interface UplinkState {
  active: string | null;
  priority: string[];
  failover_log: FailoverEntry[];
  /** False when the active uplink's default route is not installed. */
  routeApplied?: boolean | null;
}

interface Props {
  uplink: UplinkState;
  shareEnabled: boolean;
  onPriorityChange: (next: string[]) => void;
  onShareToggle: (next: boolean) => void;
}

export function UplinkPriorityPanel({
  uplink,
  shareEnabled,
  onPriorityChange,
  onShareToggle,
}: Props) {
  const tq = useTranslations("hardware.uplinkPriorityPanel");
  const recentFailovers = uplink.failover_log.slice(0, 5);

  return (
    <>
      {/* Uplink priority */}
      <section className="rounded border border-border-default bg-bg-secondary p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-medium text-text-primary">{tq("uplinkPriority")}</h2>
            <HintChip>{tq("dragARowToReorder")}</HintChip>
          </div>
          <span className="text-xs text-text-secondary">
            Active: {ifaceLabel(uplink.active)}
          </span>
        </div>
        <p className="mb-3 text-[11px] text-text-tertiary">
          {tq("dragToReorderTheFirst")}
        </p>
        {uplink.routeApplied === false && uplink.active !== null && (
          <p
            role="alert"
            className="mb-3 rounded border border-status-warning/40 bg-status-warning/5 px-3 py-2 text-[11px] text-status-warning"
          >
            Route not applied: the node selected {ifaceLabel(uplink.active)} but its
            default route is not installed. The router retries every few seconds.
          </p>
        )}
        <UplinkPriorityList
          priority={uplink.priority}
          active={uplink.active}
          onChange={onPriorityChange}
        />

        <div className="mt-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-text-secondary">
            {tq("last5Failovers")}
          </div>
          {recentFailovers.length === 0 ? (
            <div className="text-xs text-text-tertiary">{tq("noFailoversRecordedThisSession")}</div>
          ) : (
            <ul className="flex flex-col gap-1">
              {recentFailovers.map((entry, idx) => (
                <li
                  key={entry.timestamp + "-" + idx}
                  className="flex items-center justify-between rounded border border-border-default px-2 py-1.5 text-xs"
                >
                  <span className="text-text-primary">
                    {ifaceLabel(entry.from)} to {ifaceLabel(entry.to)}
                  </span>
                  <span className="text-text-tertiary">
                    {entry.reason} ({formatRelative(entry.timestamp)})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Share uplink advanced toggle */}
      <section className="rounded border border-border-default bg-bg-secondary p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium text-text-primary">{tq("shareUplinkWithAPClients")}</h2>
            <p className="mt-1 text-xs text-text-secondary">
              {tq("routesActiveUplinkTrafficOut")}
            </p>
          </div>
          <Toggle
            label={shareEnabled ? "Enabled" : "Disabled"}
            checked={shareEnabled}
            onChange={onShareToggle}
          />
        </div>
      </section>
    </>
  );
}
