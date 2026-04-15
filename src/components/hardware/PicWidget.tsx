"use client";

/**
 * @module PicWidget
 * @description Phase 2 Pilot in Command widget. Displays current PIC holder,
 * claim counter, and primary gamepad. Lets this session take control via a
 * 2-second confirm-token window and release control when held.
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import { randomId } from "@/lib/utils";

const CONFIRM_WINDOW_MS = 2000;

/**
 * Persistent per-session client id. Kept in sessionStorage so that a reload
 * does not change the identity mid-flight, but a new tab is a new pilot.
 */
function useClientId(): string {
  const ref = useRef<string | null>(null);
  if (ref.current) return ref.current;
  if (typeof window === "undefined") {
    ref.current = "gcs-ssr";
    return ref.current;
  }
  const key = "ados.gcs.clientId";
  let id = window.sessionStorage.getItem(key);
  if (!id) {
    id = "gcs-" + randomId();
    window.sessionStorage.setItem(key, id);
  }
  ref.current = id;
  return id;
}

export function PicWidget() {
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  const pic = useGroundStationStore((s) => s.pic);
  const loadPic = useGroundStationStore((s) => s.loadPic);
  const claimPic = useGroundStationStore((s) => s.claimPic);
  const releasePic = useGroundStationStore((s) => s.releasePic);

  const { toast } = useToast();
  const clientId = useClientId();

  const [countdown, setCountdown] = useState<number | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    loadPic(client);
  }, [agentUrl, apiKey, loadPic]);

  const hasAgent = Boolean(agentUrl);
  const iHoldPic = pic.claimed_by === clientId;
  const otherHolder = pic.claimed_by && !iHoldPic ? pic.claimed_by : null;

  const handleTakeControl = async () => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    setWorking(true);
    try {
      const tokenRes = await client.createPicConfirmToken(clientId);
      setCountdown(Math.floor(CONFIRM_WINDOW_MS / 1000));
      const start = Date.now();
      const tick = setInterval(() => {
        const remaining = CONFIRM_WINDOW_MS - (Date.now() - start);
        if (remaining <= 0) {
          clearInterval(tick);
          setCountdown(null);
        } else {
          setCountdown(Math.ceil(remaining / 1000));
        }
      }, 100);

      const ok = await claimPic(client, clientId, {
        confirmToken: tokenRes.confirm_token,
        force: Boolean(otherHolder),
      });
      clearInterval(tick);
      setCountdown(null);
      if (ok) {
        toast("You have control.", "success");
      } else {
        toast("Could not take control.", "error");
      }
    } catch (err) {
      setCountdown(null);
      const msg = err instanceof Error ? err.message : "Claim failed";
      toast(msg, "error");
    } finally {
      setWorking(false);
    }
  };

  const handleRelease = async () => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    setWorking(true);
    const ok = await releasePic(client, clientId);
    setWorking(false);
    if (ok) {
      toast("Control released.", "info");
    }
  };

  const pilotLabel = pic.claimed_by
    ? iHoldPic
      ? "You (" + clientId + ")"
      : pic.claimed_by
    : "No pilot";

  return (
    <section className="mb-5 rounded-lg border border-border-primary bg-surface-secondary p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-medium text-text-primary">Pilot in Command</h2>
        {iHoldPic ? (
          <span className="rounded border border-status-success/40 bg-status-success/10 px-2 py-0.5 text-xs text-status-success">
            You have control
          </span>
        ) : null}
      </div>

      {!hasAgent ? (
        <div className="py-4 text-center text-sm text-text-secondary">
          No ground station connected.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3">
            <div className="flex flex-col">
              <dt className="text-xs uppercase tracking-wide text-text-secondary">Current pilot</dt>
              <dd className="font-mono text-sm text-text-primary break-all">{pilotLabel}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-xs uppercase tracking-wide text-text-secondary">Claim counter</dt>
              <dd className="font-mono text-sm text-text-primary">{pic.claim_counter}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-xs uppercase tracking-wide text-text-secondary">Primary gamepad</dt>
              <dd className="font-mono text-sm text-text-primary break-all">
                {pic.primary_gamepad_id ?? "None"}
              </dd>
            </div>
          </dl>

          {pic.error ? (
            <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error">
              {pic.error}
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            {!iHoldPic ? (
              <Button
                variant="primary"
                onClick={handleTakeControl}
                disabled={working || pic.loading}
                loading={working}
              >
                {countdown != null
                  ? "Confirming... " + countdown + "s"
                  : otherHolder
                    ? "Take control from " + otherHolder
                    : "Take control"}
              </Button>
            ) : null}
            {iHoldPic ? (
              <Button
                variant="secondary"
                onClick={handleRelease}
                disabled={working || pic.loading}
                loading={working}
              >
                Release
              </Button>
            ) : null}
            {!iHoldPic && countdown == null ? (
              <span className="text-xs text-text-tertiary">
                Confirm within 2 seconds of tapping.
              </span>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
