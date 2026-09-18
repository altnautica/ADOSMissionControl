"use client";

import { useState } from "react";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useDroneManager } from "@/stores/drone-manager";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Save, HardDrive } from "lucide-react";

const RCMAP_PARAMS = ["RCMAP_ROLL", "RCMAP_PITCH", "RCMAP_THROTTLE", "RCMAP_YAW"];

const CHANNEL_OPTIONS = Array.from({ length: 16 }, (_, i) => ({
  value: String(i + 1),
  label: `Channel ${i + 1}`,
}));

const RCMAP_LABELS: Record<string, string> = {
  RCMAP_ROLL: "Roll",
  RCMAP_PITCH: "Pitch",
  RCMAP_THROTTLE: "Throttle",
  RCMAP_YAW: "Yaw",
};

export function RcChannelMapSection() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const [saving, setSaving] = useState(false);

  const {
    params, loading, dirtyParams, hasRamWrites,
    hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = usePanelParams({ paramNames: RCMAP_PARAMS, panelId: "rc-channel-map", autoLoad: false });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!getSelectedProtocol();
  const hasDirty = dirtyParams.size > 0;

  async function handleSave() {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    if (ok) toast("RC mapping saved to flight controller", "success");
    else toast("Some parameters failed to save", "warning");
  }

  async function handleFlash() {
    showFlashResult(await commitToFlash(), { successMessage: "Written to flash" });
  }

  return (
    <div className="border border-border-default bg-bg-secondary p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-medium text-text-primary">RC Channel Assignment</h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            Map which RC channel controls each axis. Default: CH1=Roll, CH2=Pitch, CH3=Throttle, CH4=Yaw.
          </p>
        </div>
        {!hasLoaded && connected && (
          <Button variant="secondary" size="sm" onClick={refresh} loading={loading}>
            Read
          </Button>
        )}
      </div>

      {hasLoaded && (
        <>
          <div className="grid grid-cols-2 gap-3 mb-3">
            {RCMAP_PARAMS.map((param) => (
              <div key={param} className="flex items-center gap-2">
                <span className="text-xs text-text-secondary w-16 shrink-0">
                  {RCMAP_LABELS[param]}
                </span>
                <Select
                  options={CHANNEL_OPTIONS}
                  value={String(params.get(param) ?? 1)}
                  onChange={(v) => setLocalValue(param, Number(v))}
                />
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<Save size={12} />}
              onClick={handleSave}
              disabled={!hasDirty || saving}
              loading={saving}
            >
              Save
            </Button>
            {hasRamWrites && (
              <Button variant="secondary" size="sm" icon={<HardDrive size={12} />} onClick={handleFlash}>
                Write to Flash
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
