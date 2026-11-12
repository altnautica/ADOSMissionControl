"use client";

/**
 * @module node-detail/AgentDiagnosticsStrip
 * @description The node's own command-path verdicts under the header: the
 * unsigned-traffic risk banner and the software-encode badge when they apply,
 * and a collapsed row list (FC system id with the identity reconciler's
 * outcome, the proxy edges the router holds, injector arbitration, the
 * agent's signing state).
 *
 * Read from `/api/status/full` on the attached LAN agent only: the system
 * store holds one focused agent, and another node's verdicts must never be
 * painted on this one. Polled at a fixed interval while mounted.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import {
  AGENT_SIGNING_COPY,
  FC_IDENTITY_OUTCOME_COPY,
  INJECTOR_ARBITRATION_COPY,
  type AgentDiagnostics,
  type ProxyListening,
} from "@/lib/agent/agent-diagnostics";
import { UnsignedRiskBanner } from "@/components/fc/security/signing/UnsignedRiskBanner";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

const POLL_MS = 5_000;

function listening(flag: boolean | null): string {
  if (flag === null) return "not reported";
  return flag ? "listening" : "not listening";
}

function proxySummary(proxy: ProxyListening | null): string {
  if (!proxy) return "Not reported";
  const udp =
    proxy.udp.length === 0
      ? "none"
      : `${proxy.udp.filter(Boolean).length}/${proxy.udp.length} listening`;
  const ws = proxy.ws === null ? "not configured" : listening(proxy.ws);
  return `TCP ${listening(proxy.tcp)} · UDP ${udp} · WS ${ws}`;
}

function identitySummary(d: AgentDiagnostics): string {
  const id = d.fcSystemId === null ? "Not reported" : String(d.fcSystemId);
  const verdict = d.fcIdentity;
  if (!verdict?.outcome) return id;
  const copy = FC_IDENTITY_OUTCOME_COPY[verdict.outcome] ?? verdict.outcome;
  const wanted =
    verdict.wantedSystemId !== null && verdict.wantedSystemId !== d.fcSystemId
      ? ` (slot wants ${verdict.wantedSystemId})`
      : "";
  return `${id} · ${copy}${wanted}`;
}

/** The rows and banners for one diagnostics reading. Exported for tests. */
export function AgentDiagnosticsView({ diagnostics }: { diagnostics: AgentDiagnostics }) {
  const tq = useTranslations("dashboard.agentDiagnosticsStrip");
  const d = diagnostics;
  const rows: Array<[string, string]> = [
    ["FC system id", identitySummary(d)],
    ["MAVLink proxy", proxySummary(d.proxy)],
    [
      "Injector arbitration",
      d.injectorArbitration === null
        ? "Not reported"
        : (INJECTOR_ARBITRATION_COPY[d.injectorArbitration] ?? d.injectorArbitration),
    ],
    [
      "Agent signing",
      d.agentSigning === null
        ? "Not reported"
        : (AGENT_SIGNING_COPY[d.agentSigning] ?? d.agentSigning),
    ],
    ["FC device", d.fcDevice ?? "Not reported"],
    [
      "Aux uplink drops",
      d.auxUplinkQueueFullDropped === null && d.auxUplinkPartialDropped === null
        ? "Not reported"
        : `${d.auxUplinkQueueFullDropped ?? "—"} queue full · ${d.auxUplinkPartialDropped ?? "—"} partial`,
    ],
    [
      "Control precedence",
      d.swarmPrecedence === null
        ? "Not reported"
        : d.swarmPrecedence === "operator"
          ? "Operator (a human holds pilot-in-command)"
          : d.swarmPrecedence,
    ],
  ];
  return (
    <div className="flex flex-col gap-1.5 px-3 py-1.5 border-b border-border-default bg-bg-secondary">
      <UnsignedRiskBanner risk={d.unsignedRejectedRisk} />
      {d.encoderForcedSoftware === true && (
        <span
          className="inline-flex w-fit items-center gap-1 border border-status-warning/40 bg-status-warning/5 px-2 py-0.5 text-[11px] text-status-warning"
          title={tq("theHardwareEncoderFailedVideo")}
        >
          <Cpu size={12} aria-hidden="true" />
          {tq("softwareEncode")}
        </span>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-text-tertiary">{tq("agentCommandPath")}</summary>
        <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-text-tertiary">{label}</dt>
              <dd className="text-text-primary">{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

export function AgentDiagnosticsStrip({ agentDeviceId }: { agentDeviceId: string | null }) {
  const client = useAgentConnectionStore((s) => s.client);
  const attachedDeviceId = useAgentConnectionStore((s) => s.nodeDeviceId);
  const own = agentDeviceId !== null && attachedDeviceId === agentDeviceId;
  const [diagnostics, setDiagnostics] = useState<AgentDiagnostics | null>(null);

  useEffect(() => {
    setDiagnostics(null);
    if (!own || !client) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await client.getAgentDiagnostics();
        if (!cancelled && next) setDiagnostics(next);
      } catch {
        // A missed poll keeps the last reading; the next tick retries.
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client, own]);

  if (!own || !diagnostics) return null;
  return <AgentDiagnosticsView diagnostics={diagnostics} />;
}
