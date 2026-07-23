/**
 * @module command/settings/settings-nav
 * @description The Settings tab page registry: every settings page, grouped
 * into the two-tier sections the sidebar renders (Identity / Link & network /
 * Video & vision / Cloud & remote / System & safety) — the same sectioned
 * registry pattern the Agent page uses for its sub-pages. Each item carries
 * the availability gate its page already enforces internally (profile fit,
 * the node advertising a feature block), so the sidebar never offers an
 * empty page, and renders the exact same section component one level down.
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

/** The five settings groups, top → bottom. Values are full i18n paths. */
export const SETTINGS_GROUPS = {
  identity: "nodeSettings.groups.identity",
  network: "nodeSettings.groups.network",
  videoVision: "nodeSettings.groups.videoVision",
  cloud: "nodeSettings.groups.cloud",
  system: "nodeSettings.groups.system",
} as const;

export type SettingsGroupKey = keyof typeof SETTINGS_GROUPS;

export const SETTINGS_GROUP_ORDER: SettingsGroupKey[] = [
  "identity",
  "network",
  "videoVision",
  "cloud",
  "system",
];

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
  group: SettingsGroupKey;
  icon: ReactNode;
  /** Availability gate. Absent = always shown. Mirrors the page's own
   * internal render-nothing gate so the sidebar never offers an empty page. */
  when?: (ctx: SettingsPageContext) => boolean;
  render: (ctx: SettingsPageContext) => ReactNode;
}

const isRadioProfile = (ctx: SettingsPageContext) =>
  ctx.profile === "drone" || ctx.profile === "ground-station";
const isVisionProfile = (ctx: SettingsPageContext) =>
  ctx.profile === "drone" || ctx.profile === "workstation";

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  // IDENTITY
  {
    id: "profile",
    labelKey: "nodeSettings.profile.title",
    group: "identity",
    icon: <CircleUser size={14} />,
    render: (ctx) => <ProfilePage config={ctx.config} />,
  },
  // LINK & NETWORK
  {
    id: "network",
    labelKey: "nodeSettings.network.title",
    group: "network",
    icon: <Network size={14} />,
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
    group: "network",
    icon: <Wifi size={14} />,
    render: () => <WifiClientSection />,
  },
  {
    id: "cellular",
    labelKey: "nodeSettings.cellular.title",
    group: "network",
    icon: <Signal size={14} />,
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
    group: "network",
    icon: <Fingerprint size={14} />,
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
    group: "network",
    icon: <Radar size={14} />,
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
    group: "network",
    icon: <Route size={14} />,
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
    id: "swarm",
    labelKey: "nodeSettings.swarm.title",
    group: "network",
    icon: <Waypoints size={14} />,
    when: (ctx) => configAdvertises(ctx.config, "swarm") || isDemoMode(),
    render: (ctx) => (
      <SwarmSection
        config={ctx.config}
        readOnly={ctx.readOnly}
        setValue={ctx.setValue}
      />
    ),
  },
  // VIDEO & VISION
  {
    id: "video",
    labelKey: "nodeSettings.video.title",
    group: "videoVision",
    icon: <Video size={14} />,
    when: isRadioProfile,
    render: (ctx) => (
      <VideoSection
        profile={ctx.profile}
        config={ctx.config}
        readOnly={ctx.readOnly}
        setValue={ctx.setValue}
      />
    ),
  },
  {
    id: "vision-perception",
    labelKey: "nodeSettings.perception.title",
    group: "videoVision",
    icon: <Layers size={14} />,
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
    id: "world-model",
    labelKey: "nodeSettings.atlas.title",
    group: "videoVision",
    icon: <Boxes size={14} />,
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
  // CLOUD & REMOTE
  {
    id: "cloud",
    labelKey: "nodeSettings.cloud.title",
    group: "cloud",
    icon: <Cloud size={14} />,
    render: (ctx) => (
      <CloudPage
        config={ctx.config}
        readOnly={ctx.readOnly}
        setValue={ctx.setValue}
      />
    ),
  },
  // SYSTEM & SAFETY
  {
    id: "region",
    labelKey: "operatingRegion.title",
    group: "system",
    icon: <Globe size={14} />,
    render: () => <RegulatoryRegionPanel />,
  },
  {
    id: "self-heal",
    labelKey: "nodeSettings.selfHeal.title",
    group: "system",
    icon: <HeartPulse size={14} />,
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
    group: "system",
    icon: <ShieldCheck size={14} />,
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
    group: "system",
    icon: <Wrench size={14} />,
    render: (ctx) => (
      <AdvancedPage
        config={ctx.config}
        readOnly={ctx.readOnly}
        setValue={ctx.setValue}
      />
    ),
  },
];
