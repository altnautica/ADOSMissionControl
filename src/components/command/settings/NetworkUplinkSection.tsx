"use client";

/**
 * @module command/settings/NetworkUplinkSection
 * @description The node Settings "Network" page: the uplink matrix with the
 * failover priority ladder and the share-uplink toggle, plus the hotspot —
 * the config-backed on/off switch and the AP name, channel and passphrase
 * applied through the live AP route.
 *
 * Everything here is served by the ground station: its network surface owns
 * the matrix, and only a ground station runs the access point (hostapd and
 * its DHCP server are ground-station services). Other profiles get an honest
 * note and no controls, so no switch reports "Applied" for an AP that never
 * comes up.
 *
 * The page polls the network view; when the newest poll fails it says so
 * over the last snapshot and how old that snapshot is, rather than keeping
 * the old matrix on screen as if it were live.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Network } from "lucide-react";

import type { NodeProfile } from "@/components/dashboard/node-detail/surface-types";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import type { NetworkStatus } from "@/lib/api/ground-station/types";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { ConfigToggleField } from "./ConfigFields";
import { HotspotApFields } from "./HotspotApFields";
import { InfoNote, PollFailureNote, Section } from "./Section";
import { moveEntry, UplinkMatrix, type ApLive, type EthernetLive } from "./UplinkMatrix";
import { useNodeDirectAgent } from "./use-node-direct-agent";

const POLL_MS = 5000;

interface SectionProps {
  /** The node this page is rendered for; live reads and writes go only to a
   * connection attached to it. */
  nodeDeviceId: string | null;
  profile: NodeProfile;
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

export function NetworkUplinkSection({
  nodeDeviceId,
  profile,
  config,
  readOnly,
  setValue,
}: SectionProps) {
  const t = useTranslations("nodeSettings");
  const { toast } = useToast();
  const agent = useNodeDirectAgent(nodeDeviceId);

  const isGroundStation = profile === "ground-station";
  const api = useMemo(
    () =>
      isGroundStation && agent
        ? groundStationApiFromAgent(agent.agentUrl, agent.apiKey)
        : null,
    [isGroundStation, agent],
  );
  // Answers belong to the client they were requested on; a poll from the
  // previously attached node that lands after a switch is dropped.
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  const [net, setNet] = useState<NetworkStatus | null>(null);
  /** Wall-clock ms of the last network view that landed. */
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [ethernet, setEthernet] = useState<EthernetLive | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);
  const [savingShare, setSavingShare] = useState(false);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const status = await api.getNetwork();
      if (apiRef.current !== api) return;
      setNet(status);
      setFetchedAt(Date.now());
      setLoadFailed(false);
    } catch {
      if (apiRef.current !== api) return;
      setLoadFailed(true);
    }
    // The aggregate view's ethernet leg is a static default on current
    // agents; the dedicated ethernet route carries the live link legs. Its
    // absence (older agents) leaves the row on "not reported".
    try {
      const eth = (await api.getEthernetConfig()) as EthernetLive;
      if (apiRef.current !== api) return;
      setEthernet(eth);
    } catch {
      if (apiRef.current !== api) return;
      setEthernet(null);
    }
  }, [api]);

  useEffect(() => {
    // A new client (or none) starts from nothing: the previous node's matrix
    // never renders under this node's name while the first poll is in flight.
    setNet(null);
    setFetchedAt(null);
    setEthernet(null);
    setLoadFailed(false);
    if (!api) return;
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void refresh();
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, refresh]);

  const onMovePriority = useCallback(
    async (index: number, delta: -1 | 1) => {
      if (!api || savingPriority) return;
      const current = net?.priority;
      if (!current) return;
      const next = moveEntry(current, index, delta);
      if (!next) return;
      setSavingPriority(true);
      try {
        // Read-back: the write returns the persisted list; render that, not
        // the optimistic order.
        const res = await api.setPriority(next);
        if (apiRef.current !== api) return;
        setNet((n) => (n ? { ...n, priority: res.priority } : n));
        toast(t("applied"), "success");
      } catch (err) {
        toast(err instanceof Error ? err.message : t("applyFailed"), "error");
      } finally {
        setSavingPriority(false);
      }
    },
    [api, savingPriority, net, toast, t],
  );

  const onShareToggle = useCallback(
    async (enabled: boolean) => {
      if (!api || savingShare) return;
      setSavingShare(true);
      try {
        const res = await api.setShareUplink(enabled);
        if (apiRef.current !== api) return;
        setNet((n) => (n ? { ...n, share_uplink: res.enabled } : n));
        if (res.applied === false) {
          // Persisted but not applied to a live uplink — surface the agent's
          // reason instead of a clean success.
          toast(
            t("network.sharePersistedNotApplied", {
              reason: res.apply_error ?? "unknown",
            }),
            "warning",
          );
        } else {
          toast(t("applied"), "success");
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : t("applyFailed"), "error");
      } finally {
        setSavingShare(false);
      }
    },
    [api, savingShare, toast, t],
  );

  if (!isGroundStation) {
    return (
      <Section
        title={t("network.title")}
        icon={Network}
        blurb={t("network.blurb")}
      >
        <InfoNote>{t("network.uplinkUnsupportedProfile")}</InfoNote>
      </Section>
    );
  }

  const ap = (net?.ap ?? null) as ApLive | null;

  return (
    <Section
      title={t("network.title")}
      icon={Network}
      blurb={t("network.blurb")}
    >
      {!api ? (
        <InfoNote>{t("network.liveRequiresLan")}</InfoNote>
      ) : (
        <>
          <PollFailureNote
            failed={loadFailed}
            fetchedAt={net ? fetchedAt : null}
            message={t("network.loadFailed")}
          />

          <UplinkMatrix
            net={net}
            ethernet={ethernet}
            disabled={readOnly || savingPriority}
            onMovePriority={(idx, delta) => void onMovePriority(idx, delta)}
          />

          {/* Share uplink with AP clients. Rendered only once the live view
              reports the real current value. */}
          {net && typeof net.share_uplink === "boolean" ? (
            <div className="flex flex-col gap-1.5">
              <Toggle
                label={t("network.shareLabel")}
                checked={net.share_uplink}
                onChange={(v) => void onShareToggle(v)}
                disabled={readOnly || savingShare}
              />
              <p className="text-[11px] text-text-tertiary">
                {t("network.shareHint")}
              </p>
            </div>
          ) : null}
        </>
      )}

      {/* Hotspot — the config-backed switch plus the name, channel and
          passphrase, which reach the running AP only through the ground
          station's live AP route (the AP never reads those config keys). */}
      <div className="space-y-4 border-t border-border-default pt-4">
        <ConfigToggleField
          configKey="network.hotspot.enabled"
          label={t("network.hotspotLabel")}
          hint={t("network.hotspotHint")}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
        <HotspotApFields
          key={nodeDeviceId ?? ""}
          api={api}
          liveSsid={typeof ap?.ssid === "string" ? ap.ssid : null}
          readOnly={readOnly}
        />
      </div>
    </Section>
  );
}
