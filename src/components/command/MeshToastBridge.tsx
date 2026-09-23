"use client";

/**
 * @module MeshToastBridge
 * @description Subscribes to the mesh + pairing event stream and fires
 * toast notifications for transient changes the operator should notice:
 * receiver unreachable, gateway failover, mesh partitioned, relay revoked.
 * Mounted once at the app shell level so toasts surface from any tab.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toast";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

const RECENT_DEDUP_MS = 1500;
const DEDUP_MAX_KEYS = 100;

export function MeshToastBridge() {
  const t = useTranslations("toast.mesh");
  const { toast } = useToast();
  const meshHealth = useGroundStationStore((s) => s.mesh.health);
  const selectedGateway = useGroundStationStore((s) => s.mesh.selectedGateway);
  const focusedNode = useAgentConnectionStore((s) => s.nodeDeviceId);

  const partitionedRef = useRef<boolean>(false);
  const gatewayRef = useRef<string | null>(null);
  const lastTransientTsRef = useRef<number>(0);
  const lastFireRef = useRef<Record<string, number>>({});
  const lastTransient = useGroundStationStore((s) => s.mesh.lastTransientEvent);

  const fire = (key: string, message: string, status: "warning" | "info" | "error") => {
    const now = Date.now();
    const store = lastFireRef.current;
    if (store[key] && now - store[key] < RECENT_DEDUP_MS) {
      return;
    }
    store[key] = now;
    // Cap the dedup store so a long-running session does not leak
    // memory per transient event id (e.g., every relay_revoked gets a
    // unique timestamp-based key). Evict the oldest entries when we
    // cross the soft cap.
    const keys = Object.keys(store);
    if (keys.length > DEDUP_MAX_KEYS) {
      const sorted = keys.sort((a, b) => store[a] - store[b]);
      const evictCount = keys.length - DEDUP_MAX_KEYS;
      for (let i = 0; i < evictCount; i += 1) {
        delete store[sorted[i]];
      }
    }
    toast(message, status);
  };

  // A node switch is not a transition: re-baseline the refs to whatever the
  // newly focused ground station reports, so its first reading is never
  // compared against the previous node's. Declared before the transition
  // effects so it runs first in the same commit.
  useEffect(() => {
    partitionedRef.current = meshHealth?.partition ?? false;
    gatewayRef.current = selectedGateway;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedNode]);

  // Partition status transitions.
  useEffect(() => {
    if (!meshHealth) {
      partitionedRef.current = false;
      return;
    }
    if (meshHealth.partition && !partitionedRef.current) {
      fire("partitioned", t("partitioned"), "error");
    }
    partitionedRef.current = meshHealth.partition;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshHealth?.partition]);

  // Gateway failover transitions.
  useEffect(() => {
    if (selectedGateway === gatewayRef.current) return;
    const previous = gatewayRef.current;
    gatewayRef.current = selectedGateway;
    if (previous && selectedGateway && previous !== selectedGateway) {
      fire(
        `gw-${selectedGateway}`,
        t("gatewayFailover", { to: selectedGateway }),
        "info",
      );
    }
  }, [selectedGateway, t]);

  // Transient toast-worthy events (receiver_unreachable, relay_revoked).
  useEffect(() => {
    if (!lastTransient) return;
    if (lastTransient.ts <= lastTransientTsRef.current) return;
    lastTransientTsRef.current = lastTransient.ts;
    if (lastTransient.kind === "receiver_unreachable") {
      const last = (lastTransient.payload?.last_receiver as string) || "";
      fire(
        `recv-unreachable-${lastTransient.ts}`,
        t("receiverUnreachable", { id: last || "?" }),
        "warning",
      );
    } else if (lastTransient.kind === "relay_revoked") {
      const id = (lastTransient.payload?.device_id as string) || "?";
      fire(
        `relay-revoked-${lastTransient.ts}`,
        t("relayRevoked", { id }),
        "info",
      );
    } else if (lastTransient.kind === "relay_disconnected") {
      const id = (lastTransient.payload?.relay_mac as string) || "?";
      fire(
        `relay-down-${lastTransient.ts}`,
        t("relayDisconnected", { id }),
        "warning",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTransient]);

  return null;
}
