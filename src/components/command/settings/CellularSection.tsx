"use client";

/**
 * @module command/settings/CellularSection
 * @description The node Settings "Cellular" page. On a ground station it
 * binds to the agent's modem surface: presence read-only from the node's own
 * modem-status snapshot, the modem view's config + usage legs, and writes
 * (enable, APN, data cap) whose response IS the read-back — the agent
 * replies with the modem view over the freshly-persisted config. Connectivity
 * legs that carry the manager's no-modem sentinels (`signal_quality: -1`,
 * `technology: "unknown"`, empty operator) render as unknown, never as facts.
 *
 * Other profiles have no live modem surface on the agent, so the page says
 * so and offers the config-backed cellular keys (enable + APN) instead.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Signal } from "lucide-react";

import type { NodeProfile } from "@/components/dashboard/node-detail/surface-types";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import type { ModemDetailStatus, ModemView } from "@/lib/api/ground-station/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { ConfigTextField, ConfigToggleField } from "./ConfigFields";
import { Section } from "./Section";

const POLL_MS = 10000;

interface SectionProps {
  profile: NodeProfile;
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

/** Format the configured data cap (MB) as a GB input string. */
export function capMbToGbString(capMb: number | null | undefined): string {
  if (typeof capMb !== "number" || !Number.isFinite(capMb) || capMb <= 0)
    return "";
  return String(Math.round((capMb / 1024) * 100) / 100);
}

/** Parse an operator-typed data-cap value in GB. Returns the number (0 clears
 * the cap) or null when the input is not a non-negative finite number. */
export function parseCapGb(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function ReadRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-text-tertiary">{label}</span>
      <span className="shrink-0 font-mono text-xs text-text-primary">{value}</span>
    </div>
  );
}

function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-tertiary">
      {children}
    </div>
  );
}

/** A dirty-tracked text input applying through an async writer, mirroring the
 * ConfigTextField contract (draft, Apply gate, toast, rollback on error). */
function ApplyField({
  id,
  label,
  hint,
  placeholder,
  current,
  disabled,
  validate,
  onApply,
}: {
  id: string;
  label: string;
  hint?: string;
  placeholder?: string;
  current: string;
  disabled: boolean;
  /** Returns an error message for an invalid draft, else null. */
  validate?: (draft: string) => string | null;
  onApply: (value: string) => Promise<void>;
}) {
  const t = useTranslations("nodeSettings");
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const value = draft ?? current;
  const dirty = draft !== null && draft !== current;
  const error = dirty && validate ? validate(value) : null;

  const apply = async () => {
    if (disabled || saving || !dirty || error) return;
    setSaving(true);
    try {
      await onApply(value.trim());
      setDraft(null);
    } catch {
      // The writer surfaced the failure (toast); keep the draft so the
      // operator can retry or correct it.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            id={id}
            label={label}
            value={value}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            disabled={disabled || saving}
            error={error ?? undefined}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void apply()}
          disabled={disabled || saving || !dirty || error !== null}
        >
          {saving ? t("saving") : t("apply")}
        </Button>
      </div>
      {hint ? <p className="text-[11px] text-text-tertiary">{hint}</p> : null}
    </div>
  );
}

