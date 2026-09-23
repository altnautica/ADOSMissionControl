"use client";

/**
 * @module FlashByteCounter
 * @description Dense byte/throughput readout for the active DroneCAN OTA.
 * Renders an animated progress bar, raw byte counters, last offset, last
 * chunk length, transfer-ID rotation count (derived from `lastChunkLen` +
 * total chunks served), throughput in KiB/s, and retry / timeout / CRC
 * mismatch tallies. When the orchestrator is idle the panel collapses to
 * a single sentence so the drawer stays compact in config mode.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useDroneCanFlashStore } from "@/stores/dronecan";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

function fmtThroughput(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return "0 B/s";
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KiB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MiB/s`;
}

export function FlashByteCounter() {
  const t = useTranslations("canConfig.debug.byteCounter");
  const state = useDroneCanFlashStore((s) => s.state);
  const percent = useDroneCanFlashStore((s) => s.percent);
  const bytesSent = useDroneCanFlashStore((s) => s.bytesSent);
  const bytesTotal = useDroneCanFlashStore((s) => s.bytesTotal);
  const lastOffset = useDroneCanFlashStore((s) => s.lastOffset);
  const lastChunkLen = useDroneCanFlashStore((s) => s.lastChunkLen);
  const retries = useDroneCanFlashStore((s) => s.retries);
  const timeouts = useDroneCanFlashStore((s) => s.timeouts);
  const transitions = useDroneCanFlashStore((s) => s.transitionLog);

  // Throughput sample — track bytes sent + wall clock at the moment we entered
  // TRANSFERRING. This gives us a stable per-transfer average without needing
  // a separate timer in the store.
  const startRef = useRef<{ t: number; bytes: number } | null>(null);
  const [throughput, setThroughput] = useState(0);

  useEffect(() => {
    if (state === "TRANSFERRING") {
      if (!startRef.current) {
        const first = transitions.find((x) => x.to === "TRANSFERRING");
        startRef.current = {
          t: first?.t ?? Date.now(),
          bytes: bytesSent,
        };
      }
      const start = startRef.current;
      const dt = Date.now() - start.t;
      if (dt > 0) setThroughput(((bytesSent - start.bytes) / dt) * 1000);
    } else if (state === "IDLE" || state === "DONE" || state === "ABORTED" || state === "FAILED") {
      startRef.current = null;
    }
  }, [state, bytesSent, transitions]);

  if (state === "IDLE") {
    return (
      <div className="text-xs text-text-tertiary px-2 py-1.5">{t("empty")}</div>
    );
  }

  const chunks = lastChunkLen > 0 ? Math.ceil(bytesSent / Math.max(1, lastChunkLen)) : 0;
  // Transfer-ID is a 5-bit DroneCAN counter that rotates every 32 transfers.
  const transferId = chunks % 32;
  const transferRotations = Math.floor(chunks / 32);

  return (
    <div className="space-y-2 px-2 py-2">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-text-secondary">
        {t("title")}
      </div>

      <div className="space-y-1">
        <div className="h-2 bg-bg-tertiary rounded overflow-hidden">
          <div
            className="h-full bg-accent-primary transition-all duration-200"
            style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
            data-testid="byte-counter-bar"
          />
        </div>
        <div className="flex justify-between text-[11px] font-mono text-text-secondary">
          <span>{fmtBytes(bytesSent)} / {fmtBytes(bytesTotal)}</span>
          <span>{Math.round(percent)}%</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono">
        <Row label={t("chunks")} value={chunks.toLocaleString()} />
        <Row label={t("lastOffset")} value={`0x${lastOffset.toString(16).toUpperCase()}`} />
        <Row label={t("lastLen")} value={lastChunkLen.toString()} />
        <Row
          label={t("transferId")}
          value={`${transferId}${transferRotations > 0 ? ` (×${transferRotations})` : ""}`}
        />
        <Row label={t("throughput")} value={fmtThroughput(throughput)} />
        <Row label={t("retries")} value={retries.toString()} cls={retries > 0 ? "text-status-warning" : undefined} />
        <Row label={t("timeouts")} value={timeouts.toString()} cls={timeouts > 0 ? "text-status-warning" : undefined} />
        <Row label={t("crcMismatches")} value="—" />
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  cls,
}: {
  label: string;
  value: string;
  cls?: string;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-text-tertiary">{label}</span>
      <span className={cls ?? "text-text-primary"}>{value}</span>
    </div>
  );
}
