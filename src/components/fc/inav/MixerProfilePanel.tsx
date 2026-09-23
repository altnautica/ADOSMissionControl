/**
 * @module MixerProfilePanel
 * @description iNav mixer profile viewer, switcher, and motor/servo mixer CRUD editor.
 * Shows the current mixer configuration and lets the operator select a different
 * mixer profile, then edit motor and servo mixer rules directly. The motor and
 * servo tables live in dedicated sub-components.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useState } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useMixerStore } from "@/stores/mixer-store";
import { PanelHeader } from "../shared/PanelHeader";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Settings2, Upload } from "lucide-react";
import type { INavMixer } from "@/lib/protocol/msp/msp-decoders-inav";
import { MotorMixerTable } from "./MotorMixerTable";
import { ServoMixerTable } from "./ServoMixerTable";

const PLATFORM_LABELS: Record<number, string> = {
  0: "Multirotor",
  1: "Airplane",
  2: "Helicopter",
  3: "Tricopter",
  4: "Rover",
  5: "Boat",
};

const PROFILE_OPTIONS = [
  { value: "0", label: "Mixer profile 1" },
  { value: "1", label: "Mixer profile 2" },
];

export function MixerProfilePanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const connected = !!getSelectedProtocol();

  const [profileLoading, setProfileLoading] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [mixer, setMixer] = useState<INavMixer | null>(null);
  /** The mixer profile the FC reports it is flying; null when unknown. */
  const [activeProfile, setActiveProfile] = useState<number | null>(null);
  /** The tables in the editor were read before a profile switch and belong to
   *  the previous profile until they are re-read. */
  const [tablesStale, setTablesStale] = useState(false);

  const mixerLoading = useMixerStore((s) => s.loading);
  const mixerError = useMixerStore((s) => s.error);
  const dirty = useMixerStore((s) => s.dirty);
  const mixerLoaded = useMixerStore((s) => s.loaded);

  const { loadFromFc, uploadToFc } = useMixerStore.getState();

  const { isArmed, lockMessage } = useArmedLock();
  useUnsavedGuard(dirty);

  const handleRead = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol?.getMixerConfig || !protocol.getActiveProfiles) {
      setProfileError("Mixer config not supported");
      return;
    }
    setProfileLoading(true);
    setProfileError(null);
    try {
      const [data, profiles] = await Promise.all([protocol.getMixerConfig(), protocol.getActiveProfiles()]);
      setMixer(data);
      setActiveProfile(profiles.mixerProfile);
      setProfileLoaded(true);
    } catch (err) {
      setProfileError(String(err));
    } finally {
      setProfileLoading(false);
    }
  }, [getSelectedProtocol]);

  const handleSwitchProfile = useCallback(
    async (idx: number) => {
      const protocol = getSelectedProtocol();
      if (!protocol?.selectMixerProfile || !protocol.getMixerConfig || !protocol.getActiveProfiles) {
        setProfileError("Mixer profile switch not supported");
        return;
      }
      setProfileLoading(true);
      setProfileError(null);
      try {
        const result = await protocol.selectMixerProfile(idx);
        if (!result.success) {
          setProfileError(result.message);
          return;
        }
        // The FC's current mixer tables are now the new profile's, so the
        // editor's copy may not be written back until it has been re-read.
        setTablesStale(true);
        const [data, profiles] = await Promise.all([protocol.getMixerConfig(), protocol.getActiveProfiles()]);
        setMixer(data);
        setActiveProfile(profiles.mixerProfile);
        if (profiles.mixerProfile !== idx) {
          setProfileError(
            profiles.mixerProfile === null
              ? "The flight controller did not report its mixer profile after the switch"
              : `The flight controller stayed on mixer profile ${profiles.mixerProfile + 1}`,
          );
        }
        await loadFromFc(protocol);
        if (useMixerStore.getState().error === null) setTablesStale(false);
      } catch (err) {
        setProfileError(String(err));
      } finally {
        setProfileLoading(false);
      }
    },
    [getSelectedProtocol, loadFromFc],
  );

  const handleMixerRead = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol) return;
    await loadFromFc(protocol);
    if (useMixerStore.getState().error === null) setTablesStale(false);
  }, [getSelectedProtocol, loadFromFc]);

  const handleMixerWrite = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol) return;
    await uploadToFc(protocol);
  }, [getSelectedProtocol, uploadToFc]);

  const platformLabel = mixer
    ? PLATFORM_LABELS[mixer.platformType] ?? `Type ${mixer.platformType}`
    : "";
  const loading = profileLoading || mixerLoading;
  const error = profileError || mixerError;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl space-y-6">
        <PanelHeader
          title="Mixer Profiles"
          subtitle="Platform type, motor and servo counts"
          icon={<Settings2 size={16} />}
          loading={profileLoading}
          loadProgress={null}
          hasLoaded={profileLoaded}
          onRead={handleRead}
          connected={connected}
          error={profileError}
        />

        {profileLoaded && mixer && (
          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-text-tertiary font-mono">Active mixer profile</span>
              <Select
                label=""
                options={PROFILE_OPTIONS}
                value={activeProfile === null ? "" : String(activeProfile)}
                placeholder="Not reported by the FC"
                disabled={isArmed}
                onChange={(v) => handleSwitchProfile(parseInt(v))}
              />
            </div>
            <div className="border border-border-default rounded p-3 space-y-2">
              <p className="text-[10px] font-mono text-text-tertiary uppercase tracking-wide">
                Active mixer info
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <span className="text-text-tertiary">Platform</span>
                <span className="text-text-primary">{platformLabel}</span>
                <span className="text-text-tertiary">Motor slots (FC max)</span>
                <span className="text-text-primary">{mixer.maxSupportedMotors}</span>
                <span className="text-text-tertiary">Servo slots (FC max)</span>
                <span className="text-text-primary">{mixer.maxSupportedServos}</span>
                <span className="text-text-tertiary">Motor direction inverted</span>
                <span className="text-text-primary">{mixer.motorDirectionInverted ? "Yes" : "No"}</span>
                <span className="text-text-tertiary">Motor stop on low</span>
                <span className="text-text-primary">{mixer.motorstopOnLow ? "Yes" : "No"}</span>
                <span className="text-text-tertiary">Has flaps</span>
                <span className="text-text-primary">{mixer.hasFlaps ? "Yes" : "No"}</span>
                <span className="text-text-tertiary">Applied preset</span>
                <span className="text-text-primary">{mixer.appliedMixerPreset}</span>
              </div>
            </div>
          </div>
        )}

        <PanelHeader
          title="Mixer Tables"
          subtitle="Motor and servo mixer rules"
          icon={<Settings2 size={16} />}
          loading={mixerLoading}
          loadProgress={null}
          hasLoaded={mixerLoaded}
          onRead={handleMixerRead}
          connected={connected}
          error={mixerError}
        >
          {mixerLoaded && (
            <Button
              variant="primary"
              size="sm"
              icon={<Upload size={12} />}
              loading={loading}
              disabled={!connected || loading || isArmed || tablesStale}
              title={
                isArmed
                  ? lockMessage
                  : tablesStale
                    ? "The mixer profile changed: read the tables again before writing"
                    : undefined
              }
              onClick={handleMixerWrite}
            >
              Write to FC
            </Button>
          )}
        </PanelHeader>

        {error && !profileError && (
          <p className="text-[10px] font-mono text-status-error">{error}</p>
        )}

        {tablesStale && (
          <p className="text-[10px] font-mono text-status-warning">
            The mixer profile changed and the tables below were read from the previous profile. Read them
            again before writing.
          </p>
        )}

        {dirty && (
          <p className="text-[10px] font-mono text-status-warning">
            Unsaved changes: use Write to FC to persist.
          </p>
        )}

        {mixerLoaded && (
          <>
            <MotorMixerTable isArmed={isArmed} lockMessage={lockMessage} />
            <ServoMixerTable isArmed={isArmed} lockMessage={lockMessage} />
          </>
        )}
      </div>
    </div>
  );
}
