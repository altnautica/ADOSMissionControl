"use client";

// HUD page. Full-screen flight display for HDMI kiosk mode on the SBC.
//
// Live telemetry, WebRTC/WHEP video background, gamepad polling, PIC
// claim stub.
//
// Query params:
//   ?layer=minimal    render lightweight inline HUD for low-power SBCs
//                     (Pi 4B, Rock 5C Lite under thermal throttle)

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { HudOfflineFallback } from "./components/HudOfflineFallback";
import { HudErrorBoundary } from "./components/HudErrorBoundary";
import { TopBar } from "@/components/hud/TopBar";
import { BottomBar } from "@/components/hud/BottomBar";
import { CornerAlerts } from "@/components/hud/CornerAlerts";
import { VideoBackground } from "@/components/hud/VideoBackground";
import {
  getActiveGamepadName,
  startGamepadPolling,
  stopGamepadPolling,
  startManualControlStream,
} from "@/lib/input/gamepad-poller";
import { useInputStore } from "@/stores/input-store";
import { useSettingsStore } from "@/stores/settings-store";
import { MinimalHud } from "./components/MinimalHud";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";

const HUD_KIOSK_CLIENT_ID = "hdmi-kiosk";

export default function HudPage() {
  return (
    <HudErrorBoundary>
      <Suspense fallback={<HudOfflineFallback timeoutMs={3000} />}>
        <HudRouter />
      </Suspense>
    </HudErrorBoundary>
  );
}

function HudRouter() {
  const params = useSearchParams();
  const layer = params.get("layer");
  const minimal = layer === "minimal";
  return minimal ? <MinimalHud /> : <FullHud />;
}

// Gamepad indicator. Shows controller identity + PIC claim state. When the
// settings flag hud.autoClaimPicOnFirstButton is on, the first button press
// detected by the gamepad poller auto-claims PIC as the hdmi-kiosk client.
function GamepadIndicator() {
  const controller = useInputStore((s) => s.activeController);
  const [name, setName] = useState<string | null>(null);

  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);
  const pic = useGroundStationStore((s) => s.pic);
  const claimPic = useGroundStationStore((s) => s.claimPic);
  const pollPicHeartbeat = useGroundStationStore((s) => s.pollPicHeartbeat);
  const autoClaim = useSettingsStore((s) => s.hudAutoClaimPicOnFirstButton);

  const claimedRef = useRef(false);
  const claimingRef = useRef(false);

  // Heartbeat the PIC claim while this HUD holds it. Starts on claim,
  // stops on orphan, release, or unmount.
  useEffect(() => {
    if (pic.claimed_by !== HUD_KIOSK_CLIENT_ID) return;
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    const stop = pollPicHeartbeat(client, HUD_KIOSK_CLIENT_ID);
    return () => {
      stop();
    };
  }, [pic.claimed_by, agentUrl, apiKey, pollPicHeartbeat]);

  useEffect(() => {
    if (controller !== "gamepad") {
      setName(null);
      return;
    }
    const id = setInterval(() => {
      setName(getActiveGamepadName());
    }, 1000);
    setName(getActiveGamepadName());
    return () => clearInterval(id);
  }, [controller]);

  // First-button auto-claim. Polls navigator.getGamepads() at 60 Hz looking
  // for any pressed button. Fires once per session. Gated by the settings
  // flag and by the current PIC holder.
  useEffect(() => {
    if (!autoClaim) return;
    if (typeof navigator === "undefined") return;
    if (pic.claimed_by === HUD_KIOSK_CLIENT_ID) return;

    let rafId: number | null = null;
    const loop = () => {
      rafId = requestAnimationFrame(loop);
      if (claimedRef.current || claimingRef.current) return;
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const pad of pads) {
        if (!pad) continue;
        for (const btn of pad.buttons) {
          if (btn && btn.pressed) {
            const client = groundStationApiFromAgent(agentUrl, apiKey);
            if (!client) return;
            claimingRef.current = true;
            void claimPic(client, HUD_KIOSK_CLIENT_ID).then((ok) => {
              if (ok) claimedRef.current = true;
              claimingRef.current = false;
            });
            return;
          }
        }
      }
    };
    rafId = requestAnimationFrame(loop);
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [autoClaim, agentUrl, apiKey, claimPic, pic.claimed_by]);

  const label = controller === "gamepad"
    ? (name ? name.slice(0, 28) : "GAMEPAD")
    : "NO INPUT";

  const picLabel = pic.claimed_by === HUD_KIOSK_CLIENT_ID
    ? "PIC CLAIMED"
    : pic.claimed_by
      ? "PIC (remote)"
      : autoClaim
        ? "Press button to claim"
        : "PIC pending";

  return (
    <div className="absolute top-12 right-4 flex flex-col items-end gap-1 pointer-events-none">
      <div className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 bg-scrim/50 text-on-media/80 border border-on-media/20 rounded">
        {label}
      </div>
      <div className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 bg-scrim/50 text-on-media/60 border border-on-media/10 rounded">
        {picLabel}
      </div>
    </div>
  );
}

function FullHud() {
  // Read the gamepad and open the stick stream on mount. Both are idempotent
  // singletons; the stream itself stays gated frame by frame.
  useEffect(() => {
    startGamepadPolling();
    startManualControlStream();
    return () => {
      stopGamepadPolling();
    };
  }, []);

  return (
    <div className="relative w-full h-full">
      <VideoBackground />
      <TopBar />
      <CornerAlerts />
      <GamepadIndicator />
      <BottomBar />
    </div>
  );
}

