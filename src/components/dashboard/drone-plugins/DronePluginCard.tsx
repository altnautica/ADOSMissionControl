"use client";

/**
 * @module DronePluginCard
 * @description Single plugin row inside the per-drone Plugins list.
 * Renders the plugin name + version + trust badges + status
 * pill, an Enable/Disable toggle, a Configure link, and a three-dot
 * overflow menu. Enable/Disable enqueues `plugin.enable` or
 * `plugin.disable` against the drone's agent via the existing
 * `cmd_droneCommands` queue. The card stays transport-agnostic; the
 * agent picks the right transport per the management-actions matrix
 * in `product/specs/ados-plugin-system/18-ux-plugin-management.md`
 * Section 6.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  MoreHorizontal,
  Settings,
  Trash2,
  FileText,
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
import type { Id } from "../../../../convex/_generated/dataModel";
import type { PluginInstallSummary } from "@/lib/plugins/types";
import type {
  PluginModelStatusEntry,
  PluginServiceStatusEntry,
} from "@/stores/agent-plugin-inventory-store";
import { api } from "../../../../convex/_generated/api";

import {
  DronePluginStatusPill,
  type DronePluginStatusLabel,
} from "./DronePluginStatusPill";
import { UpdateAvailableBadge } from "./UpdateAvailableBadge";
import { PluginUpdateSettings } from "./PluginUpdateSettings";

export interface DronePluginCardData extends PluginInstallSummary {
  /** Convex install row id, used to drive enable/disable mutations. */
  installId: string;
  /** Cloud device id for this drone, used to enqueue commands. */
  deviceId: string;
  /** Per-model delivery outcome reported by the agent (heartbeat inventory). */
  modelStatus?: PluginModelStatusEntry[];
  /** Per-service readiness reported by the agent (heartbeat inventory). */
  serviceStatus?: PluginServiceStatusEntry[];
}

/** Dot colour for a model-delivery state: green resolved, amber needs-model,
 *  red verify-failed (a fetched model whose digest did not match the pin). */
function modelDotClass(state: string): string {
  if (state === "resolved") return "bg-status-success";
  if (state === "verify_failed") return "bg-status-error";
  return "bg-status-warning";
}

interface DronePluginCardProps {
  install: DronePluginCardData;
  /** Optional class on the card root. */
  className?: string;
}

