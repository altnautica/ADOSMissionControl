"use client";

/**
 * @module vision/PerceptionTierCard
 * @description The Perception hub's execution-tier surface. Shows the tier the
 * agent resolved for this node — local (on the node's NPU), offload (to a
 * workstation), hybrid, or none — with the accelerator rationale behind it, and
 * lets the operator pin the workstation it offloads to. The tier + the current
 * offload target are read from the heartbeat (honest status, never fabricated);
 * the pinned workstation is the persisted `perception.offload.compute_node_addr`
 * config link (the same value the node Settings tab edits — two views of one
 * link), so the choice survives unmount. The node's own offload reconciler
 * reads that pin and opens the streaming session itself; the card only sets
 * the pin and reports what the node says.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Cpu, Layers } from "lucide-react";

import { Select, type SelectOption } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";
import { perceptionFeedState } from "@/lib/vision/perception-health";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import {
  useNodeConfig,
  readConfigPath,
} from "@/components/command/settings/use-node-config";
import { nodeToOffloadAddr } from "@/lib/vision/offload-target";
import type { RelayReach } from "@/lib/nodes/relay-reach";

/** The config key holding this node's pinned offload workstation address. */
const PIN_KEY = "perception.offload.compute_node_addr";

type Tier = "local" | "offload" | "hybrid" | "none" | "unknown";

const TIER_STYLE: Record<Tier, string> = {
  local: "border-status-success/40 bg-status-success/10 text-status-success",
  offload: "border-accent-primary/40 bg-accent-primary/10 text-accent-primary",
  hybrid: "border-accent-primary/40 bg-accent-primary/10 text-accent-primary",
  none: "border-border-default bg-bg-tertiary text-text-tertiary",
  unknown: "border-border-default bg-bg-tertiary text-text-tertiary",
};

interface PerceptionTierCardProps {
  droneId: string;
  /** The node this card is rendered for. The offload pin is a config write, so
   * the transport resolves from THIS id rather than from the focused-node
   * connection store, which lags the render. */
  nodeDeviceId: string | null;
  /** The relaying ground station's reach for a WFB-relayed drone, else null. */
  relayReach?: RelayReach | null;
}

