import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal,
  Settings,
  Trash2,
  ShieldCheck,
  Power,
  RotateCw,
} from "lucide-react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { cn, isDemoMode } from "@/lib/utils";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { PluginAgentClient } from "@/lib/agent/plugin-client";
import { resolveLanAgent } from "@/lib/agent/resolve-agent";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { PluginInstallSummary } from "@/lib/plugins/types";
import type {
  PluginModelStatusEntry,
  PluginServiceStatusEntry,
} from "@/stores/agent-plugin-inventory-store";
import { usePluginUpdateStore } from "@/stores/plugin-update-store";
import { api } from "../../../../convex/_generated/api";
import type { DronePluginStatusLabel } from "./DronePluginStatusPill";
import type { DronePluginCardData } from "./DronePluginCard";

/** Delivery window for a relayed enable / disable / uninstall: a node that
 * has not taken the command by then never runs it. */
export const PLUGIN_COMMAND_TTL_MS = 30_000;
/** How long a relayed command may sit untaken before the card says it is
 * waiting for the node. */
export const PLUGIN_COMMAND_WAITING_AFTER_MS = 3_000;

type PluginActionKind = "enable" | "disable" | "uninstall";

/**
 * Enable/disable, remove and pending-command state of one plugin row.
 *
 * A node the GCS can reach on the LAN gets the call straight from its plugin
 * API and the HTTP answer is the outcome. Otherwise the command is relayed
 * through the cloud queue with a short delivery window and tracked until the
 * agent acknowledges it; while the node has not taken it the card says so
 * and offers Cancel.
 */
