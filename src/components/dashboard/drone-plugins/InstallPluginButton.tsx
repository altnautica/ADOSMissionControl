"use client";

/**
 * @module InstallPluginButton
 * @description Per-drone plugin install entry point. Wraps the
 * `<PluginInstallDialog>` and pre-fills the target drone so Stage 0
 * (drone picker) is skipped. Used at the top of the per-drone Plugins
 * tab and on the empty-state card.
 *
 * The dialog now owns the entire install orchestration internally
 * (file pick, transport selection, manifest parse, permission
 * approval, kick-off). This button is a thin shell that resolves the
 * `FleetDrone` into the `InstallTargetDrone` shape the dialog
 * expects, then opens the dialog. The dialog handles success / failure
 * itself and surfaces toasts.
 *
 * In demo mode the button is rendered but disabled. The dialog flow
 * needs a real agent on the other end; clicking the button in demo
 * mode would surface an immediate failure, so the disabled tooltip
 * keeps the affordance honest.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { PluginInstallDialog } from "@/components/plugins/PluginInstallDialog";
import type { InstallTargetDrone } from "@/components/plugins/install-dialog/types";
import { isDemoMode } from "@/lib/utils";
import type { FleetDrone } from "@/lib/types";
import { resolveRelayReach, type RelayReach } from "@/lib/nodes/relay-reach";

interface InstallPluginButtonProps {
  /** Drone the install will land on. */
  targetDevice: FleetDrone;
  /** Optional class on the trigger button. */
  className?: string;
  /** Render style. Defaults to primary. */
  variant?: "primary" | "secondary" | "ghost";
  /** Optional custom label override. */
  label?: string;
}

export function InstallPluginButton({
  targetDevice,
  className,
  variant = "primary",
  label,
}: InstallPluginButtonProps) {
  const t = useTranslations("dronePlugins");
  const [open, setOpen] = useState(false);
  const demoMode = isDemoMode();

  // Resolve the FleetDrone into the structural shape the dialog
  // wants. The dialog stays decoupled from FleetDrone so it can be
  // driven from any store that exposes a (_id, deviceId, name) tuple.
  //
  // A relay-only node (reached solely through a ground station's WFB
  // relay) has no `cloudDeviceId` of its own — `cloudDeviceId ?? id`
  // would fall back to the drone's node-shaped id, which is not a
  // wire-level agent device id the install transport can resolve. For
  // that carve-out, route the AGENT device id `resolveRelayReach`
  // reports (the same pattern `resolveRelayTarget` uses for the LAN
  // transport resolver); a direct node keeps the existing
  // `cloudDeviceId ?? id` derivation unchanged. Deliberate, narrow
  // carve-out for relay-only nodes.
  const agentDeviceId = targetDevice.cloudDeviceId ?? null;
  const relayReach: RelayReach | null = resolveRelayReach({
    agentDeviceId,
    reachedVia: targetDevice.reachedVia,
    droneDeviceId: targetDevice.id,
  });
  const installTarget = useMemo<InstallTargetDrone>(() => {
    const resolvedDeviceId =
      relayReach?.peerDeviceId ??
      (targetDevice.cloudDeviceId ?? targetDevice.id);
    return {
      _id: resolvedDeviceId,
      deviceId: resolvedDeviceId,
      name: targetDevice.name ?? targetDevice.id,
    };
  }, [targetDevice, relayReach]);

  const buttonLabel = label ?? t("installOnThisDrone");

  return (
    <>
      <Button
        variant={variant}
        size="sm"
        icon={<Plus className="h-4 w-4" />}
        onClick={() => setOpen(true)}
        className={className}
        disabled={demoMode}
        title={demoMode ? t("demoInstallDisabled") : undefined}
      >
        {buttonLabel}
      </Button>
      <PluginInstallDialog
        open={open}
        onClose={() => setOpen(false)}
        targetDevice={installTarget}
      />
    </>
  );
}
