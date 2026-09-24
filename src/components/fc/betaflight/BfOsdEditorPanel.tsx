"use client";

/**
 * Betaflight OSD Editor Panel
 *
 * Character-cell grid editor for the Betaflight OSD: SD (PAL 30x16,
 * NTSC 30x13) and HD (53x20) canvases, per-OSD-profile visibility,
 * drag-and-drop element positioning, and MSP OSD config read/write.
 *
 * @license GPL-3.0-only
 */

import { useState, useCallback, useRef } from "react";
import { useToast } from "@/components/ui/toast";
import { useDroneManager, selectSelectedDrone } from "@/stores/drone-manager";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { PanelHeader } from "../shared/PanelHeader";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Monitor, Save, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MspOsdConfig } from "@/lib/protocol/types";
import type { BfOsdElement, VideoSystem } from "./bf-osd-constants";
import {
  VIDEO_SYSTEM_OPTIONS, VIDEO_SYSTEM_CODES, OSD_PROFILE_COUNT, buildDefaultElements, encodePosition,
  decodePosition, videoSystemFromCode,
} from "./bf-osd-constants";
import { parseMcmFont } from "./bf-osd-font";
import { BfOsdGrid } from "./BfOsdGrid";
import { BfOsdElementList } from "./BfOsdElementList";

/** What the FC holds for the editable layout: every element's position word and the video system. */
function layoutSnapshot(els: BfOsdElement[], vs: VideoSystem): string {
  return JSON.stringify({ p: els.map(encodePosition), v: vs });
}