export function useDronePluginActions(install: DronePluginCardData) {
  const t = useTranslations("dronePlugins");
  const { toast } = useToast();
  const router = useRouter();
  const { isArmed } = useArmedLock(install.deviceId);

  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);
  const [updateSettingsOpen, setUpdateSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // A row the node reported, with no cloud install record.
  const agentOnly =
    install.installId.startsWith("agent:") || install.installId.startsWith("lan:");
  // The pending update event (if any) is the only pin evidence the GCS has.
  const pendingUpdate = usePluginUpdateStore((s) =>
    s.pendingUpdates.find(
      (e) => e.deviceId === install.deviceId && e.pluginId === install.pluginId,
    ),
  );

  // The lifecycle command currently awaiting an agent ACK. We keep the
  // operator action pending (spinner held, local status NOT flipped)
  // until the agent confirms the command completed or failed — the
  // agent's failed-ACK must surface as a failure, never as success.
  const [pendingCommand, setPendingCommand] = useState<{
    commandId: Id<"cmd_droneCommands">;
    kind: PluginActionKind;
    nextStatus: "enabled" | "disabled";
  } | null>(null);
  // True once a relayed command has sat untaken past the waiting threshold.
  const [waiting, setWaiting] = useState(false);
  // Guards the ACK effect against double-applying the same terminal row.
  const ackedRef = useRef<string | null>(null);

  // Convex mutations. These resolve through `api.*` to keep the
  // typed-api guard rails on. In demo mode they are not called at all.
  const enqueueCommand = useMutation(api.cmdDroneCommands.enqueueCommand);
  const cancelCommand = useMutation(api.cmdDroneCommands.cancelCommand);
  const setStatus = useMutation(api.cmdPlugins.setStatus);
  const removeInstall = useMutation(api.cmdPlugins.removeInstall);

  // Reactively watch the in-flight command row for its terminal ACK.
  // Convex pushes the row update the instant the agent acks, so the
  // card reflects the real outcome without polling.
  const commandRow = useConvexSkipQuery(api.cmdDroneCommands.getCommandStatus, {
    args: { commandId: pendingCommand?.commandId as Id<"cmd_droneCommands"> },
    enabled: pendingCommand !== null,
  });

  const actionWord = useCallback(
    (kind: PluginActionKind) =>
      kind === "enable" ? t("enable") : kind === "disable" ? t("disable") : t("uninstall"),
    [t],
  );

  const toastFailure = useCallback(
    (kind: PluginActionKind, error: string) => {
      toast(t("actionFailed", { action: actionWord(kind), error }), "error");
    },
    [actionWord, t, toast],
  );

  const clearPending = useCallback(() => {
    setPendingCommand(null);
    setWaiting(false);
    setBusy(false);
  }, []);

  // The node did what was asked: mirror it on the cloud install record (an
  // agent-only row has none; the node's next report carries the new state)
  // and say so.
  const settleSuccess = useCallback(
    async (kind: PluginActionKind) => {
      try {
        if (!agentOnly) {
          const installId = install.installId as Id<"cmd_pluginInstalls">;
          if (kind === "uninstall") await removeInstall({ installId });
          else await setStatus({ installId, status: kind === "enable" ? "enabled" : "disabled" });
        }
        toast(
          kind === "enable"
            ? t("enableConfirmed", { name: install.name })
            : kind === "disable"
              ? t("disableConfirmed", { name: install.name })
              : t("uninstallConfirmed", { name: install.name }),
          "success",
        );
      } catch (err) {
        toastFailure(kind, err instanceof Error ? err.message : String(err));
      }
    },
    [agentOnly, install.installId, install.name, removeInstall, setStatus, t, toast, toastFailure],
  );

  // Resolve the operator action once the watched command reaches a
  // terminal status. On `completed` we apply the local install-state
  // change; on `failed` we surface the agent's failure message and
  // leave the status untouched so a no-op never renders as success.
  useEffect(() => {
    if (!pendingCommand || !commandRow) return;
    const { status } = commandRow;
    if (status !== "completed" && status !== "failed") return;
    if (ackedRef.current === commandRow._id) return;
    ackedRef.current = commandRow._id;

    const { kind } = pendingCommand;
    if (status === "failed") {
      const message = commandRow.result?.message;
      toastFailure(
        kind,
        typeof message === "string" && message.length > 0 ? message : t("agentRejected"),
      );
      clearPending();
      return;
    }
    void settleSuccess(kind).finally(clearPending);
  }, [clearPending, commandRow, pendingCommand, settleSuccess, t, toastFailure]);

  // While a relayed command sits untaken, say so after a few seconds; once its
  // delivery window has closed the node can no longer run it, so stop waiting.
  const nodeHasIt = commandRow?.status === "delivering";
  useEffect(() => {
    if (!pendingCommand || nodeHasIt) {
      setWaiting(false);
      return;
    }
    const waitingTimer = setTimeout(() => setWaiting(true), PLUGIN_COMMAND_WAITING_AFTER_MS);
    const expiryTimer = setTimeout(() => {
      toastFailure(pendingCommand.kind, t("notPickedUp", { name: install.name }));
      clearPending();
    }, PLUGIN_COMMAND_TTL_MS);
    return () => {
      clearTimeout(waitingTimer);
      clearTimeout(expiryTimer);
    };
  }, [clearPending, install.name, nodeHasIt, pendingCommand, t, toastFailure]);

  // No trust badge post-install, deliberately. The only trust-bearing field on
  // an install row is `signerId`, which is a client-supplied argument on
  // `plugins.recordInstall` with no server-side enrolled-key check — a declared
  // value, not a verification result. Rendering Signed / Verified / First-party
  // from it is the fabricated trust cue this card must not produce.
  //
  // The archive's signature IS verified at install time against the archive
  // bytes (`transports/finalize-gcs-install`), and the install pop-up badges
  // that outcome. Until that outcome has a column to live in, the card shows
  // status only. The row carries no license or vendor-attribution field either,
  // so there is nothing else here to badge.

  const statusLabel: DronePluginStatusLabel =
    install.status === "running"
      ? "running"
      : install.status === "enabled"
        ? "enabled"
        : install.status === "crashed"
          ? // A plugin the node stopped carries the node's reason; that is a
            // refusal, not a crash.
            install.failureReason
            ? "stopped"
            : "crashed"
          : install.status === "disabled"
            ? "disabled"
            : "installed";

  const isEnabled =
    install.status === "running" || install.status === "enabled";

  // Run one lifecycle action: straight to the node over the LAN when it can
  // be reached, else through the cloud relay (cloud-registered nodes only).
  const runAction = useCallback(
    async (kind: PluginActionKind) => {
      if (pendingCommand || busy) return;
      setBusy(true);
      ackedRef.current = null;

      const lan = resolveLanAgent(install.deviceId);
      if (lan) {
        try {
          const client = new PluginAgentClient(lan.agentUrl, lan.apiKey);
          if (kind === "enable") await client.enable(install.pluginId);
          else if (kind === "disable") await client.disable(install.pluginId);
          else await client.remove(install.pluginId);
          await settleSuccess(kind);
        } catch (err) {
          toastFailure(kind, err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
        return;
      }

      if (agentOnly) {
        // Only the node knows this row, and it is not reachable on the LAN:
        // the relay has no cloud record to act on.
        toastFailure(kind, t("nodeUnreachable", { name: install.name }));
        setBusy(false);
        return;
      }

      try {
        const { commandId } = await enqueueCommand({
          deviceId: install.deviceId,
          command:
            kind === "enable"
              ? "plugin.enable"
              : kind === "disable"
                ? "plugin.disable"
                : "plugin.uninstall",
          args: { pluginId: install.pluginId },
          ttlMs: PLUGIN_COMMAND_TTL_MS,
        });
        setPendingCommand({
          commandId,
          kind,
          nextStatus: kind === "enable" ? "enabled" : "disabled",
        });
        toast(
          kind === "enable"
            ? t("enableQueued", { name: install.name })
            : kind === "disable"
              ? t("disableQueued", { name: install.name })
              : t("uninstallQueued", { name: install.name }),
          "info",
        );
      } catch (err) {
        toastFailure(kind, err instanceof Error ? err.message : String(err));
        setBusy(false);
      }
    },
    [agentOnly, busy, enqueueCommand, install, pendingCommand, settleSuccess, t, toast, toastFailure],
  );

  const handleToggleEnable = useCallback(async () => {
    if (isDemoMode()) {
      toast(t("demoActionDisabled"), "info");
      return;
    }
    if (pendingCommand) return;
    // Stopping an extension asks first, as Uninstall does.
    if (isEnabled) {
      setConfirmDisableOpen(true);
      return;
    }
    await runAction("enable");
  }, [isEnabled, pendingCommand, runAction, t, toast]);

  const handleConfirmDisable = useCallback(async () => {
    setConfirmDisableOpen(false);
    if (isDemoMode()) {
      toast(t("demoActionDisabled"), "info");
      return;
    }
    await runAction("disable");
  }, [runAction, t, toast]);

  const handleOverflow = useCallback(
    async (id: string) => {
      if (id === "permissions") {
        router.push(`/config/plugins/${install.installId}?tab=permissions`);
        return;
      }
      if (id === "uninstall") {
        setConfirmRemoveOpen(true);
        return;
      }
    },
    [install.installId, router],
  );

  const handleRemove = useCallback(async () => {
    setConfirmRemoveOpen(false);
    if (isDemoMode()) {
      toast(t("demoActionDisabled"), "info");
      return;
    }
    await runAction("uninstall");
  }, [runAction, t, toast]);

  // Withdraw a relayed command the node has not taken yet. Once the node has
  // it, its answer decides and the card keeps waiting for it.
  const handleCancelPending = useCallback(async () => {
    if (!pendingCommand) return;
    try {
      const { cancelled } = await cancelCommand({ commandId: pendingCommand.commandId });
      if (cancelled) {
        ackedRef.current = pendingCommand.commandId;
        toast(t("commandCancelled", { name: install.name }), "info");
        clearPending();
      } else {
        toast(t("cancelTooLate", { name: install.name }), "info");
      }
    } catch (err) {
      toastFailure(pendingCommand.kind, err instanceof Error ? err.message : String(err));
    }
  }, [cancelCommand, clearPending, install.name, pendingCommand, t, toast, toastFailure]);

  return {
    confirmRemoveOpen,
    setConfirmRemoveOpen,
    confirmDisableOpen,
    setConfirmDisableOpen,
    updateSettingsOpen,
    setUpdateSettingsOpen,
    busy,
    waiting,
    isArmed,
    agentOnly,
    pendingUpdate,
    statusLabel,
    isEnabled,
    handleToggleEnable,
    handleConfirmDisable,
    handleOverflow,
    handleRemove,
    handleCancelPending,
  };
}
