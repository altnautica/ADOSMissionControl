"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDroneManager } from "@/stores/drone-manager";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { ArmedLockOverlay } from "@/components/indicators/ArmedLockOverlay";
import { PanelHeader } from "../shared/PanelHeader";
import { ToggleRight, Save, HardDrive, Plus, Trash2, Radio } from "lucide-react";
import { AuxRangeSlider, AuxCard, stepToPwm, pwmToStep } from "./AuxRangeSlider";

// ── Types ─────────────────────────────────────────────────────

interface ModeRange {
  boxId: number;
  auxChannel: number;
  rangeStart: number;
  rangeEnd: number;
}

// ── Constants ─────────────────────────────────────────────────

const AUX_CHANNEL_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i),
  label: `AUX ${i + 1}`,
}));

const DEFAULT_MODE_NAMES = [
  "ARM", "ANGLE", "HORIZON", "ANTI GRAVITY", "MAG", "HEADFREE",
  "HEADADJ", "CAMSTAB", "PASSTHRU", "BEEPERON", "LEDLOW",
  "CALIB", "OSD", "TELEMETRY", "SERVO1", "SERVO2", "SERVO3",
  "BLACKBOX", "FAILSAFE", "AIRMODE", "3D", "FPV ANGLE MIX",
  "BLACKBOX ERASE", "CAMERA CONTROL 1", "CAMERA CONTROL 2",
  "CAMERA CONTROL 3", "FLIPOVERAFTERCRASH", "PREARM",
  "BEEP GPS SATELLITE COUNT", "VTX PIT MODE", "USER1", "USER2",
  "USER3", "USER4", "PID AUDIO", "PARALYZE", "GPS RESCUE",
  "ACRO TRAINER", "VTX CONTROL DISABLE", "LAUNCH CONTROL",
  "MSP OVERRIDE", "STICK COMMANDS DISABLE", "BEEPER MUTE",
];

const MAX_RANGES = 20;

// ── Component ─────────────────────────────────────────────────

