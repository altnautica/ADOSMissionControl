"use client";

/**
 * @module node-detail/NodeHeaderChips
 * @description The node-detail header's live status chips, each its own
 * component so the fast-changing input it subscribes to re-renders only the
 * chip, not the whole panel and its active surface:
 *
 * - `NodeConnectChip` keeps this node's agent connected (`useNodeConnect`) and
 *   shows when the last connect failed. It reads the fleet node list, which is
 *   rebuilt on every registry update (FC telemetry rate).
 * - `NodeAuthorityChip` shows whether this browser may command the node. Its
 *   notice ages on the shared 1 Hz clock.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { PlugZap } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";
import { useFleetNodes } from "@/hooks/use-fleet-nodes";
import { useNodeControlAuthorityNotice } from "@/hooks/use-node-control-authority";
import { useNodeConnect } from "./use-node-connect";

/** Connects the node's agent while the panel shows it; visible from every
 * tab when the last connect did not reach the agent. Retried on its own; the
 * button retries now. */
export function NodeConnectChip({ focusDeviceId }: { focusDeviceId: string | null }) {
  const t = useTranslations("dronePanel");
  const tRoot = useTranslations();
  const fleetNodes = useFleetNodes();
  const focusEntry = fleetNodes.find((n) => n.deviceId === focusDeviceId) ?? null;
  const { connectFailing, retryNow } = useNodeConnect(focusDeviceId, focusEntry);
  if (!connectFailing) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded border border-status-error/40 bg-status-error/10 px-1.5 py-0.5 text-[10px] font-medium text-status-error">
      <PlugZap size={11} aria-hidden="true" />
      {tRoot("nodeConsole.hero.offline")}
      <button
        type="button"
        onClick={retryNow}
        className="underline underline-offset-2 hover:text-status-error/80 cursor-pointer"
      >
        {t("retryConnect")}
      </button>
    </span>
  );
}

/**
 * Whether this browser may publish FC frames to THIS node. Surfaced on the
 * header rather than inside one tab, because every tab that writes to the
 * vehicle rides the same lane. Separate from liveness: a node can be online
 * and uncommandable at the same time.
 */
export function NodeAuthorityChip({ droneId }: { droneId: string }) {
  const authority = useNodeControlAuthorityNotice(droneId);
  if (!authority.show) return null;
  return (
    <span
      className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded border border-status-warning/40 bg-status-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-status-warning"
      title={authority.detail}
    >
      <StatusDot status={authority.level} size="xs" label={authority.detail} />
      {authority.label}
      <span className="sr-only">{authority.detail}</span>
    </span>
  );
}
