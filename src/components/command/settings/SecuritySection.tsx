"use client";

/**
 * @module command/settings/SecuritySection
 * @description The node Settings "Security" page. Secret-free by
 * construction: the pairing API key renders only as set / not set (the
 * agent's config surface already redacts the value; this page maps even that
 * sentinel to a state label and never renders a secret's value), the two
 * exposed auth switches (raw-MAVLink WebSocket enforcement, setup-token
 * requirement) write through the shared config writer, and the
 * dashboard-access PIN renders as read-only posture pointing at the Health
 * tab's card that owns set / reset. The API surface block carries the
 * advertised Mission Control URL (editable) and the node's REST bind
 * (read-only — changing it needs a reinstall, so it is shown for reference,
 * not as a control that would sever the very connection editing it).
 *
 * Honest absences: in-place key rotation is not exposed by the agent (a
 * re-pair issues a new key), so no rotate control is fabricated; a node with
 * no LAN pairing record cannot answer the PIN posture and the page says so.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";

import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import { resolveConfigProxyTarget } from "@/lib/agent/config-access";
import {
  getDashboardPinStatus,
  type DashboardPinStatus,
} from "@/lib/agent/local-pair-client";
import { ConfigTextField, ConfigToggleField } from "./ConfigFields";
import { readConfigPath } from "./use-node-config";
import { Section } from "./Section";

interface SectionProps {
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

/** Map the redacted API-key config field to a state label key. The value is
 * NEVER rendered: any non-empty string (the agent serves the redaction
 * sentinel for a set key) reads "set", an empty string reads "not set", and
 * an absent field reads "not reported". */
export function apiKeyStateKey(
  config: Record<string, unknown> | null,
): "set" | "notSet" | "notReported" {
  const raw = readConfigPath(config, "security.api.api_key");
  if (typeof raw !== "string") return "notReported";
  return raw.length > 0 ? "set" : "notSet";
}

function StatusRow({
  label,
  value,
  valueClass,
  hint,
}: {
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-text-secondary">{label}</span>
        <span
          className={`shrink-0 font-mono text-xs ${valueClass ?? "text-text-primary"}`}
        >
          {value}
        </span>
      </div>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-text-tertiary">{hint}</p>
      ) : null}
    </div>
  );
}

/** One completed PIN-posture read, tagged with the host it answered for so a
 * re-resolved target renders "checking" instead of the stale posture. */
interface PinRead {
  target: string;
  status: DashboardPinStatus | null;
  failed: boolean;
}

export function SecuritySection({ config, readOnly, setValue }: SectionProps) {
  const t = useTranslations("nodeSettings.security");
  const nodeDeviceId = useAgentConnectionStore((s) => s.nodeDeviceId);
  // Subscribed so a pair/unpair mid-session re-resolves the PIN target.
  const localNodes = useLocalNodesStore((s) => s.nodes);
  const pairedDrones = usePairingStore((s) => s.pairedDrones);

  const pinTarget = useMemo(
    () =>
      resolveConfigProxyTarget(nodeDeviceId, { localNodes, pairedDrones }),
    [nodeDeviceId, localNodes, pairedDrones],
  );

  const [pinRead, setPinRead] = useState<PinRead | null>(null);

  useEffect(() => {
    if (!pinTarget) return;
    let cancelled = false;
    getDashboardPinStatus(pinTarget.host, pinTarget.apiKey ?? "")
      .then((status) => {
        if (!cancelled)
          setPinRead({ target: pinTarget.host, status, failed: false });
      })
      .catch(() => {
        if (!cancelled)
          setPinRead({ target: pinTarget.host, status: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [pinTarget]);

  // ── REST bind (read-only reference — changing it needs a reinstall) ──────
  const restHost = readConfigPath(config, "api.rest.host");
  const restPort = readConfigPath(config, "api.rest.port");
  const restBind =
    typeof restHost === "string" && restHost.length > 0 && restPort != null
      ? `${restHost}:${String(restPort)}`
      : t("notReported");

  // ── API key posture (state label only — the value never renders) ─────────
  const keyState = apiKeyStateKey(config);
  const keyValue =
    keyState === "set"
      ? { text: t("apiKeySet"), cls: "text-status-success" }
      : keyState === "notSet"
        ? { text: t("apiKeyNotSet"), cls: "text-text-secondary" }
        : { text: t("notReported"), cls: "text-text-tertiary" };

  // ── Dashboard PIN posture (read-only; the Health tab card owns writes) ───
  const pinValue = (() => {
    if (!pinTarget) return null;
    if (pinRead === null || pinRead.target !== pinTarget.host)
      return { text: t("pinChecking"), cls: "text-text-tertiary" };
    if (pinRead.failed || pinRead.status === null)
      return { text: t("pinReadFailed"), cls: "text-text-tertiary" };
    if (pinRead.status.locked)
      return { text: t("pinLocked"), cls: "text-status-warning" };
    return pinRead.status.pinSet
      ? { text: t("pinSet"), cls: "text-status-success" }
      : { text: t("pinNotSet"), cls: "text-text-secondary" };
  })();

  return (
    <Section title={t("title")} icon={ShieldCheck} blurb={t("blurb")}>
      {/* Pairing key — state only, never a value; no rotate control because
          the agent exposes none (a re-pair issues a new key). */}
      <StatusRow
        label={t("apiKeyLabel")}
        value={keyValue.text}
        valueClass={keyValue.cls}
        hint={t("apiKeyHint")}
      />

      {/* Exposed auth switches over the shared config writer. Turning either
          OFF is a security downgrade, so that transition is gated behind a
          danger confirm; turning it ON (the safe upgrade) writes immediately. */}
      <div className="space-y-4 border-t border-border-default pt-3">
        <ConfigToggleField
          configKey="mavlink.ws_proxy_enforce_auth"
          label={t("wsEnforceLabel")}
          hint={t("wsEnforceHint")}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
          confirm={{
            when: (next) => next === false,
            title: t("wsEnforceConfirmTitle"),
            message: t("wsEnforceConfirmMessage"),
            confirmLabel: t("wsEnforceConfirmAction"),
          }}
        />
        <ConfigToggleField
          configKey="security.setup_token_required"
          label={t("setupTokenLabel")}
          hint={t("setupTokenHint")}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
          confirm={{
            when: (next) => next === false,
            title: t("setupTokenConfirmTitle"),
            message: t("setupTokenConfirmMessage"),
            confirmLabel: t("setupTokenConfirmAction"),
          }}
        />
      </div>

      {/* API surface — the advertised Mission Control URL (editable) and the
          node's REST bind (read-only reference). */}
      <div className="space-y-3 border-t border-border-default pt-3">
        <ConfigTextField
          configKey="api.mission_control_url"
          label={t("missionControlUrlLabel")}
          hint={t("missionControlUrlHint")}
          placeholder="https://command.altnautica.com"
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
        <StatusRow
          label={t("restBindLabel")}
          value={restBind}
          hint={t("restBindHint")}
        />
      </div>

      {/* Dashboard PIN — read-only posture; set / reset lives on the Health
          tab's Dashboard access card. */}
      <div className="space-y-2 border-t border-border-default pt-3">
        {pinValue ? (
          <StatusRow
            label={t("pinLabel")}
            value={pinValue.text}
            valueClass={pinValue.cls}
            hint={t("pinHint")}
          />
        ) : (
          <div>
            <div className="text-xs text-text-secondary">{t("pinLabel")}</div>
            <p className="mt-0.5 text-[11px] text-text-tertiary">
              {t("pinNoPath")}
            </p>
          </div>
        )}
      </div>
    </Section>
  );
}