export function CellularSection({
  profile,
  config,
  readOnly,
  setValue,
}: SectionProps) {
  const t = useTranslations("nodeSettings");
  const { toast } = useToast();
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  const isGroundStation = profile === "ground-station";
  const api = useMemo(
    () => (isGroundStation ? groundStationApiFromAgent(agentUrl, apiKey) : null),
    [isGroundStation, agentUrl, apiKey],
  );

  const [modem, setModem] = useState<ModemView | null>(null);
  const [detail, setDetail] = useState<ModemDetailStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [togglePending, setTogglePending] = useState(false);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      // The declared ModemStatus type predates the wire shape; the route
      // serves the flat modem view (config + usage + sentinel connectivity
      // legs) documented on ModemView.
      const view = (await api.getModem()) as unknown as ModemView;
      setModem(view);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
    try {
      setDetail(await api.getModemDetail());
    } catch {
      setDetail(null);
    }
  }, [api]);

  useEffect(() => {
    if (!api) {
      setModem(null);
      setDetail(null);
      setLoadFailed(false);
      return;
    }
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

  /** Write a modem-config change; the agent's response is the modem view
   * over the freshly-persisted config, so rendering it IS the read-back. */
  const writeModem = useCallback(
    async (update: { apn?: string; cap_gb?: number; enabled?: boolean }) => {
      if (!api) throw new Error(t("network.liveRequiresLan"));
      const view = (await api.setModem(update)) as unknown as ModemView;
      setModem(view);
    },
    [api, t],
  );

  const onToggleEnabled = useCallback(
    async (enabled: boolean) => {
      if (togglePending) return;
      setTogglePending(true);
      try {
        await writeModem({ enabled });
        toast(t("applied"), "success");
      } catch (err) {
        toast(err instanceof Error ? err.message : t("applyFailed"), "error");
      } finally {
        setTogglePending(false);
      }
    },
    [togglePending, writeModem, toast, t],
  );

  const applyText = useCallback(
    async (update: { apn?: string; cap_gb?: number }) => {
      try {
        await writeModem(update);
        toast(t("applied"), "success");
      } catch (err) {
        toast(err instanceof Error ? err.message : t("applyFailed"), "error");
        throw err;
      }
    },
    [writeModem, toast, t],
  );

  // ---- presence + facts (unknown renders unknown, sentinels excluded) -----

  const presence = (() => {
    if (!detail) return t("cellular.presenceUnknown");
    if (detail.present === true) return t("cellular.presenceDetected");
    switch (detail.reason) {
      case "no_modem":
        return t("cellular.presenceNone");
      case "modemmanager_not_installed":
        return t("cellular.presenceNoManager");
      default:
        return detail.reason ?? t("cellular.presenceUnknown");
    }
  })();

  const stateText =
    typeof modem?.state === "string" && modem.state.length > 0
      ? modem.state
      : t("cellular.stateUnknown");
  const operator =
    typeof modem?.operator === "string" && modem.operator.length > 0
      ? modem.operator
      : null;
  const technology =
    typeof modem?.technology === "string" &&
    modem.technology.length > 0 &&
    modem.technology !== "unknown"
      ? modem.technology
      : null;
  const signalQuality =
    typeof modem?.signal_quality === "number" && modem.signal_quality >= 0
      ? modem.signal_quality
      : null;
  const capMb = typeof modem?.cap_mb === "number" ? modem.cap_mb : null;
  const usedMb =
    typeof modem?.data_used_mb === "number" ? modem.data_used_mb : null;
  const percent = typeof modem?.percent === "number" ? modem.percent : null;

  return (
    <Section
      title={t("cellular.title")}
      icon={Signal}
      blurb={t("cellular.blurb")}
    >
      {isGroundStation ? (
        !api ? (
          <InfoNote>{t("network.liveRequiresLan")}</InfoNote>
        ) : (
          <>
            {loadFailed && !modem ? (
              <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-[11px] text-status-error">
                {t("cellular.loadFailed")}
              </div>
            ) : null}

            {/* Presence + reported connection facts — read-only. */}
            <div className="space-y-2">
              <ReadRow label={t("cellular.presenceLabel")} value={presence} />
              {modem ? (
                <>
                  <ReadRow label={t("cellular.stateLabel")} value={stateText} />
                  {operator ? (
                    <ReadRow label={t("cellular.operatorLabel")} value={operator} />
                  ) : null}
                  {technology ? (
                    <ReadRow
                      label={t("cellular.technologyLabel")}
                      value={technology}
                    />
                  ) : null}
                  {signalQuality !== null ? (
                    <ReadRow
                      label={t("cellular.signalLabel")}
                      value={`${signalQuality}%`}
                    />
                  ) : null}
                  {typeof modem.ip === "string" && modem.ip.length > 0 ? (
                    <ReadRow label={t("cellular.ipLabel")} value={modem.ip} />
                  ) : null}
                </>
              ) : null}
            </div>

            {modem ? (
              <>
                {/* Data usage against the configured cap. */}
                <div className="space-y-2 border-t border-border-default pt-3">
                  <div className="text-xs text-text-secondary">
                    {t("cellular.usageTitle")}
                  </div>
                  {capMb !== null && capMb > 0 ? (
                    <ReadRow
                      label={t("cellular.usedLabel")}
                      value={t("cellular.usedOfCap", {
                        used: usedMb ?? 0,
                        cap: capMb,
                        percent: percent !== null ? percent.toFixed(0) : "0",
                      })}
                    />
                  ) : (
                    <p className="text-[11px] text-text-tertiary">
                      {t("cellular.noCap")}
                    </p>
                  )}
                </div>

                {/* Writes — each response is the persisted modem view. */}
                <div className="space-y-4 border-t border-border-default pt-3">
                  <Toggle
                    label={t("cellular.enabledLabel")}
                    checked={modem.enabled === true}
                    onChange={(v) => void onToggleEnabled(v)}
                    disabled={readOnly || togglePending}
                  />
                  <p className="-mt-3 text-[11px] text-text-tertiary">
                    {t("cellular.enabledHint")}
                  </p>

                  <ApplyField
                    id="cellular-apn"
                    label={t("cellular.apnLabel")}
                    hint={t("cellular.apnHint")}
                    placeholder={t("cellular.apnPlaceholder")}
                    current={typeof modem.apn === "string" ? modem.apn : ""}
                    disabled={readOnly}
                    onApply={(v) => applyText({ apn: v })}
                  />

                  <ApplyField
                    id="cellular-cap-gb"
                    label={t("cellular.capLabel")}
                    hint={t("cellular.capHint")}
                    placeholder="0"
                    current={capMbToGbString(capMb)}
                    disabled={readOnly}
                    validate={(v) =>
                      parseCapGb(v) === null ? t("cellular.capInvalid") : null
                    }
                    onApply={(v) => {
                      const gb = parseCapGb(v);
                      if (gb === null)
                        return Promise.reject(new Error(t("cellular.capInvalid")));
                      return applyText({ cap_gb: gb });
                    }}
                  />
                </div>
              </>
            ) : null}
          </>
        )
      ) : (
        <>
          {/* No live modem surface on this profile — config-backed keys only. */}
          <InfoNote>{t("cellular.configOnlyNote")}</InfoNote>
          <ConfigToggleField
            configKey="network.cellular.enabled"
            label={t("cellular.enabledLabel")}
            hint={t("cellular.enabledHint")}
            config={config}
            readOnly={readOnly}
            setValue={setValue}
          />
          <ConfigTextField
            configKey="network.cellular.apn"
            label={t("cellular.apnLabel")}
            hint={t("cellular.apnHint")}
            placeholder={t("cellular.apnPlaceholder")}
            config={config}
            readOnly={readOnly}
            setValue={setValue}
          />
        </>
      )}
    </Section>
  );
}
