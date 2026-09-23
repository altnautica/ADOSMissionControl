"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useDroneManager } from "@/stores/drone-manager";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { Check, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyRcTrims, type TrimOutcome } from "./rc-trim-fix";

type TrimState =
  | { kind: "idle" }
  | { kind: "stale" }
  | { kind: "done"; outcomes: TrimOutcome[] };

/** Run the trim writes against the RC sample current at click time. */
async function runTrims(channels: readonly number[]): Promise<TrimState> {
  const protocol = useDroneManager.getState().getSelectedProtocol();
  if (!protocol) return { kind: "idle" };
  const sample = useTelemetryStore.getState().rc.latest();
  return applyRcTrims(protocol, channels, sample, Date.now());
}

function FailedRows({ outcomes }: { outcomes: TrimOutcome[] }) {
  const t = useTranslations("preArm");
  return (
    <>
      {outcomes
        .filter((o) => !o.ok)
        .map((o) => (
          <div key={o.channel} className="flex items-center gap-1 text-[10px] text-status-error">
            <X size={10} />
            <span>{t("trimWriteFailed", { channel: o.channel, reason: o.reason ?? "" })}</span>
          </div>
        ))}
    </>
  );
}

/** Per-channel "set trim to the current stick position" fix. */
export function RcNeutralQuickFix({ channelNumber, onTrimApplied }: { channelNumber: number; onTrimApplied?: () => void }) {
  const t = useTranslations("preArm");
  const protocol = useDroneManager.getState().getSelectedProtocol();
  const latestRc = useFreshTelemetry("rc");
  const currentValue = latestRc?.channels[channelNumber - 1] ?? 0;

  const [trimValue, setTrimValue] = useState<number | null>(null);
  const [dzValue, setDzValue] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const [state, setState] = useState<TrimState>({ kind: "idle" });

  // Fetch current trim and DZ params
  useEffect(() => {
    if (!protocol) return;
    Promise.allSettled([
      protocol.getParameter(`RC${channelNumber}_TRIM`),
      protocol.getParameter(`RC${channelNumber}_DZ`),
    ]).then(([trimResult, dzResult]) => {
      if (trimResult.status === "fulfilled") setTrimValue(trimResult.value.value);
      if (dzResult.status === "fulfilled") setDzValue(dzResult.value.value);
    });
  }, [protocol, channelNumber]);

  async function applyTrim() {
    setApplying(true);
    try {
      const next = await runTrims([channelNumber]);
      setState(next);
      const written = next.kind === "done" ? next.outcomes.find((o) => o.ok) : undefined;
      if (written?.value != null) {
        setTrimValue(written.value);
        setTimeout(() => onTrimApplied?.(), 500);
      }
    } finally {
      setApplying(false);
    }
  }

  const offset = trimValue !== null && currentValue > 0 ? Math.abs(currentValue - trimValue) : null;
  const outsideDz = offset !== null && dzValue !== null && offset > dzValue;
  const written = state.kind === "done" ? state.outcomes.find((o) => o.ok) : undefined;

  return (
    <div className="mt-1.5 ml-3 p-2 bg-bg-tertiary border border-border-default space-y-1.5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] font-mono">
        <span className="text-text-tertiary">RC{channelNumber} Current:</span>
        <span className="text-text-primary">{currentValue || "—"}</span>
        <span className="text-text-tertiary">RC{channelNumber}_TRIM:</span>
        <span className="text-text-primary">{trimValue ?? "—"}</span>
        <span className="text-text-tertiary">RC{channelNumber}_DZ:</span>
        <span className="text-text-primary">{dzValue ?? "—"}</span>
        {offset !== null && (
          <>
            <span className="text-text-tertiary">Offset:</span>
            <span className={outsideDz ? "text-status-error" : "text-status-success"}>
              {offset}{outsideDz ? " (outside DZ)" : " (within DZ)"}
            </span>
          </>
        )}
      </div>
      {written ? (
        <div className="flex items-center gap-1 text-[10px] text-status-success">
          <Check size={10} />
          <span>{t("trimSetTo", { value: written.value ?? "" })}</span>
        </div>
      ) : (
        <>
          {state.kind === "stale" && (
            <div className="text-[10px] text-status-error">{t("rcReadingStale")}</div>
          )}
          {state.kind === "done" && <FailedRows outcomes={state.outcomes} />}
          <Button
            size="sm"
            variant="secondary"
            icon={<Wrench size={10} />}
            loading={applying}
            disabled={currentValue === 0 || !protocol}
            onClick={applyTrim}
          >
            Set RC{channelNumber} Trim to {currentValue || "..."}
          </Button>
        </>
      )}
    </div>
  );
}

/** Fix every RC-not-neutral channel at once. */
export function BulkTrimFix({ channels, onFixed }: { channels: number[]; onFixed: () => void }) {
  const t = useTranslations("preArm");
  const latestRc = useFreshTelemetry("rc");
  const allChannels = latestRc?.channels ?? [];
  const [applying, setApplying] = useState(false);
  const [state, setState] = useState<TrimState>({ kind: "idle" });

  async function fixAll() {
    setApplying(true);
    try {
      const next = await runTrims(channels);
      setState(next);
      if (next.kind === "done" && next.outcomes.some((o) => o.ok)) setTimeout(onFixed, 500);
    } finally {
      setApplying(false);
    }
  }

  const outcomes = state.kind === "done" ? state.outcomes : [];
  const okCount = outcomes.filter((o) => o.ok).length;

  if (outcomes.length > 0 && okCount === outcomes.length) {
    return (
      <div className="flex items-center gap-1 text-[10px] text-status-success p-2 bg-status-success/10 border border-status-success/20">
        <Check size={10} />
        <span>{t("allTrimsFixed")}</span>
      </div>
    );
  }

  return (
    <div className="p-2 bg-accent-primary/10 border border-accent-primary/20 space-y-1.5">
      <div className="flex items-center gap-2">
        <Wrench size={10} className="text-accent-primary" />
        <span className="text-[10px] text-text-primary font-medium">
          {t("rcChannelsOutside", { count: channels.length })}
        </span>
      </div>
      <div className="space-y-0.5">
        {channels.map(ch => {
          const current = allChannels[ch - 1] ?? 0;
          return (
            <div key={ch} className="text-[10px] font-mono text-text-tertiary">
              RC{ch}_TRIM → {current || "—"}
            </div>
          );
        })}
      </div>
      {state.kind === "stale" && (
        <div className="text-[10px] text-status-error">{t("rcReadingStale")}</div>
      )}
      {outcomes.length > 0 && (
        <div className="text-[10px] text-text-secondary">
          {t("trimsPartlyFixed", { ok: okCount, total: outcomes.length })}
        </div>
      )}
      <FailedRows outcomes={outcomes} />
      <Button
        size="sm"
        variant="primary"
        icon={<Wrench size={10} />}
        loading={applying}
        disabled={!latestRc}
        onClick={fixAll}
      >
        {t("fixAllTrims")}
      </Button>
    </div>
  );
}
