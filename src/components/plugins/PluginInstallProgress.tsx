"use client";

/**
 * @module PluginInstallProgress
 * @description Toast-style stepper that tracks a plugin install job
 * through the six-stage state machine. Subscribes to the agent's
 * WebSocket on the LAN path or to a Convex reactive query on the cloud
 * path. Re-opens a dropped LAN stream at a fixed interval until the job
 * ends. Simulates the full sequence in demo mode.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, X, Loader2, AlertCircle, Minus } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

import { cn, isDemoMode } from "@/lib/utils";
import { useConvexAvailable } from "@/hooks/use-convex-available";
import {
  installJobTicketScope,
  mintWsTicket,
  WS_TICKET_PROTOCOL,
} from "@/lib/api/ground-station/ws-ticket";

import {
  INSTALL_STAGES,
  LAN_SKIPPED_STAGES,
  cloudJobStage,
  humanStage,
  isTerminalStage,
  parseAgentJobFrame,
  stageIndex,
  type InstallJobError,
  type InstallStage,
} from "./install-stages";
import type { InstallTransport } from "./transports/types";

/** Fixed delay before re-opening a dropped LAN progress stream. */
const LAN_RECONNECT_MS = 2000;

export interface PluginInstallProgressProps {
  jobId: string;
  transport: InstallTransport;
  agentLanUrl?: string;
  pairingKey?: string;
  pluginName?: string;
  pluginVersion?: string;
  deviceLabel?: string;
}

interface ProgressState {
  stage: InstallStage;
  error?: InstallJobError;
  connectionWarning?: string;
}

const DEMO_TICK_MS = 600;

