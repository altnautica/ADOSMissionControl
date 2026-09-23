"use client";

import { useState } from "react";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useDroneManager } from "@/stores/drone-manager";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { Button } from "@/components/ui/button";
import { Save, HardDrive } from "lucide-react";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamEnums } from "../shared/ParamEnumSelect";
import { GnssConstellationEditor } from "./GnssConstellationEditor";
import { AP_GPS_RENAMED, resolveApGpsName, type ApGpsRenamedField } from "./ap-gps-constants";

const OFFSET_FIELDS: readonly { field: ApGpsRenamedField; label: string }[] = [
  { field: "posX", label: "Forward (X)" },
  { field: "posY", label: "Right (Y)" },
  { field: "posZ", label: "Down (Z)" },
];
// Both the pre-4.6 and 4.6+ spellings are requested; each is optional because
// a vehicle only ever has one of them.
const GPS_CONFIG_PARAMS: readonly string[] = [
  ...OFFSET_FIELDS.flatMap(({ field }) => AP_GPS_RENAMED[field]),
  ...AP_GPS_RENAMED.gnssMode,
];

export function GpsConfigSection() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const [saving, setSaving] = useState(false);
  const { paramName } = useParamLabel();
  const { bitmaskBits } = useParamEnums(useParamMetadataMap());

  const {
    params, loading, dirtyParams, hasRamWrites,
    hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = usePanelParams({ paramNames: GPS_CONFIG_PARAMS, optionalParams: GPS_CONFIG_PARAMS, panelId: "gps-config", autoLoad: false });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!getSelectedProtocol();
  const hasDirty = dirtyParams.size > 0;

  const gnssModeName = resolveApGpsName("gnssMode", params);

  async function handleSave() {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    if (ok) toast("GPS config saved", "success");
    else toast("Some parameters failed to save", "warning");
  }

  async function handleFlash() {
    const ok = await commitToFlash();
    showFlashResult(ok, { successMessage: "Written to flash" });
  }

  return (
    <div className="border border-border-default bg-bg-secondary p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-text-primary">GPS Configuration</h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            Antenna position offsets and constellation selection
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
          {/* GPS Antenna Offset */}
          <div>
            <h4 className="text-xs font-medium text-text-secondary mb-2">Antenna Position Offset (relative to IMU)</h4>
            <p className="text-[10px] text-text-tertiary mb-2">
              Coordinate system: X = forward (positive), Y = right (positive), Z = down (positive). Meters.
            </p>
            <div className="grid grid-cols-3 gap-3">
              {OFFSET_FIELDS.map(({ field, label }) => {
                const param = resolveApGpsName(field, params);
                return (
                  <div key={field}>
                    <label className="text-[10px] text-text-tertiary block mb-1">{label}</label>
                    {param ? (
                      <>
                        <input
                          type="number"
                          step="0.01"
                          value={params.get(param) ?? 0}
                          onChange={(e) => setLocalValue(param, Number(e.target.value) || 0)}
                          className="w-full h-7 px-2 bg-bg-tertiary border border-border-default text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
                        />
                        <span className="text-[9px] text-text-tertiary font-mono">{param}</span>
                      </>
                    ) : (
                      <span className="text-[10px] text-text-tertiary">Not on this firmware</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* GPS Constellation Selection */}
          <div>
            <h4 className="text-xs font-medium text-text-secondary mb-2">GNSS Constellation</h4>
            {gnssModeName ? (
              <GnssConstellationEditor
                paramName={paramName(gnssModeName)}
                value={params.get(gnssModeName) ?? 0}
                bits={bitmaskBits(gnssModeName)}
                onChange={(v) => setLocalValue(gnssModeName, v)}
              />
            ) : (
              <p className="text-[10px] text-text-tertiary">Not on this firmware</p>
            )}
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
