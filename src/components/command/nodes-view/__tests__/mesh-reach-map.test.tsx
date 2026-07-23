/**
 * @module command/nodes-view/mesh-reach-map.test
 * @description The reach map renders honestly: a proven, live relay stream
 * animates a flow toward the sink, an unverified one is drawn dashed and still,
 * and NOTHING animates when the operator prefers reduced motion. The relay
 * verification the derivation carried must survive to the drawn edge (Rule 44).
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, cleanup } from "@testing-library/react";

// Drive the reduced-motion preference from the test rather than the DOM.
const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-prefers-reduced-motion", () => ({
  usePrefersReducedMotion: () => reducedMotion.value,
}));

import messages from "../../../../../locales/en.json";
import { MeshReachMap } from "../MeshReachMap";
import { buildMeshGraph, type MeshNodeInput } from "@/lib/nodes/mesh-graph";
import type {
  BearerVerification,
  NodeBearerChip,
  NodeBearerKind,
} from "@/lib/nodes/node-bearer";

function chip(
  kind: NodeBearerKind,
  verification: BearerVerification,
): NodeBearerChip {
  return { kind, viaName: null, verification, rssiDbm: null };
}

/** A ground node reached over LAN with one relayed drone hanging off it. */
function fleet(relayVerification: BearerVerification): MeshNodeInput[] {
  return [
    {
      id: "node:gs",
      name: "GS-A",
      profile: "ground-station",
      liveness: "live",
      isRelayed: false,
      reachedViaId: null,
      reachedViaName: null,
      primary: chip("lan", "verified"),
      secondary: null,
    },
    {
      id: "node:drone",
      name: "Drone-D",
      profile: "drone",
      liveness: relayVerification === "verified" ? "live" : "stale",
      isRelayed: true,
      reachedViaId: "node:gs",
      reachedViaName: "GS-A",
      primary: chip("wfb", relayVerification),
      secondary: null,
    },
  ];
}

function renderMap(relayVerification: BearerVerification) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MeshReachMap graph={buildMeshGraph(fleet(relayVerification))} />
    </NextIntlClientProvider>,
  );
}

function relayEdge(container: HTMLElement): SVGLineElement {
  return container.querySelector(
    '[data-edge="node:drone:primary"]',
  ) as SVGLineElement;
}

afterEach(() => {
  cleanup();
  reducedMotion.value = false;
});

describe("MeshReachMap", () => {
  it("animates a proven, live relay stream toward the sink", () => {
    const { container } = renderMap("verified");
    const edge = relayEdge(container);
    expect(edge.getAttribute("data-verification")).toBe("verified");
    expect(edge.getAttribute("data-style")).toBe("relay");
    expect(edge.classList.contains("mesh-flow")).toBe(true);
    expect(edge.getAttribute("data-flowing")).toBe("true");
  });

  it("draws an unverified relay dashed and still, never as a confident flow", () => {
    const { container } = renderMap("unverified");
    const edge = relayEdge(container);
    expect(edge.getAttribute("data-verification")).toBe("unverified");
    // Dashed, not solid; no flow animation on a link the row cannot prove.
    expect(edge.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(edge.classList.contains("mesh-flow")).toBe(false);
    expect(edge.getAttribute("data-flowing")).toBeNull();
  });

  it("animates nothing when the operator prefers reduced motion", () => {
    reducedMotion.value = true;
    const { container } = renderMap("verified");
    const edge = relayEdge(container);
    // Still a verified relay, but static — the preference wins.
    expect(edge.getAttribute("data-verification")).toBe("verified");
    expect(edge.classList.contains("mesh-flow")).toBe(false);
    expect(edge.getAttribute("data-flowing")).toBeNull();
  });

  it("labels the graph for assistive tech with a node + path summary", () => {
    const { container } = renderMap("verified");
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toMatch(/2 node/);
  });

  it("draws a filtered-out relay parent as a named off-view terminal, not a fleet node", () => {
    // Only the relayed drone is in view; its ground node is filtered out.
    const graph = buildMeshGraph([
      {
        id: "node:drone",
        name: "Drone-D",
        profile: "drone",
        liveness: "live",
        isRelayed: true,
        reachedViaId: "node:gs",
        reachedViaName: "GS-A",
        primary: chip("wfb", "verified"),
        secondary: null,
      },
    ]);
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <MeshReachMap graph={graph} />
      </NextIntlClientProvider>,
    );
    // The off-view parent is not counted among the fleet nodes.
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toMatch(
      /1 node/,
    );
    // The drone's WFB relay edge is drawn — its terminal is the off-view parent,
    // not the GCS.
    const edge = relayEdge(container);
    expect(edge.getAttribute("data-bearer")).toBe("wfb");
    expect(edge.getAttribute("data-style")).toBe("relay");
    // The off-view parent is named on the map and marked off view.
    expect(container.textContent).toMatch(/GS-A \(off view\)/);
  });
});
