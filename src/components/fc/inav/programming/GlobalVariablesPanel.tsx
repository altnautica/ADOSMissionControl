/**
 * @module GlobalVariablesPanel
 * @description iNav Global Variables viewer + live setter.
 * Reads the current signed-32-bit values of all 8 global variables from the FC
 * and lets the operator override a variable's live runtime value. Variables are
 * also driven by logic conditions, so an override is not persistent.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useProgrammingStore, GVAR_MAX } from "@/stores/programming-store";
import { useClockStore } from "@/stores/clock-store";
import { useClockTick } from "@/lib/agent/freshness";
import { isFresh } from "@/lib/telemetry/freshness";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { PanelHeader } from "../../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Variable } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Component ─────────────────────────────────────────────────

export function GlobalVariablesPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();

  const gvarStatus = useProgrammingStore((s) => s.gvarStatus);
  const gvarStatusAt = useProgrammingStore((s) => s.gvarStatusAt);
  const loading = useProgrammingStore((s) => s.loading);
  const error = useProgrammingStore((s) => s.error);
  const pollStatus = useProgrammingStore((s) => s.pollStatus);
  const writeGvar = useProgrammingStore((s) => s.writeGvar);
  const startPolling = useProgrammingStore((s) => s.startPolling);
  const stopPolling = useProgrammingStore((s) => s.stopPolling);

  const { isArmed } = useArmedLock();
  const connected = !!getSelectedProtocol();
  const hasLoaded = gvarStatusAt !== null;
  // A value is live only while the last read is recent; older ones are the
  // last values read, not the FC's current state.
  useClockTick();
  const now = useClockStore((s) => s.now);
  const live = gvarStatusAt !== null && isFresh(gvarStatusAt, now);

  // Sparse map of operator edits; an unedited slot shows the last read value.
  const [edits, setEdits] = useState<Record<number, string>>({});

  const values: (number | undefined)[] = Array.from({ length: GVAR_MAX }, (_, i) => gvarStatus.values[i]);
  const fieldValue = (idx: number) => edits[idx] ?? (values[idx] === undefined ? "" : String(values[idx]));

  useEffect(() => {
    const protocol = getSelectedProtocol();
    if (!protocol) return;
    if (isArmed && connected) {
      startPolling(protocol, 500);
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [isArmed, connected, getSelectedProtocol, startPolling, stopPolling]);

  const handleRead = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol) {
      toast("Not connected to flight controller", "error");
      return;
    }
    if (!protocol.downloadGvarStatus) {
      toast("Global variable status not supported by this firmware", "error");
      return;
    }
    const outcome = await pollStatus(protocol);
    if (outcome.gvars !== "ok") {
      toast("Could not read the global variables from the flight controller", "error");
      return;
    }
    setEdits({}); // fresh live values supersede any drafts
    toast("Global variable status refreshed", "success");
  }, [getSelectedProtocol, pollStatus, toast]);

  const handleSet = useCallback(
    async (index: number) => {
      const protocol = getSelectedProtocol();
      if (!protocol) {
        toast("Not connected to flight controller", "error");
        return;
      }
      const read = gvarStatus.values[index];
      const value = parseInt(edits[index] ?? (read === undefined ? "" : String(read)), 10);
      if (!Number.isFinite(value)) {
        toast(`Enter a value for GVAR ${index}`, "error");
        return;
      }
      await writeGvar(protocol, index, value);
      const err = useProgrammingStore.getState().error;
      if (err) {
        toast(err, "error");
      } else {
        setEdits((e) => {
          const next = { ...e };
          delete next[index];
          return next;
        });
        toast(`GVAR ${index} set to ${value}`, "success");
      }
    },
    [getSelectedProtocol, edits, gvarStatus, writeGvar, toast],
  );

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-xl space-y-4">
        <PanelHeader
          title="Global Variables"
          subtitle={`Live values for ${GVAR_MAX} global variables (set by logic conditions or overridden here)`}
          icon={<Variable size={16} />}
          loading={loading}
          loadProgress={null}
          hasLoaded={hasLoaded}
          onRead={handleRead}
          connected={connected}
          error={error}
        />

        {isArmed && (
          <p className="text-[10px] font-mono text-status-warning">
            Armed: overrides disabled. Live values update below.
          </p>
        )}

        {hasLoaded && (
          <div className="grid grid-cols-2 gap-2">
            {values.map((val, idx) => (
              <div
                key={idx}
                className="border border-border-default rounded px-3 py-2 bg-bg-primary flex flex-col gap-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono text-text-tertiary">GVAR {idx}</span>
                  <span
                    className={cn(
                      "text-[10px] font-mono",
                      live && val !== undefined && val !== 0 ? "text-status-success" : "text-text-tertiary",
                    )}
                    title={live ? "Current live value" : "Last value read from the FC; not live"}
                  >
                    {val ?? "—"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    disabled={isArmed || !connected}
                    type="number"
                    value={fieldValue(idx)}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [idx]: e.target.value }))}
                    className="w-full text-xs font-mono bg-bg-tertiary border border-border-default rounded px-1.5 py-1 text-text-primary disabled:opacity-50"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isArmed || !connected}
                    onClick={() => handleSet(idx)}
                  >
                    Set
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {hasLoaded && (
          <p className="text-[10px] font-mono text-text-tertiary">
            Setting a value is a live runtime override; logic conditions may change it again, and it
            is not written to EEPROM. Overrides are blocked while armed.
          </p>
        )}
      </div>
    </div>
  );
}
