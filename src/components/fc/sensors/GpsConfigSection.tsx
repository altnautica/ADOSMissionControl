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

const GPS_OFFSET_PARAMS = ["GPS_POS1_X", "GPS_POS1_Y", "GPS_POS1_Z"];
const GPS_GNSS_PARAMS = ["GPS_GNSS_MODE"];
const ALL_GPS_PARAMS = [...GPS_OFFSET_PARAMS, ...GPS_GNSS_PARAMS];

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
  } = usePanelParams({ paramNames: ALL_GPS_PARAMS, panelId: "gps-config", autoLoad: false });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!getSelectedProtocol();
  const hasDirty = dirtyParams.size > 0;

  const gnssMode = params.get("GPS_GNSS_MODE") ?? 0;

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
              {GPS_OFFSET_PARAMS.map((param) => {
                const axis = param.slice(-1); // X, Y, Z
                const axisLabel = axis === "X" ? "Forward (X)" : axis === "Y" ? "Right (Y)" : "Down (Z)";
                return (
                  <div key={param}>
                    <label className="text-[10px] text-text-tertiary block mb-1">{axisLabel}</label>
                    <input
                      type="number"
                      step="0.01"
                      value={params.get(param) ?? 0}
                      onChange={(e) => setLocalValue(param, Number(e.target.value) || 0)}
                      className="w-full h-7 px-2 bg-bg-tertiary border border-border-default text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
                    />
                    <span className="text-[9px] text-text-tertiary font-mono">{param}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* GPS Constellation Selection */}
          <div>
            <h4 className="text-xs font-medium text-text-secondary mb-2">GNSS Constellation</h4>
            <GnssConstellationEditor
              paramName={paramName("GPS_GNSS_MODE")}
              value={gnssMode}
              bits={bitmaskBits("GPS_GNSS_MODE")}
              onChange={(v) => setLocalValue("GPS_GNSS_MODE", v)}
            />
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
