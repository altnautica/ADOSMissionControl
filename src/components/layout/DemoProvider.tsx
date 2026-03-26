"use client";

import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

export function DemoProvider() {
  const demoMode = useSettingsStore((s) => s.demoMode);

  useEffect(() => {
    if (!demoMode) return;

    let mounted = true;
    let engine: { start: (ms: number) => void; stop: () => void } | undefined;
    import("@/mock/engine").then((mod) => {
      if (!mounted) return;
      engine = mod.mockEngine;
      engine.start(200);
    });

    // Auto-connect the agent store in demo mode
    useAgentConnectionStore.getState().connect("mock://demo");

    return () => {
      mounted = false;
      engine?.stop();
      useAgentConnectionStore.getState().disconnect();
      useDroneManager.getState().clear();
      useFleetStore.getState().setDrones([]);
      useFleetStore.getState().clearAlerts();
    };
  }, [demoMode]);

  return null;
}
