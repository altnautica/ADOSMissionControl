/**
 * @module mock/agent/demo-enrichment.test
 * @description The demo-mode enrichment feeds the same relay / node derivations
 * the live GCS uses, so this asserts those derivations light up from the demo
 * fixtures: every reach kind resolves (LAN / cloud / direct-fc / none), a
 * relayed-via-GS drone produces a relay edge to its ground node (not a star to
 * the GCS) and a non-empty relay stream, the mock node-config round-trips a
 * typed write, the ground-station capability snapshot lights the WFB radio + the
 * CRSF/ELRS lane, and the RC/ELRS tab renders that lane populated.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, cleanup, screen } from "@testing-library/react";

import type { SkillProtocol } from "@/lib/skills/skill-protocol";

// Controllable reach resolvers so one describeNodeReach call can exercise each
// kind in turn (the demo seeds the stores these read; here we drive them
// directly to prove every kind is reachable).
const { lanHolder, directFcHolder } = vi.hoisted(() => ({
  lanHolder: { agent: null as { agentUrl: string; apiKey: string } | null },
  directFcHolder: { protocol: null as SkillProtocol | null },
}));
vi.mock("@/lib/agent/resolve-agent", () => ({
  resolveLocalAgentForDrone: () => lanHolder.agent,
}));
vi.mock("@/lib/nodes/direct-fc-protocol", () => ({
  resolveDirectFcProtocol: () => directFcHolder.protocol,
}));

import messages from "../../../../locales/en.json";
import {
  getMockConfig,
  setMockConfigValue,
} from "../config";
import { getMockGroundStationCapabilities } from "../capabilities";
import { describeNodeReach } from "@/lib/nodes/node-reach";
import type { NodeReachKind } from "@/lib/nodes/node-reach";
import {
  planRelayedEnrollment,
  type RelayGroundNode,
} from "@/lib/agent/relayed-peers";
import { buildMeshGraph, type MeshNodeInput } from "@/lib/nodes/mesh-graph";
import { buildRelayStreams } from "@/lib/nodes/relay-streams";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { normalizeCrsf, normalizeRadio } from "@/stores/agent-capabilities/normalizer";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { RcElrsLinkTab } from "@/components/command/nodes/RcElrsLinkTab";
import type { CommandCloudStatus } from "@/stores/command-fleet-store";

afterEach(() => {
  lanHolder.agent = null;
  directFcHolder.protocol = null;
  useAgentCapabilitiesStore.getState().clear();
  cleanup();
});

const GS_DEVICE = "groundstation-1";
const GS_NODE = nodeIdForDevice(GS_DEVICE);

/** The ground-station status the demo seeds: a verified WFB link relaying
 * romeo-15 (fresh, strong), whiskey-23 (old, weak), and alpha-1 (also paired). */
function demoGsStatus(now: number): CommandCloudStatus {
  return {
    deviceId: GS_DEVICE,
    updatedAt: now,
    radio: { state: "connected", rssiDbm: -58, linkDiag: "healthy" },
    linkedPeers: [
      { deviceId: "romeo-15", role: "drone", rssiDbm: -63, seenAtUnix: Math.floor(now / 1000) },
      { deviceId: "whiskey-23", role: "drone", rssiDbm: -90, seenAtUnix: Math.floor((now - 180_000) / 1000) },
      { deviceId: "alpha-1", role: "drone", rssiDbm: -55, seenAtUnix: Math.floor(now / 1000) },
    ],
  };
}

describe("demo reach kinds", () => {
  it("resolves every reach kind a filter chip counts", () => {
    // LAN: a browser-local agent resolves and the demo origin is treated as
    // non-HTTPS (originIsHttps false), so the LAN transport wins.
    lanHolder.agent = { agentUrl: "http://192.168.1.50:8080", apiKey: "demo" };
    const lan = describeNodeReach(
      { deviceId: "foxtrot-6", convexId: "cx-foxtrot" },
      { originIsHttps: false },
    );
    expect(lan.kind).toBe<NodeReachKind>("lan");

    // Cloud: no LAN agent, a cloud pairing row + a queue writer.
    lanHolder.agent = null;
    const cloud = describeNodeReach(
      { deviceId: "charlie-3", convexId: "cx-charlie" },
      { enqueueCloudCommand: async () => ({ commandId: "c1" }) },
    );
    expect(cloud.kind).toBe<NodeReachKind>("cloud");

    // Direct-FC: a plugged-in FC with a live protocol and no agent lane.
    directFcHolder.protocol = {} as SkillProtocol;
    const directFc = describeNodeReach(
      { deviceId: "sierra-19-usb", isDirectFc: true },
      {},
    );
    expect(directFc.kind).toBe<NodeReachKind>("direct-fc");
    directFcHolder.protocol = null;

    // None (Unreachable): a relayed-only drone — the relay carries no command
    // channel yet, so its command reach is none.
    const none = describeNodeReach(
      { deviceId: "romeo-15", isRelayed: true },
      {},
    );
    expect(none.kind).toBe<NodeReachKind>("none");

    // All four kinds are represented, so each filter chip's count is non-zero
    // against the demo roster.
    const kinds = new Set([lan.kind, cloud.kind, directFc.kind, none.kind]);
    expect(kinds).toEqual(new Set(["lan", "cloud", "direct-fc", "none"]));
  });
});

