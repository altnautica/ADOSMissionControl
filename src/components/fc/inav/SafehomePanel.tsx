/**
 * @module SafehomePanel
 * @description iNav safehome slot editor.
 * Reads every safehome slot the FC has, allows in-place editing,
 * and writes all slots back via the protocol layer.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useSafehomeStore, SAFEHOME_MAX } from "@/stores/safehome-store";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Home, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Component ─────────────────────────────────────────────────

export function SafehomePanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();

  const safehomes = useSafehomeStore((s) => s.safehomes);
  const loading = useSafehomeStore((s) => s.loading);
  const error = useSafehomeStore((s) => s.error);
  const dirty = useSafehomeStore((s) => s.dirty);
  const activeIndex = useSafehomeStore((s) => s.activeIndex);
  const setSlot = useSafehomeStore((s) => s.setSlot);
  const toggleEnabled = useSafehomeStore((s) => s.toggleEnabled);
  const setActiveIndex = useSafehomeStore((s) => s.setActiveIndex);
  const loadFromFc = useSafehomeStore((s) => s.loadFromFc);
  const uploadToFc = useSafehomeStore((s) => s.uploadToFc);

  const { isArmed, lockMessage } = useArmedLock();
  useUnsavedGuard(dirty);

  const hasLoaded = useSafehomeStore((s) => s.loaded);
  const connected = !!getSelectedProtocol();

  const handleRead = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol) {
      toast("Not connected to flight controller", "error");
      return;
    }
    await loadFromFc(protocol);
    const err = useSafehomeStore.getState().error;
    if (err) {
      toast(err, "error");
    } else {
      toast("Safehome slots loaded from FC", "success");
    }
  }, [getSelectedProtocol, loadFromFc, toast]);

  const handleWrite = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol) {
      toast("Not connected to flight controller", "error");
      return;
    }
    await uploadToFc(protocol);
    const err = useSafehomeStore.getState().error;
    if (err) {
      toast(err, "error");
    } else {
      toast("Safehome slots written to FC", "success");
    }
  }, [getSelectedProtocol, uploadToFc, toast]);

  const formatCoord = (val: number) => val.toFixed(7);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        <PanelHeader
          title="Safehome Slots"
          subtitle={`Up to ${SAFEHOME_MAX} return-to-home positions for iNav`}
          icon={<Home size={16} />}
          loading={loading}
          loadProgress={null}
          hasLoaded={hasLoaded}
          onRead={handleRead}
          connected={connected}
          error={error}
        >
          {hasLoaded && (
            <Button
              variant="primary"
              size="sm"
              icon={<Upload size={12} />}
              loading={loading}
              disabled={!connected || loading || isArmed}
              title={isArmed ? lockMessage : undefined}
              onClick={handleWrite}
            >
              Write to FC
            </Button>
          )}
        </PanelHeader>

        {dirty && (
          <p className="text-[10px] font-mono text-status-warning">
            Unsaved changes : use Write to FC to persist.
          </p>
        )}

        {hasLoaded && (
          <div className="space-y-1">
            {safehomes.map((sh, idx) => (
              <div
                key={idx}
                onClick={() => setActiveIndex(activeIndex === idx ? null : idx)}
                className={cn(
                  "border border-border-default rounded cursor-pointer transition-colors",
                  sh.enabled
                    ? "bg-bg-primary"
                    : "bg-bg-secondary opacity-60",
                  activeIndex === idx && "border-accent-primary",
                )}
              >
                {/* Row summary */}
                <div className="flex items-center gap-3 px-3 py-2">
                  <span className="text-[10px] font-mono text-text-tertiary w-5">{idx}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleEnabled(idx);
                    }}
                    className={cn(
                      "w-8 h-4 rounded-full relative transition-colors shrink-0",
                      sh.enabled
                        ? "bg-accent-primary"
                        : "bg-bg-tertiary border border-border-default",
                    )}
                    aria-label={sh.enabled ? "Disable slot" : "Enable slot"}
                  >
                    <div
                      className={cn(
                        "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
                        sh.enabled ? "translate-x-4" : "translate-x-0.5",
                      )}
                    />
                  </button>
                  <span
                    className={cn(
                      "text-xs font-mono",
                      sh.enabled ? "text-text-primary" : "text-text-tertiary",
                    )}
                  >
                    {sh.enabled
                      ? `${formatCoord(sh.lat)}, ${formatCoord(sh.lon)}`
                      : "Disabled"}
                  </span>
                </div>

                {/* Expanded editor */}
                {activeIndex === idx && (
                  <div
                    className="px-3 pb-3 space-y-2 border-t border-border-default"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] text-text-tertiary font-mono">Latitude</span>
                        <input
                          type="number"
                          step="0.0000001"
                          value={sh.lat}
                          onChange={(e) =>
                            setSlot(idx, { lat: parseFloat(e.target.value) || 0 })
                          }
                          className="bg-bg-tertiary border border-border-default rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] text-text-tertiary font-mono">Longitude</span>
                        <input
                          type="number"
                          step="0.0000001"
                          value={sh.lon}
                          onChange={(e) =>
                            setSlot(idx, { lon: parseFloat(e.target.value) || 0 })
                          }
                          className="bg-bg-tertiary border border-border-default rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
