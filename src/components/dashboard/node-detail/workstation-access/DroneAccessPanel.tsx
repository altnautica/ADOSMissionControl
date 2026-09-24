"use client";

/**
 * @module DroneAccessPanel
 * @description The workstation's "Drone access" view: for every paired drone
 * and ground station, whether it holds a credential from this workstation, so
 * its lanes here (Atlas ingest and world stream, perception offload, artifacts)
 * are admitted.
 *
 * Two facts per node, each from where it is true: what the workstation says it
 * issued (read live from the workstation; a credential issued before the
 * workstation was re-paired admits nothing and reads as stale), and what this
 * GCS recorded installing on the node. Provisioning is automatic (see
 * `WorkstationCredentialBridge`); the operator can re-provision a node now or
 * revoke its credential, which stays revoked until re-provisioned.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ComputeAgentClient } from "@/lib/agent/compute-client";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import {
  listNodeCredentials,
  revokeNodeCredential,
  type ListedNodeCredential,
} from "@/lib/agent/node-credential-client";
import { lanesForPeer, provisionAndRecord } from "@/lib/nodes/workstation-provisioning";
import { isDemoMode } from "@/lib/utils";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import { useWorkstationLinkStore, workstationLinkKey } from "@/stores/workstation-link-store";

function Calm({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[280px] items-center justify-center p-6">
      <div className="text-center">
        <KeyRound className="mx-auto mb-2 h-5 w-5 text-text-tertiary" />
        <p className="max-w-sm text-[11px] text-text-tertiary">{message}</p>
      </div>
    </div>
  );
}

export function DroneAccessPanel({ nodeId }: { nodeId: string }) {
  const t = useTranslations("atlas.droneAccess");
  const deviceId = deviceIdFromNodeId(nodeId) ?? nodeId;
  const nodes = useLocalNodesStore((s) => s.nodes);
  const workstation = nodes.find((n) => n.deviceId === deviceId);
  const peers = nodes.filter(
    (n) => n.deviceId !== deviceId && lanesForPeer(n.profile) !== null,
  );
  const host = workstation?.hostname ?? "";
  const apiKey = workstation?.apiKey ?? "";
  const links = useWorkstationLinkStore((s) => s.links);
  const inFlight = useWorkstationLinkStore((s) => s.inFlight);

  // What the workstation says it issued, tagged with the target it was read
  // from so a node switch never shows the previous node's list; `issued: null`
  // means the workstation did not answer.
  const [listing, setListing] = useState<{
    target: string;
    issued: ListedNodeCredential[] | null;
  } | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const target = `${host}|${apiKey}`;

  // Re-read whenever a provisioning settles or a row acted, so the view
  // follows the bridge and the operator.
  useEffect(() => {
    if (!host || !apiKey) return;
    let cancelled = false;
    void listNodeCredentials(new ComputeAgentClient(host, apiKey)).then((issued) => {
      if (!cancelled) setListing({ target: `${host}|${apiKey}`, issued });
    });
    return () => {
      cancelled = true;
    };
  }, [host, apiKey, links, refreshTick]);

  if (isDemoMode()) return <Calm message={t("demo")} />;
  if (!workstation || !host || !apiKey) return <Calm message={t("localOnly")} />;
  if (peers.length === 0) return <Calm message={t("noPeers")} />;

  const current = listing?.target === target ? listing : null;
  const issued = current?.issued ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border-default p-2 text-[11px] text-text-tertiary">
        {current && current.issued === null ? t("unreachable") : t("intro")}
      </div>
      <ul className="flex-1 divide-y divide-border-default overflow-y-auto">
        {peers.map((peer) => (
          <PeerRow
            key={peer.deviceId}
            workstation={workstation}
            peer={peer}
            issued={issued?.find((c) => c.peerDeviceId === peer.deviceId) ?? null}
            issuedKnown={issued !== null}
            busy={Boolean(inFlight[workstationLinkKey(workstation.deviceId, peer.deviceId)])}
            onChanged={() => setRefreshTick((n) => n + 1)}
          />
        ))}
      </ul>
    </div>
  );
}

function PeerRow({
  workstation,
  peer,
  issued,
  issuedKnown,
  busy,
  onChanged,
}: {
  workstation: LocalNode;
  peer: LocalNode;
  issued: ListedNodeCredential | null;
  issuedKnown: boolean;
  busy: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("atlas.droneAccess");
  const key = workstationLinkKey(workstation.deviceId, peer.deviceId);
  const link = useWorkstationLinkStore((s) => s.links[key]);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const lanes = lanesForPeer(peer.profile) ?? [];

  const workstationFact = !issuedKnown
    ? t("issuedUnknown")
    : issued === null
      ? t("notIssued")
      : issued.current
        ? t("issuedAt", { at: new Date(issued.createdAtMs).toLocaleString() })
        : t("issuedStale");
  const nodeFact = busy
    ? t("provisioning")
    : link === undefined
      ? t("notInstalled")
      : link.state === "provisioned"
        ? t("installedAt", { at: new Date(link.at).toLocaleString() })
        : link.state === "revoked"
          ? t("revoked")
          : t("failed", { error: link.error ?? "" });
  const healthy =
    !busy && link?.state === "provisioned" && issued !== null && issued.current;

  const reprovision = async () => {
    setRevokeError(null);
    await provisionAndRecord({ workstation, peer, lanes });
    onChanged();
  };

  const revoke = async () => {
    if (!issued) return;
    setRevokeError(null);
    const r = await revokeNodeCredential(
      new ComputeAgentClient(workstation.hostname, workstation.apiKey),
      issued.id,
    );
    if (!r.ok) {
      setRevokeError(r.message);
      return;
    }
    useWorkstationLinkStore.getState().record({
      workstationDeviceId: workstation.deviceId,
      peerDeviceId: peer.deviceId,
      state: "revoked",
      credentialId: issued.id,
      workstationPairedAt: workstation.pairedAt,
      peerPairedAt: peer.pairedAt,
      at: Date.now(),
    });
    onChanged();
  };

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${healthy ? "bg-status-success" : "bg-status-warning"}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-text-primary">
          {peer.name}
          <span className="ml-2 text-[10px] uppercase tracking-wide text-text-tertiary">
            {t(peer.profile === "drone" ? "profileDrone" : "profileGroundStation")}
          </span>
        </div>
        <div className="truncate text-[11px] text-text-secondary">{workstationFact}</div>
        <div className="truncate text-[11px] text-text-tertiary">{nodeFact}</div>
        {revokeError && (
          <div className="truncate text-[11px] text-status-error">
            {t("revokeFailed", { error: revokeError })}
          </div>
        )}
      </div>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void reprovision()}>
        {link === undefined ? t("provision") : t("reprovision")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy || issued === null}
        onClick={() => void revoke()}
      >
        {t("revoke")}
      </Button>
    </li>
  );
}
