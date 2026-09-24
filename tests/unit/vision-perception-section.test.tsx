/**
 * Tests for the node Settings "Perception setup" page: the drone's detector
 * model. Covers the profile gate (nothing off a drone) and the honest LAN
 * requirement for the detector picker.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

import { VisionPerceptionSection } from "@/components/command/settings/VisionPerceptionSection";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

const initialConnection = useAgentConnectionStore.getState();

afterEach(() => {
  useAgentConnectionStore.setState(initialConnection, true);
});

function renderSection(profile: "drone" | "ground-station" | "workstation") {
  return renderWithIntl(
    <VisionPerceptionSection droneId="node:dev-1" nodeDeviceId="dev-1" profile={profile} />,
  );
}

describe("VisionPerceptionSection profile gate", () => {
  it.each(["ground-station", "workstation"] as const)("renders nothing on a %s node", (profile) => {
    const utils = renderSection(profile);
    expect(utils.container.innerHTML).toBe("");
  });

  it("renders the detector page on a drone", () => {
    renderSection("drone");
    expect(screen.getByText("Perception setup")).toBeTruthy();
    expect(screen.getByText("Detector model")).toBeTruthy();
  });
});

describe("VisionPerceptionSection honesty", () => {
  it("states the LAN requirement instead of rendering a dead model picker", () => {
    // No agent URL in the connection store → no vision client resolves.
    renderSection("drone");
    expect(screen.getByText(/needs the node's LAN connection/)).toBeTruthy();
  });
});
