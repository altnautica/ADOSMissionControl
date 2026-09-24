"use client";

/**
 * @module drone-detail/cameras/CameraCard
 * @description One camera in the roster: a live preview (when a WHEP URL is
 * known) over a mount glyph, the name + role + purpose chips + resolution, an
 * enabled toggle, and edit / assign / remove actions. A plugin-owned camera
 * renders read-only with a note linking to the owning extension's tab.
 * @license GPL-3.0-only
 */

import { memo } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpToLine,
  Camera,
  Compass,
  Move3d,
  Pencil,
  Plus,
  Puzzle,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { RosterCamera } from "@/lib/agent/feature-types";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import { useUiStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";
import { CameraThumbnail } from "./CameraThumbnail";

const ORIENTATION_ICON: Record<string, LucideIcon> = {
  forward: ArrowUp,
  back: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
  down: ArrowDownToLine,
  up: ArrowUpToLine,
  gimbal: Move3d,
  custom: Compass,
};

export interface CameraCardProps {
  camera: RosterCamera;
  /** Resolved WHEP URL for a live preview, or null when none is known. */
  whepUrl?: string | null;
  /** Cloud mode / no LAN client — controls are disabled. */
  readOnly: boolean;
  onEdit: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onRemove: (id: string) => void;
}

function CameraCardBase({
  camera,
  whepUrl,
  readOnly,
  onEdit,
  onToggle,
  onRemove,
}: CameraCardProps) {
  const t = useTranslations("cameras");
  const setPendingAgentPanel = useUiStore((s) => s.setPendingAgentPanel);
  const setPendingPluginId = useUiStore((s) => s.setPendingPluginId);

  const pluginOwned = camera.state === "plugin_owned";
  const discovered = camera.state === "discovered_unassigned";
  const locked = readOnly || pluginOwned;

  const OrientationIcon =
    (camera.orientation && ORIENTATION_ICON[camera.orientation]) || Camera;
  const resolution =
    camera.width && camera.height ? `${camera.width}×${camera.height}` : null;

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border-default bg-bg-secondary">
      {/* Preview */}
      <div className="relative aspect-video w-full overflow-hidden bg-bg-tertiary">
        <div className="absolute inset-0 flex items-center justify-center">
          <OrientationIcon
            className="h-8 w-8 text-text-tertiary/50"
            aria-hidden
          />
        </div>
        {whepUrl ? (
          <CameraThumbnail whepUrl={whepUrl} className="absolute inset-0" />
        ) : null}
        <div className="absolute left-2 top-2 flex items-center gap-1.5">
          <StateBadge state={camera.state} label={t(`state.${camera.state}`)} />
        </div>
        {camera.live === true ? (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded bg-scrim/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-status-success">
            <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
            {t("card.live")}
          </span>
        ) : null}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <OrientationIcon
              className="h-4 w-4 shrink-0 text-accent-primary"
              aria-hidden
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text-primary">
                {camera.name ?? camera.id}
              </p>
              <p className="truncate text-[11px] text-text-tertiary">
                {camera.orientation
                  ? t(`orientation.${camera.orientation}`)
                  : t("orientation.none")}
                {camera.role ? ` · ${roleLabel(camera.role, t)}` : ""}
              </p>
            </div>
          </div>
          {!locked && !discovered ? (
            // The primary stream is always served: its switch reads on and
            // cannot be turned off.
            <Toggle
              label={t("card.enabled")}
              checked={camera.role === "primary" || camera.enabled}
              onChange={(v) => onToggle(camera.id, v)}
              disabled={camera.role === "primary"}
              className="shrink-0"
            />
          ) : null}
        </div>

        {/* Purpose chips */}
        {camera.purpose.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {camera.purpose.map((p) => (
              <span
                key={p}
                className={cn(
                  "rounded border px-1.5 py-0.5 text-[10px] font-medium",
                  p === "detect"
                    ? "border-accent-primary/40 bg-accent-primary/10 text-accent-primary"
                    : "border-border-default bg-bg-tertiary text-text-secondary",
                )}
              >
                {t(`purpose.${p}`)}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-text-tertiary">{t("card.noPurpose")}</p>
        )}

        <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
          <span className="truncate font-mono">
            {camera.device_path ?? camera.source}
          </span>
          {resolution ? <span className="shrink-0">{resolution}</span> : null}
        </div>

        {/* Actions */}
        <div className="mt-auto flex items-center gap-2 pt-1">
          {pluginOwned ? (
            <button
              type="button"
              onClick={() => {
                // Reveal the owning plugin in the Plugins panel.
                setPendingPluginId(camera.owner ?? null);
                setPendingAgentPanel("plugins");
              }}
              className="inline-flex items-center gap-1 text-[11px] text-text-tertiary hover:text-accent-primary"
            >
              <Puzzle className="h-3 w-3" aria-hidden />
              {t("card.managedBy", { owner: camera.owner ?? "extension" })}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={readOnly}
                onClick={() => onEdit(camera.id)}
                className={cn(
                  "inline-flex items-center gap-1 rounded border border-border-default px-2 py-1 text-[11px] text-text-secondary hover:border-accent-primary/40 hover:text-text-primary",
                  readOnly && "cursor-not-allowed opacity-50",
                )}
              >
                {discovered ? (
                  <Plus className="h-3 w-3" aria-hidden />
                ) : (
                  <Pencil className="h-3 w-3" aria-hidden />
                )}
                {discovered ? t("card.assign") : t("card.edit")}
              </button>
              {!discovered ? (
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => onRemove(camera.id)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded border border-transparent px-2 py-1 text-[11px] text-text-tertiary hover:border-status-error/40 hover:text-status-error",
                    readOnly && "cursor-not-allowed opacity-50",
                  )}
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                  {t("card.remove")}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Memoized: the roster re-renders the whole grid on any save/restart flag
 * change, but a card only needs to re-render when its own props change. */
export const CameraCard = memo(CameraCardBase);

type T = ReturnType<typeof useTranslations>;

/** A known role gets a localized label; a novel one renders raw. */
function roleLabel(role: string, t: T): string {
  return role === "primary" ? t("card.primary") : role;
}

function StateBadge({
  state,
  label,
}: {
  state: RosterCamera["state"];
  label: string;
}) {
  const variant =
    state === "assigned"
      ? "success"
      : state === "plugin_owned"
        ? "info"
        : state === "offline"
          ? "error"
          : "neutral";
  return (
    <Badge variant={variant} size="sm">
      {label}
    </Badge>
  );
}
