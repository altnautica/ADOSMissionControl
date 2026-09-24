/**
 * @module BfSettingsPanel
 * @description Full Betaflight settings viewer/editor. Reads every setting's
 * current value over the CLI (`dump`), renders each with its catalog metadata
 * (enum dropdown / ranged text), and writes changes back with `set`, persisting
 * via `save noreboot` (never reboots). Betaflight has no name-based settings
 * introspection, so this is the CLI-driven equivalent of the iNav settings
 * panels.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useState } from "react";
import { Sliders, Upload, Save, RotateCcw } from "lucide-react";
import { PanelHeader } from "../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { loadBfSettingsMetadata } from "@/lib/protocol/param-metadata/bf-settings";
import type { ParamMetadata } from "@/lib/protocol/param-metadata";
import type { CliSetting } from "@/lib/protocol/types";
import { BfSettingsTable } from "./BfSettingsTable";

export function BfSettingsPanel() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const connected = !!selectedProtocol;
  const { isArmed, lockMessage } = useArmedLock();

  const [settings, setSettings] = useState<CliSetting[]>([]);
  const [metadata, setMetadata] = useState<Map<string, ParamMetadata>>(new Map());
  const [modified, setModified] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [filter, setFilter] = useState("");
  const [showModifiedOnly, setShowModifiedOnly] = useState(false);

  const read = useCallback(async () => {
    const protocol = selectedProtocol;
    if (!protocol?.cliSettings) {
      setError("Betaflight CLI is not available on this connection");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [dumped, meta] = await Promise.all([
        protocol.cliSettings.enumerate(),
        loadBfSettingsMetadata(protocol.getVehicleInfo()?.firmwareVersionString),
      ]);
      setSettings(dumped);
      setMetadata(meta);
      setModified(new Map());
      setHasLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedProtocol]);

  const onModify = useCallback((name: string, value: string) => {
    setModified((prev) => {
      const next = new Map(prev);
      const base = settings.find((s) => s.name === name)?.value;
      if (value === base) next.delete(name);
      else next.set(name, value);
      return next;
    });
  }, [settings]);

  const write = useCallback(async (persist: boolean) => {
    const protocol = selectedProtocol;
    if (!protocol?.cliSettings || modified.size === 0) return;
    setLoading(true);
    setError(null);
    const changes = [...modified.entries()].map(([name, value]) => ({ name, value }));
    try {
      const r = await protocol.cliSettings.applySettings(changes, { persist });
      if (r.success) {
        setSettings((prev) => prev.map((s) => (modified.has(s.name) ? { ...s, value: modified.get(s.name)! } : s)));
        setModified(new Map());
      } else {
        setError(r.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedProtocol, modified]);

  const revert = useCallback(() => setModified(new Map()), []);
  const dirty = modified.size > 0;
  useUnsavedGuard(dirty);

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6">
      <PanelHeader
        title="All Settings"
        subtitle="Every Betaflight setting, read and written over the CLI"
        icon={<Sliders size={16} />}
        loading={loading}
        loadProgress={null}
        hasLoaded={hasLoaded}
        onRead={read}
        connected={connected}
        error={error}
      >
        {hasLoaded && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon={<RotateCcw size={12} />} disabled={!dirty || loading} onClick={revert}>Revert</Button>
            <Button
              variant="secondary" size="sm" icon={<Upload size={12} />} loading={loading}
              disabled={!connected || !dirty || loading || isArmed}
              title={isArmed ? lockMessage : "Apply to RAM (not saved to flash)"}
              onClick={() => write(false)}
            >
              Apply
            </Button>
            <Button
              variant="primary" size="sm" icon={<Save size={12} />} loading={loading}
              disabled={!connected || !dirty || loading || isArmed}
              title={isArmed ? lockMessage : "Save to flash (no reboot)"}
              onClick={() => write(true)}
            >
              Save
            </Button>
          </div>
        )}
      </PanelHeader>

      {dirty && (
        <p className="text-[10px] font-mono text-status-warning py-1">
          {modified.size} unsaved change{modified.size === 1 ? "" : "s"} : Apply writes to RAM, Save persists to flash.
        </p>
      )}

      {hasLoaded && (
        <div className="flex items-center gap-3 py-2">
          <input
            type="text"
            placeholder="Search settings..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 bg-bg-tertiary border border-border-default px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
          />
          <label className="flex items-center gap-1.5 text-[11px] text-text-secondary whitespace-nowrap cursor-pointer">
            <input type="checkbox" checked={showModifiedOnly} onChange={(e) => setShowModifiedOnly(e.target.checked)} />
            Modified only
          </label>
          <span className="text-[10px] text-text-tertiary font-mono whitespace-nowrap">{settings.length} settings</span>
        </div>
      )}

      {hasLoaded && (
        <BfSettingsTable
          settings={settings}
          metadata={metadata}
          modified={modified}
          onModify={onModify}
          filter={filter}
          showModifiedOnly={showModifiedOnly}
          disabled={loading || isArmed}
        />
      )}
    </div>
  );
}
