"use client";

/**
 * @module drone-scripts/AppletCatalog
 * @description The starter-script catalog in the ArduPilot Scripts tab. Lists a
 * curated set of first-party Lua examples; "Add to drone" uploads the script to
 * APM/scripts/ over MAVLink FTP and provisions any SCR_USER* tunables it reads.
 * Code is viewable inline before adding. Provisioning the applet's parameters
 * is a one-shot action (not a param-grid panel), so it writes SCR_USER* through
 * the protocol directly rather than via usePanelParams.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { BookOpen, Plus, Code2, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { APPLET_CATALOG, type AppletCatalogEntry } from "./applet-catalog";
import { SCRIPTS_DIR } from "./scripts-constants";

export function AppletCatalog({ onAdded }: { onAdded?: () => void }) {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { toast } = useToast();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const supportsFtp = !!selectedProtocol?.uploadFileViaFtp;

  async function addApplet(entry: AppletCatalogEntry) {
    const protocol = selectedProtocol;
    if (!protocol?.uploadFileViaFtp) return;
    setBusyId(entry.id);
    try {
      // SCR_USER* only exist once the Lua VM is enabled and the FC rebooted;
      // before that a write to them is silently ignored. Check first so the
      // script is never reported added with tunables the FC never took. A
      // read that fails counts as not enabled.
      if (entry.params?.length) {
        const scrEnable = await protocol.getParameter("SCR_ENABLE").catch(() => null);
        if (!scrEnable || scrEnable.value < 1) {
          toast(
            `Enable scripting (SCR_ENABLE = 1) and reboot the FC before adding ${entry.name}.`,
            "error",
          );
          return;
        }
      }
      const bytes = new TextEncoder().encode(entry.body);
      await protocol.uploadFileViaFtp(`${SCRIPTS_DIR}/${entry.filename}`, bytes);
      // One-shot applet provisioning of its SCR_USER* tunables (not a param
      // grid, so it writes through the protocol directly).
      if (entry.params?.length) {
        for (const prm of entry.params) {
          const result = await protocol.setParameter(prm.name, prm.value);
          if (!result.success) {
            toast(
              `Could not set ${prm.name} for ${entry.name}: ${result.message || "the FC did not confirm the write"}`,
              "error",
            );
            return;
          }
        }
        const commit = await protocol.commitParamsToFlash();
        if (!commit.success) {
          toast(
            `Could not save ${entry.name}'s parameters to flash: ${commit.message || "the FC refused"}`,
            "error",
          );
          return;
        }
      }
      setAddedIds((prev) => new Set(prev).add(entry.id));
      toast(`Added ${entry.name} — reboot the FC to run it.`, "success");
      onAdded?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Could not add ${entry.name}: ${msg}`, "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
      <div className="flex items-center gap-2">
        <BookOpen size={14} className="text-accent-primary" />
        <h2 className="text-sm font-medium text-text-primary">Starter Scripts</h2>
      </div>
      <p className="text-[10px] text-text-tertiary">
        Minimal examples to upload, run, and adapt. Each runs on the flight
        controller after a reboot.
      </p>

      <ul className="space-y-2">
        {APPLET_CATALOG.map((entry) => {
          const isOpen = expanded === entry.id;
          const added = addedIds.has(entry.id);
          return (
            <li
              key={entry.id}
              className="rounded border border-border-default bg-bg-tertiary/40 p-3"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-text-primary">
                      {entry.name}
                    </span>
                    <span className="font-mono text-[10px] text-text-tertiary">
                      {entry.filename}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-text-secondary">
                    {entry.description}
                  </p>
                  {entry.params?.map((prm) => (
                    <p key={prm.name} className="mt-1 text-[10px] text-text-tertiary">
                      <span className="font-mono text-accent-primary">{prm.name}</span>
                      {" = "}
                      <span className="font-mono">{prm.value}</span> — {prm.note}
                    </p>
                  ))}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button
                    variant={added ? "secondary" : "primary"}
                    size="sm"
                    icon={
                      busyId === entry.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : added ? (
                        <Check size={12} />
                      ) : (
                        <Plus size={12} />
                      )
                    }
                    disabled={!supportsFtp || busyId !== null}
                    onClick={() => addApplet(entry)}
                  >
                    {added ? "Added" : "Add"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Code2 size={12} />}
                    onClick={() => setExpanded(isOpen ? null : entry.id)}
                  >
                    {isOpen ? "Hide" : "Code"}
                  </Button>
                </div>
              </div>
              {isOpen && (
                <pre
                  className={cn(
                    "mt-2 max-h-64 overflow-auto rounded bg-bg-primary p-2",
                    "font-mono text-[10px] leading-snug text-text-secondary",
                  )}
                >
                  {entry.body}
                </pre>
              )}
            </li>
          );
        })}
      </ul>

      {!supportsFtp && (
        <p className="text-[10px] text-status-warning">
          Connect over a transport that supports file transfer to add scripts.
        </p>
      )}
    </div>
  );
}
