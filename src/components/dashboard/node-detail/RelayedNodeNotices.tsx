"use client";

/**
 * @module node-detail/RelayedNodeNotices
 * @description The node-detail notices that come from a ground station's
 * fleet slot table and from the relay itself:
 *
 * - a blocking banner, on the ground station and on every affected drone,
 *   while two aircraft in its fleet share one MAVLink system id (the station
 *   holds every command to that id);
 * - "Waiting for vehicle identity" on a relayed drone whose system id the
 *   station has not heard yet (no flight link is opened until it has);
 * - the drone's relay credential state when it is not `held`;
 * - why the last relayed connect was refused (relay ticket or the drone's own
 *   API), from the relay's own answer;
 * - "Live video follows the selected drone" on a relayed drone whose video
 *   the station is not serving, with the action that makes it the served one.
 *
 * Reads the slot table `RelayedDroneBridge` polls; renders nothing when no
 * notice applies.
 * @license GPL-3.0-only
 */

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertOctagon, Info, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  conflictingSystemIds,
  slotRowFor,
  useFleetSlotsStore,
} from "@/stores/ground-station/fleet-slots-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { GroundStationApi } from "@/lib/api/ground-station-api";
import { fleetHeroFailureReason } from "@/lib/api/ground-station/fleet";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import type { RelayReach } from "@/lib/nodes/relay-reach";

export interface RelayedNodeNoticesProps {
  /** The node's bare agent device id. */
  deviceId: string;
  profile: string | undefined;
  /** `node:<groundDeviceId>` this drone is reached through, when relayed. */
  reachedVia: string | null | undefined;
  /** The relay-proxy reach, when this browser can reach the drone through
   * its ground station. */
  relayReach: RelayReach | null;
}

const BANNER = "flex items-start gap-2 border-b px-3 py-2 text-xs";

export function RelayedNodeNotices({ deviceId, profile, reachedVia, relayReach }: RelayedNodeNoticesProps) {
  const t = useTranslations("nodeNotices");
  const { toast } = useToast();
  const byGround = useFleetSlotsStore((s) => s.byGround);
  const relayRefusal = useAgentConnectionStore((s) => (s.relay ? s.relayRefusal : null));
  const [selectingHero, setSelectingHero] = useState(false);

  const groundDeviceId = reachedVia ? deviceIdFromNodeId(reachedVia) : null;
  const slot = groundDeviceId ? slotRowFor(byGround, groundDeviceId, deviceId) : null;
  const conflictIds =
    profile === "ground-station"
      ? conflictingSystemIds(byGround[deviceId]?.slots ?? [])
      : slot?.system_id_conflict && slot.fc_system_id !== null
        ? [slot.fc_system_id]
        : [];

  const showThisDrone = async () => {
    if (!relayReach || selectingHero) return;
    setSelectingHero(true);
    try {
      await new GroundStationApi(relayReach.baseUrl, relayReach.apiKey).setFleetHero(deviceId);
    } catch (err) {
      toast(t("showThisDroneFailed", { reason: fleetHeroFailureReason(err) }), "error");
    } finally {
      setSelectingHero(false);
    }
  };

  const notices: ReactNode[] = [];
  for (const id of conflictIds) {
    notices.push(
      <div
        key={`sysid-${id}`}
        role="alert"
        className={`${BANNER} border-status-error/40 bg-status-error/10 text-status-error`}
      >
        <AlertOctagon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{t("sysidConflict", { id })}</span>
      </div>,
    );
  }

  if (slot) {
    if (slot.fc_system_id === null) {
      notices.push(
        <div
          key="identity"
          role="status"
          className={`${BANNER} border-border-default bg-bg-secondary text-text-secondary`}
        >
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium text-text-primary">{t("waitingIdentity")}</span>{" "}
            {t("waitingIdentityDetail")}
          </span>
        </div>,
      );
    }
    if (slot.relay_credential !== "held") {
      notices.push(
        <div
          key="credential"
          role="status"
          className={`${BANNER} border-status-warning/40 bg-status-warning/10 text-status-warning`}
        >
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {slot.relay_credential === "conflict" ? t("credentialConflict") : t("credentialPending")}
          </span>
        </div>,
      );
    }
    if (!slot.video_hero) {
      notices.push(
        <div
          key="video"
          role="status"
          className={`${BANNER} items-center border-border-default bg-bg-secondary text-text-secondary`}
        >
          <Video size={14} className="shrink-0" aria-hidden="true" />
          <span className="flex-1">{t("videoFollowsHero")}</span>
          {relayReach ? (
            <Button size="sm" variant="secondary" disabled={selectingHero} onClick={() => void showThisDrone()}>
              {t("showThisDrone")}
            </Button>
          ) : null}
        </div>,
      );
    }
  }

  if (relayReach && relayRefusal) {
    notices.push(
      <div
        key="refusal"
        role="alert"
        className={`${BANNER} border-status-error/40 bg-status-error/10 text-status-error`}
      >
        <AlertOctagon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          {relayRefusal.kind === "peerApi"
            ? t("relayRefusal.peerApi", { detail: relayRefusal.detail ?? "—" })
            : t(`relayRefusal.${relayRefusal.reason}`)}
        </span>
      </div>,
    );
  }

  if (notices.length === 0) return null;
  return <div className="flex flex-col flex-shrink-0">{notices}</div>;
}
