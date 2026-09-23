"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDroneManager } from "@/stores/drone-manager";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import type { MspModeBox, MspModeRange } from "@/lib/protocol/types";
import { PanelHeader } from "../shared/PanelHeader";
import { ToggleRight, Save, Plus, Trash2, Radio } from "lucide-react";
import { PwmRangeSlider, stepToPwm, pwmToStep } from "./PwmRangeSlider";

// ── Constants ─────────────────────────────────────────────────

const AUX_CHANNEL_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i),
  label: `AUX ${i + 1}`,
}));

const MAX_RANGES = 20;

/** A slot is in use when it has a PWM window or follows another mode. */
const isConfigured = (r: MspModeRange) => r.rangeStart < r.rangeEnd || (r.linkedTo ?? 0) > 0;

function AuxCard({ icon, title, description, children }: {
  icon: React.ReactNode; title: string; description: string; children: React.ReactNode;
}) {
  return (
    <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-accent-primary">{icon}</span>
        <div>
          <h2 className="text-sm font-medium text-text-primary">{title}</h2>
          <p className="text-[10px] text-text-tertiary">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────

export function AuxModesPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const scrollRef = usePanelScroll("aux-modes");

  // Modes the FC offers, keyed by permanent box id (MSP_BOXNAMES + MSP_BOXIDS).
  const [boxes, setBoxes] = useState<MspModeBox[]>([]);
  const [ranges, setRanges] = useState<MspModeRange[]>([]);
  const [originalRanges, setOriginalRanges] = useState<MspModeRange[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = !!getSelectedProtocol();
  const protocolCanSave = !!getSelectedProtocol()?.setModeRanges;

  const modeName = useCallback(
    (boxId: number) => boxes.find((b) => b.id === boxId)?.name ?? `Mode ${boxId}`,
    [boxes],
  );

  const isDirty = useMemo(() => JSON.stringify(ranges) !== JSON.stringify(originalRanges), [ranges, originalRanges]);

  useUnsavedGuard(isDirty);

  // Re-renders on every RC frame and blanks once the stream goes stale.
  const latestRc = useFreshTelemetry("rc");

  const readFromFc = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol || !protocol.isConnected) { setError("Not connected to flight controller"); return; }
    if (!protocol.getModeBoxes || !protocol.getModeRanges) {
      setError("Mode ranges are not available on this connection");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [fcBoxes, slots] = await Promise.all([protocol.getModeBoxes(), protocol.getModeRanges()]);
      const loaded = slots.filter(isConfigured);
      setBoxes(fcBoxes);
      setRanges(loaded);
      setOriginalRanges(loaded.map((r) => ({ ...r })));
      setHasLoaded(true);
      toast("Loaded auxiliary mode configuration", "success");
    } catch {
      // A read failure leaves the panel empty and unloaded; nothing is
      // adopted as the vehicle's configuration.
      setError("Could not read mode ranges from the flight controller");
      toast("Could not read mode ranges — nothing loaded", "error");
    } finally { setLoading(false); }
  }, [getSelectedProtocol, toast]);

  const readRef = useRef(readFromFc);
  readRef.current = readFromFc;
  useEffect(() => { readRef.current(); }, []);

  const saveToFc = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol || !protocol.isConnected || !protocol.setModeRanges) return;
    setSaving(true);
    try {
      const result = await protocol.setModeRanges(ranges);
      if (result.success) {
        setOriginalRanges(ranges.map((r) => ({ ...r })));
        toast("Mode ranges saved to the flight controller", "success");
      } else {
        toast(result.message || "Failed to save mode ranges", "error");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save mode ranges", "error");
    } finally { setSaving(false); }
  }, [getSelectedProtocol, ranges, toast]);

  const addRange = useCallback((boxId: number) => {
    if (ranges.length >= MAX_RANGES) { toast(`Maximum ranges reached (${MAX_RANGES})`, "warning"); return; }
    setRanges((prev) => [...prev, { boxId, auxChannel: 0, rangeStart: 1700, rangeEnd: 2100, modeLogic: 0, linkedTo: 0 }]);
  }, [ranges.length, toast]);

  const removeRange = useCallback((index: number) => { setRanges((prev) => prev.filter((_, i) => i !== index)); }, []);

  const updateRange = useCallback((index: number, partial: Partial<MspModeRange>) => {
    setRanges((prev) => { const next = [...prev]; next[index] = { ...next[index], ...partial }; return next; });
  }, []);

  const rangesByMode = useMemo(() => {
    const map = new Map<number, { range: MspModeRange; index: number }[]>();
    ranges.forEach((range, index) => {
      const list = map.get(range.boxId) ?? [];
      list.push({ range, index });
      map.set(range.boxId, list);
    });
    return map;
  }, [ranges]);

  const allModes = useMemo(() => {
    const activeBoxIds = new Set(ranges.map((r) => r.boxId));
    const active = Array.from(activeBoxIds).sort((a, b) => a - b);
    const inactive = boxes.filter((b) => !activeBoxIds.has(b.id));
    return { active, inactive };
  }, [ranges, boxes]);

  const addModeOptions = useMemo(
    () => allModes.inactive.map((b) => ({ value: String(b.id), label: b.name })),
    [allModes.inactive],
  );

  const [addModeId, setAddModeId] = useState<string>("");
  const selectedAddMode = addModeOptions.some((o) => o.value === addModeId) ? addModeId : addModeOptions[0]?.value ?? "";

  return (
    <ArmedWarningBanner>
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
                return (
                  <AuxCard key={boxId} icon={<ToggleRight size={14} />} title={modeName(boxId)} description={`Box ID ${boxId}`}>
                    <div className="space-y-3">
                      {modeRanges.map(({ range, index }) => (
                        <div key={index} className="space-y-2">
                          {(range.linkedTo ?? 0) > 0 ? (
                            <div className="flex items-center gap-3 text-xs text-text-secondary">
                              <span className="flex-1">Follows {modeName(range.linkedTo ?? 0)}</span>
                              <Button variant="ghost" size="sm" icon={<Trash2 size={12} />} onClick={() => removeRange(index)} />
                            </div>
                          ) : (
                            <div className="flex items-center gap-3">
                              <div className="w-28">
                                <Select label="Channel" options={AUX_CHANNEL_OPTIONS} value={String(range.auxChannel)}
                                  onChange={(v) => updateRange(index, { auxChannel: Number(v) })} />
                              </div>
                              <div className="flex-1 space-y-1">
                                <div className="flex justify-between text-[10px] text-text-secondary">
                                  <span>{range.rangeStart} µs</span>
                                  <span>{range.rangeEnd} µs</span>
                                </div>
                                <PwmRangeSlider start={pwmToStep(range.rangeStart)} end={pwmToStep(range.rangeEnd)}
                                  onChange={(start, end) => updateRange(index, { rangeStart: stepToPwm(start), rangeEnd: stepToPwm(end) })}
                                  activePwm={latestRc?.channels[range.auxChannel + 4]} />
                              </div>
                              <Button variant="ghost" size="sm" icon={<Trash2 size={12} />} onClick={() => removeRange(index)} />
                            </div>
                          )}
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
                  <Select label="Mode" options={addModeOptions} value={selectedAddMode} onChange={setAddModeId} searchable searchPlaceholder="Search modes..." />
                </div>
                <Button variant="secondary" size="sm" icon={<Plus size={12} />} onClick={() => addRange(Number(selectedAddMode))}
                  disabled={ranges.length >= MAX_RANGES}>Add</Button>
              </div>
            </AuxCard>
          )}

          {hasLoaded && allModes.active.length === 0 && (
            <div className="text-center py-8 text-text-tertiary text-xs">No mode ranges configured. Add a mode above to get started.</div>
          )}

          <div className="flex items-center gap-3 pt-2 pb-4">
            <Button variant="primary" size="lg" icon={<Save size={14} />} disabled={!isDirty || !connected || !protocolCanSave} loading={saving} onClick={saveToFc}>
              Save to Flight Controller
            </Button>
            {!protocolCanSave && connected && <span className="text-[10px] text-text-tertiary">This connection cannot write mode ranges</span>}
            {!connected && <span className="text-[10px] text-text-tertiary">Connect a drone to save parameters</span>}
            {isDirty && connected && <span className="text-[10px] text-status-warning">Unsaved changes</span>}
          </div>
        </div>
      </div>
    </ArmedWarningBanner>
  );
}
