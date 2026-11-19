"use client";

/**
 * @module UplinkHandoverCard
 * @description Which ground transmits to the fleet: this ground station, or a
 * phone that took the uplink from it. While a phone holds it the box only
 * receives and refuses commands from its own surfaces; the operator takes it
 * back here, after a confirm. Reads `GET /api/v1/ground-station/uplink`; a
 * radio service that is not reporting shows as unknown, never as a guess.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { RadioTower } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useDemoMode } from "@/hooks/use-demo-mode";
import { GroundStationApiError, groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import {
  uplinkRefusalDetail,
  type RadioUplink,
} from "@/lib/api/ground-station/uplink-handover";
import { demoGroundStationUplink } from "@/mock/ground-station-uplink";
import { Chip, LaneCard, StatRow } from "./lane-ui";
import { useGroundStationPoll } from "./use-gs-poll";

/** The holder's beacon is heard about once a second; read at that cadence. */
const POLL_MS = 2000;

export interface UplinkHandoverCardProps {
  agentUrl: string;
  apiKey: string | null;
}

type Read = { kind: "loading" } | { kind: "absent" } | { kind: "failed" } | { kind: "ok"; uplink: RadioUplink | null };

export function UplinkHandoverCard({ agentUrl, apiKey }: UplinkHandoverCardProps) {
  const t = useTranslations("hardware.radio.uplinkHandover");
  const format = useFormatter();
  const { toast } = useToast();
  const demo = useDemoMode();
  const [live, setLive] = useState<Read>({ kind: "loading" });
  const [demoUplink, setDemoUplink] = useState<RadioUplink>(() => demoGroundStationUplink.get());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useGroundStationPoll(agentUrl, apiKey, POLL_MS, async (api) => {
    try {
      setLive({ kind: "ok", uplink: await api.getRadioUplink() });
    } catch (err) {
      // An agent that predates the handover, or a node that is not a ground
      // station, has no uplink to hand over: the card is not shown.
      const absent = err instanceof GroundStationApiError && (err.status === 404 || err.status === 501);
      setLive(absent ? { kind: "absent" } : { kind: "failed" });
    }
  });

  const read: Read = demo ? { kind: "ok", uplink: demoUplink } : live;
  if (read.kind === "absent") return null;

  const uplink = read.kind === "ok" ? read.uplink : null;
  const holder = uplink?.holder_name ?? uplink?.holder_device_id ?? t("unnamedPhone");
  const now = Date.now();

  const takeBack = async () => {
    setConfirming(false);
    if (demo) {
      setDemoUplink(demoGroundStationUplink.takeBack().uplink ?? demoGroundStationUplink.get());
      toast(t("takenBack"), "success");
      return;
    }
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) return;
    setBusy(true);
    try {
      const result = await api.takeBackRadioUplink();
      if (result.uplink) setLive({ kind: "ok", uplink: result.uplink });
      toast(t("takenBack"), "success");
    } catch (err) {
      toast(uplinkRefusalDetail(err) ?? t("takeBackFailed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const chip =
    uplink === null ? (
      <Chip tone="muted">{t("unknown")}</Chip>
    ) : uplink.state === "standby" ? (
      <Chip tone="warning">{t("standby")}</Chip>
    ) : (
      <Chip tone="success">{t("transmitting")}</Chip>
    );

  return (
    <LaneCard title={t("title")} icon={RadioTower} trailing={chip}>
      {read.kind === "failed" ? (
        <p role="status" className="mb-2 text-xs text-status-warning">
          {t("unreachable")}
        </p>
      ) : null}
      <p className="text-sm text-text-primary" data-testid="uplink-line">
        {read.kind === "loading"
          ? t("loading")
          : uplink === null
            ? t("lineUnknown")
            : uplink.state === "transmitting"
              ? t("lineTransmitting")
              : uplink.since_ms === null
                ? t("lineStandby", { holder })
                : t("lineStandbySince", {
                    holder,
                    since: format.dateTime(new Date(uplink.since_ms), { timeStyle: "short" }),
                  })}
      </p>
      {uplink?.state === "standby" ? (
        <>
          <dl className="mt-2">
            <StatRow
              label={t("lastHeard")}
              value={
                uplink.last_beacon_ms === null
                  ? t("notHeard")
                  : t("secondsAgo", { seconds: Math.max(0, Math.round((now - uplink.last_beacon_ms) / 1000)) })
              }
            />
          </dl>
          <p className="mt-2 text-xs text-text-secondary">{t("standbyBody", { holder })}</p>
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              disabled={busy || read.kind === "failed"}
              onClick={() => setConfirming(true)}
            >
              {t("takeBack")}
            </Button>
          </div>
        </>
      ) : uplink === null && read.kind === "ok" ? (
        <p className="mt-1 text-xs text-text-secondary">{t("unknownBody")}</p>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={t("confirmTitle")}
        message={t("confirmBody", { holder })}
        confirmLabel={t("takeBack")}
        variant="danger"
        onCancel={() => setConfirming(false)}
        onConfirm={() => void takeBack()}
      />
    </LaneCard>
  );
}