export function PerceptionTierCard({
  droneId,
  nodeDeviceId,
  relayReach = null,
}: PerceptionTierCardProps) {
  const t = useTranslations("vision");
  const { toast } = useToast();

  const perceptionTier = useAgentCapabilitiesStore((s) => s.perceptionTier);
  const offloadTarget = useAgentCapabilitiesStore(
    (s) => s.perceptionOffloadTarget,
  );
  // Live return-stream health for the offload path — the same freshness the
  // cockpit chip and session card read, surfaced here on the tier card too.
  const batch = useVisionDetectionsStore((s) => s.batches[droneId]);
  const [now, setNow] = useState(() => Date.now());
  // Key on whether a feed EXISTS, not the batch object (replaced every frame,
  // ~10-15 Hz), so the 500 ms staleness interval is created once per feed
  // lifecycle instead of torn down + recreated on every batch.
  const hasFeed = !!batch;
  useEffect(() => {
    if (!hasFeed) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [hasFeed]);
  const feed = perceptionFeedState(batch, now);
  const npuTops = useAgentCapabilitiesStore((s) => s.npuTops);
  const hasAccelerator = useAgentCapabilitiesStore((s) => s.hasAccelerator);
  const compute = useAgentCapabilitiesStore((s) => s.compute);
  const nodes = useLocalNodesStore((s) => s.nodes);

  // The pinned workstation is the persisted config link, not local state, so it
  // survives unmount and matches what the Settings tab shows. Scoped to THIS
  // node: the pin names where this drone offloads, so a write resolved from the
  // ambient connection could re-point a different aircraft.
  const { config, readOnly, setValue } = useNodeConfig(
    nodeDeviceId,
    relayReach,
  );
  const storedAddr =
    (readConfigPath(config, PIN_KEY) as string | undefined) ?? "";
  // A local override while a write is in flight.
  const [pendingAddr, setPendingAddr] = useState<string | null>(null);

  const effectiveAddr = pendingAddr ?? storedAddr;

  const tier: Tier = perceptionTier ?? "unknown";
  // Fall back to the compute block when the top-level mirrors are absent.
  const acceleratorPresent =
    hasAccelerator ?? (compute.npu_available || compute.gpu_available);
  const tops = npuTops ?? compute.npu_tops;

  const workstations = useMemo(
    () => nodes.filter((n) => n.profile === "workstation"),
    [nodes],
  );
  // Options mirror the Settings "Pin workstation" control: an Auto entry
  // (auto-discover any serving workstation) plus each paired workstation, keyed
  // by the offload address the agent stores.
  const options: SelectOption[] = [
    { value: "", label: t("offloadAutoAny") },
    ...workstations.map((n) => ({
      value: nodeToOffloadAddr(n),
      label: n.name || n.hostname,
    })),
  ];

  const onPick = async (addr: string) => {
    if (readOnly) return;
    setPendingAddr(addr);
    try {
      await setValue(PIN_KEY, addr);
    } catch (err) {
      toast(err instanceof Error ? err.message : t("offloadFailed"), "error");
    } finally {
      setPendingAddr(null);
    }
  };

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Layers size={16} className="text-accent-primary" aria-hidden="true" />
        <h2 className="text-lg font-medium text-text-primary">
          {t("perceptionTier")}
        </h2>
        <div className="flex-1" />
        <span
          className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium ${TIER_STYLE[tier]}`}
        >
          {t(`tier_${tier}` as const)}
        </span>
      </div>

      <p className="mb-3 text-xs text-text-secondary">
        {t(`tierHint_${tier}` as const)}
      </p>

      {/* Why the tier resolved as it did — the accelerator posture. */}
      <div className="mb-4 flex items-center gap-2 rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2">
        <Cpu size={12} className="flex-none text-text-tertiary" aria-hidden="true" />
        <span className="text-[11px] text-text-secondary">
          {acceleratorPresent
            ? t("acceleratorPresent", { tops: tops.toFixed(1) })
            : t("acceleratorNone")}
        </span>
      </div>

      {offloadTarget ? (
        <div className="mb-4 text-[11px] text-text-tertiary">
          {t("offloadTargetActive", { target: offloadTarget })}
        </div>
      ) : null}

      {/* Offload return-stream health — is detection actually flowing back. */}
      {tier === "offload" ? (
        <div className="mb-4 flex items-center gap-1.5 text-[11px]">
          <span
            className={`h-2 w-2 flex-none rounded-full ${
              feed === "fresh"
                ? "bg-status-success"
                : feed === "stale"
                  ? "bg-status-warning"
                  : "bg-text-tertiary"
            }`}
            aria-hidden="true"
          />
          <span
            className={
              feed === "stale" ? "text-status-warning" : "text-text-secondary"
            }
          >
            {feed === "fresh"
              ? t("offloadHealthLive")
              : feed === "stale"
                ? t("offloadHealthStale")
                : t("offloadHealthIdle")}
          </span>
        </div>
      ) : null}

      {/* Offload target picker + request. */}
      {workstations.length === 0 ? (
        <p className="text-[11px] text-text-tertiary">
          {t("offloadNoWorkstation")}
        </p>
      ) : (
        <div className="min-w-[200px]">
          <Select
            label={t("offloadTarget")}
            options={options}
            value={effectiveAddr}
            onChange={(v) => void onPick(v)}
            placeholder={t("offloadTargetPlaceholder")}
            disabled={readOnly}
          />
        </div>
      )}
      <p className="mt-2 text-[11px] text-text-tertiary">
        {t("offloadPinHint")}
      </p>
    </section>
  );
}
