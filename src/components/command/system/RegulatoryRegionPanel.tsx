"use client";

/**
 * @module command/system/RegulatoryRegionPanel
 * @description Writable operating-region control for one node's radio.
 * A fresh agent ships UNRESTRICTED: it brings the radio up and
 * transmits on the configured channel without a verified regulatory
 * domain. The operator opts into a region (an ISO 3166-1 alpha-2 country
 * code) to re-enable the strict regulatory gate and the region's legal
 * power limit. The control writes only what the operator picks; it never
 * auto-pins a code on the operator's behalf. The agent owns the default.
 *
 * The live posture is read back from the heartbeat (`regPosture` /
 * `pinnedRegion` / `regVerified`, falling back to `regDomain`) so the
 * operator sees the effective state confirm the round-trip. Writes ride
 * the shared config-access resolution FOR THE NODE THIS PANEL IS RENDERED
 * FOR — its device id and (for a WFB-relayed drone) its relay reach arrive
 * as props, never from the focused-node connection store: that store lags
 * the render, so an ambient resolution can pin a region on the previously
 * connected aircraft. The direct client carries the write only when it is
 * attached to this node; otherwise the server-side config proxy against
 * this node's stored LAN pairing does, so a cloud session stays writable,
 * and a relayed drone writes over its ground station's relay-proxy. The
 * control degrades to read-only only when no path reaches the node.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import {
  directClientForNode,
  resolveConfigAccess,
  setConfigValueViaAccess,
} from "@/lib/agent/config-access";
import { configWriteFailure } from "@/lib/agent/config-write";
import type { RelayReach } from "@/lib/nodes/relay-reach";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Select, type SelectOption } from "@/components/ui/select";
import {
  COMMON_REGIONS,
  OTHER_REGION_VALUE,
  UNRESTRICTED_VALUE,
  isCommonRegion,
  normalizeRegionCode,
  regionName,
} from "@/lib/operating-region";
import { UnrestrictedRegionBadge } from "./UnrestrictedRegionBadge";

export interface RegulatoryRegionPanelProps {
  /** The node this panel is rendered for: its agent device id (direct reach),
   * or a WFB-relayed drone's own peer id. Null when the GCS has no identity
   * for it, which resolves read-only rather than writing somewhere else. */
  nodeDeviceId: string | null;
  /** The relaying ground station's reach, for a drone with no address of its
   * own. Null for a directly-paired node. */
  relayReach?: RelayReach | null;
}

