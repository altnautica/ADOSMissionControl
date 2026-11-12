"use client";

/**
 * @module DronePluginCard
 * @description Single plugin row inside the per-drone Plugins list.
 * Renders the plugin name + version + status pill, an Enable/Disable
 * toggle, a Configure link, and a three-dot overflow menu. Enable, Disable
 * and Uninstall go straight to a node reachable on the LAN, else through the
 * `cmd_droneCommands` relay; Disable and Uninstall ask first.
 *
 * A row reported by the node itself but with no cloud install record
 * (`installId` of `agent:<pluginId>` from the heartbeat inventory, or
 * `lan:<pluginId>` from the node's own install list) has no Convex row to
 * update: its state follows the node's next report, and it offers no cloud
 * configure or permissions page.
 *
 * @license GPL-3.0-only
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import type { Id } from "../../../../convex/_generated/dataModel";
import type { PluginInstallSummary } from "@/lib/plugins/types";
import type {
  PluginModelStatusEntry,
  PluginServiceStatusEntry,
} from "@/stores/agent-plugin-inventory-store";
import { usePluginUpdateStore } from "@/stores/plugin-update-store";
import { api } from "../../../../convex/_generated/api";


import {
  DronePluginStatusPill,
  type DronePluginStatusLabel,
} from "./DronePluginStatusPill";
import { useDronePluginActions } from "./use-drone-plugin-actions";
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
  /** Why the node stopped or refused the plugin (the agent's
   * `failure_reason`), absent when it has not failed. */
  failureReason?: string;
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
  const {
    confirmRemoveOpen,
    setConfirmRemoveOpen,
    confirmDisableOpen,
    setConfirmDisableOpen,
    updateSettingsOpen,
    setUpdateSettingsOpen,
    busy,
    waiting,
    armedNote,
    agentOnly,
    pendingUpdate,
    statusLabel,
    isEnabled,
    handleToggleEnable,
    handleConfirmDisable,
    handleOverflow,
    handleRemove,
    handleCancelPending,
  } = useDronePluginActions(install);
  // Known delivery states read as words; an unrecognised one says so.
  const modelStateWord = (state: string) =>
    state === "resolved" || state === "needs_model" || state === "verify_failed"
      ? t(`modelState.${state}`)
      : t("modelState.unknown");

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
                  title={
                    m.reason
                      ? t("modelStateReason", { state: modelStateWord(m.state), reason: m.reason })
                      : modelStateWord(m.state)
                  }
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
                    s.ready
                      ? t("serviceReady")
                      : s.reason
                        ? t("serviceNotReadyReason", { reason: s.reason })
                        : t("serviceNotReady")
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

      {waiting ? (
        <div
          data-testid="plugin-command-waiting"
          className="flex items-center justify-end gap-2 text-xs text-text-tertiary"
          role="status"
        >
          <span>{t("waitingForNode", { name: install.name })}</span>
          <Button variant="ghost" size="sm" onClick={handleCancelPending}>
            {t("cancelCommand")}
          </Button>
        </div>
      ) : null}

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
        {agentOnly ? null : (
          <Link href={`/config/plugins/${install.installId}`} passHref>
            <Button
              variant="ghost"
              size="sm"
              icon={<Settings className="h-3.5 w-3.5" />}
            >
              {t("configure")}
            </Button>
          </Link>
        )}
        <DropdownMenu
          align="right"
          trigger={
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("moreActions")}
              title={t("moreActions")}
              icon={<MoreHorizontal className="h-3.5 w-3.5" />}
            />
          }
          items={[
            ...(agentOnly
              ? []
              : [
                  {
                    id: "permissions",
                    label: t("viewPermissions"),
                    icon: <ShieldCheck className="h-3.5 w-3.5" />,
                  },
                  { id: "divider", label: "", divider: true },
                ]),
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

      <ConfirmDialog
        open={confirmDisableOpen}
        onConfirm={handleConfirmDisable}
        onCancel={() => setConfirmDisableOpen(false)}
        title={t("disableConfirmTitle", { name: install.name })}
        message={
          armedNote
            ? `${t("disableConfirmMessage")} ${t(armedNote === "armed" ? "disableArmedNote" : "disableArmedUnknownNote")}`
            : t("disableConfirmMessage")
        }
        confirmLabel={t("disable")}
        variant="danger"
      />

      {updateSettingsOpen ? (
        <PluginUpdateSettings
          deviceId={install.deviceId}
          pluginId={install.pluginId}
          pluginName={install.name}
          currentVersion={install.version}
          // The agent does not report its auto-update switch or last sweep
          // time to the GCS, so both are unknown; a pin is known only when
          // the pending update event says the pin held it back.
          autoUpdate={null}
          pinned={pendingUpdate?.reason === "pinned" ? true : null}
          lastUpdateCheckAt={null}
          onClose={() => setUpdateSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}
