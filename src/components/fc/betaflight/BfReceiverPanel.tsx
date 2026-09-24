/**
 * @module BfReceiverPanel
 * @description Betaflight receiver page: live RC channel bars plus the receiver
 * config over MSP (serial-RX provider, valid pulse window, stick checks) and the
 * RC channel map. Writes echo the raw MSP_RX_CONFIG payload with the edited
 * leading fields patched, so version-dependent trailing bytes round-trip.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useState } from "react";
import { Radio, Upload } from "lucide-react";
import { PanelHeader } from "../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { RcChannelBar } from "../receiver/RcChannelBar";
import type { BfRxConfig } from "@/lib/protocol/types";
import { BF_SERIALRX_PROVIDERS, RX_MAP_CHANNELS, isRxMapPermutation } from "./bf-rx-constants";

const PROVIDER_OPTIONS = BF_SERIALRX_PROVIDERS.map((label, i) => ({ value: String(i), label }));
const ONOFF_OPTIONS = [{ value: "0", label: "OFF" }, { value: "1", label: "ON" }];
const USB_HID_OPTIONS = [{ value: "0", label: "Default (CDC)" }, { value: "1", label: "Composite (CDC + HID)" }];
const snapshot = (cfg: BfRxConfig, map: number[]) => JSON.stringify({ c: { ...cfg, raw: Array.from(cfg.raw) }, m: map });

// Betaflight accepts rx_min_usec / rx_max_usec in PWM_PULSE_MIN..PWM_PULSE_MAX;
// pulses outside the window mark the channel invalid (RX loss / failsafe).
const PULSE_LIMIT_MIN = 750;
const PULSE_LIMIT_MAX = 2250;
// Firmware defaults: a window at least this wide keeps a normal 988-2012 TX valid.
const DEFAULT_RX_MIN_USEC = 885;
const DEFAULT_RX_MAX_USEC = 2115;
const clampPulse = (v: number) => Math.min(PULSE_LIMIT_MAX, Math.max(PULSE_LIMIT_MIN, v));

/** A labelled U16 number input. */
function NumField({ label, value, disabled, onChange, min = 0, max = 2500 }: {
  label: string; value: number; disabled: boolean; onChange: (v: number) => void; min?: number; max?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-text-tertiary font-mono">{label}</span>
      <input
        type="number" min={min} max={max} value={value} disabled={disabled}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="bg-bg-tertiary border border-border-default px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary disabled:opacity-50"
      />
    </label>
  );
}

