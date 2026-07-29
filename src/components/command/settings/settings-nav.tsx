/**
 * @module command/settings/settings-nav
 * @description The node configuration page registry: every settings page, its
 * label, icon, availability gate and body. Each item carries the gate its page
 * already enforces internally (profile fit, the node advertising a feature
 * block), so the sidebar never offers an empty page, and renders the exact same
 * section component one level down.
 *
 * These pages have no sidebar of their own. They are hoisted into the Agent
 * page's single sidebar beside the live surface for the same subsystem —
 * ordering and section headers live in
 * `dashboard/node-detail/agent/agent-nav-sections`, which is also what supplies
 * the `SettingsPageContext` below from one `useNodeConfig()` call.
 * @license GPL-3.0-only
 */
// Exempt from 300 LOC soft rule: sub-page registry data file.

import type { ReactNode } from "react";
import {
  Boxes,
  CircleUser,
  Cloud,
  Fingerprint,
  Globe,
  HeartPulse,
  Layers,
  Network,
  Radar,
  RadioTower,
  Route,
  ShieldCheck,
  Signal,
  Video,
  Waypoints,
  Wifi,
  Wrench,
} from "lucide-react";

import type { NodeProfile } from "@/components/dashboard/node-detail/surface-types";
import { RegulatoryRegionPanel } from "@/components/command/system/RegulatoryRegionPanel";
import { isDemoMode } from "@/lib/utils";
import { configAdvertises } from "./use-node-config";
import { ProfilePage, CloudPage, AdvancedPage } from "./CorePages";
import { VideoSection } from "./VideoSection";
import { RadioSection } from "./RadioSection";
import { VisionPerceptionSection } from "./VisionPerceptionSection";
import { AtlasSection } from "./AtlasSection";
import { SwarmSection } from "./SwarmSection";
import { NetworkUplinkSection } from "./NetworkUplinkSection";
import { WifiClientSection } from "./WifiClientSection";
import { CellularSection } from "./CellularSection";
import { MacPinSection } from "./MacPinSection";
import { DiscoverySection } from "./DiscoverySection";
import { SelfHealSection } from "./SelfHealSection";
import { MavlinkRoutingSection } from "./MavlinkRoutingSection";
import { SecuritySection } from "./SecuritySection";

