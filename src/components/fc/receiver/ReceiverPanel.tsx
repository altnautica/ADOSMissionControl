"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { useDroneManager } from "@/stores/drone-manager";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { RcChannelBar } from "./RcChannelBar";
import { ReceiverBindingUI } from "./ReceiverBindingUI";
import { ArmedLockOverlay } from "@/components/indicators/ArmedLockOverlay";
import { Save, Radio, HardDrive } from "lucide-react";

import {
  RC_CHANNEL_COUNT, CHANNEL_OPTIONS, RC_PROTOCOLS_OPTIONS,
  RSSI_TYPE_OPTIONS, RECEIVER_PARAMS,
} from "./receiver-constants";

export function ReceiverPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const protocol = getSelectedProtocol();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  // Live RC data from telemetry store
  const rcBuffer = useTelemetryStore((s) => s.rc);
  const latestRc = rcBuffer.latest();
  const channels = latestRc?.channels ?? Array.from({ length: RC_CHANNEL_COUNT }, () => 0);
  // Absent until an RC frame arrives. "RSSI 0" reads as a receiver reporting a
  // dead link, which is a stronger claim than having heard nothing yet.
  const rssi = latestRc?.rssi;

  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded,
    refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = usePanelParams({ paramNames: RECEIVER_PARAMS, panelId: "receiver", autoLoad: true });
  useUnsavedGuard(dirtyParams.size > 0);

  // ── Helpers to read/write params from flat Map ──────────────

  const getMapping = (role: string) => String(params.get(`RCMAP_${role}`) ?? { ROLL: 1, PITCH: 2, THROTTLE: 3, YAW: 4 }[role] ?? 1);
  const getChannelMin = (i: number) => params.get(`RC${i + 1}_MIN`) ?? 1000;
  const getChannelMax = (i: number) => params.get(`RC${i + 1}_MAX`) ?? 2000;
  const getChannelTrim = (i: number) => params.get(`RC${i + 1}_TRIM`) ?? 1500;
  const getChannelReversed = (i: number) => (params.get(`RC${i + 1}_REVERSED`) ?? 0) !== 0;
  const getChannelDz = (i: number) => params.get(`RC${i + 1}_DZ`) ?? 30;

  // ── Save / Flash ───────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    if (ok) toast("Receiver parameters saved to RAM", "success");
    else toast("Some parameters failed to save", "warning");
  }

  async function handleFlash() {
    const ok = await commitToFlash();
    if (ok) toast("Parameters written to flash", "success");
    else toast("Failed to write to flash", "error");
  }

  // ── RC data guard ─────────────────────────────────────────
  const hasRcData = latestRc != null && channels.some((c) => c > 0);

  // Primary axis channels from RCMAP
  const rollCh = Number(params.get("RCMAP_ROLL") ?? 1);
  const pitchCh = Number(params.get("RCMAP_PITCH") ?? 2);
  const yawCh = Number(params.get("RCMAP_YAW") ?? 4);

  // ── RSSI percentage ────────────────────────────────────────

  const rssiPct = useMemo(
    () => (rssi != null ? Math.round((rssi / 255) * 100) : undefined),
    [rssi],
  );

  const hasDirty = dirtyParams.size > 0;

  // ── Protocol setParameter callback for calibration ─────────
  const onSetParameter = async (name: string, value: number) => {
    if (protocol) {
      await protocol.setParameter(name, value);
    }
  };

  if (!protocol) {
    return (<div className="flex-1 p-6"><div className="max-w-3xl space-y-4">
      <h2 className="text-sm font-semibold text-text-primary">RC Receiver</h2>
      <Card><p className="text-xs text-text-tertiary">Connect to a drone to configure receiver.</p></Card>
    </div></div>);
  }

  return (
    <ArmedLockOverlay>
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl space-y-4">
        <PanelHeader
          title="RC Receiver"
          subtitle="Channel mapping, calibration, and per-channel settings"
          loading={loading}
          loadProgress={loadProgress}
          hasLoaded={hasLoaded}
          onRead={refresh}
          connected={!!protocol}
          error={error}
        >
          {hasDirty && (
            <span className="text-[10px] font-mono text-status-warning px-1.5 py-0.5 bg-status-warning/10 border border-status-warning/20">
              UNSAVED
            </span>
          )}
          <Button
            variant="primary"
            size="sm"
            icon={<Save size={12} />}
            loading={saving}
            disabled={!hasDirty}
            onClick={handleSave}
          >
            Save
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
        </PanelHeader>

        {/* ── Live RC Channels ──────────────────────────────── */}

        <Card title="Live RC Channels">
          <div className="space-y-1.5">
            {channels.slice(0, RC_CHANNEL_COUNT).map((val, i) => (
              <RcChannelBar
                key={i}
                index={i}
                value={val}
                min={getChannelMin(i)}
                max={getChannelMax(i)}
                trim={getChannelTrim(i)}
                dz={getChannelDz(i)}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border-default">
            <Radio size={12} className="text-text-tertiary" />
            <span className="text-[10px] text-text-secondary">RSSI:</span>
            {rssi != null && rssiPct != null ? (
              <>
                <span className="text-[10px] font-mono text-text-primary">{rssi}</span>
                <span className="text-[10px] text-text-tertiary">({rssiPct}%)</span>
              </>
            ) : (
              <span className="text-[10px] font-mono text-text-tertiary">
                -- (no RC telemetry)
              </span>
            )}
          </div>
        </Card>

        {/* ── Channel Mapping ──────────────────────────────── */}

        <Card title="Channel Mapping">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select
              label="Roll"
              value={getMapping("ROLL")}
              onChange={(v) => setLocalValue("RCMAP_ROLL", Number(v))}
              options={CHANNEL_OPTIONS}
            />
            <Select
              label="Pitch"
              value={getMapping("PITCH")}
              onChange={(v) => setLocalValue("RCMAP_PITCH", Number(v))}
              options={CHANNEL_OPTIONS}
            />
            <Select
              label="Throttle"
              value={getMapping("THROTTLE")}
              onChange={(v) => setLocalValue("RCMAP_THROTTLE", Number(v))}
              options={CHANNEL_OPTIONS}
            />
            <Select
              label="Yaw"
              value={getMapping("YAW")}
              onChange={(v) => setLocalValue("RCMAP_YAW", Number(v))}
              options={CHANNEL_OPTIONS}
            />
          </div>
        </Card>

        {/* ── RC Protocol & RSSI ──────────────────────────── */}

        <Card title="RC Protocol & RSSI">
          <div className="space-y-3">
            <Select
              label="RC_PROTOCOLS — Allowed RC Protocols (bitmask)"
              options={RC_PROTOCOLS_OPTIONS}
              value={String(params.get("RC_PROTOCOLS") ?? "1")}
              onChange={(v) => setLocalValue("RC_PROTOCOLS", Number(v))}
            />
            <p className="text-[10px] text-text-tertiary">
              Bitmask of allowed RC input protocols. Set to match your receiver type.
            </p>
            <Select
              label="RSSI_TYPE — RSSI Source"
              options={RSSI_TYPE_OPTIONS}
              value={String(params.get("RSSI_TYPE") ?? "0")}
              onChange={(v) => setLocalValue("RSSI_TYPE", Number(v))}
            />
          </div>
        </Card>

        {/* ── Per-Channel Settings ─────────────────────────── */}

        <Card title="Channel Settings" padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-default text-text-secondary">
                  <th className="px-3 py-2 text-left font-medium">CH</th>
                  <th className="px-3 py-2 text-left font-medium">Min</th>
                  <th className="px-3 py-2 text-left font-medium">Max</th>
                  <th className="px-3 py-2 text-left font-medium">Trim</th>
                  <th className="px-3 py-2 text-left font-medium">DZ</th>
                  <th className="px-3 py-2 text-left font-medium">Rev</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: RC_CHANNEL_COUNT }, (_, i) => (
                  <tr key={i} className="border-b border-border-default last:border-0 hover:bg-bg-tertiary/50">
                    <td className="px-3 py-1.5 font-mono text-text-secondary">{i + 1}</td>
                    <td className="px-3 py-1.5">
                      <input
                        type="number"
                        value={getChannelMin(i)}
                        onChange={(e) => setLocalValue(`RC${i + 1}_MIN`, Number(e.target.value))}
                        className="w-16 h-7 px-1.5 bg-bg-tertiary border border-border-default text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="number"
                        value={getChannelMax(i)}
                        onChange={(e) => setLocalValue(`RC${i + 1}_MAX`, Number(e.target.value))}
                        className="w-16 h-7 px-1.5 bg-bg-tertiary border border-border-default text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="number"
                        value={getChannelTrim(i)}
                        onChange={(e) => setLocalValue(`RC${i + 1}_TRIM`, Number(e.target.value))}
                        className="w-16 h-7 px-1.5 bg-bg-tertiary border border-border-default text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="number"
                        value={getChannelDz(i)}
                        onChange={(e) => setLocalValue(`RC${i + 1}_DZ`, Number(e.target.value))}
                        className="w-14 h-7 px-1.5 bg-bg-tertiary border border-border-default text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Toggle
                        label=""
                        checked={getChannelReversed(i)}
                        onChange={(v) => setLocalValue(`RC${i + 1}_REVERSED`, v ? 1 : 0)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* ── Radio Calibration ────────────────────────────── */}

        <ReceiverBindingUI
          channels={channels}
          hasRcData={hasRcData}
          setLocalValue={setLocalValue}
          getChannelTrim={getChannelTrim}
          getChannelDz={getChannelDz}
          rollCh={rollCh}
          pitchCh={pitchCh}
          yawCh={yawCh}
          onSetParameter={onSetParameter}
        />
      </div>
    </div>
    </ArmedLockOverlay>
  );
}
