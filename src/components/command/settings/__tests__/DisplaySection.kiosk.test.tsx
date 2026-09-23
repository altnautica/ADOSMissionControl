/**
 * @module command/settings/DisplaySection.kiosk.test
 * @description The node starts the HDMI kiosk whenever the renderer resolves
 * to HDMI and a display is attached, and never reads
 * `ground_station.kiosk.enabled`. A switch bound to that key reads OFF while
 * the kiosk owns the screen and toasts "Saved" for a change the node never
 * makes, so the Display page offers none: the renderer choice above is what
 * takes the kiosk off the screen.
 * @license GPL-3.0-only
 */

import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";

vi.mock("@/components/hardware/LocalDisplayCard", () => ({
  LocalDisplayCard: () => <div data-testid="renderer-picker" />,
}));
vi.mock("@/components/hardware/HdmiKioskCard", () => ({
  HdmiKioskCard: () => <div data-testid="kiosk-url" />,
}));

import { DisplaySection } from "../DisplaySection";

afterEach(() => cleanup());

/** Every prop a Display page has ever taken, so a version bound to the config
 * document renders its config-backed controls here too. */
interface AnyDisplayProps {
  nodeDeviceId: string | null;
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

describe("DisplaySection kiosk", () => {
  it("offers no kiosk on/off switch and never writes the key the node ignores", () => {
    const setValue = vi.fn(async () => {});
    const Section = DisplaySection as unknown as ComponentType<AnyDisplayProps>;
    renderWithIntl(
      <Section
        nodeDeviceId="gs-1"
        config={{ ground_station: { kiosk: { enabled: false } } }}
        readOnly={false}
        setValue={setValue}
      />,
    );

    expect(screen.queryByRole("switch")).toBeNull();
    for (const box of screen.queryAllByRole("checkbox")) fireEvent.click(box);
    expect(setValue).not.toHaveBeenCalledWith(
      "ground_station.kiosk.enabled",
      expect.anything(),
    );
    // What the page says instead: how the kiosk actually behaves.
    expect(screen.getByText(/choose a different renderer/)).toBeTruthy();
    expect(screen.getByTestId("renderer-picker")).toBeTruthy();
    expect(screen.getByTestId("kiosk-url")).toBeTruthy();
  });
});
