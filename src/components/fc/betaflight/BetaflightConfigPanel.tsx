"use client";

import { useState, useMemo, useCallback } from "react";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { PanelHeader } from "../shared/PanelHeader";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Settings,
  Save,
  HardDrive,
  ToggleRight,
  Shield,
  Bell,
} from "lucide-react";
import { bfConfigParamNames, featureDefsForApi, BEEPER_DEFS, BfCard as Card } from "./bf-config-constants";

export function BetaflightConfigPanel() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const scrollRef = usePanelScroll("bf-config");
  const [saving, setSaving] = useState(false);

  const {
    params,
    loading,
    error,
    dirtyParams,
    hasRamWrites,
    loadProgress,
    hasLoaded,
    refresh,
    setLocalValue,
    saveAllToRam,
    commitToFlash,
  } = usePanelParams({
    paramNames: bfConfigParamNames,
    panelId: "bf-config",
    autoLoad: true,
  });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!selectedProtocol;
  const hasDirty = dirtyParams.size > 0;
  const mspApi = selectedProtocol?.getVehicleInfo()?.mspApiVersion;
  const featureDefs = useMemo(() => featureDefsForApi(mspApi), [mspApi]);

  // ── Feature mask helpers ───────────────────────────────────

  const featureMask = params.get("BF_FEATURE_MASK") ?? 0;

  const toggleFeature = useCallback(
    (bit: number) => {
      const mask = 1 << bit;
      const current = params.get("BF_FEATURE_MASK") ?? 0;
      const next = current & mask ? current & ~mask : current | mask;
      setLocalValue("BF_FEATURE_MASK", next >>> 0);
    },
    [params, setLocalValue]
  );

  // ── Beeper mask helpers (inverted: bit=1 means disabled) ───

  const beeperMask = params.get("BF_BEEPER_DISABLED_MASK") ?? 0;

  const toggleBeeper = useCallback(
    (bit: number) => {
      const mask = 1 << bit;
      const current = params.get("BF_BEEPER_DISABLED_MASK") ?? 0;
      // Inverted: checking the box means the beeper is ENABLED (bit is cleared)
      const next = current & mask ? current & ~mask : current | mask;
      setLocalValue("BF_BEEPER_DISABLED_MASK", next >>> 0);
    },
    [params, setLocalValue]
  );

  // Count enabled features and beepers
  const enabledFeatureCount = useMemo(
    () => featureDefs.filter((f) => (featureMask & (1 << f.bit)) !== 0).length,
    [featureDefs, featureMask]
  );
  const enabledBeeperCount = useMemo(
    () => BEEPER_DEFS.filter((b) => (beeperMask & (1 << b.bit)) === 0).length,
    [beeperMask]
  );

  const p = (name: string, fallback = "0") =>
    String(params.get(name) ?? fallback);
  const set = (name: string, v: string) =>
    setLocalValue(name, Number(v) || 0);

  async function handleSave() {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    if (ok) toast("Saved to flight controller", "success");
    else toast("Some parameters failed to save", "warning");
  }

  async function handleFlash() {
    const ok = await commitToFlash();
    showFlashResult(ok, { successMessage: "Written to flash" });
  }

  return (
    <ArmedWarningBanner>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <PanelHeader
            title="Configuration"
            subtitle="Feature toggles, arming settings, and beeper configuration"
            icon={<Settings size={16} />}
            loading={loading}
            loadProgress={loadProgress}
            hasLoaded={hasLoaded}
            onRead={refresh}
            connected={connected}
            error={error}
          />

          {/* Feature Toggles */}
          <Card
            icon={<ToggleRight size={14} />}
            title={`Feature Toggles (${enabledFeatureCount}/${featureDefs.length} enabled)`}
            description="Enable or disable firmware features (BF_FEATURE_MASK)"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {featureDefs.map((feat) => {
                const checked = (featureMask & (1 << feat.bit)) !== 0;
                return (
                  <label
                    key={feat.bit}
                    className="flex items-start gap-2 cursor-pointer group p-1.5 rounded hover:bg-bg-tertiary/50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFeature(feat.bit)}
                      className="w-3.5 h-3.5 mt-0.5 rounded border-border-default bg-bg-tertiary accent-accent-primary"
                    />
                    <div className="min-w-0">
                      <span className="text-xs font-mono text-text-primary group-hover:text-accent-primary transition-colors">
                        {feat.label}
                      </span>
                      <p className="text-[10px] text-text-tertiary leading-tight">
                        {feat.description}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="mt-2 text-[10px] text-text-tertiary font-mono">
              Mask: {featureMask} (0x
              {featureMask.toString(16).toUpperCase().padStart(8, "0")})
            </div>
          </Card>

          {/* Arming Configuration */}
          <Card
            icon={<Shield size={14} />}
            title="Arming"
            description="Auto-disarm timeout and small angle limit"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Auto-disarm delay"
                type="number"
                step="1"
                min="0"
                max="60"
                unit="s"
                value={p("BF_AUTO_DISARM_DELAY", "5")}
                onChange={(e) => set("BF_AUTO_DISARM_DELAY", e.target.value)}
              />
              <Input
                label="Small angle limit"
                type="number"
                step="1"
                min="0"
                max="180"
                unit="deg"
                value={p("BF_SMALL_ANGLE", "25")}
                onChange={(e) => set("BF_SMALL_ANGLE", e.target.value)}
              />
            </div>
            <p className="text-[10px] text-text-tertiary mt-2">
              Auto-disarm: seconds of inactivity before motors auto-disarm (0 = disabled).
              Small angle: maximum tilt angle in degrees that allows arming.
            </p>
          </Card>

          {/* Beeper Configuration */}
          <Card
            icon={<Bell size={14} />}
            title={`Beeper Configuration (${enabledBeeperCount}/${BEEPER_DEFS.length} enabled)`}
            description="Toggle individual beeper conditions (BF_BEEPER_DISABLED_MASK is inverted: bit=1 disables)"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {BEEPER_DEFS.map((beep) => {
                // Inverted: bit=1 in mask means DISABLED, so checkbox enabled = bit NOT set
                const isEnabled = (beeperMask & (1 << beep.bit)) === 0;
                return (
                  <label
                    key={beep.bit}
                    className="flex items-center gap-2 cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={() => toggleBeeper(beep.bit)}
                      className="w-3.5 h-3.5 rounded border-border-default bg-bg-tertiary accent-accent-primary"
                    />
                    <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">
                      {beep.label}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="mt-2 text-[10px] text-text-tertiary font-mono">
              Disabled mask: {beeperMask} (0x
              {beeperMask.toString(16).toUpperCase().padStart(8, "0")})
            </div>
          </Card>

          {/* Save */}
          <div className="flex items-center gap-3 pt-2 pb-4">
            <Button
              variant="primary"
              size="lg"
              icon={<Save size={14} />}
              disabled={!hasDirty || !connected}
              loading={saving}
              onClick={handleSave}
            >
              Save to Flight Controller
            </Button>
            {hasRamWrites && (
              <Button
                variant="secondary"
                size="lg"
                icon={<HardDrive size={14} />}
                onClick={handleFlash}
              >
                Write to Flash
              </Button>
            )}
            {!connected && (
              <span className="text-[10px] text-text-tertiary">
                Connect a drone to save parameters
              </span>
            )}
            {hasDirty && connected && (
              <span className="text-[10px] text-status-warning">
                Unsaved changes
              </span>
            )}
          </div>
        </div>
      </div>
    </ArmedWarningBanner>
  );
}