export function PluginInstallProgress(props: PluginInstallProgressProps) {
  const {
    jobId,
    transport,
    agentLanUrl,
    pairingKey,
    pluginName,
    pluginVersion,
    deviceLabel,
  } = props;

  const [state, setState] = useState<ProgressState>(() => ({
    stage: transport === "lan" ? "verifying" : "uploading",
  }));
  const [dismissed, setDismissed] = useState(false);

  // --- Demo mode ----------------------------------------------------
  useEffect(() => {
    if (!isDemoMode()) return;
    const seq: InstallStage[] =
      transport === "lan"
        ? ["verifying", "installing", "enabling", "completed"]
        : [...INSTALL_STAGES, "completed"];
    let i = 0;
    setState({ stage: seq[0] });
    const id = window.setInterval(() => {
      i += 1;
      if (i >= seq.length) {
        window.clearInterval(id);
        return;
      }
      const next = seq[i];
      setState({ stage: next });
    }, DEMO_TICK_MS);
    return () => window.clearInterval(id);
  }, [jobId, transport]);

  // --- LAN WebSocket subscription -----------------------------------
  //
  // Browsers cannot set custom headers on the WebSocket handshake, so the
  // pairing key is exchanged (over the normal ``X-ADOS-Key`` REST call) for a
  // one-shot ticket that rides the ``ados-ws-ticket`` subprotocol, the same
  // ticket every authenticated WS on the agent front accepts. A dropped
  // stream is retried at a fixed interval until the job reaches a terminal
  // stage or the view unmounts; it never gives up on its own.
  useEffect(() => {
    if (isDemoMode()) return;
    if (transport !== "lan" || !agentLanUrl) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let cancelled = false;
    let ticketAbort: AbortController | null = null;

    const retrySoon = (): void => {
      if (cancelled) return;
      setState((cur) => {
        if (isTerminalStage(cur.stage)) return cur;
        reconnectTimer = window.setTimeout(() => void open(), LAN_RECONNECT_MS);
        return { ...cur, connectionWarning: "Reconnecting..." };
      });
    };

    const open = async (): Promise<void> => {
      if (cancelled) return;
      if (!pairingKey) {
        setState((s) => ({
          ...s,
          error: {
            code: "auth_missing",
            message: "Drone is not paired; cannot open progress channel.",
          },
          stage: "failed",
        }));
        return;
      }

      let ticket: string | null;
      try {
        ticketAbort = new AbortController();
        ticket = await mintWsTicket(
          { baseUrl: agentLanUrl, apiKey: pairingKey },
          installJobTicketScope(jobId),
          ticketAbort.signal,
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        retrySoon();
        return;
      }

      let wsUrlStr: string;
      try {
        wsUrlStr = new URL(
          `/api/plugins/jobs/${encodeURIComponent(jobId)}`,
          agentLanUrl.replace(/^http/, "ws"),
        ).toString();
      } catch {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          error: { code: "lan_url_invalid", message: "Bad LAN agent URL." },
          stage: "failed",
        }));
        return;
      }
      if (cancelled) return;
      ws = ticket
        ? new WebSocket(wsUrlStr, [WS_TICKET_PROTOCOL, ticket])
        : new WebSocket(wsUrlStr);
      ws.onmessage = (ev) => {
        try {
          const update = parseAgentJobFrame(JSON.parse(String(ev.data)));
          if (!update) return;
          setState((s) => ({
            stage: update.stage,
            error: update.error ?? s.error,
            connectionWarning: undefined,
          }));
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onclose = () => retrySoon();
    };

    void open();
    return () => {
      cancelled = true;
      if (ticketAbort) {
        try { ticketAbort.abort(); } catch { /* ignore */ }
      }
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, [jobId, transport, agentLanUrl, pairingKey]);

  // --- Cloud reactive subscription ----------------------------------
  const convexAvailable = useConvexAvailable();
  const cloudArgs = useMemo(
    () =>
      !isDemoMode() && convexAvailable && transport === "cloud"
        ? { jobId: jobId as Id<"plugin_install_jobs"> }
        : ("skip" as const),
    [convexAvailable, transport, jobId],
  );
  // Call the query unconditionally and pass "skip" when the cloud path is
  // inactive (demo mode, no Convex, or the LAN transport). Skipping keeps
  // the hook order stable across renders while doing no network work.
  const cloudJob = useQuery(api.cmdPluginInstallJobs.getJob, cloudArgs);
  useEffect(() => {
    if (!cloudJob) return;
    const stage = cloudJobStage(cloudJob.stage);
    if (stage === null) return;
    setState((s) => ({
      stage,
      error: cloudJob.error ?? s.error,
    }));
  }, [cloudJob]);

  // --- Render -------------------------------------------------------
  const terminal = isTerminalStage(state.stage);
  if (dismissed && terminal) return null;
  const currentIndex = stageIndex(state.stage);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 top-4 z-[100] w-[360px] rounded-md border border-border-default bg-bg-secondary p-3 shadow-lg"
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">
            {pluginName ?? "Plugin install"}
            {pluginVersion ? (
              <span className="ml-1 text-xs text-text-tertiary">
                v{pluginVersion}
              </span>
            ) : null}
          </p>
          {deviceLabel ? (
            <p className="truncate text-xs text-text-tertiary">
              on {deviceLabel}
            </p>
          ) : null}
        </div>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
            transport === "lan"
              ? "bg-status-success/10 text-status-success"
              : "bg-accent-primary/10 text-accent-primary",
          )}
        >
          {transport === "lan" ? "LAN" : "Cloud"}
        </span>
        {terminal ? (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss install progress"
            className="text-text-tertiary hover:text-text-primary"
          >
            <X size={14} />
          </button>
        ) : null}
      </header>

      <ol className="flex items-center gap-1.5">
        {INSTALL_STAGES.map((s, i) => {
          const lanSkip = transport === "lan" && LAN_SKIPPED_STAGES.has(s);
          const isFailed = state.stage === "failed";
          const isActive = !terminal && i === currentIndex;
          const isDone = i < currentIndex || (terminal && !isFailed);
          const dotState: DotState = lanSkip
            ? "skipped"
            : isFailed && i >= currentIndex
              ? "failed"
              : isActive
                ? "active"
                : isDone
                  ? "done"
                  : "pending";
          return (
            <li key={s} className="flex flex-1 items-center justify-center" aria-label={s}>
              <StageDot state={dotState} />
            </li>
          );
        })}
      </ol>

      <p className="mt-2 text-xs text-text-secondary">
        {terminal
          ? state.stage === "completed"
            ? "Done"
            : `Failed: ${state.error?.code ?? "unknown"}`
          : `${humanStage(state.stage)}...`}
      </p>
      {state.connectionWarning ? (
        <p className="mt-1 text-xs text-status-warning">{state.connectionWarning}</p>
      ) : null}
      {state.stage === "failed" && state.error ? (
        <Details error={state.error} />
      ) : null}
    </div>
  );
}

// --- helpers --------------------------------------------------------

type DotState = "pending" | "active" | "done" | "failed" | "skipped";

function StageDot({ state }: { state: DotState }): ReactNode {
  if (state === "skipped")
    return <Minus size={12} className="text-text-tertiary/50" aria-hidden />;
  if (state === "done")
    return <Check size={12} className="text-status-success" aria-hidden />;
  if (state === "active")
    return <Loader2 size={12} className="animate-spin text-accent-primary" aria-hidden />;
  if (state === "failed")
    return <AlertCircle size={12} className="text-status-error" aria-hidden />;
  return <span aria-hidden className="block h-2 w-2 rounded-full bg-text-tertiary/40" />;
}

function Details({ error }: { error: InstallJobError }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 border-t border-border-default pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-accent-primary hover:underline"
      >
        {open ? "Hide details" : "Details"}
      </button>
      {open ? (
        <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-status-error">
          {error.message}
        </pre>
      ) : null}
    </div>
  );
}

