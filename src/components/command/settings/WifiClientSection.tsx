"use client";

/**
 * @module command/settings/WifiClientSection
 * @description The node Settings "Wi-Fi" page: current station connection,
 * scan → join, disconnect, and the saved-network list (autoconnect / forget)
 * over the agent's profile-agnostic `/api/v1/network/client/*` surface —
 * served on every profile, since joining a bench network only needs a wlan
 * interface.
 *
 * Honesty rules: the connection state is the agent's own report (an agent
 * whose Wi-Fi manager is unreachable reports the same not-connected shape,
 * so it reads "no connection reported", not "disconnected"); a 404/501 scan
 * renders "not exposed by this agent version" instead of an empty list; the
 * passphrase is write-only — sent to the node on join, cleared locally,
 * never echoed back.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Wifi } from "lucide-react";

import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import {
  AgentNetworkError,
  agentNetworkContext,
  forgetWifi,
  getConfiguredWifi,
  getWifiStatus,
  isRouteUnexposed,
  joinWifi,
  leaveWifi,
  scanWifi,
  setWifiAutoconnect,
  type SavedWifiConnection,
  type WifiClientLiveStatus,
  type WifiScanNetwork,
} from "@/lib/agent/network-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Section } from "./Section";

const STATUS_POLL_MS = 10000;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-text-tertiary">{label}</span>
      <span className="shrink-0 font-mono text-xs text-text-primary">{value}</span>
    </div>
  );
}

export function WifiClientSection() {
  const t = useTranslations("nodeSettings");
  const { toast } = useToast();
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);
  const nodeDeviceId = useAgentConnectionStore((s) => s.nodeDeviceId);
  const ctx = useMemo(
    () => agentNetworkContext(agentUrl, apiKey),
    [agentUrl, apiKey],
  );
  // The identity of the agent this section talks to. It changes on a node
  // switch, a re-pair, or an unpair — and every field holding the PREVIOUS
  // agent's state must clear then, so a passphrase (or SSID) typed for one node
  // can never be submitted to the next. The section renders the same instances
  // in place, so nothing resets these otherwise.
  const agentIdentity = `${nodeDeviceId ?? ""}|${agentUrl ?? ""}|${apiKey ?? ""}`;

  const [status, setStatus] = useState<WifiClientLiveStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [saved, setSaved] = useState<SavedWifiConnection[] | null>(null);
  const [networks, setNetworks] = useState<WifiScanNetwork[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<{
    message: string;
    unexposed: boolean;
  } | null>(null);

  const [ssid, setSsid] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [joining, setJoining] = useState(false);
  const [forcePrompt, setForcePrompt] = useState(false);
  const [leavePrompt, setLeavePrompt] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [forgetPrompt, setForgetPrompt] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!ctx) return;
    try {
      setStatus(await getWifiStatus(ctx));
      setStatusFailed(false);
    } catch {
      setStatus(null);
      setStatusFailed(true);
    }
    try {
      setSaved(await getConfiguredWifi(ctx));
    } catch {
      setSaved(null);
    }
  }, [ctx]);

  useEffect(() => {
    if (!ctx) {
      setStatus(null);
      setSaved(null);
      setNetworks(null);
      setScanError(null);
      setStatusFailed(false);
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void refresh();
    };
    tick();
    const timer = setInterval(tick, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [ctx, refresh]);

  // Clear every field that carries the previous agent's state whenever the
  // agent identity changes (node switch / re-pair / unpair). The polling effect
  // above only resets when the context becomes null, so a switch between two
  // reachable agents would otherwise leave A's SSID / passphrase / scan results
  // / confirm prompts in the form — a credential typed for A could then be
  // submitted to B. The status / saved list get refreshed by the poll; clearing
  // them here just avoids showing A's readings against B in the interim.
  useEffect(() => {
    setSsid("");
    setPassphrase("");
    setNetworks(null);
    setScanError(null);
    setStatus(null);
    setSaved(null);
    setStatusFailed(false);
    setForcePrompt(false);
    setLeavePrompt(false);
    setForgetPrompt(null);
  }, [agentIdentity]);

  const onScan = useCallback(async () => {
    if (!ctx || scanning) return;
    setScanning(true);
    setScanError(null);
    try {
      setNetworks(await scanWifi(ctx));
    } catch (err) {
      setNetworks(null);
      setScanError({
        message: err instanceof Error ? err.message : String(err),
        unexposed: isRouteUnexposed(err),
      });
    } finally {
      setScanning(false);
    }
  }, [ctx, scanning]);

  const doJoin = useCallback(
    async (force: boolean) => {
      if (!ctx || joining) return;
      const target = ssid.trim();
      if (!target) return;
      setJoining(true);
      try {
        const res = await joinWifi(ctx, {
          ssid: target,
          passphrase: passphrase.length > 0 ? passphrase : undefined,
          force,
        });
        if (res.joined) {
          // Write-only secret: clear as soon as the node has it.
          setPassphrase("");
          toast(t("wifi.joined", { ssid: target }), "success");
        } else {
          toast(
            res.error
              ? t("wifi.joinFailedReason", { reason: res.error })
              : t("wifi.joinFailed"),
            "error",
          );
        }
      } catch (err) {
        if (err instanceof AgentNetworkError && err.needsForce) {
          setForcePrompt(true);
          return;
        }
        toast(err instanceof Error ? err.message : t("wifi.joinFailed"), "error");
      } finally {
        setJoining(false);
      }
      await refresh();
    },
    [ctx, joining, ssid, passphrase, toast, t, refresh],
  );

  const onLeave = useCallback(async () => {
    if (!ctx || leaving) return;
    setLeaving(true);
    try {
      const res = await leaveWifi(ctx);
      toast(
        res.previous_ssid
          ? t("wifi.leftNetwork", { ssid: res.previous_ssid })
          : t("wifi.left"),
        "success",
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : t("applyFailed"), "error");
    } finally {
      setLeaving(false);
    }
    await refresh();
  }, [ctx, leaving, toast, t, refresh]);

  const onForget = useCallback(
    async (name: string) => {
      if (!ctx) return;
      setRowBusy(name);
      try {
        await forgetWifi(ctx, name);
        toast(t("wifi.forgot", { name }), "success");
      } catch (err) {
        toast(err instanceof Error ? err.message : t("applyFailed"), "error");
      } finally {
        setRowBusy(null);
      }
      await refresh();
    },
    [ctx, toast, t, refresh],
  );

  const onAutoconnect = useCallback(
    async (name: string, enabled: boolean) => {
      if (!ctx || rowBusy) return;
      setRowBusy(name);
      try {
        await setWifiAutoconnect(ctx, name, enabled);
        toast(t("applied"), "success");
      } catch (err) {
        toast(err instanceof Error ? err.message : t("applyFailed"), "error");
      } finally {
        setRowBusy(null);
      }
      await refresh();
    },
    [ctx, rowBusy, toast, t, refresh],
  );

  const pickNetwork = useCallback((n: WifiScanNetwork) => {
    setSsid(n.ssid);
    // Hand focus to the passphrase input so keyboard flow continues
    // scan-pick → type password → Enter to join.
    document.getElementById("wifi-join-passphrase")?.focus();
  }, []);

  return (
    <Section title={t("wifi.title")} icon={Wifi} blurb={t("wifi.blurb")}>
      {!ctx ? (
        <div className="rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-tertiary">
          {t("network.liveRequiresLan")}
        </div>
      ) : (
        <>
          {/* Current connection — the agent's own report. */}
          <div className="space-y-2">
            <div className="text-xs text-text-secondary">
              {t("wifi.currentTitle")}
            </div>
            {statusFailed ? (
              <p className="text-[11px] text-status-error">
                {t("wifi.statusFailed")}
              </p>
            ) : status?.connected ? (
              <div className="space-y-1.5 rounded border border-border-default/40 bg-bg-tertiary px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-text-primary">
                    {status.ssid ?? t("wifi.unknownSsid")}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setLeavePrompt(true)}
                    disabled={leaving}
                  >
                    {leaving ? t("saving") : t("wifi.leaveAction")}
                  </Button>
                </div>
                {status.signal !== null ? (
                  <Row label={t("wifi.signalLabel")} value={`${status.signal}%`} />
                ) : null}
                {status.ip ? <Row label={t("wifi.ipLabel")} value={status.ip} /> : null}
                {status.security ? (
                  <Row label={t("wifi.securityLabel")} value={status.security} />
                ) : null}
              </div>
            ) : (
              <p className="text-[11px] text-text-tertiary">
                {t("wifi.noConnectionReported")}
              </p>
            )}
          </div>

          {/* Join a network (manual SSID entry works for hidden networks). */}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void doJoin(false);
            }}
          >
            <div className="text-xs text-text-secondary">
              {t("wifi.joinTitle")}
            </div>
            <Input
              id="wifi-join-ssid"
              label={t("wifi.ssidLabel")}
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              placeholder={t("wifi.ssidPlaceholder")}
              disabled={joining}
            />
            <Input
              id="wifi-join-passphrase"
              label={t("wifi.passwordLabel")}
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={t("wifi.passwordPlaceholder")}
              disabled={joining}
            />
            <p className="text-[11px] text-text-tertiary">
              {t("wifi.passwordHint")}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={joining || ssid.trim().length === 0}
              >
                {joining ? t("wifi.joining") : t("wifi.joinAction")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void onScan()}
                disabled={scanning}
              >
                {scanning ? t("wifi.scanning") : t("wifi.scanAction")}
              </Button>
            </div>
          </form>

          {/* Scan results. */}
          {scanError ? (
            <p className="text-[11px] text-text-tertiary">
              {scanError.unexposed
                ? t("wifi.scanUnsupported")
                : t("wifi.scanFailed", { message: scanError.message })}
            </p>
          ) : networks !== null ? (
            networks.length === 0 ? (
              <p className="text-[11px] text-text-tertiary">
                {t("wifi.scanEmpty")}
              </p>
            ) : (
              <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                {networks.map((n) => (
                  <li key={`${n.ssid}-${n.bssid}`}>
                    <button
                      type="button"
                      onClick={() => pickNetwork(n)}
                      className="flex w-full items-center justify-between gap-3 rounded border border-border-default/40 bg-bg-tertiary px-3 py-2 text-left hover:border-accent-primary focus:border-accent-primary focus:outline-none"
                      aria-label={t("wifi.useNetwork", { ssid: n.ssid })}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm text-text-primary">
                          {n.ssid}
                        </span>
                        {n.in_use ? (
                          <span className="rounded border border-status-success/40 bg-status-success/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-status-success">
                            {t("wifi.inUse")}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-baseline gap-2 font-mono text-[11px] text-text-tertiary">
                        <span>{n.security || t("wifi.openNetwork")}</span>
                        <span>{n.signal}%</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}

          {/* Saved networks. */}
          <div className="space-y-2 border-t border-border-default pt-3">
            <div className="text-xs text-text-secondary">
              {t("wifi.savedTitle")}
            </div>
            {saved === null ? (
              <p className="text-[11px] text-text-tertiary">
                {t("wifi.savedNotReported")}
              </p>
            ) : saved.length === 0 ? (
              <p className="text-[11px] text-text-tertiary">
                {t("wifi.savedEmpty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {saved.map((c) => (
                  <li
                    key={c.name}
                    className="flex items-center justify-between gap-3 rounded border border-border-default/40 bg-bg-tertiary px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm text-text-primary">
                        {c.name}
                      </div>
                      {c.device ? (
                        <div className="font-mono text-[10px] text-text-tertiary">
                          {c.device}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Toggle
                        label={t("wifi.autoconnectLabel")}
                        checked={c.autoconnect}
                        onChange={(v) => void onAutoconnect(c.name, v)}
                        disabled={rowBusy !== null}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setForgetPrompt(c.name)}
                        disabled={rowBusy !== null}
                      >
                        {t("wifi.forgetAction")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {/* Force-join: the node's AP holds the radio; joining takes it over. */}
      <ConfirmDialog
        open={forcePrompt}
        title={t("wifi.forceTitle")}
        message={t("wifi.forceMessage")}
        confirmLabel={t("wifi.forceConfirm")}
        variant="danger"
        onCancel={() => setForcePrompt(false)}
        onConfirm={() => {
          setForcePrompt(false);
          void doJoin(true);
        }}
      />
      <ConfirmDialog
        open={leavePrompt}
        title={t("wifi.leaveTitle")}
        message={t("wifi.leaveMessage", {
          ssid: status?.ssid ?? t("wifi.unknownSsid"),
        })}
        confirmLabel={t("wifi.leaveConfirm")}
        variant="danger"
        onCancel={() => setLeavePrompt(false)}
        onConfirm={() => {
          setLeavePrompt(false);
          void onLeave();
        }}
      />
      <ConfirmDialog
        open={forgetPrompt !== null}
        title={t("wifi.forgetTitle")}
        message={t("wifi.forgetMessage", { name: forgetPrompt ?? "" })}
        confirmLabel={t("wifi.forgetConfirm")}
        variant="danger"
        onCancel={() => setForgetPrompt(null)}
        onConfirm={() => {
          const name = forgetPrompt;
          setForgetPrompt(null);
          if (name) void onForget(name);
        }}
      />
    </Section>
  );
}
