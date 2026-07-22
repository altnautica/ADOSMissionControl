"use client";

/**
 * @module command/settings/DiscoverySection
 * @description The node Settings "Discovery" page: the mDNS announcement
 * switch (config-backed, applied when the agent restarts) and the reach
 * names + URLs the node ITSELF advertises — hostname, mDNS name, LAN
 * addresses, and the advertised access URLs from the agent's own setup
 * report.
 *
 * Reach honesty: every name and URL on this page is rendered verbatim from
 * the node's report; the app never constructs a hostname (a constructed name
 * is not a name that resolves). The report needs the LAN client — a session
 * without one states that instead of guessing, and a failed read says it
 * failed rather than showing stale names.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Radar, RefreshCw } from "lucide-react";

import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import type { SetupAccessUrl } from "@/lib/agent/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfigToggleField, ConfigReadonlyRow } from "./ConfigFields";
import { Section } from "./Section";

interface SectionProps {
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

/** The slice of the agent's setup report this page renders. */
interface AdvertisedReach {
  hostname: string;
  mdnsHost: string;
  apiPort: number;
  localIps: string[];
  accessUrls: SetupAccessUrl[];
}

type ReachLoad =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "loaded"; reach: AdvertisedReach };

function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-tertiary">
      {children}
    </div>
  );
}

function ReadRow({ label, value }: { label: string; value: string | null }) {
  const t = useTranslations("nodeSettings.discovery");
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-text-tertiary">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-xs text-text-primary">
        {value != null && value.length > 0 ? (
          value
        ) : (
          <span className="text-text-tertiary">{t("notReported")}</span>
        )}
      </span>
    </div>
  );
}

export function DiscoverySection({ config, readOnly, setValue }: SectionProps) {
  const t = useTranslations("nodeSettings.discovery");
  const client = useAgentConnectionStore((s) => s.client);

  const [load, setLoad] = useState<ReachLoad>({ state: "loading" });

  // State writes happen only from the async resolve/reject (the initial
  // state is already "loading"); the manual refresh button flips the
  // loading state from its event handler.
  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const status = await client.getSetupStatus();
      setLoad({
        state: "loaded",
        reach: {
          hostname: status.network.hostname,
          mdnsHost: status.network.mdns_host,
          apiPort: status.network.api_port,
          localIps: status.network.local_ips,
          accessUrls: status.access_urls,
        },
      });
    } catch {
      setLoad({ state: "failed" });
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Section title={t("title")} icon={Radar} blurb={t("blurb")}>
      {/* mDNS announcement — the config-backed switch the agent's service
          registry reads at startup. */}
      <ConfigToggleField
        configKey="discovery.mdns_enabled"
        label={t("mdnsLabel")}
        hint={t("mdnsHint")}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />
      <ConfigReadonlyRow
        configKey="discovery.service_type"
        label={t("serviceTypeLabel")}
        config={config}
      />

      {/* Advertised reach — verbatim from the node's own report. */}
      <div className="space-y-3 border-t border-border-default pt-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-text-secondary">
              {t("advertisedTitle")}
            </div>
            <p className="mt-0.5 text-[11px] text-text-tertiary">
              {t("advertisedHint")}
            </p>
          </div>
          {client ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw size={12} />}
              onClick={() => {
                setLoad({ state: "loading" });
                void refresh();
              }}
              disabled={load.state === "loading"}
            >
              {t("refresh")}
            </Button>
          ) : null}
        </div>

        {!client ? (
          <InfoNote>{t("requiresLan")}</InfoNote>
        ) : load.state === "loading" ? (
          <p className="text-[11px] text-text-tertiary">{t("loading")}</p>
        ) : load.state === "failed" ? (
          <p className="text-[11px] text-status-error">{t("loadFailed")}</p>
        ) : (
          <>
            <div className="space-y-2">
              <ReadRow
                label={t("hostnameLabel")}
                value={load.reach.hostname}
              />
              <ReadRow label={t("mdnsHostLabel")} value={load.reach.mdnsHost} />
              <ReadRow
                label={t("apiPortLabel")}
                value={
                  Number.isFinite(load.reach.apiPort)
                    ? String(load.reach.apiPort)
                    : null
                }
              />
              <ReadRow
                label={t("localIpsLabel")}
                value={
                  load.reach.localIps.length > 0
                    ? load.reach.localIps.join(", ")
                    : null
                }
              />
            </div>

            <div className="space-y-2 border-t border-border-default pt-3">
              <div className="text-xs text-text-secondary">
                {t("urlsTitle")}
              </div>
              {load.reach.accessUrls.length === 0 ? (
                <p className="text-[11px] text-text-tertiary">
                  {t("urlsEmpty")}
                </p>
              ) : (
                load.reach.accessUrls.map((u, idx) => (
                  <div
                    key={`${u.kind}-${u.url}-${idx}`}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-tertiary">
                      {u.label}
                      {u.primary ? (
                        <Badge variant="info" size="sm">
                          {t("primaryBadge")}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="min-w-0 truncate text-right font-mono text-xs text-text-primary">
                      {u.url}
                    </span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
