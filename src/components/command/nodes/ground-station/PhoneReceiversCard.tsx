"use client";

/**
 * @module PhoneReceiversCard
 * @description Phone receivers waiting for this ground station's approval. A
 * phone with its own radio asks for the fleet receive keys; nothing is shared
 * until an operator compares the fingerprint shown on the phone with the one
 * listed here and approves it. Receive-only: the phone never transmits.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useDemoMode } from "@/hooks/use-demo-mode";
import { GroundStationApiError, groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import type { PhoneInvite } from "@/lib/api/ground-station/types";
import { DEMO_PHONE_INVITES } from "@/mock/demo-seed/ground-station";
import { useGroundStationPoll } from "./use-gs-poll";

/** How often the waiting list is re-read. Invites live for two minutes. */
const POLL_MS = 2000;

export interface PhoneReceiversCardProps {
  agentUrl: string;
  apiKey: string | null;
}

export function PhoneReceiversCard({ agentUrl, apiKey }: PhoneReceiversCardProps) {
  const t = useTranslations("hardware.radio.phoneReceivers");
  const { toast } = useToast();
  const demo = useDemoMode();
  const [live, setLive] = useState<PhoneInvite[] | null>(null);
  const [demoPending, setDemoPending] = useState<readonly PhoneInvite[]>(DEMO_PHONE_INVITES);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [poll, setPoll] = useState<"ok" | "absent" | "failed">("ok");

  useGroundStationPoll(agentUrl, apiKey, POLL_MS, async (api) => {
    try {
      const list = await api.listPhoneInvites();
      setLive(list.pending);
      setPoll("ok");
    } catch (err) {
      const absent =
        err instanceof GroundStationApiError && (err.status === 404 || err.status === 501);
      setPoll(absent ? "absent" : "failed");
    }
  });

  const pending = demo ? demoPending : live;

  const decide = async (invite: PhoneInvite, decision: "approve" | "reject") => {
    if (demo) {
      setDemoPending((rows) => rows.filter((r) => r.invite_id !== invite.invite_id));
      toast(t(decision === "approve" ? "approved" : "rejected", { label: invite.label }), "info");
      return;
    }
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) return;
    setBusyId(invite.invite_id);
    try {
      await api.decidePhoneInvite(invite.invite_id, decision);
      setLive((rows) => rows?.filter((r) => r.invite_id !== invite.invite_id) ?? null);
      toast(
        t(decision === "approve" ? "approved" : "rejected", { label: invite.label }),
        decision === "approve" ? "success" : "info",
      );
    } catch {
      toast(t("decideFailed"), "error");
    } finally {
      setBusyId(null);
    }
  };

  // An agent that predates phone invites (or answers as a non-ground-station)
  // has nothing to approve here, so the card is not shown at all.
  if (!demo && poll === "absent") return null;
  const pollFailed = !demo && poll === "failed";

  return (
    <section
      aria-labelledby="phone-receivers-title"
      className="rounded-lg border border-border-default bg-bg-secondary p-4"
    >
      <div className="mb-1 flex items-center gap-2">
        <Smartphone size={16} aria-hidden className="text-text-secondary" />
        <h3 id="phone-receivers-title" className="text-sm font-semibold text-text-primary">
          {t("title")}
        </h3>
      </div>
      <p className="mb-3 text-xs text-text-secondary">{t("description")}</p>
      {pollFailed ? (
        <p role="status" className="mb-2 text-xs text-status-warning">
          {t("unreachable")}
        </p>
      ) : null}
      {pending === null ? (
        pollFailed ? null : <p className="text-xs text-text-tertiary">{t("loading")}</p>
      ) : pending.length === 0 ? (
        <p className="text-xs text-text-tertiary">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pending.map((invite) => (
            <li
              key={invite.invite_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-default px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-text-primary">{invite.label}</p>
                <p className="text-xs text-text-secondary">
                  {t("fingerprint")}{" "}
                  <span className="select-all font-mono tabular-nums text-text-primary">
                    {invite.phone_fingerprint}
                  </span>
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busyId !== null || pollFailed}
                  onClick={() => void decide(invite, "reject")}
                  aria-label={t("rejectLabel", { label: invite.label })}
                >
                  {t("reject")}
                </Button>
                <Button
                  size="sm"
                  loading={busyId === invite.invite_id}
                  disabled={busyId !== null || pollFailed}
                  onClick={() => void decide(invite, "approve")}
                  aria-label={t("approveLabel", { label: invite.label })}
                >
                  {t("approve")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
