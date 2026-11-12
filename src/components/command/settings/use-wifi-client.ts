import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
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
import { useToast } from "@/components/ui/toast";
import { useDescribeAgentError } from "@/hooks/use-describe-agent-error";
import { useNodeDirectAgent } from "./use-node-direct-agent";

const STATUS_POLL_MS = 10000;

/**
 * State and actions of the node Wi-Fi page: the status poll, scan, join,
 * leave and the saved-network list, all bound to the node's own connection.
 */
export function useWifiClient(nodeDeviceId: string | null) {
  const t = useTranslations("nodeSettings");
  const { toast } = useToast();
  const describeAgentError = useDescribeAgentError();
  const agent = useNodeDirectAgent(nodeDeviceId);
  const ctx = useMemo(
    () => (agent ? agentNetworkContext(agent.agentUrl, agent.apiKey) : null),
    [agent],
  );
  // Answers belong to the connection they were requested on. A status poll,
  // scan or join started against one node that resolves after the page moved
  // to another is dropped instead of rendering under the new node's name.
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  }, [ctx]);
  // The identity of the agent this section talks to. It changes on a node
  // switch, a re-pair, or an unpair — and every field holding the PREVIOUS
  // agent's state must clear then, so a passphrase (or SSID) typed for one node
  // can never be submitted to the next. The section renders the same instances
  // in place, so nothing resets these otherwise.
  const agentIdentity = `${nodeDeviceId ?? ""}|${agent?.agentUrl ?? ""}|${agent?.apiKey ?? ""}`;

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
      const next = await getWifiStatus(ctx);
      if (ctxRef.current !== ctx) return;
      setStatus(next);
      setStatusFailed(false);
    } catch {
      if (ctxRef.current !== ctx) return;
      setStatus(null);
      setStatusFailed(true);
    }
    try {
      const next = await getConfiguredWifi(ctx);
      if (ctxRef.current !== ctx) return;
      setSaved(next);
    } catch {
      if (ctxRef.current !== ctx) return;
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
      const found = await scanWifi(ctx);
      if (ctxRef.current !== ctx) return;
      setNetworks(found);
    } catch (err) {
      if (ctxRef.current !== ctx) return;
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
        toast(describeAgentError(err, t("wifi.joinFailed")), "error");
      } finally {
        setJoining(false);
      }
      await refresh();
    },
    [ctx, joining, ssid, passphrase, toast, t, refresh, describeAgentError],
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
      toast(describeAgentError(err, t("applyFailed")), "error");
    } finally {
      setLeaving(false);
    }
    await refresh();
  }, [ctx, leaving, toast, t, refresh, describeAgentError]);

  const onForget = useCallback(
    async (name: string) => {
      if (!ctx) return;
      setRowBusy(name);
      try {
        await forgetWifi(ctx, name);
        toast(t("wifi.forgot", { name }), "success");
      } catch (err) {
        toast(describeAgentError(err, t("applyFailed")), "error");
      } finally {
        setRowBusy(null);
      }
      await refresh();
    },
    [ctx, toast, t, refresh, describeAgentError],
  );

  const onAutoconnect = useCallback(
    async (name: string, enabled: boolean) => {
      if (!ctx || rowBusy) return;
      setRowBusy(name);
      try {
        await setWifiAutoconnect(ctx, name, enabled);
        toast(t("applied"), "success");
      } catch (err) {
        toast(describeAgentError(err, t("applyFailed")), "error");
      } finally {
        setRowBusy(null);
      }
      await refresh();
    },
    [ctx, rowBusy, toast, t, refresh, describeAgentError],
  );

  const pickNetwork = useCallback((n: WifiScanNetwork) => {
    setSsid(n.ssid);
    // Hand focus to the passphrase input so keyboard flow continues
    // scan-pick → type password → Enter to join.
    document.getElementById("wifi-join-passphrase")?.focus();
  }, []);

  return {
    agent,
    ctx,
    status,
    statusFailed,
    saved,
    networks,
    scanning,
    scanError,
    ssid,
    setSsid,
    passphrase,
    setPassphrase,
    joining,
    forcePrompt,
    setForcePrompt,
    leavePrompt,
    setLeavePrompt,
    leaving,
    forgetPrompt,
    setForgetPrompt,
    rowBusy,
    onScan,
    doJoin,
    onLeave,
    onForget,
    onAutoconnect,
    pickNetwork,
  };
}
