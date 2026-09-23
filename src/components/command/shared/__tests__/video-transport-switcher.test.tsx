/**
 * @license GPL-3.0-only
 *
 * The transport pill must not claim the agent's video service stopped when
 * nothing has reported its state yet.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { VideoTransportSwitcher } from "../VideoTransportSwitcher";

function renderWith(agentVideoState: string) {
  return render(
    <VideoTransportSwitcher
      activeTransport="lan-whep"
      cascadeState="connecting"
      cascadeError={null}
      onRetry={vi.fn()}
      hasPairedAgent
      hasLanWhep
      agentVideoState={agentVideoState}
      retryDelaySec={0}
    />,
  );
}

describe("VideoTransportSwitcher agent video state", () => {
  it("does not report a stopped service when the state is unknown", () => {
    renderWith("unknown");
    expect(screen.queryByText("AGENT VIDEO STOPPED")).toBeNull();
    expect(screen.getByText("CONNECTING…")).toBeTruthy();
  });

  it("reports a stopped service on an explicit stopped report", () => {
    renderWith("stopped");
    expect(screen.getByText("AGENT VIDEO STOPPED")).toBeTruthy();
  });
});
