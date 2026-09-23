/**
 * @module INavOsdPanel
 * @description iNav OSD configuration panel.
 * Three collapsible sections: layout summary, alarms editor, preferences editor.
 * Alarms and preferences live in dedicated sub-components.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useRef, useState } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useToast } from "@/components/ui/toast";
import { PanelHeader } from "../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { Monitor, ChevronDown, ChevronRight, Upload, Type } from "lucide-react";
import { AlarmFieldsEditor } from "./AlarmFieldsEditor";
import { OsdPreferencesEditor } from "./OsdPreferencesEditor";
import { parseMcmFont } from "../betaflight/bf-osd-font";
import type {
  INavOsdLayoutsHeader,
  INavOsdAlarms,
  INavOsdPreferences,
} from "@/lib/protocol/msp/msp-decoders-inav";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-border-default rounded">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-2 text-[11px] font-semibold text-text-primary hover:bg-bg-tertiary"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

export function INavOsdPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const connected = !!getSelectedProtocol();

  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [layoutsHeader, setLayoutsHeader] = useState<INavOsdLayoutsHeader | null>(null);
  const [alarms, setAlarms] = useState<INavOsdAlarms | null>(null);
  const [preferences, setPreferences] = useState<INavOsdPreferences | null>(null);
  const [alarmsDirty, setAlarmsDirty] = useState(false);
  const [prefsDirty, setPrefsDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const { isArmed, lockMessage } = useArmedLock();
  const { toast } = useToast();
  useUnsavedGuard(alarmsDirty || prefsDirty);

  const fontInputRef = useRef<HTMLInputElement>(null);
  const [fontProgress, setFontProgress] = useState<{ done: number; total: number } | null>(null);

  const handleFontFile = useCallback(async (file: File) => {
    const protocol = getSelectedProtocol();
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
  }, [getSelectedProtocol, toast]);

  const handleRead = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol?.getOsdLayoutsHeader || !protocol.getOsdAlarms || !protocol.getOsdPreferences) {
      setError("OSD config not available on this firmware");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [header, al, pref] = await Promise.all([
        protocol.getOsdLayoutsHeader(),
        protocol.getOsdAlarms(),
        protocol.getOsdPreferences(),
      ]);
      setLayoutsHeader(header);
      setAlarms(al);
      setPreferences(pref);
      setHasLoaded(true);
      setAlarmsDirty(false);
      setPrefsDirty(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [getSelectedProtocol]);

  const handleSaveAlarms = useCallback(async () => {
    if (!alarms) return;
    const protocol = getSelectedProtocol();
    if (!protocol?.setOsdAlarms) return;
    setSaving(true);
    setError(null);
    try {
      const result = await protocol.setOsdAlarms(alarms);
      if (!result.success) {
        setError(result.message);
        return;
      }
      setAlarmsDirty(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [getSelectedProtocol, alarms]);

  const handleSavePrefs = useCallback(async () => {
    if (!preferences) return;
    const protocol = getSelectedProtocol();
    if (!protocol?.setOsdPreferences) return;
    setSaving(true);
    setError(null);
    try {
      const result = await protocol.setOsdPreferences(preferences);
      if (!result.success) {
        setError(result.message);
        return;
      }
      setPrefsDirty(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [getSelectedProtocol, preferences]);

  function updateAlarm<K extends keyof INavOsdAlarms>(key: K, value: INavOsdAlarms[K]) {
    if (!alarms) return;
    setAlarms({ ...alarms, [key]: value });
    setAlarmsDirty(true);
  }

  function updatePref<K extends keyof INavOsdPreferences>(
    key: K,
    value: INavOsdPreferences[K],
  ) {
    if (!preferences) return;
    setPreferences({ ...preferences, [key]: value });
    setPrefsDirty(true);
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        <PanelHeader
          title="OSD (iNav)"
          subtitle="OSD layout summary, alarms, and display preferences."
          icon={<Monitor size={16} />}
          loading={loading}
          loadProgress={null}
          hasLoaded={hasLoaded}
          onRead={handleRead}
          connected={connected}
          error={error}
        >
          {hasLoaded && alarmsDirty && (
            <Button
              variant="primary"
              size="sm"
              icon={<Upload size={12} />}
              loading={saving}
              disabled={!connected || saving || isArmed}
              title={isArmed ? lockMessage : undefined}
              onClick={handleSaveAlarms}
            >
              Save alarms
            </Button>
          )}
          {hasLoaded && prefsDirty && (
            <Button
              variant="primary"
              size="sm"
              icon={<Upload size={12} />}
              loading={saving}
              disabled={!connected || saving || isArmed}
              title={isArmed ? lockMessage : undefined}
              onClick={handleSavePrefs}
            >
              Save prefs
            </Button>
          )}
        </PanelHeader>

        {hasLoaded && (
          <div className="space-y-3">
            {(alarmsDirty || prefsDirty) && (
              <p className="text-[10px] font-mono text-status-warning">
                Unsaved changes : use the Save buttons above to persist.
              </p>
            )}

            <Section title="Layouts">
              {layoutsHeader ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-text-secondary">Layout count</span>
                    <span className="font-mono text-text-primary">{layoutsHeader.layoutCount}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-text-secondary">Items per layout</span>
                    <span className="font-mono text-text-primary">{layoutsHeader.itemCount}</span>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-text-tertiary">No layout data.</p>
              )}
            </Section>

            <Section title="Alarms">
              <AlarmFieldsEditor alarms={alarms} onUpdate={updateAlarm} />
            </Section>

            <Section title="Preferences">
              <OsdPreferencesEditor preferences={preferences} onUpdate={updatePref} />
            </Section>
          </div>
        )}

        {connected && (
          <Section title="Font">
            <p className="text-[10px] text-text-tertiary">
              Upload a MAX7456 <span className="font-mono">.mcm</span> OSD font to the flight controller (analog OSD).
            </p>
            <input
              ref={fontInputRef}
              type="file"
              accept=".mcm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFontFile(f);
                e.target.value = "";
              }}
            />
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<Type size={12} />}
                disabled={!connected || fontProgress !== null || isArmed}
                title={isArmed ? lockMessage : undefined}
                onClick={() => fontInputRef.current?.click()}
              >
                Upload font (.mcm)
              </Button>
              {fontProgress && (
                <span className="text-[10px] font-mono text-text-tertiary">
                  {fontProgress.done}/{fontProgress.total}
                </span>
              )}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
