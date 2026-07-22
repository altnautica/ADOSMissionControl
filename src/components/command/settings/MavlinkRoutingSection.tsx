"use client";

/**
 * @module command/settings/MavlinkRoutingSection
 * @description The node Settings "MAVLink" page. Read-only where the agent
 * only reads: the FC transport (source / port / baud, managed from the node
 * Overview's FC connection picker so this page never runs a second writer for
 * the same keys) and the configured MAVLink endpoints list. Writable where the
 * agent genuinely accepts the write: the router's own system / component id
 * and the cloud-relay forwarding rates, each an integer-validated field over
 * the shared config writer.
 *
 * The signing block (drone profile) reads the agent's own signing surface —
 * capability with the agent's reason, the router's require-signing flag
 * (writable), and the passive signed-frame counters. It needs the LAN client
 * (the config proxy does not forward these routes); a cloud session says so,
 * and an agent build without the routes reads "not exposed", never a
 * fabricated state. Key enrollment stays in the FC Setup Security panel.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Route } from "lucide-react";

import type { NodeProfile } from "@/components/dashboard/node-detail/surface-types";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import type {
  SigningCapability,
  SigningCounters,
} from "@/lib/agent/agent-client/types";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { formatLogTime } from "../shared/LogViewer";
import { ConfigIntField, ConfigReadonlyRow } from "./ConfigFields";
import { readConfigPath } from "./use-node-config";
import { Section } from "./Section";

interface SectionProps {
  profile: NodeProfile;
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

/** One configured MAVLink endpoint, as the agent's config carries it. Reads
 * are defensive: a malformed entry renders what it has, never a guess. */
interface EndpointEntry {
  type: string | null;
  host: string | null;
  port: number | null;
  enabled: boolean;
}

/** Parse the `mavlink.endpoints` config list. Returns null when the config
 * does not carry a list (older agent / config not loaded) — distinct from a
 * present-but-empty list. */
export function parseEndpoints(
  config: Record<string, unknown> | null,
): EndpointEntry[] | null {
  const raw = readConfigPath(config, "mavlink.endpoints");
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      type: typeof e.type === "string" && e.type.length > 0 ? e.type : null,
      host: typeof e.host === "string" && e.host.length > 0 ? e.host : null,
      port:
        typeof e.port === "number" && Number.isFinite(e.port) ? e.port : null,
      // Absent reads enabled (the agent's model default), an explicit false
      // reads disabled.
      enabled: e.enabled !== false,
    }));
}

function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-tertiary">
      {children}
    </div>
  );
}

function ReadRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-text-tertiary">{label}</span>
      <span className="shrink-0 font-mono text-xs text-text-primary">
        {value}
      </span>
    </div>
  );
}

/** The signing sub-surface load result. "unexposed" is an agent build without
 * the routes (404/501); "failed" is any other error. */
type SigningLoad =
  | { state: "loading" }
  | { state: "unexposed" }
  | { state: "failed" }
  | {
      state: "loaded";
      capability: SigningCapability;
      require: boolean | null;
      counters: SigningCounters | null;
    };

function isUnexposedError(err: unknown): boolean {
  return err instanceof Error && /Agent API (404|501)/.test(err.message);
}

/** Agent capability-reason enum → readable text. Unknown reasons render the
 * agent's own token raw rather than a mislabel. */
function reasonLabel(t: (key: string) => string, reason: string): string {
  switch (reason) {
    case "ok":
      return t("signingReasonOk");
    case "fc_not_connected":
      return t("signingReasonFcNotConnected");
    case "firmware_not_supported":
      return t("signingReasonFirmwareNotSupported");
    case "firmware_too_old":
      return t("signingReasonFirmwareTooOld");
    case "firmware_px4_no_persistent_store":
      return t("signingReasonPx4NoStore");
    case "msp_protocol":
      return t("signingReasonMsp");
    default:
      return reason;
  }
}