export function AuxModesPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const { firmwareType } = useFirmwareCapabilities();
  const scrollRef = usePanelScroll("aux-modes");

  const [modeNames] = useState<string[]>(DEFAULT_MODE_NAMES);
  const [ranges, setRanges] = useState<ModeRange[]>([]);
  const [originalRanges, setOriginalRanges] = useState<ModeRange[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFlash, setShowFlash] = useState(false);

  const connected = !!getSelectedProtocol();

  const isDirty = useMemo(() => {
    if (ranges.length !== originalRanges.length) return true;
    return ranges.some((r, i) => {
      const o = originalRanges[i];
      return r.boxId !== o.boxId || r.auxChannel !== o.auxChannel || r.rangeStart !== o.rangeStart || r.rangeEnd !== o.rangeEnd;
    });
  }, [ranges, originalRanges]);

  useUnsavedGuard(isDirty);

  const rcBuffer = useTelemetryStore((s) => s.rc);
  const latestRc = rcBuffer.latest();

  const readFromFc = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol || !protocol.isConnected) { setError("Not connected to flight controller"); return; }
    setLoading(true);
    setError(null);
    try {
      const boxNamesResult = await protocol.getParameter("BF_BOX_NAMES");
      void boxNamesResult;
      const rangeResult = await protocol.getParameter("BF_MODE_RANGE_COUNT");
      const rangeCount = rangeResult.value >= 0 ? rangeResult.value : MAX_RANGES;
      const loadedRanges: ModeRange[] = [];
      for (let i = 0; i < rangeCount; i++) {
        try {
          const boxIdResult = await protocol.getParameter(`BF_MODE_RANGE_${i}_BOX_ID`);
          const auxResult = await protocol.getParameter(`BF_MODE_RANGE_${i}_AUX`);
          const startResult = await protocol.getParameter(`BF_MODE_RANGE_${i}_START`);
          const endResult = await protocol.getParameter(`BF_MODE_RANGE_${i}_END`);
          if (boxIdResult.value >= 0 && startResult.value < endResult.value) {
            loadedRanges.push({ boxId: boxIdResult.value, auxChannel: auxResult.value, rangeStart: startResult.value, rangeEnd: endResult.value });
          }
        } catch { /* Skip unreadable ranges */ }
      }
      setRanges(loadedRanges);
      setOriginalRanges(loadedRanges.map((r) => ({ ...r })));
      setHasLoaded(true);
      toast("Loaded auxiliary mode configuration", "success");
    } catch {
      const demoRanges: ModeRange[] = [
        { boxId: 0, auxChannel: 0, rangeStart: pwmToStep(1700), rangeEnd: pwmToStep(2100) },
        { boxId: 1, auxChannel: 1, rangeStart: pwmToStep(1300), rangeEnd: pwmToStep(1700) },
        { boxId: 19, auxChannel: 0, rangeStart: pwmToStep(900), rangeEnd: pwmToStep(2100) },
        { boxId: 36, auxChannel: 2, rangeStart: pwmToStep(1800), rangeEnd: pwmToStep(2100) },
      ];
      setRanges(demoRanges);
      setOriginalRanges(demoRanges.map((r) => ({ ...r })));
      setHasLoaded(true);
      toast("Loaded default mode ranges (unable to read from FC)", "info");
    } finally { setLoading(false); }
  }, [getSelectedProtocol, toast]);

  const readRef = useRef(readFromFc);
  readRef.current = readFromFc;
  useEffect(() => { readRef.current(); }, []);

  const saveToFc = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol || !protocol.isConnected) return;
    setSaving(true);
    try {
      for (let i = 0; i < MAX_RANGES; i++) {
        const range = ranges[i];
        if (range) {
          await protocol.setParameter(`BF_MODE_RANGE_${i}_BOX_ID`, range.boxId);
          await protocol.setParameter(`BF_MODE_RANGE_${i}_AUX`, range.auxChannel);
          await protocol.setParameter(`BF_MODE_RANGE_${i}_START`, range.rangeStart);
          await protocol.setParameter(`BF_MODE_RANGE_${i}_END`, range.rangeEnd);
        } else {
          await protocol.setParameter(`BF_MODE_RANGE_${i}_BOX_ID`, 0);
          await protocol.setParameter(`BF_MODE_RANGE_${i}_AUX`, 0);
          await protocol.setParameter(`BF_MODE_RANGE_${i}_START`, 0);
          await protocol.setParameter(`BF_MODE_RANGE_${i}_END`, 0);
        }
      }
      setOriginalRanges(ranges.map((r) => ({ ...r })));
      setShowFlash(true);
      toast("Saved to flight controller", "success");
    } catch { toast("Failed to save mode ranges", "error"); }
    finally { setSaving(false); }
  }, [getSelectedProtocol, ranges, toast]);

  const commitFlash = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol || !protocol.isConnected) return;
    try {
      const result = await protocol.commitParamsToFlash();
      if (result.success) { setShowFlash(false); toast("Written to flash", "success"); }
      else { toast("Failed to write to flash", "error"); }
    } catch { toast("Failed to write to flash", "error"); }
  }, [getSelectedProtocol, toast]);

  const addRange = useCallback((boxId: number) => {
    if (ranges.length >= MAX_RANGES) { toast("Maximum ranges reached (20)", "warning"); return; }
    setRanges((prev) => [...prev, { boxId, auxChannel: 0, rangeStart: pwmToStep(1700), rangeEnd: pwmToStep(2100) }]);
  }, [ranges.length, toast]);

  const removeRange = useCallback((index: number) => { setRanges((prev) => prev.filter((_, i) => i !== index)); }, []);

  const updateRange = useCallback((index: number, partial: Partial<ModeRange>) => {
    setRanges((prev) => { const next = [...prev]; next[index] = { ...next[index], ...partial }; return next; });
  }, []);

  const rangesByMode = useMemo(() => {
    const map = new Map<number, { range: ModeRange; index: number }[]>();
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      const list = map.get(r.boxId) ?? [];
      list.push({ range: r, index: i });
      map.set(r.boxId, list);
    }
    return map;
  }, [ranges]);

  const allModes = useMemo(() => {
    const activeBoxIds = new Set(ranges.map((r) => r.boxId));
    const active = Array.from(activeBoxIds).sort((a, b) => a - b);
    const inactive = modeNames.map((_, i) => i).filter((i) => !activeBoxIds.has(i));
    return { active, inactive };
  }, [ranges, modeNames]);

  const addModeOptions = useMemo(
    () => allModes.inactive.map((id) => ({ value: String(id), label: modeNames[id] ?? `Mode ${id}` })),
    [allModes.inactive, modeNames],
  );

  const [addModeId, setAddModeId] = useState("0");

  return (
    <ArmedLockOverlay>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-6">
          <PanelHeader title="Auxiliary Modes" subtitle="Configure mode activation via AUX channel PWM ranges"
            icon={<ToggleRight size={16} />} loading={loading} loadProgress={null} hasLoaded={hasLoaded}
            onRead={readFromFc} connected={connected} error={error} />

          {hasLoaded && latestRc && (
            <AuxCard icon={<Radio size={14} />} title="Live RC Channels" description="Current AUX channel PWM values">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Array.from({ length: 8 }, (_, i) => {
                  const chIndex = i + 4;
                  const pwm = latestRc.channels[chIndex] ?? 0;
                  const pct = pwm > 0 ? ((pwm - 900) / 1200) * 100 : 0;
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-text-secondary">AUX {i + 1}</span>
                        <span className="font-mono text-accent-primary tabular-nums">{pwm > 0 ? pwm : "\u2014"}</span>
                      </div>
                      <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                        <div className="h-full bg-accent-primary rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </AuxCard>
          )}

          {hasLoaded && allModes.active.length > 0 && (
            <div className="space-y-3">
              {allModes.active.map((boxId) => {
                const modeRanges = rangesByMode.get(boxId) ?? [];
                const modeName = modeNames[boxId] ?? `Mode ${boxId}`;
                return (
                  <AuxCard key={boxId} icon={<ToggleRight size={14} />} title={modeName} description={`Box ID ${boxId}`}>
                    <div className="space-y-3">
                      {modeRanges.map(({ range, index }) => (
                        <div key={index} className="space-y-2">
                          <div className="flex items-center gap-3">
                            <div className="w-28">
                              <Select label="Channel" options={AUX_CHANNEL_OPTIONS} value={String(range.auxChannel)}
                                onChange={(v) => updateRange(index, { auxChannel: Number(v) })} />
                            </div>
                            <div className="flex-1 space-y-1">
                              <div className="flex justify-between text-[10px] text-text-secondary">
                                <span>{stepToPwm(range.rangeStart)} \u00B5s</span>
                                <span>{stepToPwm(range.rangeEnd)} \u00B5s</span>
                              </div>
                              <AuxRangeSlider start={range.rangeStart} end={range.rangeEnd}
                                onChange={(start, end) => updateRange(index, { rangeStart: start, rangeEnd: end })}
                                activePwm={latestRc ? latestRc.channels[range.auxChannel + 4] ?? 0 : 0} />
                            </div>
                            <Button variant="ghost" size="sm" icon={<Trash2 size={12} />} onClick={() => removeRange(index)} />
                          </div>
                        </div>
                      ))}
                      <Button variant="ghost" size="sm" icon={<Plus size={12} />} onClick={() => addRange(boxId)}
                        disabled={ranges.length >= MAX_RANGES}>Add Range</Button>
                    </div>
                  </AuxCard>
                );
              })}
            </div>
          )}

          {hasLoaded && addModeOptions.length > 0 && (
            <AuxCard icon={<Plus size={14} />} title="Add Mode" description="Assign a new mode to an AUX channel">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Select label="Mode" options={addModeOptions} value={addModeId} onChange={setAddModeId} searchable searchPlaceholder="Search modes..." />
                </div>
                <Button variant="secondary" size="sm" icon={<Plus size={12} />} onClick={() => addRange(Number(addModeId))}
                  disabled={ranges.length >= MAX_RANGES}>Add</Button>
              </div>
            </AuxCard>
          )}

          {hasLoaded && allModes.active.length === 0 && (
            <div className="text-center py-8 text-text-tertiary text-xs">No mode ranges configured. Add a mode above to get started.</div>
          )}

          <div className="flex items-center gap-3 pt-2 pb-4">
            <Button variant="primary" size="lg" icon={<Save size={14} />} disabled={!isDirty || !connected} loading={saving} onClick={saveToFc}>
              Save to Flight Controller
            </Button>
            {showFlash && (
              <Button variant="secondary" size="lg" icon={<HardDrive size={14} />} onClick={commitFlash}>Write to Flash</Button>
            )}
            {!connected && <span className="text-[10px] text-text-tertiary">Connect a drone to save parameters</span>}
            {isDirty && connected && <span className="text-[10px] text-status-warning">Unsaved changes</span>}
          </div>
        </div>
      </div>
    </ArmedLockOverlay>
  );
}
