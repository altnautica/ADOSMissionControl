"use client";

/**
 * @module WifiPowersaveCard
 * @description Per-interface WiFi power-save reconciler verdicts for the Network
 * panel. Power-save adds receive latency and drops throughput on a link that
 * must stay responsive, so the agent's runtime reconciler holds power-save OFF
 * and re-asserts it whenever the driver flips it back on. This card proves the
 * state is held OFF at runtime and surfaces the re-assert count + signal per
 * interface. Read-only.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import type { WifiPowersaveInterface } from "@/lib/agent/feature-types";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { StatRow } from "./StatRow";

// Signal color thresholds (dBm). Higher (closer to zero) is stronger.
const SIGNAL_GREEN_DBM = -60;
const SIGNAL_YELLOW_DBM = -75;

function signalClass(dbm: number | null): string {
  if (dbm == null) return "text-text-secondary";
  if (dbm >= SIGNAL_GREEN_DBM) return "text-status-success";
  if (dbm >= SIGNAL_YELLOW_DBM) return "text-status-warning";
  return "text-status-error";
}

function ifaceTitle(i: WifiPowersaveInterface): string {
  return i.iface || "interface";
}

export function WifiPowersaveCard() {
  const tq = useTranslations("hardware.wifiPowersaveCard");
  const wifiPowersave = useAgentCapabilitiesStore((s) => s.wifiPowersave);
  const interfaces = wifiPowersave?.interfaces ?? [];
  // Omit-when-absent: nothing to show on an agent that predates the reconciler
  // or a profile with no managed WiFi interface.
  if (interfaces.length === 0) return null;

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <h2 className="mb-1 text-lg font-medium text-text-primary">{tq("wifiPowerSave")}</h2>
      <p className="mb-3 text-xs text-text-secondary">
        Power-save adds receive latency and drops throughput on a link that must
        stay responsive. The agent holds power-save OFF at runtime and re-asserts
        it whenever the driver flips it back on. OFF is the healthy state.
      </p>
      <div className="space-y-4">
        {interfaces.map((i, idx) => {
          // OFF (power-save disabled) is the verified/good state; ON means the
          // reconciler has not yet won it back and reads as a warning.
          const off = i.powersaveOn === false;
          return (
            <div
              key={i.iface || String(idx)}
              className="rounded border border-border-default/60 p-3"
            >
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-mono text-sm text-text-primary">
                  {ifaceTitle(i)}
                </span>
                <span
                  className={
                    "text-xs font-medium " +
                    (off ? "text-status-success" : "text-status-warning")
                  }
                >
                  {off ? "Power-save OFF (verified)" : "Power-save ON"}
                </span>
              </div>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                <StatRow label={tq("reAsserts")} value={String(i.reasserts)} />
                {i.signalDbm != null ? (
                  <StatRow
                    label={tq("signal")}
                    value={`${i.signalDbm} dBm`}
                    valueClass={signalClass(i.signalDbm)}
                  />
                ) : null}
                {i.linkState ? (
                  <StatRow label={tq("link")} value={i.linkState} />
                ) : null}
                {i.lastReassert ? (
                  <StatRow label={tq("lastReAssert")} value={i.lastReassert} />
                ) : null}
              </dl>
              {!off ? (
                <p className="mt-2 text-xs text-status-warning">
                  Power-save is currently on for this interface. The agent will
                  re-assert it off; if this persists, the driver keeps flipping
                  it back on.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
