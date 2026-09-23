"use client";

/**
 * @module command/settings/CorePages
 * @description The small core settings pages that used to live inline in the
 * Settings tab body: Profile (read-only — a switch is a transactional setup
 * change), Cloud posture (mode + backend URL read-only as a transactional
 * pair, plus the remote-access tunnel as read-only status: the node's own
 * report of whether its tunnel service is running), and
 * Advanced (per-key log level + read-only board override). The
 * board override is file-sourced (`/etc/ados/board_override`, injected onto
 * the GET response only) and is not a writable config field, so it renders
 * read-only rather than as a control that rejects every write.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import type { SetupStatus } from "@/lib/agent/types";
import { ConfigReadonlyRow, ConfigSelectField } from "./ConfigFields";
import { readConfigPath } from "./use-node-config";
import { useNodeDirectAgent } from "./use-node-direct-agent";
import { Section } from "./Section";

interface PageProps {
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

/** Map a stored option value to its display label; unknown values render raw. */
function labelFor(
  opts: { value: string; label: string }[],
  raw: unknown,
): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  return opts.find((o) => o.value === raw)?.label ?? raw;
}

/** Profile — read-only in v1 (a switch is a transactional setup change). */
export function ProfilePage({ config }: Pick<PageProps, "config">) {
  const t = useTranslations("nodeSettings");
  const profileOptions = [
    { value: "drone", label: t("profile.optionDrone") },
    { value: "ground-station", label: t("profile.optionGroundStation") },
    { value: "workstation", label: t("profile.optionWorkstation") },
  ];
  return (
    <Section title={t("profile.title")}>
      <ConfigReadonlyRow
        configKey="agent.profile"
        label={t("profile.label")}
        hint={t("profile.hint")}
        config={config}
        format={(raw) => labelFor(profileOptions, raw)}
      />
    </Section>
  );
}

type TunnelStatus = SetupStatus["remote_access"]["status"];

/** The node's own report of its tunnel service, read from its setup status
 * over a connection attached to this node. Null while unread or when there
 * is no direct connection. */
