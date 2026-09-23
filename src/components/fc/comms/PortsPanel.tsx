"use client";

import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { useDroneManager } from "@/stores/drone-manager";
import { useToast } from "@/components/ui/toast";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useParamPanelActions } from "@/hooks/use-param-panel-actions";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { PanelHeader } from "../shared/PanelHeader";
import { useParamEnums } from "../shared/ParamEnumSelect";
import { EnumSelect } from "../parameters/EnumSelect";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import {
  Save,
  Usb,
  HardDrive,
  Info,
  AlertTriangle,
} from "lucide-react";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";

import {
  NUM_PORTS, HARDWARE_LABELS,
  PORT_PARAMS, PX4_PORTS, PX4_PORT_PARAMS, PX4_BAUD_OPTIONS,
} from "./ports-constants";

export function PortsPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const protocol = getSelectedProtocol();
  const { firmwareType } = useFirmwareCapabilities();
  const isPx4 = firmwareType === "px4";
  const [needsReboot, setNeedsReboot] = useState(false);
  const { toast } = useToast();
  // SERIALn_PROTOCOL / SERIALn_BAUD options come from the firmware metadata
  // (verbatim ArduPilot @Values as the offline floor), never a hand table.
  const { enumValues } = useParamEnums(useParamMetadataMap());

  const portParamNames = useMemo(
    () => (isPx4 ? PX4_PORT_PARAMS : PORT_PARAMS),
    [isPx4],
  );

  // autoLoad: read the moment the panel is opened (params come straight from
  // the cache seeded by the connect-time full download). optionalParams: serial
  // ports vary by board, so a port this board lacks is silently absent, never a
  // hard load error that blocks the panel.
  const panelParams = usePanelParams({ paramNames: portParamNames, optionalParams: portParamNames, panelId: "ports", autoLoad: true });
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded,
    refresh, setLocalValue, revertAll,
  } = panelParams;

  // Render only the serial ports this board actually has. Params for ports the
  // board lacks (e.g. SERIAL7 on a board with fewer UARTs) never load, so those
  // ports are omitted rather than shown as empty/broken rows.
  const presentPorts = useMemo(
    () => Array.from({ length: NUM_PORTS }, (_, i) => i).filter((i) => params.has(`SERIAL${i}_PROTOCOL`)),
    [params],
  );
  const { saving, save, flash: handleFlash } = useParamPanelActions(panelParams);
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!protocol;
  const hasDirty = dirtyParams.size > 0;

  // ── Helpers to read param values from flat Map ──────────────

  const getProtocolValue = (i: number) => params.get(`SERIAL${i}_PROTOCOL`) ?? -1;

  const getBaudValue = (i: number) => params.get(`SERIAL${i}_BAUD`) ?? 57;

  // ── Save / Flash / Reboot ───────────────────────────────────

  const handleSave = useCallback(async () => {
    const ok = await save();
    if (ok) setNeedsReboot(true);
  }, [save]);

  async function handleReboot() {
    if (!protocol) return;
    const result = await protocol.reboot();
    if (!result.success) {
      toast(`Reboot refused: ${result.message}`, "error");
      return;
    }
    setNeedsReboot(false);
  }

  // ── Render ──────────────────────────────────────────────────

  if (!protocol) {
    return (
      <div className="flex-1 p-6">
        <div className="max-w-3xl space-y-4">
          <h2 className="text-sm font-semibold text-text-primary">Serial Ports</h2>
          <Card>
            <p className="text-xs text-text-tertiary">Connect to a drone to configure serial ports.</p>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <ArmedWarningBanner>
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-border-default bg-bg-secondary px-4 py-3 space-y-3">
          <PanelHeader
            title="Serial Ports"
            subtitle="Protocol and baud rate for each serial port"
            icon={<Usb size={16} />}
            loading={loading}
            loadProgress={loadProgress}
            hasLoaded={hasLoaded}
            onRead={refresh}
            connected={connected}
            error={error}
          >
            {hasDirty && (
              <span className="text-[10px] font-mono text-status-warning px-1.5 py-0.5 bg-status-warning/10 border border-status-warning/20">
                UNSAVED
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={revertAll}
              disabled={!hasDirty}
            >
              Revert
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Save size={12} />}
              onClick={handleSave}
              disabled={!hasDirty}
              loading={saving}
            >
              Save Changes
            </Button>
            {hasRamWrites && (
              <Button
                variant="secondary"
                size="sm"
                icon={<HardDrive size={12} />}
                onClick={handleFlash}
              >
                Write to Flash
              </Button>
            )}
            {needsReboot && (
              <Button
                variant="danger"
                size="sm"
                onClick={handleReboot}
              >
                Reboot FC
              </Button>
            )}
          </PanelHeader>
        </div>

        {/* Reboot info banner */}
        {needsReboot && (
          <div className="flex-shrink-0 px-4 py-2 bg-status-warning/10 border-b border-status-warning/30 flex items-center gap-2">
            <Info size={14} className="text-status-warning flex-shrink-0" />
            <span className="text-xs text-status-warning">
              Serial port changes require a reboot to take effect.
            </span>
          </div>
        )}

        {/* Port table */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-3xl space-y-2">
            {!hasLoaded && !loading ? (
              <div className="flex items-center justify-center py-16">
                <span className="text-xs text-text-tertiary">
                  Click &quot;Read from FC&quot; to load serial parameters.
                </span>
              </div>
            ) : loading && !hasLoaded ? (
              <div className="flex items-center justify-center py-16">
                <span className="text-xs text-text-tertiary">Loading serial parameters...</span>
              </div>
            ) : isPx4 ? (
              <div className="space-y-3">
                <p className="text-xs text-text-tertiary">
                  PX4 auto-detects port protocols. Configure baud rates below.
                </p>
                {PX4_PORTS.map((port) => (
                  <div key={port.baudParam} className="flex items-center gap-4 p-3 rounded-md bg-bg-tertiary">
                    <span className="text-xs font-medium text-text-primary w-20">{port.label}</span>
                    <Select
                      value={String(params.get(port.baudParam) ?? "0")}
                      onChange={(v) => setLocalValue(port.baudParam, Number(v))}
                      options={PX4_BAUD_OPTIONS}
                      className="flex-1"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {/* Table header */}
                <div className="grid grid-cols-[60px_80px_1fr_1fr] gap-3 px-3 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                    Port
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                    Label
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                    Protocol
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                    Baud Rate
                  </span>
                </div>

                {presentPorts.map((i) => {
                  const protocolDirty = dirtyParams.has(`SERIAL${i}_PROTOCOL`);
                  const baudDirty = dirtyParams.has(`SERIAL${i}_BAUD`);
                  const rowChanged = protocolDirty || baudDirty;

                  return (
                    <Card key={i} className={rowChanged ? "border-status-warning/40" : undefined}>
                      <div className="grid grid-cols-[60px_80px_1fr_1fr] gap-3 items-center">
                        <span className="text-xs font-mono text-text-secondary">
                          SERIAL{i}
                        </span>
                        <span className="text-xs text-text-tertiary">
                          {HARDWARE_LABELS[i]}
                        </span>
                        <EnumSelect
                          values={enumValues(`SERIAL${i}_PROTOCOL`)}
                          value={getProtocolValue(i)}
                          onChange={(v) => setLocalValue(`SERIAL${i}_PROTOCOL`, v)}
                          className={protocolDirty ? "border-status-warning/60" : undefined}
                        />
                        <EnumSelect
                          values={enumValues(`SERIAL${i}_BAUD`)}
                          value={getBaudValue(i)}
                          onChange={(v) => setLocalValue(`SERIAL${i}_BAUD`, v)}
                          className={baudDirty ? "border-status-warning/60" : undefined}
                        />
                      </div>
                    </Card>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </ArmedWarningBanner>
  );
}
