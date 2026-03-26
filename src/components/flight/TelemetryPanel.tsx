"use client";

import { useTelemetryLatest } from "@/hooks/use-telemetry-latest";
import { useDroneStore } from "@/stores/drone-store";
import { useMissionStore } from "@/stores/mission-store";
import { TelemetryBlock } from "@/components/shared/telemetry-block";
import { BatteryBar } from "@/components/shared/battery-bar";
import { mpsToKph, normalizeHeading } from "@/lib/telemetry-utils";
import { formatDuration } from "@/lib/utils";

export function TelemetryPanel() {
  const position = useTelemetryLatest("position");
  const vfr = useTelemetryLatest("vfr");
  const battery = useTelemetryLatest("battery");
  const gps = useTelemetryLatest("gps");
  const radio = useTelemetryLatest("radio");
  const flightMode = useDroneStore((s) => s.flightMode);
  const mission = useMissionStore((s) => s.activeMission);

  const alt = position?.alt ?? vfr?.alt ?? 0;
  const speedMps = vfr?.groundspeed ?? position?.groundSpeed ?? 0;
  const heading = position?.heading ?? vfr?.heading ?? 0;
  const battPct = battery?.remaining ?? 0;
  const voltage = battery?.voltage ?? 0;
  const current = battery?.current ?? 0;
  const sats = gps?.satellites ?? 0;
  const hdop = gps?.hdop ?? 0;

  const elapsedSec = mission?.startedAt
    ? Math.floor((Date.now() - mission.startedAt) / 1000)
    : 0;

  return (
    <div className="w-60 bg-bg-secondary border-l border-border-default flex flex-col overflow-y-auto shrink-0">
      {/* Position */}
      <div className="px-2 pt-2 pb-1">
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-semibold">
          Position
        </span>
      </div>
      <TelemetryBlock label="ALT" value={alt.toFixed(1)} unit="m" />
      <TelemetryBlock
        label="SPD"
        value={mpsToKph(speedMps).toFixed(1)}
        unit="km/h"
      />
      <TelemetryBlock
        label="HDG"
        value={String(Math.round(normalizeHeading(heading))).padStart(3, "0")}
        unit={"\u00B0"}
      />

      {/* Divider */}
      <div className="border-t border-border-default my-1" />

      {/* Power */}
      <div className="px-2 pt-1 pb-1">
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-semibold">
          Power
        </span>
      </div>
      <TelemetryBlock
        label="BATT"
        value={Math.round(battPct)}
        unit="%"
        warning={battPct <= 50 && battPct > 25}
        critical={battPct <= 25}
      />
      <div className="px-2 py-1">
        <BatteryBar percentage={battPct} />
      </div>
      <TelemetryBlock label="VOLTS" value={voltage.toFixed(1)} unit="V" />
      <TelemetryBlock label="AMPS" value={current.toFixed(1)} unit="A" />

      {/* Divider */}
      <div className="border-t border-border-default my-1" />

      {/* GPS */}
      <div className="px-2 pt-1 pb-1">
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-semibold">
          GPS
        </span>
      </div>
      <TelemetryBlock label="GPS" value={sats} unit="sat" />
      <TelemetryBlock
        label="HDOP"
        value={hdop.toFixed(1)}
        warning={hdop > 2.0}
        critical={hdop > 5.0}
      />

      {/* Divider */}
      <div className="border-t border-border-default my-1" />

      {/* Radio Link */}
      <div className="px-2 pt-1 pb-1">
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-semibold">
          Radio
        </span>
      </div>
      {(() => {
        const rssiDbm = radio ? radio.rssi / 1.9 - 127 : null;
        const remRssiDbm = radio ? radio.remrssi / 1.9 - 127 : null;
        return (
          <>
            <TelemetryBlock
              label="RSSI"
              value={rssiDbm !== null ? Math.round(rssiDbm) : "--"}
              unit="dBm"
              warning={rssiDbm !== null ? rssiDbm > -70 && rssiDbm < -50 : false}
              critical={rssiDbm !== null ? rssiDbm < -70 : false}
            />
            <TelemetryBlock
              label="REM"
              value={remRssiDbm !== null ? Math.round(remRssiDbm) : "--"}
              unit="dBm"
            />
          </>
        );
      })()}
      <TelemetryBlock
        label="TXBUF"
        value={radio?.txbuf ?? "--"}
        unit="%"
        warning={radio ? radio.txbuf < 50 : false}
        critical={radio ? radio.txbuf < 20 : false}
      />

      {/* Divider */}
      <div className="border-t border-border-default my-1" />

      {/* Flight */}
      <div className="px-2 pt-1 pb-1">
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-semibold">
          Flight
        </span>
      </div>
      <TelemetryBlock label="MODE" value={flightMode} />
      <TelemetryBlock
        label="TIME"
        value={formatDuration(elapsedSec)}
      />
    </div>
  );
}
