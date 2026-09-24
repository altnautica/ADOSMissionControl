"use client";

/**
 * @module layout/DemoProvider
 * @description The demo-mode driver. Loaded as its own chunk and mounted only
 * while demo mode is on; the seed data lives in `@/mock/demo-seed/*`.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { DemoMissionSync } from "@/components/layout/DemoMissionSync";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { usePairingStore } from "@/stores/pairing-store";
import { clearDemoNodeCommands } from "@/mock/demo-node-commands";
import { useCommandFleetStore, type CommandCloudStatus } from "@/stores/command-fleet-store";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { setMockAgentOverride } from "@/mock/agent/client";
import { clearDemoLanNodes } from "@/lib/demo/demo-residue";
import { DEMO_AGENTS, buildDemoStatus, seedDemoLanNodes } from "@/mock/demo-seed/fleet";
import { seedGroundStationStore } from "@/mock/demo-seed/ground-station";
import { seedFocusedAgentSystem, seedFocusedCapabilities } from "@/mock/demo-seed/agent-system";
import { getDemoMcpPlugins } from "@/mock/mock-mcp-plugins";
import { useMcpPluginStore } from "@/lib/plugins/mcp-plugin-tools";

/** The subset of the mock engine this provider drives. */
interface MockEngineHandle {
  start: (ms: number) => void;
  stop: () => void;
  freezeTelemetry: () => void;
  resumeTelemetry: () => void;
  readonly telemetryFlowing: boolean;
}

declare global {
  interface Window {
    /**
     * Demo-only scenario controls, present only while demo mode is on. Used to
     * drive the freshness-gated surfaces from the console without hardware;
     * see the install site below for why they exist.
     */
    __adosDemo?: {
      freezeTelemetry: () => void;
      resumeTelemetry: () => void;
      readonly telemetryFlowing: boolean;
    };
  }
}

/**
 * Drives demo mode: starts the mock engine, seeds the demo fleet and the
 * profile-specific stores, and tears all of it down on unmount. The shell
 * mounts it only while demo mode is on (after the settings store hydrates), so
 * mount and unmount bracket demo on and off, and a real session never loads
 * the mock tree.
 */
export function DemoProvider() {
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);

  // `drone-manager.selectDrone` resets the ground-station store (and video /
  // capability stores) on every node switch to stop one node's data bleeding
  // onto the next. In demo that wipes the ground-station overview data we seed
  // once below, so re-seed the profile-specific stores after each switch — the
  // ground-station overview then stays populated whenever opened.
  useEffect(() => {
    seedGroundStationStore();
    seedFocusedAgentSystem(Date.now());
    seedFocusedCapabilities();
  }, [selectedDroneId]);

  useEffect(() => {
    let mounted = true;
    let engine: MockEngineHandle | undefined;
    import("@/mock/engine").then((mod) => {
      if (!mounted) return;
      engine = mod.mockEngine;
      engine.start(200);
      // Demo-only scenario handle. The freshness-gated surfaces — the cockpit
      // safety band, the HUD attitude flag, the proximity radar, the telemetry
      // strip, the LINK STALE badge — all key off a sample's age, and every
      // one of them shipped painting a dead link as live precisely because
      // demo mode had no way to produce a stale reading. Freezing the tick
      // leaves the last samples in place and lets the clock age them, which
      // is what a dead radio looks like from here.
      //
      //   __adosDemo.freezeTelemetry()   // watch the surfaces blank out
      //   __adosDemo.resumeTelemetry()
      //
      // Installed only while demo mode is on, removed on teardown.
      window.__adosDemo = {
        freezeTelemetry: () => engine?.freezeTelemetry(),
        resumeTelemetry: () => engine?.resumeTelemetry(),
        get telemetryFlowing() {
          return engine?.telemetryFlowing ?? false;
        },
      };
    });

    // Auto-connect the agent store in demo mode
    useAgentConnectionStore.getState().connect("mock://demo");
    usePairingStore.getState().setPairedDrones(DEMO_AGENTS);
    // Two drones paired over the LAN so the Nodes board shows the local-first
    // `lan` reach kind alongside cloud (local-first).
    seedDemoLanNodes(Date.now());

    // Seed the profile-specific stores the ground-station overview reads (the
    // singleton agent-system store stays drone-flavored).
    seedGroundStationStore();
    seedFocusedAgentSystem(Date.now());
    seedFocusedCapabilities();
    useMcpPluginStore.setState({ plugins: getDemoMcpPlugins(), status: "ready" });

    const updateCommandFleetDemo = () => {
      const now = Date.now();
      const statuses: CommandCloudStatus[] = DEMO_AGENTS.map((agent, index) =>
        buildDemoStatus(agent, index, now),
      );
      // Upsert (not replace) so the transitive-enrollment bridge's funneled
      // relayed-drone rows (romeo-15 / whiskey-23), which it writes into this
      // same store, survive each 2s tick rather than being wiped and re-added.
      // The demo roster is fixed, so nothing needs the replace semantics.
      useCommandFleetStore.getState().upsertCloudStatuses(statuses);
      for (const status of statuses) {
        if (status.telemetry) {
          useCommandFleetStore.getState().setTelemetry(status.deviceId, status.telemetry);
        }
      }
      usePairingStore.getState().setPairedDrones(
        DEMO_AGENTS.map((agent) => ({ ...agent, lastSeen: now })),
      );
      // Re-seed the focused node's agent-system status/resources so the
      // Overview / Health / Logs tabs stay live.
      seedFocusedAgentSystem(now);
      // The ground-station link card ages its radio reading on this stamp.
      useGroundStationStore.setState({ linkHealthAt: now });
    };

    updateCommandFleetDemo();
    const demoFleetInterval = setInterval(updateCommandFleetDemo, 2000);

    return () => {
      mounted = false;
      clearInterval(demoFleetInterval);
      engine?.stop();
      // Drop the demo profile override so a future real connection's mock
      // client (should one ever be constructed) reverts to its own defaults.
      setMockAgentOverride({ status: null, services: null, resources: null });
      useAgentConnectionStore.getState().disconnect();
      // `disconnect()` already clears the agent system store, but call
      // it again explicitly so a future refactor of the connection store
      // can't silently re-introduce a stale mock status on the screen.
      useAgentSystemStore.getState().clear();
      useDroneManager.getState().clear();
      useFleetStore.getState().setDrones([]);
      useFleetStore.getState().clearAlerts();
      usePairingStore.getState().clear();
      // Surgical: drop only the demo LAN nodes, never a real fleet's.
      clearDemoLanNodes();
      clearDemoNodeCommands();
      useCommandFleetStore.getState().clear();
      // The demo seeds the node registry (the single fleet write target);
      // clear it too so toggling demo off leaves no ghost rows for the
      // FleetProjectionBridge to re-project.
      useNodeRegistryStore.getState().clear();
      // Reset the profile-specific stores so demo leaves no residue in real mode.
      useGroundStationStore.getState().resetAll();
      useMcpPluginStore.setState({ plugins: [], status: "idle" });
      delete window.__adosDemo;
    };
  }, []);

  return <DemoMissionSync />;
}
