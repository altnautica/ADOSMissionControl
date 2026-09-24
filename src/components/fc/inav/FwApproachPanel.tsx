/**
 * @module FwApproachPanel
 * @description iNav fixed-wing approach configuration editor. Reads every
 * approach slot the flight controller reports (each by index) and edits them
 * in place; nothing is shown that the FC did not return. Only relevant on
 * fixed-wing platforms.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { Select } from "@/components/ui/select";
import { Plane } from "lucide-react";
import type { INavFwApproach } from "@/lib/protocol/msp/msp-decoders-inav";

// platformType 0 = MULTIROTOR. FW Approach is only relevant for non-multirotor platforms.
const PLATFORM_MULTIROTOR = 0;

/** iNav `fwAutolandApproachDirection_e`: the side of the runway the approach turns from. */
const DIRECTION_OPTIONS = [
  { value: "0", label: "Left" },
  { value: "1", label: "Right" },
];

/** Land headings are degrees: 0 disables one, a negative heading makes it exclusive. */
const HEADING_MIN = -360;
const HEADING_MAX = 360;

export function FwApproachPanel() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const connected = !!selectedProtocol;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [platformType, setPlatformType] = useState<number | null>(null);
  // The slots as the FC last reported (or accepted) them, and the edited copy.
  const [fcSlots, setFcSlots] = useState<INavFwApproach[] | null>(null);
  const [slots, setSlots] = useState<INavFwApproach[]>([]);

  const { isArmed, lockMessage } = useArmedLock();

  const dirtySlots = useMemo(
    () => new Set(slots.flatMap((s, i) => (JSON.stringify(s) !== JSON.stringify(fcSlots?.[i]) ? [i] : []))),
    [slots, fcSlots],
  );
  useUnsavedGuard(dirtySlots.size > 0);

  useEffect(() => {
    const protocol = selectedProtocol;
    if (!protocol?.getMixerConfig) return;
    protocol.getMixerConfig().then((m) => {
      setPlatformType(m.platformType);
    }).catch(() => {
      // Leave platformType null on unsupported firmware.
    });
  }, [selectedProtocol]);

  const handleRead = useCallback(async () => {
    const protocol = selectedProtocol;
    if (!protocol?.getFwApproach) { setError("FW approach config not available on this firmware"); return; }
    setLoading(true); setError(null);
    try {
      const data = await protocol.getFwApproach();
      setFcSlots(data.map((s) => ({ ...s })));
      setSlots(data.map((s) => ({ ...s })));
    } catch (err) {
      // A failed read shows nothing rather than invented slots.
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedProtocol]);

  function updateSlot<K extends keyof INavFwApproach>(idx: number, key: K, value: INavFwApproach[K]) {
    setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, [key]: value } : s)));
  }

  const handleSave = useCallback(async (idx: number) => {
    const protocol = selectedProtocol;
    if (!protocol?.setFwApproach) { setError("FW approach write not available on this firmware"); return; }
    const slot = slots[idx];
    if ([slot.landHeading1, slot.landHeading2].some((h) => h < HEADING_MIN || h > HEADING_MAX)) {
      setError(`Land headings must be ${HEADING_MIN} to ${HEADING_MAX}`);
      return;
    }
    setSavingIdx(idx); setError(null);
    try {
      const result = await protocol.setFwApproach(slot);
      if (!result.success) { setError(result.message); return; }
      setFcSlots((prev) => prev && prev.map((s, i) => (i === idx ? { ...slot } : s)));
    } catch (err) {
      setError(String(err));
    } finally {
      setSavingIdx(null);
    }
  }, [selectedProtocol, slots]);

  const isMultirotor = platformType === PLATFORM_MULTIROTOR;
  const hasLoaded = fcSlots !== null;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        {isMultirotor && (
          <p className="text-[11px] text-text-tertiary border border-border-default rounded px-3 py-2 bg-bg-secondary">
            This panel applies to fixed-wing and tricopter platforms. The connected flight controller is configured as a multirotor.
          </p>
        )}
        <PanelHeader
          title="FW Approach"
          subtitle="Fixed-wing landing approach configuration, one slot per approach the flight controller holds."
          icon={<Plane size={16} />}
          loading={loading}
          loadProgress={null}
          hasLoaded={hasLoaded}
          onRead={handleRead}
          connected={connected}
          error={error}
        />

        {hasLoaded && !isMultirotor && (
          <div className="space-y-4">
            {slots.map((slot, idx) => (
              <div key={slot.number} className="border border-border-default rounded p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-text-primary">
                    Approach {slot.number}
                    {dirtySlots.has(idx) && <span className="ml-2 text-[10px] font-mono text-status-warning">unsaved</span>}
                  </span>
                  <button
                    onClick={() => handleSave(idx)}
                    disabled={savingIdx === idx || isArmed || !dirtySlots.has(idx)}
                    title={isArmed ? lockMessage : undefined}
                    className="text-[11px] px-3 py-1 border border-accent-primary text-accent-primary rounded hover:bg-accent-primary/10 disabled:opacity-50"
                  >
                    {savingIdx === idx ? "Saving..." : "Save"}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <NumInput label="Approach alt (cm)" value={slot.approachAlt} onChange={(v) => updateSlot(idx, "approachAlt", v)} />
                  <NumInput label="Land alt (cm)" value={slot.landAlt} onChange={(v) => updateSlot(idx, "landAlt", v)} />
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-text-secondary">Approach direction</span>
                    <Select
                      label=""
                      options={DIRECTION_OPTIONS}
                      value={String(slot.approachDirection)}
                      onChange={(v) => updateSlot(idx, "approachDirection", parseInt(v, 10))}
                    />
                  </div>
                  <NumInput label="Land heading 1 (deg, 0 = off)" value={slot.landHeading1} min={HEADING_MIN} max={HEADING_MAX} onChange={(v) => updateSlot(idx, "landHeading1", v)} />
                  <NumInput label="Land heading 2 (deg, 0 = off)" value={slot.landHeading2} min={HEADING_MIN} max={HEADING_MAX} onChange={(v) => updateSlot(idx, "landHeading2", v)} />
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-text-secondary">Altitude reference</span>
                    <button
                      onClick={() => updateSlot(idx, "isSeaLevelRef", !slot.isSeaLevelRef)}
                      className={`text-[11px] px-3 py-1 rounded border ${
                        slot.isSeaLevelRef
                          ? "border-accent-primary bg-accent-primary/20 text-accent-primary"
                          : "border-border-default text-text-secondary"
                      }`}
                    >
                      {slot.isSeaLevelRef ? "Sea level" : "Relative to home"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inline numeric input ──────────────────────────────────────

function NumInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-text-secondary">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        className="w-full bg-bg-tertiary border border-border-default rounded px-2 py-1 text-[11px] text-text-primary font-mono"
      />
    </div>
  );
}
