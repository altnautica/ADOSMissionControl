"use client";

import { useState } from "react";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useDroneManager } from "@/stores/drone-manager";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { PanelHeader } from "../shared/PanelHeader";
import { Input } from "@/components/ui/input";
import { ParamEnumSelect, useParamEnums } from "../shared/ParamEnumSelect";
import { Button } from "@/components/ui/button";
import { Radio, Save, HardDrive, Signal } from "lucide-react";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import {
  TELRADIO_PARAMS, OPTIONAL_TELRADIO_PARAMS,
  radioLevel, Card, RssiBar, LiveStat,
} from "./telradio-helpers";

/** PX4 has no SERIALn_* or SYSID_* parameters (it uses MAV_n_* and MAV_SYS_ID). */
const NO_PARAMS: string[] = [];

export function TelRadioPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const { label: pl } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const { enumValues } = useParamEnums(paramMeta);
  const lbl = (raw: string) => <ParamFieldLabel raw={pl(raw)} metadata={paramMeta} />;
  const [saving, setSaving] = useState(false);

  // Re-renders on each RADIO_STATUS and blanks once the stream goes stale.
  const latestRadio = useFreshTelemetry("radio");

  const { firmwareType } = useFirmwareCapabilities();
  const isPx4 = firmwareType === "px4";
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded,
    refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = usePanelParams({
    paramNames: isPx4 ? NO_PARAMS : TELRADIO_PARAMS,
    optionalParams: isPx4 ? NO_PARAMS : OPTIONAL_TELRADIO_PARAMS,
    panelId: "telradio",
    autoLoad: true,
  });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!getSelectedProtocol();
  const hasDirty = dirtyParams.size > 0;

  const set = (name: string, v: string) => setLocalValue(name, Number(v) || 0);
  // A parameter that was not read is shown as such, never as a default.
  const unread = (label: string) => (
    <div>
      <span className="text-xs text-text-secondary">{lbl(label)}</span>
      <p className="text-xs font-mono text-text-tertiary">{hasLoaded ? "not present" : "—"}</p>
    </div>
  );
  const enumField = (name: string, label: string) => {
    const value = params.get(name);
    if (value === undefined) return unread(`${name} — ${label}`);
    return (
      <ParamEnumSelect
        label={lbl(`${name} — ${label}`)}
        values={enumValues(name)}
        value={value}
        onChange={(v) => setLocalValue(name, v)}
      />
    );
  };
  const idField = (name: string, label: string) => {
    const value = params.get(name);
    if (value === undefined) return unread(`${name} — ${label}`);
    return (
      <Input
        label={lbl(`${name} — ${label}`)}
        type="number"
        step="1"
        min="1"
        max="255"
        value={String(value)}
        onChange={(e) => set(name, e.target.value)}
      />
    );
  };

  async function handleSave() {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    if (ok) toast("Saved to flight controller", "success");
    else toast("Some parameters failed to save", "warning");
  }

  async function handleFlash() {
    const ok = await commitToFlash();
    showFlashResult(ok);
  }

  return (
    <ArmedWarningBanner>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <PanelHeader
            title="Telemetry Radio"
            subtitle="Radio link status and serial port config"
            icon={<Radio size={16} />}
            loading={loading}
            loadProgress={loadProgress}
            hasLoaded={hasLoaded}
            onRead={refresh}
            connected={connected}
            error={error}
          />

          {/* Link Status */}
          <Card icon={<Signal size={14} />} title="Link Status" description="Live RADIO_STATUS telemetry">
            {latestRadio ? (
              <div className="space-y-3">
                <RssiBar label="Local RSSI" value={latestRadio.rssi} />
                <RssiBar label="Remote RSSI" value={latestRadio.remrssi} />
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-2">
                  <LiveStat label="TX Buffer" value={`${latestRadio.txbuf}`} unit="%" />
                  <LiveStat label="Noise (device scale)" value={radioLevel(latestRadio.noise)} unit="" />
                  <LiveStat label="RX Errors" value={`${latestRadio.rxerrors}`} unit="" />
                  <LiveStat label="Fixed" value={`${latestRadio.fixed}`} unit="" />
                </div>
                <div className="text-[10px] text-text-tertiary">
                  Remote noise (device scale): {radioLevel(latestRadio.remnoise)}
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-text-tertiary">
                No live radio telemetry: RADIO_STATUS not received recently
              </p>
            )}
          </Card>

          {!isPx4 && (
            <>
              {/* Serial Port Config */}
              <Card icon={<Radio size={14} />} title="Serial Port Configuration" description="Protocol and baud rate for telemetry ports">
                <div className="space-y-4">
                  <div>
                    <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">SERIAL1 (TELEM1)</span>
                    <div className="mt-2 space-y-2">
                      {enumField("SERIAL1_PROTOCOL", "Protocol")}
                      {enumField("SERIAL1_BAUD", "Baud Rate")}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">SERIAL2 (TELEM2)</span>
                    <div className="mt-2 space-y-2">
                      {enumField("SERIAL2_PROTOCOL", "Protocol")}
                      {enumField("SERIAL2_BAUD", "Baud Rate")}
                    </div>
                  </div>
                </div>
              </Card>

              {/* System ID */}
              <Card icon={<Radio size={14} />} title="System Identification" description="MAVLink system and GCS IDs for multi-vehicle setups">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {idField("SYSID_THISMAV", "Vehicle System ID")}
                  {idField("SYSID_MYGCS", "GCS System ID")}
                </div>
                <p className="text-[10px] text-text-tertiary mt-1">
                  Each vehicle on the same link needs a unique SYSID_THISMAV. Default GCS ID is 255.
                </p>
              </Card>
            </>
          )}

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
              <span className="text-[10px] text-text-tertiary">Connect a drone to save parameters</span>
            )}
            {hasDirty && connected && (
              <span className="text-[10px] text-status-warning">Unsaved changes</span>
            )}
          </div>
        </div>
      </div>
    </ArmedWarningBanner>
  );
}