export function RegulatoryRegionPanel({
  nodeDeviceId,
  relayReach = null,
}: RegulatoryRegionPanelProps) {
  const radio = useAgentCapabilitiesStore((s) => s.radio);
  const radioStackState = useAgentCapabilitiesStore((s) => s.radioStackState);
  const storeClient = useAgentConnectionStore((s) => s.client);
  const attachedDeviceId = useAgentConnectionStore((s) => s.nodeDeviceId);
  const setNodeRegion = useLocalNodesStore((s) => s.setNodeRegion);
  const nodes = useLocalNodesStore((s) => s.nodes);
  const pairedDrones = usePairingStore((s) => s.pairedDrones);
  const t = useTranslations("operatingRegion");
  const { toast } = useToast();

  // Picker selection: the unrestricted sentinel, a common region code, or
  // the "other" sentinel that reveals the free-text ISO field. Holds an
  // operator-pending selection until the next heartbeat reflects it.
  const [selection, setSelection] = useState<string>(UNRESTRICTED_VALUE);
  const [otherCode, setOtherCode] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Omit the whole card when the agent advertises no radio surface at all
  // (a compute node, or a drone with no air-side adapter).
  const hasRadioSurface = radio !== null || radioStackState !== undefined;
  if (!hasRadioSurface) return null;

  // Effective posture from the heartbeat. Prefer the explicit regPosture /
  // pinnedRegion fields; fall back to the legacy regDomain so an older
  // agent that only reports regDomain still renders the right badge (a set
  // regDomain implies a pinned region, absence implies unrestricted).
  const pinnedRegion =
    radio?.pinnedRegion ?? (radio?.regDomain ? radio.regDomain : null);
  const livePosture: "unrestricted" | "region" =
    radio?.regPosture === "region" || (radio?.regPosture == null && pinnedRegion)
      ? "region"
      : "unrestricted";
  const regVerified = radio?.regVerified ?? null;

  // The node's own LAN record, so the chosen region is remembered across a
  // re-pair / re-flash of that same node. Keyed strictly by the rendered
  // node's device id — an `agentUrl` fallback would match whichever node the
  // connection store currently holds, i.e. the wrong one.
  const activeNode =
    nodes.find((n) => nodeDeviceId !== null && n.deviceId === nodeDeviceId) ??
    null;

  // Shared writable-path resolution for THIS node: its direct client when the
  // attached one serves it, else the server-side config proxy against its
  // stored LAN pairing, else its ground station's relay-proxy, and read-only
  // only when no path reaches it at all.
  const access = resolveConfigAccess(
    directClientForNode(storeClient, attachedDeviceId, nodeDeviceId),
    nodeDeviceId,
    { localNodes: nodes, pairedDrones },
    relayReach,
  );
  const readOnly = access.mode === "none";

  const options: SelectOption[] = [
    {
      value: UNRESTRICTED_VALUE,
      label: t("optionUnrestricted"),
      description: t("optionUnrestrictedHint"),
    },
    ...COMMON_REGIONS.map((r) => ({
      value: r.code,
      label: `${r.name} (${r.code})`,
    })),
    {
      value: OTHER_REGION_VALUE,
      label: t("optionOther"),
      description: t("optionOtherHint"),
    },
  ];

  // The mode + region the picker currently resolves to, and whether it is
  // a valid choice to apply.
  const resolvedMode: "unrestricted" | "region" =
    selection === UNRESTRICTED_VALUE ? "unrestricted" : "region";
  const resolvedRegion: string | null =
    selection === UNRESTRICTED_VALUE
      ? null
      : selection === OTHER_REGION_VALUE
        ? normalizeRegionCode(otherCode)
        : selection;
  const otherInvalid =
    selection === OTHER_REGION_VALUE && otherCode.trim().length > 0 && resolvedRegion === null;
  const canApply =
    !readOnly &&
    !saving &&
    dirty &&
    (resolvedMode === "unrestricted" || resolvedRegion !== null);

  const onSelectionChange = (next: string) => {
    setSelection(next);
    setDirty(true);
  };

  const onApply = async () => {
    if (readOnly || saving) return;
    if (resolvedMode === "region" && resolvedRegion === null) return;
    setSaving(true);
    try {
      // Mode first, then region. The agent coerces both at its config
      // boundary; an empty region string clears any prior pin. The writes
      // ride whichever transport resolved for this node.
      //
      // `configWriteFailure` covers both halves of the agent's
      // 200-means-nothing contract: a rejected value (`{error}`) and a value
      // taken in RAM but never written to disk (`persisted: false`). A legal
      // RF posture that dies at the next restart must not report "applied".
      const modeFailure = configWriteFailure(
        await setConfigValueViaAccess(
          access,
          "network.regulatory.mode",
          resolvedMode,
        ),
      );
      if (modeFailure) throw new Error(modeFailure);
      const regionFailure = configWriteFailure(
        await setConfigValueViaAccess(
          access,
          "network.regulatory.region",
          resolvedRegion ?? "",
        ),
      );
      if (regionFailure) throw new Error(regionFailure);
      // Remember the choice against this node so a re-pair / re-flash can
      // re-apply it. Keyed by the agent's stable device id.
      if (activeNode) {
        setNodeRegion(
          activeNode.deviceId,
          resolvedMode === "region" ? resolvedRegion : null,
        );
      }
      toast(t("applied"), "success");
      setDirty(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("applyFailed");
      toast(msg, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Globe size={16} className="text-accent-primary" />
        <h2 className="text-lg font-medium text-text-primary">{t("title")}</h2>
        <div className="flex-1" />
        {livePosture === "unrestricted" ? (
          <UnrestrictedRegionBadge />
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded border border-status-success/40 bg-status-success/10 px-2.5 py-1 text-xs font-medium text-status-success">
            {t("regionEnforced", { region: regionName(pinnedRegion ?? "") })}
          </span>
        )}
      </div>

      {/* Live effective posture from the heartbeat. */}
      <div className="mb-4 rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-text-tertiary">
          {t("livePosture")}
        </div>
        <div className="mt-0.5 text-sm text-text-primary">
          {livePosture === "unrestricted"
            ? t("liveUnrestricted")
            : t("livePinned", { region: regionName(pinnedRegion ?? "") })}
          {livePosture === "region" && regVerified === false ? (
            <span className="ml-2 text-status-warning">{t("regionUnverified")}</span>
          ) : null}
        </div>
      </div>

      {/* Region picker. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-[220px] flex-1">
          <Select
            label={t("pickerLabel")}
            options={options}
            value={selection}
            onChange={onSelectionChange}
            disabled={readOnly}
            searchable
          />
        </div>
        {selection === OTHER_REGION_VALUE ? (
          <div className="min-w-[140px]">
            <label className="mb-1 block text-xs text-text-secondary">
              {t("otherFieldLabel")}
            </label>
            <input
              type="text"
              value={otherCode}
              maxLength={2}
              placeholder={t("otherFieldPlaceholder")}
              onChange={(e) => {
                setOtherCode(e.target.value);
                setDirty(true);
              }}
              disabled={readOnly}
              className="h-9 w-full rounded border border-border-default bg-bg-tertiary px-2 font-mono text-sm uppercase text-text-primary focus:border-accent-primary focus:outline-none disabled:opacity-50"
            />
          </div>
        ) : null}
        <Button
          variant="primary"
          size="sm"
          onClick={() => void onApply()}
          disabled={!canApply}
        >
          {saving ? t("applying") : t("applyButton")}
        </Button>
      </div>

      {otherInvalid ? (
        <p className="mt-2 text-[11px] text-status-error">{t("otherInvalid")}</p>
      ) : null}

      <p className="mt-3 text-[11px] text-text-tertiary">
        {resolvedMode === "unrestricted" ? t("applyHintUnrestricted") : t("applyHintRegion")}
      </p>
      {readOnly ? (
        <p className="mt-1 text-[11px] text-text-tertiary">
          {t("readOnlyNoAgent")}
        </p>
      ) : null}
    </section>
  );
}
