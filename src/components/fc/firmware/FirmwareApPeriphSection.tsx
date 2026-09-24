"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Plug, Send } from "lucide-react";
import {
  ApPeriphManifest,
  EMBEDDED_BOARD_LIST,
  type BoardManifest,
} from "@/lib/protocol/firmware/ap-periph-manifest";
import { useDroneCanFlashStore } from "@/stores/dronecan/flash-store";
import { useDroneCanNodeStore } from "@/stores/dronecan/node-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useSlcanModeStore } from "@/stores/slcan-mode-store";
import { isDemoMode } from "@/lib/utils";
import { FirmwareApPeriphNodeTable } from "./FirmwareApPeriphNodeTable";
import { FirmwareApPeriphFirmwareCard } from "./FirmwareApPeriphFirmwareCard";
import { DebugDrawer } from "@/components/config/can/debug/DebugDrawer";

const apPeriphManifest = new ApPeriphManifest();

const DEFAULT_CHANNELS: readonly string[] = ["stable", "beta", "latest"];

interface Props {
  checklistAllChecked: boolean;
  isFlashing: boolean;
  onFlash: (params: {
    targetNodeId: number;
    board: string;
    channel: string;
    transport: "slcan" | "can-forward";
  }) => void | Promise<void>;
}

export function FirmwareApPeriphSection({
  checklistAllChecked,
  isFlashing,
  onFlash,
}: Props) {
  const t = useTranslations("flashTool.apPeriph");
  const demo = isDemoMode();

  // Connection state — in demo mode, treat SLCAN as active so the UI
  // is exerciseable without live agent wiring.
  const [transport, setTransport] = useState<"slcan" | "can-forward">("slcan");

  // SLCAN gating: the radio is only enabled when the selected drone is
  // connected over a WebSerial-capable transport (direct USB). Cloud /
  // MQTT / WebSocket links can't drive SLCAN because they don't own the
  // FC's USB byte stream.
  const selectedDrone = useDroneManager((s) => s.getSelectedDrone());
  const slcanCapable =
    demo || selectedDrone?.transport?.type === "webserial";

  // Live SLCAN state from the arbiter (banner + button glyph).
  const slcanState = useSlcanModeStore((s) => s.state);
  const slcanActive = demo || slcanState === "SLCAN_ACTIVE";

  // CAN_FORWARD reachability: the agent advertises CAN bus presence via
  // `canBuses` once its capability heartbeat has populated. Demo mode
  // enables the option so the production radio path is exerciseable from
  // a synthetic session too.
  const canBuses = useAgentCapabilitiesStore((s) => s.canBuses);
  const canForwardEnabled = demo || (Array.isArray(canBuses) && canBuses.length > 0);

  // Target node selection
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);

  // Firmware selection
  const [boards, setBoards] = useState<readonly string[]>(EMBEDDED_BOARD_LIST);
  const [channels, setChannels] = useState<readonly string[]>(DEFAULT_CHANNELS);
  const [selectedBoard, setSelectedBoard] = useState<string>("");
  const [selectedChannel, setSelectedChannel] = useState<string>("stable");
  const [manifest, setManifest] = useState<BoardManifest | null>(null);
  const [loadingManifest, setLoadingManifest] = useState(false);
  const [manifestError, setManifestError] = useState("");

  // Flash store mirror for post-flash UI
  const flashState = useDroneCanFlashStore((s) => s.state);

  // Look up current node SW version for diff line
  const nodesMap = useDroneCanNodeStore((s) => s.nodes);
  const currentNodeVersion = useMemo(() => {
    if (selectedNodeId == null) return undefined;
    const entry = nodesMap.get(selectedNodeId);
    const sv = entry?.nodeInfo?.software_version;
    if (!sv) return undefined;
    return `${sv.major}.${sv.minor}`;
  }, [nodesMap, selectedNodeId]);

  // Load the channel list once.
  const channelsLoadedRef = useRef(false);
  useEffect(() => {
    if (channelsLoadedRef.current) return;
    channelsLoadedRef.current = true;
    let cancelled = false;
    apPeriphManifest
      .listChannels()
      .then((list) => {
        if (cancelled) return;
        if (list.length > 0) {
          setChannels(list);
          if (!list.includes(selectedChannel)) {
            setSelectedChannel(list[0]);
          }
        }
      })
      .catch(() => {
        // Embedded baseline already seeded.
      });
    return () => {
      cancelled = true;
    };
  }, [selectedChannel]);

  // Load the board list for the selected channel.
  useEffect(() => {
    if (!selectedChannel) return;
    let cancelled = false;
    apPeriphManifest
      .listBoards(selectedChannel)
      .then((list) => {
        if (cancelled) return;
        if (list.length > 0) {
          setBoards(list);
          if (!selectedBoard || !list.includes(selectedBoard)) {
            setSelectedBoard(list[0]);
          }
        }
      })
      .catch(() => {
        setBoards(EMBEDDED_BOARD_LIST);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChannel]);

  // Load the board manifest when both selections are known.
  useEffect(() => {
    if (!selectedChannel || !selectedBoard) return;
    let cancelled = false;
    setLoadingManifest(true);
    setManifestError("");
    apPeriphManifest
      .getBoardManifest(selectedChannel, selectedBoard)
      .then((m) => {
        if (cancelled) return;
        setManifest(m);
      })
      .catch((err) => {
        if (cancelled) return;
        setManifest(null);
        setManifestError(
          err instanceof Error ? err.message : t("firmware.error"),
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingManifest(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedChannel, selectedBoard, t]);

  const retryManifest = () => {
    if (!selectedChannel || !selectedBoard) return;
    apPeriphManifest.clearCache().then(() => {
      setManifest(null);
      setSelectedChannel((c) => c);
    });
  };

  // SLCAN needs the FC's own USB byte stream; without it the flash rides
  // CAN_FORWARD regardless of the last radio choice.
  const effectiveTransport = transport === "slcan" && !slcanCapable ? "can-forward" : transport;

  // A DroneCAN OTA in progress (the flash store, not the FC flasher) blocks a
  // second start: FirmwarePanel would dispose the running session under it.
  const flashInFlight =
    flashState !== "IDLE" &&
    flashState !== "DONE" &&
    flashState !== "ABORTED" &&
    flashState !== "FAILED";

  const flashEnabled =
    checklistAllChecked &&
    selectedNodeId != null &&
    !!selectedBoard &&
    !!selectedChannel &&
    manifest?.files.some((f) => f.kind === "app") === true &&
    !isFlashing && !flashInFlight;

  const handleFlashClick = () => {
    if (!flashEnabled || selectedNodeId == null) return;
    onFlash({
      targetNodeId: selectedNodeId,
      board: selectedBoard,
      channel: selectedChannel,
      transport: effectiveTransport,
    });
  };
  // The debug drawer shows the state ribbon, byte counter and live frame log
  // while a flash is mid-flight; the terminal summary replaces it after.
  return (
    <>
      {/* Connection card */}
      <div className="bg-bg-secondary border border-border-default p-4 space-y-3">
        <h2 className="text-xs font-semibold text-text-primary flex items-center gap-2">
          <Plug size={14} />
          {t("connection.title")}
        </h2>

        <div
          role="radiogroup"
          aria-label={t("connection.transportAria")}
          className="flex gap-2"
        >
          <button
            role="radio"
            aria-checked={effectiveTransport === "slcan"}
            disabled={!slcanCapable}
            onClick={() => {
              if (slcanCapable) setTransport("slcan");
            }}
            title={
              slcanCapable
                ? t("connection.transport.slcan")
                : t("connection.transport.slcanRequiresUsb")
            }
            className={`flex-1 px-3 py-2 text-xs font-semibold border cursor-pointer transition-colors ${
              !slcanCapable
                ? "border-border-default text-text-tertiary opacity-40 cursor-not-allowed"
                : effectiveTransport === "slcan"
                  ? "border-accent-primary text-accent-primary bg-accent-primary/10"
                  : "border-border-default text-text-secondary hover:text-text-primary"
            }`}
          >
            {t("connection.transport.slcan")}
          </button>
          <button
            role="radio"
            aria-checked={effectiveTransport === "can-forward"}
            disabled={!canForwardEnabled}
            onClick={() => {
              if (canForwardEnabled) setTransport("can-forward");
            }}
            title={
              canForwardEnabled
                ? t("connection.transport.canForwardReady")
                : t("connection.transport.canForwardWaiting")
            }
            className={`flex-1 px-3 py-2 text-xs font-semibold border cursor-pointer transition-colors ${
              !canForwardEnabled
                ? "border-border-default text-text-tertiary opacity-40 cursor-not-allowed"
                : effectiveTransport === "can-forward"
                  ? "border-accent-primary text-accent-primary bg-accent-primary/10"
                  : "border-border-default text-text-secondary hover:text-text-primary"
            }`}
          >
            {t("connection.transport.canForward")}
          </button>
        </div>

        {transport === "slcan" && !demo && !slcanCapable && (
          <p
            className="text-[10px] text-status-warning"
            data-testid="ap-periph-slcan-requires-usb"
          >
            {t("connection.transport.slcanRequiresUsb")}
          </p>
        )}

        <p className={slcanActive ? "text-[10px] text-status-success" : "text-[10px] text-text-tertiary"}>
          {slcanActive ? t("connection.slcanSessionActive") : t("connection.slcanInactive")}
        </p>
      </div>

      {/* Target node card */}
      <FirmwareApPeriphNodeTable
        selectedNodeId={selectedNodeId}
        onSelect={setSelectedNodeId}
        slcanActive={slcanActive}
      />

      {/* Firmware card */}
      <FirmwareApPeriphFirmwareCard
        boards={boards}
        channels={channels}
        selectedBoard={selectedBoard}
        setSelectedBoard={setSelectedBoard}
        selectedChannel={selectedChannel}
        setSelectedChannel={setSelectedChannel}
        manifest={manifest}
        loading={loadingManifest}
        error={manifestError}
        currentNodeVersion={currentNodeVersion}
        onRetry={retryManifest}
      />

      {/* Flash button */}
      <button
        onClick={handleFlashClick}
        disabled={!flashEnabled}
        className={`w-full px-4 py-2.5 text-sm font-semibold border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 ${
          flashEnabled
            ? "border-accent-primary text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20"
            : "border-border-default text-text-tertiary"
        }`}
      >
        <Send size={14} />
        {t("flashButton")}
      </button>

      {/* Post-flash result */}
      {flashState === "DONE" && selectedNodeId != null && (
        <div
          data-testid="ap-periph-post-flash"
          className="bg-bg-secondary border border-status-success/40 p-4 space-y-1"
        >
          <h2 className="text-xs font-semibold text-status-success">
            {t("postFlash.doneTitle")}
          </h2>
          <p className="text-[10px] text-text-tertiary">
            {t("postFlash.doneBody")}
          </p>
        </div>
      )}

      {/* Debug drawer — only mounted while a flash is mid-flight. */}
      {flashInFlight && <DebugDrawer mode="flash" />}
    </>
  );
}
