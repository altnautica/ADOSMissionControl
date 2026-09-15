/**
 * @module hardware/local-display-renderer-gate.test
 * @description `ground_station.display.type` is boot-critical: the display
 * service gates its early startup on it, so provisioning a renderer that is not
 * attached takes the on-box UI dark at the next start — and the on-box UI is how
 * an operator recovers a node whose network is down, so the recovery path for
 * this mistake is the very thing the mistake removes. It has already cost a
 * board on the bench.
 *
 * Two guards must hold. A renderer the node does not report is not selectable
 * and cannot be written even if something calls through. And any change away
 * from the agent's own resolved renderer reaches the agent only after an
 * explicit confirmation.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

const setConfigValueViaAccess = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/agent/config-access", () => ({
  directClientForNode: () => null,
  resolveConfigAccess: () => ({ mode: "proxy" }),
  setConfigValueViaAccess: (...args: unknown[]) =>
    setConfigValueViaAccess(...(args as [])),
}));
vi.mock("@/lib/agent/config-write", () => ({
  configWriteFailure: () => null,
}));

const toast = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));

import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { LocalDisplayCard } from "../LocalDisplayCard";

/** Seed the capability store with a ground station whose bound display and
 * resolved renderer are exactly what the agent reported. */
function seed(opts: {
  display?: { type: "spi-lcd" | "hdmi" | "none" };
  displayType?: "auto" | "hdmi" | "lcd" | "none";
}) {
  useAgentCapabilitiesStore.setState({
    loaded: true,
    display: opts.display,
    displayType: opts.displayType,
    uiTheme: undefined,
  } as never);
  useAgentConnectionStore.setState({
    client: null,
    nodeDeviceId: "gs-1",
  } as never);
}

beforeEach(() => {
  setConfigValueViaAccess.mockClear();
  toast.mockClear();
});

afterEach(() => {
  useAgentCapabilitiesStore.setState({
    loaded: false,
    display: undefined,
    displayType: undefined,
  } as never);
});

describe("local display renderer gate", () => {
  it("offers only the renderers the node reports as attached", async () => {
    // An SPI LCD is bound; no HDMI sink was reported.
    seed({ display: { type: "spi-lcd" }, displayType: "lcd" });
    render(<LocalDisplayCard nodeDeviceId="gs-1" />);

    fireEvent.click(screen.getByRole("combobox"));

    const hdmi = await screen.findByRole("option", {
      name: /override\.hdmi/,
    });
    const lcd = screen.getByRole("option", { name: /override\.lcd/ });
    expect(hdmi).toHaveAttribute("aria-disabled", "true");
    expect(lcd).not.toHaveAttribute("aria-disabled", "true");
  });

  it("does not write an absent renderer, and says why", async () => {
    seed({ display: { type: "spi-lcd" }, displayType: "lcd" });
    render(<LocalDisplayCard nodeDeviceId="gs-1" />);

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(
      await screen.findByRole("option", { name: /override\.hdmi/ }),
    );

    // Nothing reached the agent.
    await waitFor(() => {
      expect(setConfigValueViaAccess).not.toHaveBeenCalled();
    });
  });

  it("holds a renderer change behind an explicit confirmation", async () => {
    // Both renderers present, so presence is not what is under test here.
    seed({ display: { type: "hdmi" }, displayType: "hdmi" });
    render(<LocalDisplayCard nodeDeviceId="gs-1" />);

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(
      await screen.findByRole("option", { name: /override\.none/ }),
    );

    // Not yet: the confirmation is open and nothing has been written.
    expect(setConfigValueViaAccess).not.toHaveBeenCalled();
    await screen.findByText("override.confirmTitle");

    fireEvent.click(
      screen.getByRole("button", { name: /override\.confirmAction/ }),
    );
    await waitFor(() => {
      expect(setConfigValueViaAccess).toHaveBeenCalledWith(
        { mode: "proxy" },
        "ground_station.display.type",
        "none",
      );
    });
  });

  it("writes nothing when the confirmation is dismissed", async () => {
    seed({ display: { type: "hdmi" }, displayType: "hdmi" });
    render(<LocalDisplayCard nodeDeviceId="gs-1" />);

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(
      await screen.findByRole("option", { name: /override\.none/ }),
    );
    await screen.findByText("override.confirmTitle");
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));

    await waitFor(() => {
      expect(setConfigValueViaAccess).not.toHaveBeenCalled();
    });
  });
});
