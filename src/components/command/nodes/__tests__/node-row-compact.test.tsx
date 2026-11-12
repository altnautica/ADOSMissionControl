/**
 * @module nodes/node-row-compact.test
 * @description The compact fleet row: an outlined node tile with a liveness
 * dot, a one-line meta summary with labelled icons, a live drone's battery,
 * and an icon-only Fly button.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../../locales/en.json";
import { NodeRow } from "../NodeRow";
import { NodeTile, STATUS_DOT } from "../NodeTile";
import { NodeMetaLine } from "../NodeMetaLine";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useNodePersonalizationStore } from "@/stores/node-personalization-store";

function node(over: Partial<FleetNodeEntry> = {}): FleetNodeEntry {
  return {
    _id: "node:n1",
    userId: "u",
    deviceId: "n1",
    name: "Alpha",
    apiKey: "",
    pairedAt: Date.now(),
    lastSeen: Date.now(),
    profile: "drone",
    isLocal: false,
    ...over,
  };
}

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const nc = messages.nodeConsole;

afterEach(() => {
  cleanup();
  useCommandFleetStore.getState().clear();
  useNodePersonalizationStore.setState({ byNode: {} });
});

describe("NodeTile", () => {
  it("is a 28 px outlined tile with a green dot for a live node", () => {
    wrap(<NodeTile node={node()} />);
    const tile = screen.getByTestId("node-tile");
    expect(tile.className).toContain("h-7");
    expect(tile.className).toContain("border-border-default");
    expect(tile.getAttribute("style")).toBeNull();
    const dot = tile.querySelector("[data-status]") as HTMLElement;
    expect(dot.className).toContain(STATUS_DOT.good);
  });

  it("dims the dot for an offline node and warns for a stale one", () => {
    wrap(
      <>
        <NodeTile node={node({ _id: "a", lastSeen: Date.now() - 3_600_000 })} />
        <NodeTile node={node({ _id: "b", lastSeen: Date.now() - 50_000 })} />
      </>,
    );
    const [offline, stale] = screen.getAllByTestId("node-tile");
    expect(offline.querySelector("[data-status]")!.className).toContain("bg-text-tertiary");
    expect(stale.querySelector("[data-status]")!.className).toContain("bg-status-serious");
  });
});

describe("NodeMetaLine", () => {
  it("leads a stale node with Stale, then the firmware", () => {
    wrap(
      <NodeMetaLine
        node={node({ lastSeen: Date.now() - 50_000, fcFirmware: "ardupilot" })}
        effProfile="drone"
      />,
    );
    const stale = screen.getByText(nc.liveness.stale, { exact: false });
    expect(stale.className).toContain("text-status-serious");
    expect(stale.parentElement!.textContent).toBe("Stale · ArduPilot");
  });

  it("shows hardware and reach as labelled icons", () => {
    wrap(
      <NodeMetaLine
        node={node({ board: "rpi-cm4", fcConnected: true, isRelayed: true, isLocal: true })}
        effProfile="drone"
      />,
    );
    expect(screen.getByRole("img", { name: nc.badge.companion })).toBeTruthy();
    expect(screen.getByRole("img", { name: nc.provenance.relayed })).toBeTruthy();
    expect(screen.getByRole("img", { name: nc.badge.lan })).toBeTruthy();
  });

  it("appends a live drone's battery, red below 15 %", () => {
    useCommandFleetStore.setState({
      cloudStatuses: { n1: { deviceId: "n1", telemetry: { battery: { remaining: 12 } } } },
    } as never);
    wrap(<NodeMetaLine node={node()} effProfile="drone" />);
    const battery = screen.getByTestId("node-meta-battery");
    expect(battery.textContent).toBe("12%");
    expect(battery.className).toContain("text-status-error");
  });

  it("hides the battery once the drone is not live", () => {
    useCommandFleetStore.setState({
      cloudStatuses: { n1: { deviceId: "n1", telemetry: { battery: { remaining: 80 } } } },
    } as never);
    wrap(<NodeMetaLine node={node({ lastSeen: Date.now() - 50_000 })} effProfile="drone" />);
    expect(screen.queryByTestId("node-meta-battery")).toBeNull();
  });
});

describe("NodeRow", () => {
  it("is a 52 px row with an icon-only Fly button", () => {
    wrap(<NodeRow node={node()} selected={false} onSelect={() => {}} onContext={() => {}} />);
    const row = screen.getByRole("option");
    expect(row.className).toContain("h-[52px]");
    const fly = screen.getByTestId("fly-button-row");
    expect(fly.className).toContain("w-7");
    expect(fly.textContent).toBe("");
    expect(fly.getAttribute("title")).toBe(messages.flightScreen.fly);
  });

  it("fills the Fly button on the selected row", () => {
    wrap(<NodeRow node={node()} selected onSelect={() => {}} onContext={() => {}} />);
    expect(screen.getByTestId("fly-button-row").className).toContain("bg-accent-primary");
  });
});
