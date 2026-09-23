"use client";

/**
 * @module CellularSection
 * @description 4G modem card with Configure button. Shows the configured
 * legs (enabled, APN, data cap) and whatever connectivity the agent reports
 * (state, signal, operator, interface, IP); a leg the agent has not probed
 * reads as not reported rather than as a value. A data-usage bar appears once
 * the data-cap tracker reports usage against a configured cap. The configure
 * modal lives in the parent.
 * @license GPL-3.0-only
 */

import { Button } from "@/components/ui/button";
import { DataUsageBar } from "@/components/hardware/DataUsageBar";
import { HintChip } from "@/components/hardware/HintChip";
import type { ModemView } from "@/lib/api/ground-station/types";
import { dataCapFromModem } from "@/stores/ground-station/uplink-ws";
import { StatRow } from "./StatRow";

const EMPTY = "…";
const NOT_REPORTED = "not reported";

interface Props {
  modem: ModemView | null;
  onConfigure: () => void;
}

export function CellularSection({ modem, onConfigure }: Props) {
  const dataCap = dataCapFromModem(modem);
  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-medium text-text-primary">4G Modem</h2>
        <Button variant="secondary" size="sm" onClick={onConfigure} disabled={!modem}>
          Configure
        </Button>
      </div>

      {!modem ? (
        <div className="text-sm text-text-secondary">{EMPTY}</div>
      ) : (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <StatRow label="Enabled" value={modem.enabled ? "yes" : "no"} />
            <StatRow label="State" value={modem.state ?? NOT_REPORTED} />
            <StatRow
              label="Signal"
              value={modem.signal_quality !== null ? `${modem.signal_quality}%` : NOT_REPORTED}
            />
            <StatRow label="Operator" value={modem.operator || NOT_REPORTED} />
            <StatRow label="APN" value={modem.apn ?? NOT_REPORTED} />
            <StatRow label="Interface" value={modem.iface ?? NOT_REPORTED} />
            <StatRow label="IP" value={modem.ip ?? NOT_REPORTED} />
            <StatRow
              label="Data cap"
              value={modem.cap_mb !== null ? `${modem.cap_mb} MB` : "none"}
            />
          </dl>

          {dataCap && dataCap.cap_mb > 0 ? (
            <div className="mt-1">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-text-secondary">
                  Data usage
                </span>
                <HintChip>Caps apply to 4G only. WiFi and Ethernet are uncapped.</HintChip>
              </div>
              <DataUsageBar
                usedMb={dataCap.used_mb}
                capMb={dataCap.cap_mb}
                state={dataCap.state}
              />
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