function useTunnelStatus(nodeDeviceId: string | null): {
  status: TunnelStatus | null;
  error: string | null;
  reachable: boolean;
} {
  const client = useNodeDirectAgent(nodeDeviceId)?.client ?? null;
  const [read, setRead] = useState<{
    client: unknown;
    status: TunnelStatus;
    error: string;
  } | null>(null);
  useEffect(() => {
    if (!client) return;
    let current = true;
    client
      .getSetupStatus()
      .then((s) => {
        if (current) {
          setRead({
            client,
            status: s.remote_access.status,
            error: s.remote_access.error,
          });
        }
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [client]);
  // A report read from a previously attached node never renders here.
  const mine = read !== null && read.client === client ? read : null;
  return {
    status: mine?.status ?? null,
    error: mine?.error ? mine.error : null,
    reachable: client !== null,
  };
}

/** Cloud posture — the cloud mode + backend URL are read-only (a
 * transactional setup pair). Remote access is read-only too: the node starts
 * or stops its tunnel service outside the config document (changing
 * `remote_access.*` there does not touch the running tunnel), so a switch here
 * would report a change the node never made. The page shows the configured
 * provider and the node's own report of the tunnel service instead. */
export function CloudPage({
  nodeDeviceId,
  config,
}: {
  nodeDeviceId: string | null;
  config: Record<string, unknown> | null;
}) {
  const tunnel = useTunnelStatus(nodeDeviceId);
  const t = useTranslations("nodeSettings");
  const cloudModeOptions = [
    { value: "local", label: t("cloud.optionLocal") },
    { value: "cloud", label: t("cloud.optionCloud") },
    { value: "self_hosted", label: t("cloud.optionSelfHosted") },
  ];
  const remoteProviderOptions = [
    { value: "none", label: t("cloud.remoteOptionNone") },
    { value: "cloudflare", label: t("cloud.remoteOptionCloudflare") },
  ];
  // The Cloudflare tunnel publishes these reach endpoints once provisioned;
  // show each read-only when the node reports it.
  const tunnelUrls = [
    {
      key: "remote_access.cloudflare.setup_url",
      label: t("cloud.remoteSetupUrlLabel"),
    },
    {
      key: "remote_access.cloudflare.api_url",
      label: t("cloud.remoteApiUrlLabel"),
    },
    {
      key: "remote_access.cloudflare.video_whep_url",
      label: t("cloud.remoteVideoUrlLabel"),
    },
    {
      key: "remote_access.cloudflare.mavlink_ws_url",
      label: t("cloud.remoteMavlinkUrlLabel"),
    },
  ];
  // The active backend URL lives under a mode-specific key that GET
  // /api/config actually emits: the managed endpoint (`server.cloud.url`) in
  // cloud mode, the operator's deployment (`server.self_hosted.url`) in
  // self-hosted mode. (`server.self_hosted.convex_url` was never a real key,
  // so the row always read blank.) Local mode has no backend, so no row.
  const mode = readConfigPath(config, "server.mode");
  const backendKey =
    mode === "self_hosted"
      ? "server.self_hosted.url"
      : mode === "cloud"
        ? "server.cloud.url"
        : null;

  return (
    <Section title={t("cloud.title")}>
      <ConfigReadonlyRow
        configKey="server.mode"
        label={t("cloud.modeLabel")}
        hint={t("cloud.modeHint")}
        config={config}
        format={(raw) => labelFor(cloudModeOptions, raw)}
      />
      {backendKey ? (
        <ConfigReadonlyRow
          configKey={backendKey}
          label={t("cloud.backendLabel")}
          config={config}
        />
      ) : null}

      {/* Remote access — the outbound tunnel that reaches this node beyond
          the LAN. Read-only: configured provider, and the tunnel service
          state as the node itself reports it. */}
      <div className="space-y-4 border-t border-border-default pt-4">
        <ConfigReadonlyRow
          configKey="remote_access.provider"
          label={t("cloud.remoteProviderLabel")}
          hint={t("cloud.remoteProviderHint")}
          config={config}
          format={(raw) => labelFor(remoteProviderOptions, raw)}
        />
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-text-secondary">
              {t("cloud.remoteStatusLabel")}
            </span>
            <span className="font-mono text-xs text-text-primary">
              {!tunnel.reachable
                ? t("cloud.remoteStatusNeedsLan")
                : tunnel.status === null
                  ? t("cloud.remoteStatusUnknown")
                  : t(`cloud.remoteStatus_${tunnel.status}`)}
            </span>
          </div>
          {tunnel.error ? (
            <p className="text-[11px] text-status-error">{tunnel.error}</p>
          ) : null}
          <p className="text-[11px] text-text-tertiary">
            {t("cloud.remoteManagedOnNode")}
          </p>
        </div>
        {tunnelUrls.map(({ key, label }) => {
          const v = readConfigPath(config, key);
          return typeof v === "string" && v.length > 0 ? (
            <ConfigReadonlyRow
              key={key}
              configKey={key}
              label={label}
              config={config}
            />
          ) : null;
        })}
      </div>
    </Section>
  );
}

/** Advanced — per-key log level + board override. */
export function AdvancedPage({ config, readOnly, setValue }: PageProps) {
  const t = useTranslations("nodeSettings");
  const logLevelOptions = [
    { value: "debug", label: "DEBUG" },
    { value: "info", label: "INFO" },
    { value: "warning", label: "WARNING" },
    { value: "error", label: "ERROR" },
  ];
  return (
    <Section title={t("advanced.title")}>
      <ConfigSelectField
        configKey="logging.level"
        label={t("advanced.logLevelLabel")}
        options={logLevelOptions}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />
      <ConfigReadonlyRow
        configKey="agent.board_override"
        label={t("advanced.boardOverrideLabel")}
        hint={t("advanced.boardOverrideHint")}
        config={config}
        format={(raw) =>
          typeof raw === "string" && raw.length > 0
            ? raw
            : t("advanced.boardOverrideAuto")
        }
      />
    </Section>
  );
}
