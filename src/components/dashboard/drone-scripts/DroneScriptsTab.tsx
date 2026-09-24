"use client";

/**
 * @module drone-scripts/DroneScriptsTab
 * @description The per-drone ArduPilot Lua Scripts tab. Composes the scripting-
 * engine config (SCR_*), the APM/scripts/ file manager (upload/download/delete
 * over MAVLink FTP), and the script output console. ArduPilot-only surface
 * (gated in the drone surface registry); it degrades gracefully if the active
 * transport does not expose FTP. Works both direct-to-FC and through the
 * agent's transparent MAVLink pipe, since everything runs over the selected
 * drone's `DroneProtocol` transport.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { FileWarning } from "lucide-react";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { ScrConfigCard } from "./ScrConfigCard";
import { ScriptFileManager } from "./ScriptFileManager";
import { AppletCatalog } from "./AppletCatalog";
import { ScriptConsole } from "./ScriptConsole";

export function DroneScriptsTab({ droneId }: { droneId?: string }) {
  void droneId; // the tab operates on the selected protocol (this node is selected)
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const supportsFtp = !!selectedProtocol?.uploadFileViaFtp;
  // Bumped when an applet is added so the file manager re-lists.
  const [reloadSignal, setReloadSignal] = useState(0);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-lg font-display font-semibold text-text-primary">
            Lua Scripts
          </h1>
          <p className="text-xs text-text-tertiary mt-0.5">
            Manage the flight controller&rsquo;s onboard Lua scripts. Scripts run
            on the FC itself from{" "}
            <span className="font-mono">APM/scripts/</span> — no companion
            computer required.
          </p>
        </div>

        {!supportsFtp ? (
          <div className="flex items-start gap-2 rounded border border-status-warning/30 bg-status-warning/5 p-4">
            <FileWarning size={16} className="text-status-warning shrink-0 mt-0.5" />
            <div className="text-xs text-text-secondary">
              <p className="font-medium text-text-primary">
                File transfer unavailable on this connection
              </p>
              <p className="mt-1">
                Managing scripts needs MAVLink file transfer. Connect to the
                flight controller directly (USB/serial/TCP) or through an ADOS
                agent to upload and manage scripts. The scripting-engine settings
                below still apply.
              </p>
            </div>
          </div>
        ) : (
          <ScriptFileManager reloadSignal={reloadSignal} />
        )}

        {supportsFtp && (
          <AppletCatalog onAdded={() => setReloadSignal((n) => n + 1)} />
        )}

        <ScrConfigCard />
        <ScriptConsole />
      </div>
    </div>
  );
}
