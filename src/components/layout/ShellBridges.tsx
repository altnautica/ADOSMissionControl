"use client";

/**
 * @module ShellBridges
 * @description The headless connection layer every route needs to receive
 * data: auto-reconnect, the agent MAVLink session, the agent state bridges,
 * the node-presence bridges that write the node registry, the fleet
 * projector, and the demo engine. All of it renders null.
 *
 * Mounted by CommandShell in both branches: the full GCS chrome and the
 * chromeless kiosk HUD. A HUD opened in a fresh tab (or loaded by the SBC
 * kiosk) starts with empty stores, so without these it would never see a
 * vehicle.
 *
 * @license GPL-3.0-only
 */

import dynamic from "next/dynamic";
import { useAutoReconnect } from "@/hooks/use-auto-reconnect";
import { useSettingsStore } from "@/stores/settings-store";
import { DemoResidueSweep } from "./DemoResidueSweep";
import { AgentMavlinkBridge } from "@/components/command/AgentMavlinkBridge";
import { AgentBridges } from "@/components/command/AgentBridges";
import { CloudDroneBridge } from "@/components/dashboard/CloudDroneBridge";
import { LocalDroneBridge } from "@/components/dashboard/LocalDroneBridge";
import { RelayedDroneBridge } from "@/components/dashboard/RelayedDroneBridge";
import { RelayedMavlinkBridge } from "@/components/dashboard/RelayedMavlinkBridge";
import { FleetProjectionBridge } from "@/components/dashboard/FleetProjectionBridge";

/**
 * Demo mode pulls in the whole 11.8k-LOC `src/mock/` tree — the mock
 * protocol, the iNav mock and a 1427-line parameter table. A static import
 * here put every byte of it in the shared chunk of every production page,
 * for a feature gated behind a persisted settings boolean that is off by
 * default. `next/dynamic` with `ssr: false` moves it to its own chunk, and it
 * is rendered only when demo mode is on, so the chunk is fetched only then.
 * The residue sweep that must run when demo is OFF carries no mock imports.
 */
const DemoProvider = dynamic(
  () => import("./DemoProvider").then((m) => m.DemoProvider),
  { ssr: false },
);

export function ShellBridges() {
  useAutoReconnect();
  const demoMode = useSettingsStore((s) => s.demoMode);
  const settingsHydrated = useSettingsStore((s) => s._hasHydrated);
  return (
    <>
      <DemoResidueSweep />
      {settingsHydrated && demoMode ? <DemoProvider /> : null}
      {/* Owns the FC link and persists across selection changes. */}
      <AgentMavlinkBridge />
      <AgentBridges />
      {/* The presence bridges WRITE the node registry (local + cloud
          presence, plus relayed presence for a WFB-linked drone reached
          through a directly-paired ground node); FleetProjectionBridge
          projects the registry into the fleet store, so a node seen on any
          transport renders once and an FC-less node never shows fabricated
          telemetry. */}
      <CloudDroneBridge />
      <LocalDroneBridge />
      <RelayedDroneBridge />
      {/* Opens the actual MAVLink session for a relay-only drone against its
          ground station's republish endpoint. */}
      <RelayedMavlinkBridge />
      <FleetProjectionBridge />
    </>
  );
}
