"use client";

/**
 * @module AdapterStabilityCard
 * @description Per-adapter stable-MAC pin verdicts for the Network panel.
 * An onboard adapter with no efuse MAC randomizes its address each boot, which
 * churns the DHCP lease (and the box's IP); the agent auto-pins a stable MAC so
 * the IP stops moving. This card surfaces that so the operator sees it was
 * handled and can copy the pinned MAC for a DHCP reservation. Read-only here;
 * pin / unpin / confirm actions are available via the agent's
 * `ados network mac` CLI and `/v1/network/mac/*` REST routes.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import type { MacStabilityAdapter } from "@/lib/agent/feature-types";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { StatRow } from "./StatRow";

const STATE_LABEL: Record<string, string> = {
  stable: "Stable",
  pinned: "Pinned (next boot)",
  candidate: "Candidate",
  deferred: "Pin deferred",
  disabled: "Disabled",
};

const STATE_CLASS: Record<string, string> = {
  stable: "text-text-secondary",
  pinned: "text-status-success",
  candidate: "text-status-warning",
  deferred: "text-status-warning",
  disabled: "text-text-secondary",
};

function adapterTitle(a: MacStabilityAdapter): string {
  return a.name || a.vidpid || "adapter";
}

export function AdapterStabilityCard() {
  const tq = useTranslations("hardware.adapterStabilityCard");
  const macStability = useAgentCapabilitiesStore((s) => s.macStability);
  const adapters = macStability?.adapters ?? [];
  // Omit-when-absent: nothing to show on a board with no no-efuse randomizer.
  if (adapters.length === 0) return null;
  if (!adapters.some((a) => a.state && a.state !== "stable")) return null;

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <h2 className="mb-1 text-lg font-medium text-text-primary">{tq("adapterStability")}</h2>
      <p className="mb-3 text-xs text-text-secondary">
        An onboard adapter with no hardware MAC randomizes its address each boot,
        which churns the DHCP lease. The agent pins a stable MAC so the IP stops
        moving. Add a DHCP reservation for a pinned MAC to fix the IP too.
      </p>
      <div className="space-y-4">
        {adapters.map((a, idx) => {
          const state = a.state ?? "stable";
          return (
            <div
              key={a.usbPath || a.name || a.vidpid || String(idx)}
              className="rounded border border-border-default/60 p-3"
            >
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-mono text-sm text-text-primary">
                  {adapterTitle(a)}
                </span>
                <span
                  className={
                    "text-xs font-medium " +
                    (STATE_CLASS[state] ?? "text-text-secondary")
                  }
                >
                  {STATE_LABEL[state] ?? state}
                </span>
              </div>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                {a.vidpid ? <StatRow label={tq("chipset")} value={a.vidpid} /> : null}
                {a.pinnedMac ? (
                  <StatRow
                    label={tq("pinnedMAC")}
                    value={a.pinnedMac}
                    valueClass="text-status-success"
                  />
                ) : null}
                {a.lastSeenMac && a.lastSeenMac !== a.pinnedMac ? (
                  <StatRow label={tq("currentMAC")} value={a.lastSeenMac} />
                ) : null}
                {a.source ? <StatRow label={tq("detectedBy")} value={a.source} /> : null}
              </dl>
              {state === "candidate" ? (
                <p className="mt-2 text-xs text-status-warning">
                  This adapter looks like it randomizes its MAC. Confirm the pin
                  with{" "}
                  <code className="font-mono">
                    ados network mac pin {a.name ?? "<iface>"}
                  </code>
                  .
                </p>
              ) : null}
              {a.deferredReason ? (
                <p className="mt-2 text-xs text-status-warning">
                  Deferred: {a.deferredReason}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