export function BfOsdEditorPanel() {
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const selectedDrone = useDroneManager(selectSelectedDrone);
  const { toast } = useToast();

  const [elements, setElements] = useState<BfOsdElement[]>(() => buildDefaultElements());
  const [videoSystem, setVideoSystem] = useState<VideoSystem>("PAL");
  const [profileCount, setProfileCount] = useState(OSD_PROFILE_COUNT);
  const [activeProfile, setActiveProfile] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fontProgress, setFontProgress] = useState<{ done: number; total: number } | null>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  // The config last read from (or written to) the FC. Saves diff against it:
  // only changed elements are written, and the general block is round-tripped
  // from it so units and alarm thresholds keep their FC values.
  const fcConfig = useRef<MspOsdConfig | null>(null);
  // Layout snapshot of what the FC holds, for the unsaved-change guard.
  const [baseline, setBaseline] = useState<string | null>(null);
  const dirty = baseline !== null && layoutSnapshot(elements, videoSystem) !== baseline;
  useUnsavedGuard(dirty);

  // ── Element operations ──────────────────────────────────────

  const updateElement = useCallback(
    (id: number, updates: Partial<BfOsdElement>) => {
      setElements((prev) =>
        prev.map((el) => (el.id === id ? { ...el, ...updates } : el)),
      );
    },
    [],
  );

  const toggleVisibility = useCallback((id: number) => {
    const bit = 1 << (activeProfile - 1);
    setElements((prev) =>
      prev.map((el) => (el.id === id ? { ...el, profiles: el.profiles ^ bit } : el)),
    );
  }, [activeProfile]);

  const resetAll = useCallback(() => {
    setElements((prev) => buildDefaultElements(prev.length));
    setSelectedId(null);
    toast("Reset all elements to defaults", "info");
  }, [toast]);

  // ── Read from FC ────────────────────────────────────────────

  const handleRead = useCallback(async () => {
    const protocol = selectedDrone?.protocol;
    if (!protocol?.getOsdConfig) {
      setError("This connection cannot read the Betaflight OSD configuration");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const cfg = await protocol.getOsdConfig();
      // Positions arrive in `osd_items_e` order: the index is the element id.
      const loaded = cfg.items.map((item, id) => decodePosition(item.position, id));
      const loadedVideo = videoSystemFromCode(cfg.videoSystem);
      setElements(loaded);
      setVideoSystem(loadedVideo);
      setProfileCount(Math.min(OSD_PROFILE_COUNT, cfg.osdProfileCount));
      setActiveProfile(Math.min(OSD_PROFILE_COUNT, cfg.osdProfileCount, cfg.osdProfileIndex));
      fcConfig.current = cfg;
      setBaseline(layoutSnapshot(loaded, loadedVideo));
      setHasLoaded(true);
      toast("OSD config loaded", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read OSD config");
    } finally {
      setLoading(false);
    }
  }, [selectedDrone, toast]);

  // ── Save to FC ──────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    const protocol = selectedDrone?.protocol;
    if (!protocol?.writeOsdLayout) {
      toast("This connection cannot write the Betaflight OSD configuration", "error");
      return;
    }
    const fc = fcConfig.current;
    if (!fc) {
      toast("Read the OSD config from the flight controller before saving", "error");
      return;
    }
    const items = elements
      .map((el) => ({ index: el.id, position: encodePosition(el) }))
      .filter((it) => it.position !== fc.items[it.index]?.position);
    const videoCode = VIDEO_SYSTEM_CODES[videoSystem];
    const general = videoCode !== fc.videoSystem
      ? {
        videoSystem: videoCode, units: fc.units, rssiAlarm: fc.rssiAlarm,
        capacityWarning: fc.capacityWarning, altAlarm: fc.altAlarm, enabledWarnings: fc.enabledWarnings,
      }
      : undefined;
    if (items.length === 0 && !general) {
      toast("No OSD changes to save", "info");
      return;
    }
    setSaving(true);
    try {
      const r = await protocol.writeOsdLayout(items, general);
      if (r.success) {
        const nextItems = fc.items.map((it) => ({ ...it }));
        for (const it of items) nextItems[it.index] = { position: it.position };
        fcConfig.current = { ...fc, items: nextItems, videoSystem: videoCode };
        setBaseline(layoutSnapshot(elements, videoSystem));
        toast(`Saved ${items.length} OSD element${items.length === 1 ? "" : "s"} to flight controller`, "success");
      } else {
        toast(r.message, "error");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save OSD config", "error");
    } finally {
      setSaving(false);
    }
  }, [selectedDrone, elements, videoSystem, toast]);

  // ── Font upload (.mcm) ──────────────────────────────────────

  const handleFontFile = useCallback(async (file: File) => {
    const protocol = selectedDrone?.protocol;
    if (!protocol?.uploadOsdFont) {
      toast("Font upload is not available on this connection", "error");
      return;
    }
    try {
      const { glyphs } = parseMcmFont(await file.text());
      setFontProgress({ done: 0, total: glyphs.length });
      const r = await protocol.uploadOsdFont(glyphs, (done, total) => setFontProgress({ done, total }));
      toast(r.success ? `Uploaded ${glyphs.length} font glyphs` : r.message, r.success ? "success" : "error");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Font upload failed", "error");
    } finally {
      setFontProgress(null);
    }
  }, [selectedDrone, toast]);

  // ── Render ────────────────────────────────────────────────

  return (
    <ArmedWarningBanner>
      <div className="h-full flex flex-col gap-3 p-4 overflow-auto">
        <PanelHeader
          title="Betaflight OSD"
          icon={<Monitor size={16} />}
          loading={loading}
          loadProgress={null}
          hasLoaded={hasLoaded}
          onRead={handleRead}
          connected={!!selectedDroneId}
          error={error}
        >
          {hasLoaded && (
            <Button variant="primary" size="sm" icon={<Save size={12} />} onClick={handleSave} loading={saving} disabled={saving}>
              Save
            </Button>
          )}
        </PanelHeader>

        {/* Controls bar */}
        {hasLoaded && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-36">
              <Select label="Video System" options={VIDEO_SYSTEM_OPTIONS} value={videoSystem} onChange={(v) => setVideoSystem(v as VideoSystem)} />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-text-secondary mr-1">OSD profile:</span>
              {Array.from({ length: profileCount }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setActiveProfile(p)}
                  className={cn(
                    "w-7 h-7 text-xs font-mono transition-colors",
                    activeProfile === p
                      ? "bg-accent-primary text-accent-foreground"
                      : "bg-bg-tertiary text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/80",
                  )}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Font upload (.mcm) */}
            <input
              ref={fontInputRef}
              type="file"
              accept=".mcm"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFontFile(f); e.target.value = ""; }}
            />
            <Button
              variant="secondary" size="sm" icon={<Upload size={12} />}
              disabled={fontProgress !== null}
              onClick={() => fontInputRef.current?.click()}
            >
              Upload font (.mcm)
            </Button>
            {fontProgress && (
              <span className="text-[11px] font-mono text-text-secondary">
                Uploading {fontProgress.done}/{fontProgress.total} glyphs…
              </span>
            )}
          </div>
        )}

        {/* Main layout: grid + sidebar */}
        {hasLoaded && (
          <div className="flex gap-4 flex-1 min-h-0">
            <BfOsdGrid
              elements={elements}
              activeProfile={activeProfile}
              profileCount={profileCount}
              videoSystem={videoSystem}
              selectedId={selectedId}
              onSelectElement={setSelectedId}
              onUpdateElement={updateElement}
            />
            <BfOsdElementList
              elements={elements}
              activeProfile={activeProfile}
              selectedId={selectedId}
              onSelectElement={setSelectedId}
              onToggleVisibility={toggleVisibility}
              onResetAll={resetAll}
            />
          </div>
        )}
      </div>
    </ArmedWarningBanner>
  );
}
