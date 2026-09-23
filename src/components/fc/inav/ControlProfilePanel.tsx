/**
 * @module ControlProfilePanel
 * @description iNav control profile switcher. Reads the profile the FC is
 * flying from MSP2_INAV_STATUS and switches with MSP_SELECT_SETTING, showing
 * the profile the FC reports afterwards rather than the one requested.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useState } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { PanelHeader } from "../shared/PanelHeader";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Gauge } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────

interface ControlProfileInfo {
  activeProfile: number;
  profileCount: number;
}

const PROFILE_OPTIONS = [
  { value: "0", label: "Control profile 1" },
  { value: "1", label: "Control profile 2" },
  { value: "2", label: "Control profile 3" },
];

// ── Component ─────────────────────────────────────────────────

export function ControlProfilePanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const connected = !!getSelectedProtocol();

  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<ControlProfileInfo>({ activeProfile: 0, profileCount: 3 });
  const [pendingProfile, setPendingProfile] = useState<number | null>(null);

  const { isArmed } = useArmedLock();

  const handleRead = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol?.getActiveProfiles) { setError("Control profiles are not available on this firmware"); return; }
    setLoading(true); setError(null);
    try {
      const { controlProfile } = await protocol.getActiveProfiles();
      setInfo({ activeProfile: controlProfile, profileCount: 3 });
      setHasLoaded(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [getSelectedProtocol]);

  const handleSwitchRequested = useCallback((idx: number) => {
    if (idx === info.activeProfile) return;
    setPendingProfile(idx);
  }, [info.activeProfile]);

  const handleSwitchConfirm = useCallback(async () => {
    const idx = pendingProfile;
    setPendingProfile(null);
    if (idx === null) return;
    const protocol = getSelectedProtocol();
    if (!protocol?.selectControlProfile || !protocol.getActiveProfiles) {
      setError("Control profiles are not available on this firmware");
      return;
    }
    setLoading(true); setError(null);
    try {
      const result = await protocol.selectControlProfile(idx);
      if (!result.success) { setError(result.message); return; }
      const { controlProfile } = await protocol.getActiveProfiles();
      setInfo((prev) => ({ ...prev, activeProfile: controlProfile }));
      if (controlProfile !== idx) setError(`The flight controller stayed on control profile ${controlProfile + 1}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [getSelectedProtocol, pendingProfile]);

  const handleSwitchCancel = useCallback(() => {
    setPendingProfile(null);
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        <PanelHeader
          title="Control Profiles"
          subtitle="Switch the active rate and control profile"
          icon={<Gauge size={16} />}
          loading={loading}
          loadProgress={null}
          hasLoaded={hasLoaded}
          onRead={handleRead}
          connected={connected}
          error={error}
        />

        {hasLoaded && (
          <div className="border border-border-default rounded p-4 space-y-3">
            <p className="text-[11px] text-text-secondary">
              iNav supports up to 3 control profiles. Switching takes effect immediately on the FC.
            </p>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-text-tertiary font-mono">Active control profile</span>
              <Select
                label=""
                options={PROFILE_OPTIONS.slice(0, info.profileCount)}
                value={String(info.activeProfile)}
                disabled={isArmed}
                onChange={(v) => handleSwitchRequested(parseInt(v))}
              />
            </div>
          </div>
        )}
        <ConfirmDialog
          open={pendingProfile !== null}
          title="Switch active control profile?"
          message={
            pendingProfile !== null
              ? `This switches the active profile on the flight controller immediately. The new profile starts with its own PID, rates, and RC-tuning values. Current flight behavior may change. Switching to profile ${pendingProfile + 1}.`
              : ""
          }
          confirmLabel="Switch profile"
          cancelLabel="Cancel"
          variant="primary"
          onConfirm={handleSwitchConfirm}
          onCancel={handleSwitchCancel}
        />
      </div>
    </div>
  );
}
