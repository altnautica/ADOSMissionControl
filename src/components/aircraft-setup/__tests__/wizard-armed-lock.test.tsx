/**
 * @license GPL-3.0-only
 *
 * The ground wizard (calibrations) does not start on an armed aircraft: the
 * screen disables Start and says "Disarm first", and the demo setup engine
 * refuses with `armed` the way the agent does.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../tests/helpers/intl-wrapper";

const arm = { state: "armed" as "armed" | "disarmed" | "unknown" };
const UNKNOWN_NOTE = "This control is disabled until the vehicle reports it is disarmed.";

vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => ({
    isArmed: arm.state === "armed",
    isHardBlocked: arm.state !== "disarmed",
    lockMessage: "",
    hardBlockMessage: arm.state === "unknown" ? UNKNOWN_NOTE : arm.state === "armed" ? "armed" : "",
  }),
}));
vi.mock("@/stores/node-registry", () => ({
  resolveNodeId: (id: string) => `node:${id}`,
  useNodeRegistryStore: { getState: () => ({ getEntry: () => ({ fc: { armState: arm.state } }) }) },
}));

import { AircraftSetupView } from "../AircraftSetupView";
import { useFcSetup } from "@/lib/fc-setup/use-fc-setup";
import { SetupRequestError, startWizard, rerunStep } from "@/lib/fc-setup/client";
import { demoSetupTransport, resetDemoSetup } from "@/mock/mock-fc-setup";
import { setupText } from "@/lib/fc-setup/strings";

function Harness() {
  const setup = useFcSetup(demoSetupTransport("armed-wizard-test"));
  return <AircraftSetupView setup={setup} droneId="node:armed-wizard-test" />;
}

describe("aircraft setup while armed", () => {
  afterEach(() => resetDemoSetup());

  it("disables the ground wizard Start and shows the armed refusal", async () => {
    arm.state = "armed";
    render(<Harness />, { wrapper: IntlWrapper });
    const start = (await screen.findByTestId("setup-start")) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(screen.getByTestId("setup-armed").textContent).toBe(setupText("setup.err.armed"));
  });

  it("words an unknown arm state as the calibration panels do, not as armed", async () => {
    arm.state = "unknown";
    render(<Harness />, { wrapper: IntlWrapper });
    const start = (await screen.findByTestId("setup-start")) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(screen.getByTestId("setup-armed").textContent).toBe(UNKNOWN_NOTE);
    expect(start.title).toBe(UNKNOWN_NOTE);
  });

  it("offers Start on a disarmed aircraft", async () => {
    arm.state = "disarmed";
    render(<Harness />, { wrapper: IntlWrapper });
    const start = (await screen.findByTestId("setup-start")) as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    expect(screen.queryByTestId("setup-armed")).toBeNull();
  });

  it("the demo engine refuses ground start and step runs with `armed`", async () => {
    arm.state = "armed";
    const t = demoSetupTransport("armed-engine-test");
    await expect(startWizard(t, "ground")).rejects.toMatchObject({ errKey: "armed", status: 409 });
    await expect(rerunStep(t, "ground", "accel")).rejects.toBeInstanceOf(SetupRequestError);
    arm.state = "disarmed";
    await expect(startWizard(t, "ground")).resolves.toBeTruthy();
  });
});