export function MavlinkRoutingSection({
  profile,
  config,
  readOnly,
  setValue,
}: SectionProps) {
  const t = useTranslations("nodeSettings.mavlinkRouting");
  const tRoot = useTranslations("nodeSettings");
  const { toast } = useToast();
  const client = useAgentConnectionStore((s) => s.client);

  const isDrone = profile === "drone";

  const [signing, setSigning] = useState<SigningLoad>({ state: "loading" });
  const [requirePending, setRequirePending] = useState(false);

  const loadSigning = useCallback(async () => {
    if (!isDrone || !client) return;
    setSigning({ state: "loading" });
    try {
      const capability = await client.getSigningCapability();
      const [requireRes, counters] = await Promise.all([
        client.getSigningRequire().catch(() => null),
        client.getSigningCounters().catch(() => null),
      ]);
      setSigning({
        state: "loaded",
        capability,
        require: requireRes ? requireRes.require : null,
        counters,
      });
    } catch (err) {
      setSigning({ state: isUnexposedError(err) ? "unexposed" : "failed" });
    }
  }, [isDrone, client]);

  useEffect(() => {
    void loadSigning();
  }, [loadSigning]);

  const onToggleRequire = useCallback(
    async (next: boolean) => {
      if (!client || requirePending) return;
      setRequirePending(true);
      try {
        const res = await client.setSigningRequire(next);
        setSigning((prev) =>
          prev.state === "loaded" ? { ...prev, require: res.require } : prev,
        );
        toast(tRoot("applied"), "success");
      } catch (err) {
        toast(
          err instanceof Error ? err.message : tRoot("applyFailed"),
          "error",
        );
      } finally {
        setRequirePending(false);
      }
    },
    [client, requirePending, toast, tRoot],
  );

  const sourceOptions: Record<string, string> = {
    auto: t("sourceAuto"),
    serial: t("sourceSerial"),
    udp: t("sourceUdp"),
    tcp: t("sourceTcp"),
  };

  const endpoints = parseEndpoints(config);

  return (
    <Section title={t("title")} icon={Route} blurb={t("blurb")}>
      {/* FC transport — read-only; the Overview's FC connection picker owns
          these writes, so this page never runs a second writer. */}
      {isDrone ? (
        <div className="space-y-2">
          <div className="text-xs text-text-secondary">
            {t("transportTitle")}
          </div>
          <ConfigReadonlyRow
            configKey="mavlink.source"
            label={t("sourceLabel")}
            config={config}
            format={(raw) =>
              typeof raw === "string" && raw.length > 0
                ? (sourceOptions[raw] ?? raw)
                : null
            }
          />
          <ConfigReadonlyRow
            configKey="mavlink.serial_port"
            label={t("portLabel")}
            config={config}
          />
          <ConfigReadonlyRow
            configKey="mavlink.baud_rate"
            label={t("baudLabel")}
            config={config}
          />
          <p className="text-[11px] text-text-tertiary">{t("transportHint")}</p>
        </div>
      ) : null}

      {/* Configured endpoints — read-only, the agent's own config list. */}
      <div
        className={
          isDrone
            ? "space-y-2 border-t border-border-default pt-3"
            : "space-y-2"
        }
      >
        <div className="text-xs text-text-secondary">{t("endpointsTitle")}</div>
        {endpoints === null ? (
          <p className="text-[11px] text-text-tertiary">
            {t("endpointsNotReported")}
          </p>
        ) : endpoints.length === 0 ? (
          <p className="text-[11px] text-text-tertiary">{t("endpointsEmpty")}</p>
        ) : (
          endpoints.map((e, idx) => (
            <ReadRow
              key={`${e.type ?? "endpoint"}-${e.port ?? idx}`}
              label={e.type ?? t("endpointFallbackType")}
              value={`${e.host ?? "?"}:${e.port ?? "?"} · ${
                e.enabled ? t("endpointEnabled") : t("endpointDisabled")
              }`}
            />
          ))
        )}
      </div>

      {/* Router identity — writable integers over the shared config writer. */}
      <div className="space-y-4 border-t border-border-default pt-3">
        <div className="text-xs text-text-secondary">{t("identityTitle")}</div>
        <ConfigIntField
          configKey="mavlink.system_id"
          label={t("systemIdLabel")}
          hint={t("systemIdHint")}
          min={1}
          max={255}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
        <ConfigIntField
          configKey="mavlink.component_id"
          label={t("componentIdLabel")}
          hint={t("componentIdHint")}
          min={1}
          max={255}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
      </div>

      {/* Cloud-relay forwarding rates — the agent's own throttles for the
          relay path, not the FC's stream rates. */}
      <div className="space-y-4 border-t border-border-default pt-3">
        <div className="text-xs text-text-secondary">{t("ratesTitle")}</div>
        <ConfigIntField
          configKey="server.telemetry_rate"
          label={t("telemetryRateLabel")}
          hint={t("telemetryRateHint")}
          min={1}
          max={50}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
        <ConfigIntField
          configKey="server.heartbeat_interval"
          label={t("heartbeatIntervalLabel")}
          hint={t("heartbeatIntervalHint")}
          min={1}
          max={3600}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
      </div>

      {/* Signing — drone only; needs the LAN client (the config proxy does
          not forward these routes). */}
      {isDrone ? (
        <div className="space-y-3 border-t border-border-default pt-3">
          <div className="text-xs text-text-secondary">{t("signingTitle")}</div>
          {!client ? (
            <InfoNote>{t("signingRequiresLan")}</InfoNote>
          ) : signing.state === "loading" ? (
            <p className="text-[11px] text-text-tertiary">
              {t("signingLoading")}
            </p>
          ) : signing.state === "unexposed" ? (
            <InfoNote>{t("signingUnexposed")}</InfoNote>
          ) : signing.state === "failed" ? (
            <p className="text-[11px] text-status-error">
              {t("signingLoadFailed")}
            </p>
          ) : (
            <>
              <ReadRow
                label={t("signingCapabilityLabel")}
                value={
                  signing.capability.supported
                    ? t("signingSupported")
                    : reasonLabel(t, signing.capability.reason)
                }
              />
              {signing.capability.firmware_name ? (
                <ReadRow
                  label={t("signingFirmwareLabel")}
                  value={`${signing.capability.firmware_name}${
                    signing.capability.firmware_version
                      ? ` ${signing.capability.firmware_version}`
                      : ""
                  }`}
                />
              ) : null}
              <div className="flex flex-col gap-1.5">
                <Toggle
                  label={t("signingRequireLabel")}
                  checked={signing.require === true}
                  onChange={(v) => void onToggleRequire(v)}
                  disabled={requirePending}
                />
                {signing.require === null ? (
                  <p className="text-[11px] text-text-tertiary">
                    {t("signingRequireNotSet")}
                  </p>
                ) : null}
                <p className="text-[11px] text-text-tertiary">
                  {t("signingRequireHint")}
                </p>
              </div>
              {signing.counters ? (
                <>
                  <ReadRow
                    label={t("signingTxLabel")}
                    value={String(signing.counters.tx_signed_count)}
                  />
                  <ReadRow
                    label={t("signingRxLabel")}
                    value={String(signing.counters.rx_signed_count)}
                  />
                  <ReadRow
                    label={t("signingLastRxLabel")}
                    value={
                      signing.counters.last_signed_rx_at != null
                        ? formatLogTime(
                            new Date(
                              signing.counters.last_signed_rx_at * 1000,
                            ).toISOString(),
                          )
                        : t("signingNoneSeen")
                    }
                  />
                </>
              ) : null}
              <p className="text-[11px] text-text-tertiary">
                {t("signingEnrollHint")}
              </p>
            </>
          )}
        </div>
      ) : null}
    </Section>
  );
}
