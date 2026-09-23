"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { useDroneManager } from "@/stores/drone-manager";
import { usePanelParams } from "@/hooks/use-panel-params";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { Database, Save, HardDrive, Download, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  blackboxParamNames, DEVICE_OPTIONS, RATE_PRESETS,
  formatBytes, type DataflashSummary,
} from "./blackbox-constants";
import { downloadBlob } from "@/lib/download";

export function BlackboxPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const scrollRef = usePanelScroll("blackbox");
  const [saving, setSaving] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [flashInfo, setFlashInfo] = useState<DataflashSummary | null>(null);
  const [flashLoading, setFlashLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded,
    refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = usePanelParams({ paramNames: blackboxParamNames, panelId: "blackbox", autoLoad: true });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!getSelectedProtocol();
  const hasDirty = dirtyParams.size > 0;
  const p = (name: string, fallback = "0") => String(params.get(name) ?? fallback);
  const set = (name: string, v: string) => setLocalValue(name, Number(v) || 0);

  const deviceType = Number(params.get("BF_BLACKBOX_DEVICE") ?? 0);
  const rateNum = Number(params.get("BF_BLACKBOX_RATE_NUM") ?? 1);
  const rateDenom = Number(params.get("BF_BLACKBOX_RATE_DENOM") ?? 1);
  const ratePercentage = useMemo(() => rateDenom === 0 ? 100 : Math.round((rateNum / rateDenom) * 100), [rateNum, rateDenom]);
  const usagePercent = useMemo(() => (!flashInfo || flashInfo.totalSize === 0) ? 0 : Math.round((flashInfo.usedSize / flashInfo.totalSize) * 100), [flashInfo]);

  const [flashUnsupported, setFlashUnsupported] = useState(false);

  const loadFlashInfo = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol || !protocol.isConnected) return;
    if (!protocol.getDataflashSummary) {
      setFlashUnsupported(true);
      setFlashInfo(null);
      return;
    }
    setFlashUnsupported(false);
    setFlashLoading(true);
    try {
      setFlashInfo(await protocol.getDataflashSummary());
    } catch { setFlashInfo(null); }
    finally { setFlashLoading(false); }
  }, [getSelectedProtocol]);

  useEffect(() => { if (hasLoaded && (deviceType === 1 || deviceType === 2)) loadFlashInfo(); }, [hasLoaded, deviceType, loadFlashInfo]);

  async function handleSave() { setSaving(true); const ok = await saveAllToRam(); setSaving(false); if (ok) toast("Saved to flight controller", "success"); else toast("Some parameters failed to save", "warning"); }
  async function handleFlash() { const ok = await commitToFlash(); showFlashResult(ok); }

  async function handleDownload() {
    const protocol = getSelectedProtocol();
    if (!protocol || !protocol.isConnected) { toast("Not connected to flight controller", "error"); return; }
    if (!protocol.downloadBlackbox) { toast("This connection cannot download blackbox logs", "error"); return; }
    setDownloading(true);
    setDownloadProgress(0);
    try {
      const data = await protocol.downloadBlackbox((p) => setDownloadProgress(p.percentComplete));
      if (data.length === 0) { toast("No blackbox data on the flight controller", "warning"); return; }
      // Copy into a fresh ArrayBuffer-backed view so the Blob part is typed
      // Uint8Array<ArrayBuffer> (not the adapter's ArrayBufferLike return).
      const blob = new Blob([new Uint8Array(data)], { type: "application/octet-stream" });
      downloadBlob(blob, `blackbox-${Date.now()}.bbl`);
      toast(`Downloaded ${formatBytes(data.length)} blackbox log`, "success");
    } catch (err) {
      toast(`Blackbox download failed: ${err instanceof Error ? err.message : "unknown error"}`, "error");
    } finally {
      setDownloading(false);
    }
  }

  async function handleErase() {
    if (!window.confirm("Erase all blackbox logs? This cannot be undone.")) return;
    const protocol = getSelectedProtocol();
    if (!protocol || !protocol.isConnected) { toast("Not connected to flight controller", "error"); return; }
    if (!protocol.eraseDataflash) { toast("This connection cannot erase blackbox logs", "error"); return; }
    setErasing(true);
    try {
      await protocol.eraseDataflash();
      toast("Blackbox logs erased", "success");
      setFlashInfo((prev) => prev ? { ...prev, usedSize: 0 } : null);
    } catch { toast("Failed to erase blackbox logs", "error"); }
    finally { setErasing(false); }
  }

  function handleRatePreset(num: number, denom: number) { setLocalValue("BF_BLACKBOX_RATE_NUM", num); setLocalValue("BF_BLACKBOX_RATE_DENOM", denom); }

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader title="Blackbox" subtitle="Flight data recording device and logging rate" icon={<Database size={16} />} loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded} onRead={refresh} connected={connected} error={error} />

        <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1"><Database size={14} className="text-accent-primary" /><h2 className="text-sm font-medium text-text-primary">Logging Device</h2></div>
          <Select label="Device" options={DEVICE_OPTIONS} value={p("BF_BLACKBOX_DEVICE")} onChange={(v) => set("BF_BLACKBOX_DEVICE", v)} />
        </div>

        <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Database size={14} className="text-accent-primary" /><h2 className="text-sm font-medium text-text-primary">Log Rate</h2>
            <span className="text-[10px] font-mono text-accent-primary ml-auto">{rateNum}/{rateDenom} = {ratePercentage}% of PID loop</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Numerator" type="number" step="1" min="1" max="32" value={p("BF_BLACKBOX_RATE_NUM", "1")} onChange={(e) => set("BF_BLACKBOX_RATE_NUM", e.target.value)} />
            <Input label="Denominator" type="number" step="1" min="1" max="32" value={p("BF_BLACKBOX_RATE_DENOM", "1")} onChange={(e) => set("BF_BLACKBOX_RATE_DENOM", e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {RATE_PRESETS.map((preset) => {
              const isActive = rateNum === preset.num && rateDenom === preset.denom;
              return (<button key={preset.label} type="button" onClick={() => handleRatePreset(preset.num, preset.denom)} className={cn("px-2 py-1 text-[10px] font-mono border transition-colors", isActive ? "bg-accent-primary/20 border-accent-primary text-accent-primary" : "bg-bg-tertiary border-border-default text-text-secondary hover:border-text-tertiary")}>{preset.label}</button>);
            })}
          </div>
        </div>

        {deviceType > 0 && deviceType <= 2 && (
          <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1"><Database size={14} className="text-accent-primary" /><h2 className="text-sm font-medium text-text-primary">{deviceType === 1 ? "Flash Storage" : "SD Card Storage"}</h2></div>
            {flashLoading && (<div className="flex items-center gap-2 py-4"><Loader2 size={14} className="animate-spin text-accent-primary" /><span className="text-xs text-text-secondary">Reading storage info...</span></div>)}
            {!flashLoading && flashInfo && (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1"><span className="text-[10px] text-text-tertiary">Used: {formatBytes(flashInfo.usedSize)} / {formatBytes(flashInfo.totalSize)}</span><span className="text-[10px] font-mono text-text-secondary">{usagePercent}%</span></div>
                  <div className="h-3 bg-bg-tertiary overflow-hidden"><div className={cn("h-full transition-all", usagePercent > 90 ? "bg-status-error" : usagePercent > 70 ? "bg-status-warning" : "bg-accent-primary")} style={{ width: `${usagePercent}%` }} /></div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Button variant="secondary" size="sm" icon={<Download size={12} />} onClick={handleDownload} loading={downloading} disabled={flashInfo.usedSize === 0 || erasing}>Download Logs</Button>
                  <Button variant="secondary" size="sm" icon={<Trash2 size={12} />} onClick={handleErase} loading={erasing} disabled={flashInfo.usedSize === 0 || downloading}>Erase</Button>
                </div>
                {downloading && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-text-tertiary">Downloading blackbox log…</span>
                      <span className="text-[10px] font-mono text-accent-primary">{downloadProgress}%</span>
                    </div>
                    <div className="h-2 bg-bg-tertiary overflow-hidden">
                      <div className="h-full bg-accent-primary transition-all" style={{ width: `${downloadProgress}%` }} />
                    </div>
                  </div>
                )}
              </>
            )}
            {!flashLoading && !flashInfo && (
              <p className="text-[10px] text-text-tertiary">
                {flashUnsupported ? "This connection cannot read onboard log storage." : "Could not read storage info from the flight controller."}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2 pb-4">
          <Button variant="primary" size="lg" icon={<Save size={14} />} disabled={!hasDirty || !connected} loading={saving} onClick={handleSave}>Save to Flight Controller</Button>
          {hasRamWrites && <Button variant="secondary" size="lg" icon={<HardDrive size={14} />} onClick={handleFlash}>Write to Flash</Button>}
          {!connected && <span className="text-[10px] text-text-tertiary">Connect a drone to save parameters</span>}
          {hasDirty && connected && <span className="text-[10px] text-status-warning">Unsaved changes</span>}
        </div>
      </div>
    </div>
    </ArmedWarningBanner>
  );
}
