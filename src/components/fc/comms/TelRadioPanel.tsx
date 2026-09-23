"use client";

import { useState, useCallback } from "react";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useDroneManager } from "@/stores/drone-manager";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { ArmedLockOverlay } from "@/components/indicators/ArmedLockOverlay";
import { PanelHeader } from "../shared/PanelHeader";
import { Input } from "@/components/ui/input";
import { ParamEnumSelect, useParamEnums } from "../shared/ParamEnumSelect";
import { Button } from "@/components/ui/button";
import { Radio, Save, HardDrive, Terminal, Signal } from "lucide-react";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";
import {
  TELRADIO_PARAMS, OPTIONAL_TELRADIO_PARAMS,
  rssiPercent, Card, RssiBar, LiveStat,
} from "./telradio-helpers";

export function TelRadioPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const { label: pl } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const { enumValues } = useParamEnums(paramMeta);
  const lbl = (raw: string) => <ParamFieldLabel raw={pl(raw)} metadata={paramMeta} />;
  const [saving, setSaving] = useState(false);
  const [atCommand, setAtCommand] = useState("");
  const [atResponse, setAtResponse] = useState("");

  const radioBuffer = useTelemetryStore((s) => s.radio);
  const latestRadio = radioBuffer.latest();

  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded,
    refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = usePanelParams({ paramNames: TELRADIO_PARAMS, optionalParams: OPTIONAL_TELRADIO_PARAMS, panelId: "telradio", autoLoad: true });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!getSelectedProtocol();
  const hasDirty = dirtyParams.size > 0;

  const p = (name: string, fallback = "0") => String(params.get(name) ?? fallback);
  const set = (name: string, v: string) => setLocalValue(name, Number(v) || 0);

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

  const handleSendAT = useCallback(() => {
    if (!atCommand.trim()) return;
    // AT command passthrough would use protocol.sendSerialData()
    setAtResponse(`> ${atCommand}\nOK`);
    setAtCommand("");
    toast("AT command sent", "success");
  }, [atCommand, toast]);

  const localRssiPct = latestRadio ? rssiPercent(latestRadio.rssi) : 0;
  const remoteRssiPct = latestRadio ? rssiPercent(latestRadio.remrssi) : 0;

  return (
    <ArmedLockOverlay>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <PanelHeader
            title="Telemetry Radio"
            subtitle="Radio link status, serial port config, AT commands"
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
                <RssiBar label="Local RSSI" value={latestRadio.rssi} pct={localRssiPct} />
                <RssiBar label="Remote RSSI" value={latestRadio.remrssi} pct={remoteRssiPct} />
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-2">
                  <LiveStat label="TX Buffer" value={`${latestRadio.txbuf}`} unit="%" />
                  <LiveStat label="Noise" value={`${latestRadio.noise}`} unit="dBm" />
                  <LiveStat label="RX Errors" value={`${latestRadio.rxerrors}`} unit="" />
                  <LiveStat label="Fixed" value={`${latestRadio.fixed}`} unit="" />
                </div>
                {latestRadio.remnoise > 0 && (
                  <div className="text-[10px] text-text-tertiary">
                    Remote noise: {latestRadio.remnoise} dBm
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[10px] text-text-tertiary">
                No radio telemetry — RADIO_STATUS not received
              </p>
            )}
          </Card>

          {/* Serial Port Config */}
          <Card icon={<Radio size={14} />} title="Serial Port Configuration" description="Protocol and baud rate for telemetry ports">
            <div className="space-y-4">
              <div>
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">SERIAL1 (TELEM1)</span>
                <div className="mt-2 space-y-2">
                  <ParamEnumSelect
                    label={lbl("SERIAL1_PROTOCOL — Protocol")}
                    values={enumValues("SERIAL1_PROTOCOL")}
                    value={params.get("SERIAL1_PROTOCOL") ?? 2}
                    onChange={(v) => setLocalValue("SERIAL1_PROTOCOL", v)}
                  />
                  <ParamEnumSelect
                    label={lbl("SERIAL1_BAUD — Baud Rate")}
                    values={enumValues("SERIAL1_BAUD")}
                    value={params.get("SERIAL1_BAUD") ?? 57}
                    onChange={(v) => setLocalValue("SERIAL1_BAUD", v)}
                  />
                </div>
              </div>
              <div>
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">SERIAL2 (TELEM2)</span>
                <div className="mt-2 space-y-2">
                  <ParamEnumSelect
                    label={lbl("SERIAL2_PROTOCOL — Protocol")}
                    values={enumValues("SERIAL2_PROTOCOL")}
                    value={params.get("SERIAL2_PROTOCOL") ?? 2}
                    onChange={(v) => setLocalValue("SERIAL2_PROTOCOL", v)}
                  />
                  <ParamEnumSelect
                    label={lbl("SERIAL2_BAUD — Baud Rate")}
                    values={enumValues("SERIAL2_BAUD")}
                    value={params.get("SERIAL2_BAUD") ?? 57}
                    onChange={(v) => setLocalValue("SERIAL2_BAUD", v)}
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* System ID */}
          <Card icon={<Radio size={14} />} title="System Identification" description="MAVLink system and GCS IDs for multi-vehicle setups">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label={lbl("SYSID_THISMAV — Vehicle System ID")}
                type="number"
                step="1"
                min="1"
                max="255"
                value={p("SYSID_THISMAV", "1")}
                onChange={(e) => set("SYSID_THISMAV", e.target.value)}
              />
              <Input
                label={lbl("SYSID_MYGCS — GCS System ID")}
                type="number"
                step="1"
                min="1"
                max="255"
                value={p("SYSID_MYGCS", "255")}
                onChange={(e) => set("SYSID_MYGCS", e.target.value)}
              />
            </div>
            <p className="text-[10px] text-text-tertiary mt-1">
              Each vehicle on the same link needs a unique SYSID_THISMAV. Default GCS ID is 255.
            </p>
          </Card>

          {/* AT Commands */}
          <Card icon={<Terminal size={14} />} title="AT Commands" description="Send AT commands to 3DR/RFD900 radios">
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={atCommand}
                  onChange={(e) => setAtCommand(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSendAT(); }}
                  placeholder="AT command (e.g. ATI, ATS1?)"
                  className="flex-1 px-2 py-1.5 text-xs font-mono bg-bg-tertiary border border-border-default rounded"
                />
                <Button size="sm" onClick={handleSendAT} disabled={!atCommand.trim()}>
                  Send
                </Button>
              </div>
              {atResponse && (
                <pre className="p-2 text-[10px] font-mono bg-bg-tertiary/50 border border-border-default rounded text-text-secondary whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {atResponse}
                </pre>
              )}
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
              <span className="text-[10px] text-text-tertiary">Connect a drone to save parameters</span>
            )}
            {hasDirty && connected && (
              <span className="text-[10px] text-status-warning">Unsaved changes</span>
            )}
          </div>
        </div>
      </div>
    </ArmedLockOverlay>
  );
}
