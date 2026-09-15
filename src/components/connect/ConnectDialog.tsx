/**
 * @module ConnectDialog
 * @description Unified "+" connect modal. Presents two connection stacks side
 * by side: a Flight Controller over direct MAVLink (USB Serial / WebSocket /
 * Bluetooth) on the left, and a Companion Computer running the ADOS Agent
 * (software-defined, hostname / IP / pair code) on the right. Opened from any
 * "+" entry point — both the connect-dialog store and the pair-dialog store
 * drive this one surface.
 * @license GPL-3.0-only
 */

"use client";

import { useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { ActiveConnections } from "@/components/connect/ActiveConnections";
import { DirectMavlinkPanel } from "@/components/connect/DirectMavlinkPanel";
import { AgentConnectPanel } from "@/components/command/AgentConnectPanel";
import { useConnectDialogStore } from "@/stores/connect-dialog-store";
import { usePairDialogStore } from "@/stores/pair-dialog-store";
import { useDroneManager } from "@/stores/drone-manager";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { usePlatform } from "@/hooks/use-platform";
import { GITHUB_RELEASES_URL } from "@/components/onboarding/constants";
import { Radio, Cpu, Plug, ExternalLink } from "lucide-react";

export function ConnectDialog() {
  const t = useTranslations("connect");
  // One modal, two openers: the conventional connect-dialog store and the
  // agent pair-dialog store. Either opens this surface; closing clears both.
  const connectOpen = useConnectDialogStore((s) => s.open);
  const closeConnect = useConnectDialogStore((s) => s.closeDialog);
  const pairOpen = usePairDialogStore((s) => s.open);
  const closePair = usePairDialogStore((s) => s.closeDialog);
  const agentInitialTab = usePairDialogStore((s) => s.initialTab);
  const droneCount = useDroneManager((s) => s.drones.size);
  const { isElectron } = usePlatform();

  const open = connectOpen || pairOpen;
  const close = () => {
    closeConnect();
    closePair();
  };

  // Select the freshly-paired node so the drone-detail connect-on-select
  // effect brings the agent live (mirrors the retired ShellPairingDialog).
  const selectTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (selectTimer.current !== null) window.clearTimeout(selectTimer.current);
    },
    [],
  );

  function handleAgentPaired(deviceId: string) {
    // The one canonical selection id is `node:<deviceId>` (see
    // `@/lib/agent/node-id`). The retired `local-<deviceId>` /
    // `cloud-<deviceId>` projector forms match no fleet row, so selecting one
    // closed the modal and fired the success toast while leaving the operator
    // on an unchanged screen with nothing open.
    const nodeId = nodeIdForDevice(deviceId);
    if (selectTimer.current !== null) window.clearTimeout(selectTimer.current);
    selectTimer.current = window.setTimeout(() => {
      selectTimer.current = null;
      useDroneManager.getState().selectDrone(nodeId);
    }, 150);
  }

  return (
    <Modal open={open} onClose={close} title={t("title")} className="max-w-5xl">
      <div className="max-h-[80vh] overflow-y-auto -m-4 p-4 space-y-4">
        {/* Two-ways-in explainer + current-surface indicator. */}
        <div className="bg-bg-tertiary border border-border-default p-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-tertiary">
          <span className="text-text-secondary font-medium">{t("intro.lead")}</span>
          <span className="flex items-center gap-1">
            <Plug size={11} /> {t("intro.direct")}
          </span>
          <span className="text-text-tertiary">·</span>
          <span className="flex items-center gap-1">
            <Cpu size={11} /> {t("intro.agent")}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            {isElectron ? (
              t("env.desktopApp")
            ) : (
              <>
                <span>{t("env.webApp")}</span>
                <a
                  href={GITHUB_RELEASES_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-accent-primary hover:underline"
                >
                  <ExternalLink size={10} />
                  {t("getDesktopApp")}
                </a>
              </>
            )}
          </span>
        </div>

        {/* Active connections (shared across both stacks) */}
        {droneCount > 0 && (
          <div className="bg-bg-primary border border-status-success/20 p-3 space-y-2">
            <h3 className="text-xs font-semibold text-text-primary flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-status-success animate-pulse" />
              {t("activeConnections")}
              <Badge variant="success" size="sm">
                <Radio size={8} className="mr-0.5" />
                {droneCount}
              </Badge>
            </h3>
            <ActiveConnections />
          </div>
        )}

        {/* Two stacks, side by side: FC (left), Companion agent (right) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left — Flight Controller (Direct MAVLink) */}
          <section className="border border-border-default rounded">
            <header className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
              <Plug size={14} className="text-text-secondary" />
              <div className="min-w-0">
                <h3 className="text-xs font-semibold text-text-primary">
                  {t("fcStackTitle")}
                </h3>
                <p className="text-[10px] text-text-tertiary">{t("fcStackDesc")}</p>
              </div>
            </header>
            <div className="p-3">
              <DirectMavlinkPanel onClose={close} />
            </div>
          </section>

          {/* Right — Companion Computer (ADOS Agent) */}
          <section className="border border-accent-primary/30 rounded">
            <header className="flex items-center gap-2 px-3 py-2 border-b border-accent-primary/20 bg-accent-primary/5">
              <Cpu size={14} className="text-accent-primary" />
              <div className="min-w-0 flex-1">
                <h3 className="text-xs font-semibold text-text-primary flex items-center gap-2">
                  {t("agentStackTitle")}
                  <Badge variant="info" size="sm">
                    {t("agentStackBadge")}
                  </Badge>
                </h3>
                <p className="text-[10px] text-text-tertiary">{t("agentStackDesc")}</p>
              </div>
            </header>
            <div className="p-3 space-y-2">
              <AgentConnectPanel
                open={open}
                onClose={close}
                onPaired={handleAgentPaired}
                initialTab={agentInitialTab}
              />
              <p className="text-[10px] text-text-tertiary leading-relaxed">
                {t("agentUdpNote")}
              </p>
            </div>
          </section>
        </div>
      </div>
    </Modal>
  );
}
