"use client";

import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTelemetryStore } from "@/stores/telemetry-store";

interface RadioLinkCardProps {
  className?: string;
}

export function RadioLinkCard({ className }: RadioLinkCardProps) {
  useTelemetryStore((s) => s._version);
  const radio = useTelemetryStore((s) => s.radio);
  const latest = radio.latest();

  return (
    <div
      className={cn(
        "border border-border-default rounded-lg p-4",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <Radio className="w-3.5 h-3.5 text-text-tertiary" />
        <span className="text-xs font-medium text-text-secondary">
          Radio Link
        </span>
      </div>

      {/* RSSI local + remote */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <div>
          <div className="text-[10px] text-text-tertiary">Local RSSI</div>
          <div className="text-xs font-mono text-text-primary">
            {latest ? `${latest.rssi} dBm` : "-- dBm"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-text-tertiary">Remote RSSI</div>
          <div className="text-xs font-mono text-text-primary">
            {latest ? `${latest.remrssi} dBm` : "-- dBm"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-text-tertiary">TX Buffer</div>
          <div className="text-xs font-mono text-text-primary">
            {latest ? `${latest.txbuf}%` : "--%"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-text-tertiary">Noise</div>
          <div className="text-xs font-mono text-text-primary">
            {latest ? `${latest.noise}` : "--"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-text-tertiary">RX Errors</div>
          <div className="text-xs font-mono text-text-primary">
            {latest ? `${latest.rxerrors}` : "--"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-text-tertiary">Fixed</div>
          <div className="text-xs font-mono text-text-primary">
            {latest ? `${latest.fixed}` : "--"}
          </div>
        </div>
      </div>

      {!latest && (
        <div className="text-[10px] text-text-tertiary text-center mt-1.5">
          Waiting for data...
        </div>
      )}
    </div>
  );
}
