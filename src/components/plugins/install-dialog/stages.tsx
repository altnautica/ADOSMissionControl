/**
 * @module PluginInstallDialogStages
 * @description Stage components for the plugin install dialog. The
 * review surface is composed under `./sections/` so this file only
 * carries the local-file pick screen, the install-in-flight notice,
 * and the error stage. The dialog owns the state machine and feeds
 * props in.
 *
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import {
  Upload,
  AlertTriangle,
  Cloud,
  Wifi,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { InstallTransport } from "../transports/types";

export function TransportChrome({
  targetName,
  transport,
  lanAvailable,
}: {
  targetName: string;
  transport: InstallTransport;
  lanAvailable: boolean;
}) {
  const icon =
    transport === "lan" ? (
      <Wifi className="h-3 w-3" />
    ) : (
      <Cloud className="h-3 w-3" />
    );
  const label =
    transport === "lan"
      ? `LAN direct to ${targetName}`
      : `Cloud relay${lanAvailable ? " (forced)" : ""}`;
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border-default px-4 py-2 text-xs text-text-tertiary">
      <Badge variant={transport === "lan" ? "success" : "info"} size="sm">
        <span className="inline-flex items-center gap-1">
          {icon}
          {label}
        </span>
      </Badge>
    </div>
  );
}

export function PickStage({
  dragActive,
  setDragActive,
  onDrop,
  onPick,
}: {
  dragActive: boolean;
  setDragActive: (v: boolean) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const tk = useTranslations("plugins.stages");
  return (
    <div className="space-y-3 p-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-8 text-center",
          dragActive
            ? "border-accent-primary bg-accent-primary/5"
            : "border-border-default",
        )}
      >
        <Upload className="h-8 w-8 text-text-tertiary" />
        <p className="text-sm text-text-primary">
          {tk("dragA")} <code>.adosplug</code> here or pick a file.
        </p>
        <label className="cursor-pointer text-xs text-accent-primary underline">
          <input
            type="file"
            accept=".adosplug,application/zip"
            className="hidden"
            onChange={onPick}
          />
          {tk("chooseFile")}
        </label>
      </div>
    </div>
  );
}

export function ErrorStage({
  error,
  onClose,
  onRetry,
}: {
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
}) {
  const tk = useTranslations("plugins.stages");
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-start gap-2 rounded-md border border-status-error/30 bg-status-error/10 p-3">
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0 text-status-error"
          aria-hidden
        />
        <p className="text-sm text-status-error">{error}</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {tk("close")}
        </Button>
        <Button variant="secondary" onClick={onRetry}>
          {tk("tryAgain")}
        </Button>
      </div>
    </div>
  );
}