/** Everything a settings page (or its availability gate) needs. */
export interface SettingsPageContext {
  droneId: string;
  profile: NodeProfile;
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

export interface SettingsNavItem {
  /** Stable page id. */
  id: string;
  /** Full i18n path for the sidebar label. */
  labelKey: string;
  icon: ReactNode;
  /** Whether the page's body reads the node configuration — every page whose
   * render takes `config` / `readOnly` / `setValue`. The Agent page shows the
   * config loading / read-only / read-failure banners only while such a page
   * is open: Wi-Fi scans the radio and Operating region writes the regulatory
   * domain, each over its own endpoint, so a "could not read the node
   * configuration" banner over either would be a false alarm. */
  readsConfig: boolean;
  /** Availability gate. Absent = always shown. Mirrors the page's own
   * internal render-nothing gate so the sidebar never offers an empty page. */
  when?: (ctx: SettingsPageContext) => boolean;
  render: (ctx: SettingsPageContext) => ReactNode;
}

const isRadioProfile = (ctx: SettingsPageContext) =>
  ctx.profile === "drone" || ctx.profile === "ground-station";
const isVisionProfile = (ctx: SettingsPageContext) =>
  ctx.profile === "drone" || ctx.profile === "workstation";
const isDroneProfile = (ctx: SettingsPageContext) => ctx.profile === "drone";

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  {
    id: "profile",
    labelKey: "nodeSettings.profile.title",
    icon: <CircleUser size={14} />,
    readsConfig: true,
    render: (ctx) => <ProfilePage config={ctx.config} />,
  },
  {
    id: "network",
    labelKey: "nodeSettings.network.title",
    icon: <Network size={14} />,
    readsConfig: true,
    render: (ctx) => (
      <NetworkUplinkSection
        profile={ctx.profile}
        config={ctx.config}
        readOnly={ctx.readOnly}
        setValue={ctx.setValue}
      />
    ),
  },
  {
    id: "wifi",
    labelKey: "nodeSettings.wifi.title",
    icon: <Wifi size={14} />,
    // Scans and joins networks over the agent's own Wi-Fi endpoints; it never
    // reads the persisted config, so the config banners do not apply.
    readsConfig: false,
    render: () => <WifiClientSection />,
  },
  {
    id: "cellular",
    labelKey: "nodeSettings.cellular.title",
    icon: <Signal size={14} />,
    readsConfig: true,
    render: (ctx) => (
      <CellularSection
        profile={ctx.profile}
        config={ctx.config}
        readOnly={ctx.readOnly}
        setValue={ctx.setValue}
      />
    ),
  },
  {
    id: "mac-pin",
    labelKey: "nodeSettings.macPin.title",
    icon: <Fingerprint size={14} />,
    readsConfig: true,
    render: (ctx) => (
      <MacPinSection
        config={ctx.config}
        readOnly={ctx.readOnly}
        setValue={ctx.setValue}
      />
    ),
  },
  {
    id: "discovery",
    labelKey: "nodeSettings.discovery.title",
    icon: <Radar size={14} />,
    readsConfig: true,
    render: (ctx) => (
      <DiscoverySection
        config={ctx.config}
        readOnly={ctx.readOnly}
        setValue={ctx.setValue}
      />
    ),
  },
  {
    id: "mavlink",
    labelKey: "nodeSettings.mavlinkRouting.title",
    icon: <Route size={14} />,
    readsConfig: true,
    // MAVLink routing (FC transport, router identity, signing, relay rates) is
    // the FC-connected drone's surface — a ground station or workstation has no
    // MAVLink router to configure, so the page never appears there.
    when: isDroneProfile,
    render: (ctx) => (
      <MavlinkRoutingSection
        profile={ctx.profile}
        config={ctx.config}
        readOnly={ctx.readOnly}
        setValue={ctx.setValue}
      />
    ),
  },
  {
    // `radio-config`, not `radio`: the live air-side Link page owns `radio`,
    // which is a retired top-level surface id a deep link still resolves
    // through. The two now sit next to each other in one sidebar, so the ids
    // can no longer collide.
    id: "radio-config",
    labelKey: "nodeSettings.radio.title",
    icon: <RadioTower size={14} />,
    readsConfig: true,
    // Fleet addressing, the link switches and the modulation rung — the WFB
    // radio's own page. A workstation carries no radio, so it never appears
    // there; it sits directly under the live Link page it configures.
    when: isRadioProfile,
    render: (ctx) => (
      <RadioSection
        profile={ctx.profile}
        config={ctx.config}
        readOnly={ctx.readOnly}
        setValue={ctx.setValue}
      />
    ),
  },
  {
    id: "swarm",
    labelKey: "nodeSettings.swarm.title",
    icon: <Waypoints size={14} />,
    readsConfig: true,
    // Swarm coordination is a drone-fleet surface — it does not apply to a
    // ground station or workstation even when their stored config carries the
    // block. Drone profile AND the node advertising the block (or demo).
    when: (ctx) =>
      isDroneProfile(ctx) &&
      (configAdvertises(ctx.config, "swarm") || isDemoMode()),
    render: (ctx) => (
      <SwarmSection
        config={ctx.config}
        readOnly={ctx.readOnly}
        setValue={ctx.setValue}
      />
    ),
  },
  {
    id: "video",
    labelKey: "nodeSettings.video.title",
    icon: <Video size={14} />,
    readsConfig: true,
    // The camera and encode config of a node that actually encodes. A ground
    // station relays video it never encodes and a workstation runs no
    // pipeline, so neither is offered the page; the radio half that used to
    // live here moved to the Radio page above.
    when: isDroneProfile,
    render: (ctx) => (
      <VideoSection
        profile={ctx.profile}
        config={ctx.config}
        readOnly={ctx.readOnly}
        setValue={ctx.setValue}
      />
    ),
  },
  // `vision-perception`, not `vision`: the live Perception dashboard (engine
  // tier, session health, usage, detection overlay) owns that id in
  // `agent-nav-items.tsx`. This page is the detector-model + offload/serving
  // *config* behind it — hence the distinct "Perception setup" label, so two
  // adjacent sidebar rows can never read as the same thing.
  {
    id: "vision-perception",
    labelKey: "nodeSettings.perception.title",
    icon: <Layers size={14} />,
    readsConfig: true,
    when: isVisionProfile,
    render: (ctx) => (
      <VisionPerceptionSection
        droneId={ctx.droneId}
        profile={ctx.profile}
        config={ctx.config}
        readOnly={ctx.readOnly}
        setValue={ctx.setValue}
      />
    ),
  },
  {
    // `world-model-config`, not `world-model`: the live World Model viewer owns
    // that id (another retired top-level surface id). This page is the Atlas
    // capture *setup* behind it — hence the distinct "World model setup" label,
    // so two adjacent sidebar rows can never read as the same thing.
    id: "world-model-config",
    labelKey: "nodeSettings.atlas.title",
    icon: <Boxes size={14} />,
    readsConfig: true,
    when: (ctx) =>
      ctx.profile === "drone" &&
      (configAdvertises(ctx.config, "atlas") || isDemoMode()),
    render: (ctx) => (
      <AtlasSection
        droneId={ctx.droneId}
        profile={ctx.profile}
        config={ctx.config}
        readOnly={ctx.readOnly}
        setValue={ctx.setValue}
      />
    ),
  },
  {
    id: "cloud",
    labelKey: "nodeSettings.cloud.title",
    icon: <Cloud size={14} />,
    readsConfig: true,
    render: (ctx) => (
      <CloudPage
        config={ctx.config}
        readOnly={ctx.readOnly}
        setValue={ctx.setValue}
      />
    ),
  },
  {
    id: "region",
    labelKey: "operatingRegion.title",
    icon: <Globe size={14} />,
    // Writes the regulatory domain straight to the agent's own region endpoint
    // with its own read-back; it never touches the persisted config document.
    readsConfig: false,
    // Operating region governs the RF radio; a radio-less workstation has no
    // regulatory domain, so the (otherwise blank) page never appears there.
    when: isRadioProfile,
    render: () => <RegulatoryRegionPanel />,
  },
  {
    id: "self-heal",
    labelKey: "nodeSettings.selfHeal.title",
    icon: <HeartPulse size={14} />,
    readsConfig: true,
    render: (ctx) => (
      <SelfHealSection
        config={ctx.config}
        readOnly={ctx.readOnly}
        setValue={ctx.setValue}
      />
    ),
  },
  {
    id: "security",
    labelKey: "nodeSettings.security.title",
    icon: <ShieldCheck size={14} />,
    readsConfig: true,
    render: (ctx) => (
      <SecuritySection
        config={ctx.config}
        readOnly={ctx.readOnly}
        setValue={ctx.setValue}
      />
    ),
  },
  {
    id: "advanced",
    labelKey: "nodeSettings.advanced.title",
    icon: <Wrench size={14} />,
    readsConfig: true,
    render: (ctx) => (
      <AdvancedPage
        config={ctx.config}
        readOnly={ctx.readOnly}
        setValue={ctx.setValue}
      />
    ),
  },
];