describe("demo relayed-via-GS enrollment", () => {
  const now = 1_800_000_000_000;

  it("enrolls the relayed drones through the ground node", () => {
    const gs: RelayGroundNode = {
      deviceId: GS_DEVICE,
      nodeId: GS_NODE,
      status: demoGsStatus(now),
      radioUp: true,
    };
    const enrollments = planRelayedEnrollment({
      groundNodes: [gs],
      // alpha-1 is also cloud-paired directly; romeo-15 + whiskey-23 are not.
      directlyPairedDeviceIds: new Set([GS_DEVICE, "alpha-1"]),
      now,
    });

    const byId = new Map(enrollments.map((e) => [e.deviceId, e]));
    // romeo-15 + whiskey-23 enroll as relayed-only nodes with a funneled feed.
    expect(byId.get("romeo-15")?.reachedVia).toBe(GS_NODE);
    expect(byId.get("romeo-15")?.peerRssiDbm).toBe(-63);
    expect(byId.get("romeo-15")?.funneledStatus).toBeDefined();
    expect(byId.get("whiskey-23")?.funneledStatus).toBeDefined();
    // alpha-1 is directly paired too, so it keeps a relay hop as provenance but
    // no funneled status (its own bridge owns the feed).
    expect(byId.get("alpha-1")?.reachedVia).toBe(GS_NODE);
    expect(byId.get("alpha-1")?.funneledStatus).toBeUndefined();
  });

  it("draws a relay edge to the ground node, not a star to the GCS", () => {
    const inputs: MeshNodeInput[] = [
      {
        id: GS_NODE,
        name: "Ground Station Alpha",
        profile: "ground-station",
        liveness: "live",
        isRelayed: false,
        reachedViaId: null,
        reachedViaName: null,
        primary: { kind: "cloud", viaName: null, verification: "verified", rssiDbm: null },
        secondary: null,
      },
      {
        id: nodeIdForDevice("romeo-15"),
        name: "Romeo-15",
        profile: "drone",
        liveness: "live",
        isRelayed: true,
        reachedViaId: GS_NODE,
        reachedViaName: "Ground Station Alpha",
        primary: { kind: "wfb", viaName: "Ground Station Alpha", verification: "verified", rssiDbm: -63 },
        secondary: null,
      },
    ];

    const graph = buildMeshGraph(inputs);
    const relayEdge = graph.edges.find(
      (e) => e.from === nodeIdForDevice("romeo-15"),
    );
    expect(relayEdge).toBeDefined();
    // The relay terminates at the ground node, never redirected to the GCS sink.
    expect(relayEdge?.to).toBe(GS_NODE);
    expect(relayEdge?.style).toBe("relay");

    const streams = buildRelayStreams(graph);
    expect(streams.length).toBeGreaterThan(0);
    const romeo = streams.find((s) => s.id === nodeIdForDevice("romeo-15"));
    expect(romeo).toBeDefined();
    // A verified relay + a verified home hop = a live funnel.
    expect(romeo?.live).toBe(true);
  });
});

describe("demo mock node config", () => {
  it("carries the settings blocks and round-trips a typed write", () => {
    const cfg = getMockConfig();
    // A sampling of the blocks the node-Settings pages read.
    expect(cfg.network).toBeDefined();
    expect(cfg.mavlink).toBeDefined();
    expect(cfg.swarm).toBeDefined();
    expect(cfg.video).toBeDefined();
    expect(cfg.perception).toBeDefined();
    expect(cfg.atlas).toBeDefined();

    // A boolean write reads back a real boolean (so a Toggle reads `raw ===
    // true`), and a number write reads back a real number.
    setMockConfigValue("network.hotspot.enabled", "false");
    setMockConfigValue("mavlink.system_id", "7");
    const after = getMockConfig();
    const network = after.network as { hotspot: { enabled: unknown } };
    const mavlink = after.mavlink as { system_id: unknown };
    expect(network.hotspot.enabled).toBe(false);
    expect(mavlink.system_id).toBe(7);

    // Restore so the shared module config does not leak into another test.
    setMockConfigValue("network.hotspot.enabled", "true");
    setMockConfigValue("mavlink.system_id", "1");
  });
});

describe("demo ground-station capabilities", () => {
  it("lights the WFB radio and the CRSF/ELRS lane", () => {
    const caps = getMockGroundStationCapabilities();
    // The lane normalizes to a live, honest reading.
    const crsf = normalizeCrsf(caps.crsf);
    expect(crsf).not.toBeNull();
    expect(crsf?.state).toBe("link_ok");
    expect(crsf?.mode).toBe("crsf_rc");
    expect(crsf?.txPowerMw).toBe(250);
    // The radio normalizes to a connected link with a healthy diagnosis.
    const radio = normalizeRadio(caps.radio);
    expect(radio?.state).toBe("connected");
    expect(radio?.linkDiag).toBe("healthy");

    // Fed through the capability store, both the radio and crsf gates light so
    // the Radio + RC/ELRS Link tabs appear, and the role reads relay.
    useAgentCapabilitiesStore.getState().setCapabilities(caps);
    const s = useAgentCapabilitiesStore.getState();
    expect(s.radio).not.toBeNull();
    expect(s.crsf).not.toBeNull();
    expect(s.role).toBe("relay");
  });

  it("renders the RC/ELRS tab populated against the demo lane", () => {
    const crsf = normalizeCrsf(getMockGroundStationCapabilities().crsf);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RcElrsLinkTab crsf={crsf} />
      </NextIntlClientProvider>,
    );
    // The transmit power reads through to the stat row (not the empty "…").
    expect(screen.getByText("250 mW")).toBeInTheDocument();
  });
});
