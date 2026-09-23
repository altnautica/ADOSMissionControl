"use client";

/**
 * @module features/WorldModelFeatureRow
 * @description The master-enable control for the World Model (Atlas) first-party
 * feature, one drone. Toggling ON both reveals the World Model + Live World
 * node-detail tabs (via the per-node features store, which gates the surfaces
 * and the readiness poll) AND enables the native capture service on the drone
 * over the LAN. Toggling OFF disables the service and hides the tabs.
 *
 * The switch label is the agent-derived state: a not-yet-paired node shows
 * "Pair on LAN" and the switch is disabled (never offer a control that cannot
 * reach the node). A reachable node is polled whether or not this browser has
 * the feature on, so the label is the drone's own readiness — Running even
 * when another GCS started the capture, Offline once the node stops
 * answering, "—" before its first answer.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";

import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { useAtlasControl } from "@/hooks/use-atlas-control";
import { isActiveCaptureState } from "@/lib/agent/atlas-control-client";
import { useNodeFeaturesStore } from "@/stores/node-features-store";
import { Toggle } from "@/components/ui/toggle";

export function WorldModelFeatureRow({ droneId }: { droneId: string }) {
  const deviceId = deviceIdFromNodeId(droneId) ?? droneId;
  const enabled = useNodeFeaturesStore((s) =>
    (s.enabled[deviceId] ?? []).includes("world-model"),
  );
  const setEnabled = useNodeFeaturesStore((s) => s.setEnabled);
  const control = useAtlasControl(droneId);
  const [busy, setBusy] = useState(false);
  // The last write the node REFUSED. Without it a failed enable left the
  // toggle checked and the pill on "Enabling…" forever, and a failed disable
  // hid the Atlas tabs while the drone kept capturing.
  const [writeFailed, setWriteFailed] = useState<"on" | "off" | null>(null);

  const available = control.demo || control.reachable;
  const r = control.readiness;
  const reason = control.configError ? `: ${control.configError}` : "";

  const status = writeFailed === "on"
    ? `Could not enable${reason}`
    : writeFailed === "off"
      ? `Still capturing — could not disable${reason}`
      : !available
        ? "Pair on LAN"
        : control.offline
          ? "Offline"
          : !r
            ? "—"
            : r.serviceRunning || r.capturing || isActiveCaptureState(r.state)
              ? "Running"
              : r.enabled
                ? "Enabled"
                : enabled
                  ? "Enabling…"
                  : "Off";

  const onToggle = async (on: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      setWriteFailed(null);
      if (on) {
        // Reveal the tabs + start the poll first so the readiness poll can
        // confirm the service came up — but roll the flag back when the node
        // refuses, rather than leaving the operator believing it is on.
        setEnabled(deviceId, "world-model", true);
        if (!(await control.enable())) {
          setEnabled(deviceId, "world-model", false);
          setWriteFailed("on");
        }
      } else if (await control.disable()) {
        setEnabled(deviceId, "world-model", false);
      } else {
        // Keep the tabs: the node is still capturing and forwarding.
        setWriteFailed("off");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Toggle
      label={busy || control.busy ? "Working…" : status}
      checked={enabled}
      onChange={onToggle}
      disabled={!available || busy || control.busy}
    />
  );
}