export function BfReceiverPanel() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const connected = !!selectedProtocol;
  const { isArmed, lockMessage } = useArmedLock();
  const channels = useFreshTelemetry("rc")?.channels ?? [];

  const [cfg, setCfg] = useState<BfRxConfig | null>(null);
  const [rxMap, setRxMap] = useState<number[]>([]);
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  // The provider the flight controller last booted with (the one read or saved
  // before this session changed it). Betaflight opens the serial receiver at
  // boot, so a saved change does nothing until the next reboot.
  const [bootProvider, setBootProvider] = useState<number | null>(null);

  const read = useCallback(async () => {
    const p = selectedProtocol;
    if (!p?.getRxConfig || !p.getRxMap) {
      setError("Receiver config is not available on this connection");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [c, m] = await Promise.all([p.getRxConfig(), p.getRxMap()]);
      setCfg(c);
      setRxMap(m);
      setBaseline(snapshot(c, m));
      setBootProvider(c.serialrxProvider);
      setHasLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedProtocol]);

  const write = useCallback(async () => {
    const p = selectedProtocol;
    if (!p?.setRxConfig || !p.setRxMap || !cfg || !isRxMapPermutation(rxMap)) return;
    setLoading(true);
    setError(null);
    try {
      const out = { ...cfg, rxMinUsec: clampPulse(cfg.rxMinUsec), rxMaxUsec: clampPulse(cfg.rxMaxUsec) };
      const r1 = await p.setRxConfig(out);
      const r2 = await p.setRxMap(rxMap);
      if (r1.success && r2.success) {
        setCfg(out);
        setBaseline(snapshot(out, rxMap));
      } else setError(r1.message || r2.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedProtocol, cfg, rxMap]);

  const updateCfg = (patch: Partial<BfRxConfig>) => setCfg((prev) => (prev ? { ...prev, ...patch } : prev));
  const dirty = hasLoaded && cfg !== null && snapshot(cfg, rxMap) !== baseline;
  useUnsavedGuard(dirty);
  const disabled = loading || isArmed;
  const rxMapValid = isRxMapPermutation(rxMap);
  const narrowPulseWindow = cfg !== null && (cfg.rxMinUsec > DEFAULT_RX_MIN_USEC || cfg.rxMaxUsec < DEFAULT_RX_MAX_USEC);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <PanelHeader
        title="Receiver"
        subtitle="Betaflight RC input, receiver config, and channel map"
        icon={<Radio size={16} />}
        loading={loading}
        loadProgress={null}
        hasLoaded={hasLoaded}
        onRead={read}
        connected={connected}
        error={error}
      >
        {hasLoaded && (
          <Button
            variant="primary" size="sm" icon={<Upload size={12} />} loading={loading}
            disabled={!connected || !dirty || disabled || !rxMapValid}
            title={isArmed ? lockMessage : undefined}
            onClick={write}
          >
            Write to FC
          </Button>
        )}
      </PanelHeader>

      {/* Live channels */}
      <div className="space-y-1">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Live channels</h3>
        {channels.length === 0 ? (
          <p className="text-[11px] text-text-tertiary">No live RC data. Check the transmitter and the link.</p>
        ) : (
          channels.slice(0, 18).map((v, i) => (
            <RcChannelBar key={i} index={i} value={v} min={1000} max={2000} trim={cfg?.midrc ?? 1500} dz={0} />
          ))
        )}
      </div>

      {hasLoaded && cfg && (
        <>
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Configuration</h3>
            <div className="w-56">
              <span className="text-[10px] text-text-tertiary font-mono">Serial RX provider</span>
              <Select options={PROVIDER_OPTIONS} value={String(cfg.serialrxProvider)} onChange={(v) => updateCfg({ serialrxProvider: parseInt(v) })} disabled={disabled} searchable />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-w-2xl">
              <NumField label="Valid pulse min (µs)" value={cfg.rxMinUsec} min={PULSE_LIMIT_MIN} max={PULSE_LIMIT_MAX} disabled={disabled} onChange={(v) => updateCfg({ rxMinUsec: v })} />
              <NumField label="Stick center (µs)" value={cfg.midrc} disabled={disabled} onChange={(v) => updateCfg({ midrc: v })} />
              <NumField label="Valid pulse max (µs)" value={cfg.rxMaxUsec} min={PULSE_LIMIT_MIN} max={PULSE_LIMIT_MAX} disabled={disabled} onChange={(v) => updateCfg({ rxMaxUsec: v })} />
              <NumField label="Min check (µs)" value={cfg.mincheck} disabled={disabled} onChange={(v) => updateCfg({ mincheck: v })} />
              <NumField label="Max check (µs)" value={cfg.maxcheck} disabled={disabled} onChange={(v) => updateCfg({ maxcheck: v })} />
              <NumField label="Spektrum sat bind" value={cfg.spektrumSatBind} disabled={disabled} onChange={(v) => updateCfg({ spektrumSatBind: v })} />
              <NumField label="FPV cam angle (°)" value={cfg.fpvCamAngle} disabled={disabled} onChange={(v) => updateCfg({ fpvCamAngle: v })} />
              <NumField label="Air-mode threshold (%)" value={cfg.airModeThresholdPct} disabled={disabled} onChange={(v) => updateCfg({ airModeThresholdPct: v })} />
            </div>
            <p className={narrowPulseWindow ? "text-[11px] text-status-warning max-w-2xl" : "text-[11px] text-text-tertiary max-w-2xl"}>
              Pulses outside the valid pulse window are treated as signal loss and can trigger failsafe or block arming.
              These are not stick endpoints (use Min/Max check for those). Values are limited to {PULSE_LIMIT_MIN}–{PULSE_LIMIT_MAX} µs on write
              {narrowPulseWindow ? `; this window is narrower than the ${DEFAULT_RX_MIN_USEC}–${DEFAULT_RX_MAX_USEC} µs default` : ""}.
            </p>
            <div className="w-56">
              <span className="text-[10px] text-text-tertiary font-mono">USB HID type</span>
              <Select options={USB_HID_OPTIONS} value={String(cfg.usbCdcHidType)} onChange={(v) => updateCfg({ usbCdcHidType: parseInt(v) })} disabled={disabled} />
            </div>
          </div>
          {!dirty && bootProvider !== null && cfg.serialrxProvider !== bootProvider && (
            <p className="text-[11px] text-status-warning max-w-2xl">
              Saved. The flight controller switches to the new serial RX provider when it next reboots.
            </p>
          )}

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">RC Smoothing</h3>
            <div className="w-56">
              <span className="text-[10px] text-text-tertiary font-mono">RC smoothing</span>
              <Select options={ONOFF_OPTIONS} value={String(cfg.rcSmoothing)} onChange={(v) => updateCfg({ rcSmoothing: parseInt(v) })} disabled={disabled} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-w-2xl">
              <NumField label="Setpoint cutoff (Hz, 0=auto)" value={cfg.rcSmoothingSetpointCutoff} disabled={disabled} onChange={(v) => updateCfg({ rcSmoothingSetpointCutoff: v })} />
              <NumField label="Throttle cutoff (Hz, 0=auto)" value={cfg.rcSmoothingThrottleCutoff} disabled={disabled} onChange={(v) => updateCfg({ rcSmoothingThrottleCutoff: v })} />
              <NumField label="Auto factor RPY" value={cfg.rcSmoothingAutoFactorRpy} disabled={disabled} onChange={(v) => updateCfg({ rcSmoothingAutoFactorRpy: v })} />
              <NumField label="Auto factor throttle" value={cfg.rcSmoothingAutoFactorThrottle} disabled={disabled} onChange={(v) => updateCfg({ rcSmoothingAutoFactorThrottle: v })} />
            </div>
          </div>

          {rxMap.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Channel map</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-2xl">
                {rxMap.map((ch, i) => (
                  <label key={i} className="flex flex-col gap-1">
                    <span className="text-[10px] text-text-tertiary font-mono">{RX_MAP_CHANNELS[i] ?? `Ch ${i}`}</span>
                    <input
                      type="number" min={0} max={rxMap.length - 1} value={ch < 0 ? "" : ch} disabled={disabled}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        setRxMap((prev) => prev.map((x, idx) => (idx === i ? (Number.isNaN(v) ? -1 : v) : x)));
                      }}
                      className="bg-bg-tertiary border border-border-default px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary disabled:opacity-50"
                    />
                  </label>
                ))}
              </div>
              {!rxMapValid && (
                <p className="text-[11px] text-status-warning max-w-2xl">
                  Each input channel 0–{rxMap.length - 1} must be assigned exactly once before the map can be written.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
