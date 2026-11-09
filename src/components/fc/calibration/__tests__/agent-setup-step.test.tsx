/**
 * @license GPL-3.0-only
 *
 * A calibration panel on an agent-connected drone runs its step through the
 * setup engine's single-step route; with no engine (direct-serial FC) or a
 * step the FC's wizard does not have, the MAVLink panel renders unchanged.
 */

import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";

import { AgentSetupStep } from "../AgentSetupStep";
import { useFcSetup } from "@/lib/fc-setup/use-fc-setup";
import { demoSetupTransport, resetDemoSetup } from "@/mock/mock-fc-setup";
import { useDroneStore } from "@/stores/drone-store";

const transport = demoSetupTransport("agent-step-test");

function Harness({
  steps,
  engine = true,
  via = transport,
}: {
  steps: string[];
  engine?: boolean;
  via?: typeof transport;
}) {
  const setup = useFcSetup(engine ? via : null);
  const routed = engine && setup.status?.uid ? setup : null;
  return (
    <>
      {steps.map((step) => (
        <AgentSetupStep key={step} setup={routed} wizard="ground" step={step}>
          <div data-testid={`mavlink-${step}`}>MAVLink wizard</div>
        </AgentSetupStep>
      ))}
    </>
  );
}

function mount(steps: string[], engine?: boolean) {
  return render(
    <IntlWrapper>
      <Harness steps={steps} engine={engine} />
    </IntlWrapper>,
  );
}

describe("AgentSetupStep", () => {
  afterEach(() => resetDemoSetup());

  it("keeps the MAVLink panel when the drone has no agent setup engine", () => {
    mount(["accel"], false);
    expect(screen.getByTestId("mavlink-accel")).toBeTruthy();
  });

  it("routes a step the engine has and keeps MAVLink for one it lacks", async () => {
    mount(["accel", "no_such_step"]);
    await screen.findByTestId("agent-setup-run-accel");
    expect(screen.queryByTestId("mavlink-accel")).toBeNull();
    expect(screen.getByTestId("mavlink-no_such_step")).toBeTruthy();
  });

  it("runs the step through the agent route instead of MAVLink", async () => {
    mount(["accel"]);
    const run = await screen.findByTestId("agent-setup-run-accel");
    expect(screen.getByTestId("agent-setup-ground-accel").getAttribute("data-agent-routed")).toBe("true");
    fireEvent.click(run);
    // The engine now asks for the first pose: its own action replaces Run.
    await waitFor(() => expect(screen.queryByTestId("agent-setup-run-accel")).toBeNull());
    expect(screen.getByText("Next pose")).toBeTruthy();
  });

  it("holds a ground step's run while the selected vehicle is armed", async () => {
    useDroneStore.setState({ armState: "armed", connectionState: "connected" });
    try {
      render(
        <IntlWrapper>
          <Harness steps={["accel"]} via={demoSetupTransport("agent-step-armed")} />
        </IntlWrapper>,
      );
      const run = await screen.findByTestId("agent-setup-run-accel");
      expect((run as HTMLButtonElement).disabled).toBe(true);
      expect(run.getAttribute("title")).toBe("Disarm first");
    } finally {
      useDroneStore.setState({ armState: "disarmed", connectionState: "disconnected" });
    }
  });
});