export function DronePluginCard({ install, className }: DronePluginCardProps) {
  const t = useTranslations("dronePlugins");
  const { toast } = useToast();

  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [updateSettingsOpen, setUpdateSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // The lifecycle command currently awaiting an agent ACK. We keep the
  // operator action pending (spinner held, local status NOT flipped)
  // until the agent confirms the command completed or failed — the
  // agent's failed-ACK must surface as a failure, never as success.
  const [pendingCommand, setPendingCommand] = useState<{
    commandId: Id<"cmd_droneCommands">;
    kind: "enable" | "disable" | "uninstall";
    nextStatus: "enabled" | "disabled";
  } | null>(null);
  // Guards the ACK effect against double-applying the same terminal row.
  const ackedRef = useRef<string | null>(null);

  // Convex mutations. These resolve through `api.*` to keep the
  // typed-api guard rails on. In demo mode they are not called at all.
  const enqueueCommand = useMutation(api.cmdDroneCommands.enqueueCommand);
  const setStatus = useMutation(api.cmdPlugins.setStatus);
  const removeInstall = useMutation(api.cmdPlugins.removeInstall);

  // Reactively watch the in-flight command row for its terminal ACK.
  // Convex pushes the row update the instant the agent acks, so the
  // card reflects the real outcome without polling.
  const commandRow = useConvexSkipQuery(api.cmdDroneCommands.getCommandStatus, {
    args: { commandId: pendingCommand?.commandId as Id<"cmd_droneCommands"> },
    enabled: pendingCommand !== null,
  });

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

    const { kind, nextStatus } = pendingCommand;

    if (status === "failed") {
      const message = commandRow.result?.message;
      toast(
        t("actionFailed", {
          action:
            kind === "enable"
              ? t("enable")
              : kind === "disable"
                ? t("disable")
                : t("uninstall"),
          error:
            typeof message === "string" && message.length > 0
              ? message
              : t("agentRejected"),
        }),
        "error",
      );
      setPendingCommand(null);
      setBusy(false);
      return;
    }

    // status === "completed": commit the local install-state change.
    const apply = async () => {
      try {
        if (kind === "uninstall") {
          await removeInstall({
            installId: install.installId as Id<"cmd_pluginInstalls">,
          });
          toast(t("uninstallConfirmed", { name: install.name }), "success");
        } else {
          await setStatus({
            installId: install.installId as Id<"cmd_pluginInstalls">,
            status: nextStatus,
          });
          toast(
            kind === "enable"
              ? t("enableConfirmed", { name: install.name })
              : t("disableConfirmed", { name: install.name }),
            "success",
          );
        }
      } catch (err) {
        toast(
          t("actionFailed", {
            action:
              kind === "enable"
                ? t("enable")
                : kind === "disable"
                  ? t("disable")
                  : t("uninstall"),
            error: err instanceof Error ? err.message : String(err),
          }),
          "error",
        );
      } finally {
        setPendingCommand(null);
        setBusy(false);
        setConfirmRemoveOpen(false);
      }
    };
    void apply();
  }, [
    commandRow,
    pendingCommand,
    install,
    removeInstall,
    setStatus,
    t,
    toast,
  ]);

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
          ? "crashed"
          : install.status === "disabled"
            ? "disabled"
            : "installed";

  const isEnabled =
    install.status === "running" || install.status === "enabled";

  const handleToggleEnable = useCallback(async () => {
    if (isDemoMode()) {
      toast(t("demoActionDisabled"), "info");
      return;
    }
    if (pendingCommand) return;
    setBusy(true);
    ackedRef.current = null;
    try {
      const nextStatus: "enabled" | "disabled" = isEnabled
        ? "disabled"
        : "enabled";
      // Enqueue the command and wait for the agent's ACK before flipping
      // the local install state. The status only changes once the agent
      // confirms the command completed (see the ACK effect above).
      const { commandId } = await enqueueCommand({
        deviceId: install.deviceId,
        command: isEnabled ? "plugin.disable" : "plugin.enable",
        args: { pluginId: install.pluginId },
      });
      setPendingCommand({
        commandId,
        kind: isEnabled ? "disable" : "enable",
        nextStatus,
      });
      toast(
        isEnabled
          ? t("disableQueued", { name: install.name })
          : t("enableQueued", { name: install.name }),
        "info",
      );
    } catch (err) {
      toast(
        t("actionFailed", {
          action: isEnabled ? t("disable") : t("enable"),
          error: err instanceof Error ? err.message : String(err),
        }),
        "error",
      );
      setBusy(false);
    }
  }, [
    enqueueCommand,
    install,
    isEnabled,
    pendingCommand,
    t,
    toast,
  ]);

  const handleOverflow = useCallback(
    async (id: string) => {
      if (id === "logs") {
        toast(t("logsPending"), "info");
        return;
      }
      if (id === "permissions") {
        toast(t("permissionsLinkPending"), "info");
        return;
      }
      if (id === "uninstall") {
        setConfirmRemoveOpen(true);
        return;
      }
    },
    [t, toast],
  );

  const handleRemove = useCallback(async () => {
    if (isDemoMode()) {
      toast(t("demoActionDisabled"), "info");
      setConfirmRemoveOpen(false);
      return;
    }
    if (pendingCommand) return;
    setBusy(true);
    ackedRef.current = null;
    try {
      // Enqueue the uninstall and wait for the agent's ACK before
      // removing the local install row. A failed ACK keeps the row and
      // surfaces the failure (see the ACK effect above).
      const { commandId } = await enqueueCommand({
        deviceId: install.deviceId,
        command: "plugin.uninstall",
        args: { pluginId: install.pluginId },
      });
      setPendingCommand({
        commandId,
        kind: "uninstall",
        nextStatus: "disabled",
      });
      toast(t("uninstallQueued", { name: install.name }), "info");
    } catch (err) {
      toast(
        t("actionFailed", {
          action: t("uninstall"),
          error: err instanceof Error ? err.message : String(err),
        }),
        "error",
      );
      setBusy(false);
    }
    setConfirmRemoveOpen(false);
  }, [enqueueCommand, install, pendingCommand, t, toast]);

  return (
    <div
      data-testid={`drone-plugin-card-${install.pluginId}`}
      className={cn(
        "flex flex-col gap-2 rounded-md border border-border-default bg-bg-secondary p-3",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-text-primary">
              {install.name}
            </span>
            <span className="text-xs text-text-tertiary">
              v{install.version}
            </span>
          </div>
          <code className="block truncate text-xs text-text-tertiary">
            {install.pluginId}
          </code>
          {install.modelStatus && install.modelStatus.length > 0 ? (
            <div
              data-testid="plugin-model-status"
              className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1"
            >
              {install.modelStatus.map((m) => (
                <span
                  key={m.model_id}
                  className="inline-flex items-center gap-1 text-xs text-text-tertiary"
                  title={m.reason ? `${m.state}: ${m.reason}` : m.state}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      modelDotClass(m.state),
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{m.model_id}</span>
                </span>
              ))}
            </div>
          ) : null}
          {install.serviceStatus && install.serviceStatus.length > 0 ? (
            <div
              data-testid="plugin-service-status"
              className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1"
            >
              {install.serviceStatus.map((s) => (
                <span
                  key={s.name}
                  className="inline-flex items-center gap-1 text-xs text-text-tertiary"
                  title={
                    s.ready ? "ready" : s.reason ? `not ready: ${s.reason}` : "not ready"
                  }
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      s.ready ? "bg-status-success" : "bg-status-error",
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{s.name}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <UpdateAvailableBadge
            deviceId={install.deviceId}
            pluginId={install.pluginId}
            onClick={() => setUpdateSettingsOpen(true)}
          />
          <DronePluginStatusPill label={statusLabel} />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant={isEnabled ? "secondary" : "primary"}
          size="sm"
          icon={
            busy ? (
              <RotateCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Power className="h-3.5 w-3.5" />
            )
          }
          disabled={busy}
          onClick={handleToggleEnable}
        >
          {isEnabled ? t("disable") : t("enable")}
        </Button>
        <Link href={`/config/plugins/${install.installId}`} passHref>
          <Button
            variant="ghost"
            size="sm"
            icon={<Settings className="h-3.5 w-3.5" />}
          >
            {t("configure")}
          </Button>
        </Link>
        <DropdownMenu
          align="right"
          trigger={
            <Button
              variant="ghost"
              size="sm"
              icon={<MoreHorizontal className="h-3.5 w-3.5" />}
            />
          }
          items={[
            {
              id: "logs",
              label: t("viewLogs"),
              icon: <FileText className="h-3.5 w-3.5" />,
            },
            {
              id: "permissions",
              label: t("viewPermissions"),
              icon: <ShieldCheck className="h-3.5 w-3.5" />,
            },
            { id: "divider", label: "", divider: true },
            {
              id: "uninstall",
              label: t("uninstall"),
              icon: <Trash2 className="h-3.5 w-3.5" />,
              danger: true,
            },
          ]}
          onSelect={handleOverflow}
        />
      </div>

      <ConfirmDialog
        open={confirmRemoveOpen}
        onConfirm={handleRemove}
        onCancel={() => setConfirmRemoveOpen(false)}
        title={t("uninstallConfirmTitle")}
        message={t("uninstallConfirmMessage", { name: install.name })}
        confirmLabel={t("uninstall")}
        variant="danger"
      />

      {updateSettingsOpen ? (
        <PluginUpdateSettings
          deviceId={install.deviceId}
          pluginId={install.pluginId}
          pluginName={install.name}
          currentVersion={install.version}
          autoUpdate={true}
          pinnedVersion={null}
          lastUpdateCheckAt={null}
          onClose={() => setUpdateSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}

