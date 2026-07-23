/**
 * @module command/nodes-view/relay-streams-list.test
 * @description The relay-streams list is the map's text equivalent: it names a
 * multi-hop funnel end to end for a screen reader, marks a stale funnel as stale
 * rather than live, and — like the map — never animates under a reduced-motion
 * preference. The state the derivation carried must survive to the row (Rule 44).
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, cleanup, within } from "@testing-library/react";

// Drive the reduced-motion preference from the test rather than the DOM.
const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-prefers-reduced-motion", () => ({
  usePrefersReducedMotion: () => reducedMotion.value,
}));

import messages from "../../../../../locales/en.json";
import { RelayStreamsList } from "../RelayStreamsList";
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

function node(over: Partial<MeshNodeInput> & { id: string }): MeshNodeInput {
  return {
    name: over.id,
    profile: "drone",
    liveness: "live",
    isRelayed: false,
    reachedViaId: null,
    reachedViaName: null,
    primary: chip("lan", "verified"),
    secondary: null,
    ...over,
  };
}

function renderList(inputs: MeshNodeInput[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RelayStreamsList graph={buildMeshGraph(inputs)} />
    </NextIntlClientProvider>,
  );
}

/** A two-hop funnel: a relayed drone through a ground node, live. */
const LIVE_FUNNEL: MeshNodeInput[] = [
  node({ id: "node:gs", name: "GS-A", profile: "ground-station" }),
  node({
    id: "node:drone",
    name: "Drone-D",
    isRelayed: true,
    reachedViaId: "node:gs",
    primary: chip("wfb", "verified"),
  }),
];

afterEach(() => {
  cleanup();
  reducedMotion.value = false;
});

describe("RelayStreamsList", () => {
  it("names a multi-hop funnel end to end for assistive tech", () => {
    const { container, getByRole } = renderList([
      node({ id: "node:gs", name: "GS-A", profile: "ground-station" }),
      node({
        id: "node:relay",
        name: "Charlie-03",
        isRelayed: true,
        reachedViaId: "node:gs",
        primary: chip("wfb", "verified"),
      }),
      node({
        id: "node:far",
        name: "Delta-04",
        isRelayed: true,
        reachedViaId: "node:relay",
        primary: chip("wfb", "verified"),
      }),
    ]);
    // The list is a proper, named list of the two funnels.
    const list = getByRole("list", { name: /Relay streams/ });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);

    // The deepest funnel names every node and every relayed bearer to the sink,
    // as one screen-reader sentence.
    const far = container.querySelector('[data-stream="node:far"]')!;
    const sentence = far.querySelector(".sr-only")?.textContent ?? "";
    expect(sentence).toMatch(/Delta-04.*over WFB to Charlie-03/);
    expect(sentence).toMatch(/over WFB to GS-A/);
    expect(sentence).toMatch(/to GCS/);
    expect(sentence).toMatch(/Live\.?$/);
  });

  it("names an off-view parent and never claims a WFB link to the GCS when the ground node is filtered out", () => {
    // Only the relayed drone is in the visible set; its ground node is filtered
    // out, so the funnel must stop at the off-view parent, not the GCS.
    const { container } = renderList([
      node({
        id: "node:drone",
        name: "Drone-D",
        isRelayed: true,
        reachedViaId: "node:gs",
        reachedViaName: "GS-A",
        primary: chip("wfb", "verified"),
      }),
    ]);
    const row = container.querySelector('[data-stream="node:drone"]')!;
    const sentence = row.querySelector(".sr-only")?.textContent ?? "";
    // The off-view parent is named; the sentence never asserts a hop to the GCS.
    expect(sentence).toMatch(/over WFB to GS-A \(off view\)/);
    expect(sentence).not.toMatch(/to GCS/);
  });

  it("marks a stale funnel as stale, never as a live stream", () => {
    const { container } = renderList([
      node({
        id: "node:drone",
        name: "Drone-D",
        liveness: "stale",
        isRelayed: true,
        reachedViaId: "node:gs",
        primary: chip("wfb", "stale"),
      }),
    ]);
    const row = container.querySelector('[data-stream="node:drone"]')!;
    expect(row.getAttribute("data-worst")).toBe("stale");
    expect(row.getAttribute("data-live")).toBeNull();
    // The visible state badge says Stale, not Live.
    expect(within(row as HTMLElement).queryByText("Live")).toBeNull();
    expect(within(row as HTMLElement).getByText("Stale")).toBeTruthy();
  });

  it("breathes a live funnel's dot, but never under reduced motion", () => {
    const first = renderList(LIVE_FUNNEL);
    const liveRow = first.container.querySelector('[data-stream="node:drone"]')!;
    expect(liveRow.getAttribute("data-live")).toBe("true");
    expect(liveRow.querySelector(".relay-live-pulse")).not.toBeNull();
    cleanup();

    reducedMotion.value = true;
    const { container } = renderList(LIVE_FUNNEL);
    const stillRow = container.querySelector('[data-stream="node:drone"]')!;
    // Still a proven, live funnel — but the dot holds still, the preference wins.
    expect(stillRow.getAttribute("data-live")).toBe("true");
    expect(stillRow.querySelector(".relay-live-pulse")).toBeNull();
  });

  it("says so plainly when no node is funneled", () => {
    const { getByText, queryByRole } = renderList([
      node({ id: "node:a", name: "A", primary: chip("lan", "verified") }),
    ]);
    expect(getByText(/No relay streams/)).toBeTruthy();
    expect(queryByRole("listitem")).toBeNull();
  });
});
