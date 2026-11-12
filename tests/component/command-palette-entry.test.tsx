/**
 * How the global command palette is reached and what its parameter results
 * say: a parameter hit carries its name and units, the shell's hint opens the
 * palette, and the chord does nothing while another dialog is open.
 *
 * @license GPL-3.0-only
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../locales/en.json";
import type { ParamMetadata } from "@/lib/protocol/param-metadata";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
}));
const meta = new Map<string, ParamMetadata>([
  ["RTL_ALT", { name: "RTL_ALT", humanName: "RTL Altitude", description: "Return altitude", units: "cm" } as ParamMetadata],
]);
vi.mock("@/hooks/use-param-metadata", () => ({ useParamMetadataMap: () => meta }));

import { CommandPalette } from "@/components/shared/command-palette";
import { openCommandPalette } from "@/lib/command-palette-open";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import type { DroneProtocol } from "@/lib/protocol/types";

function renderPalette() {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CommandPalette />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  const protocol = {
    isConnected: true,
    getFirmwareHandler: () => null,
    getCapabilities: () => ({}),
    getCachedParameterNames: () => ["RTL_ALT", "RTL_SPEED"],
  } as unknown as DroneProtocol;
  useDroneManager.setState({
    drones: new Map([["d1", { id: "d1", protocol } as unknown as ManagedDrone]]),
    selectedDroneId: "d1",
  });
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
});

describe("command palette entry", () => {
  it("shows a parameter's name and units under its id", () => {
    renderPalette();
    act(() => openCommandPalette());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "rtl" } });
    const option = screen.getByRole("option", { name: /RTL_ALT/ });
    expect(option.textContent).toContain("RTL Altitude (cm)");
  });

  it("opens from the shell's hint event", () => {
    renderPalette();
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => openCommandPalette());
    expect(screen.getByRole("dialog", { name: messages.commandPalette.title })).toBeTruthy();
  });

  it("leaves Ctrl+K alone while another dialog is open", () => {
    const other = document.createElement("div");
    other.setAttribute("role", "dialog");
    other.setAttribute("aria-modal", "true");
    document.body.appendChild(other);
    renderPalette();
    act(() => {
      fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    });
    expect(screen.queryByRole("dialog", { name: messages.commandPalette.title })).toBeNull();
  });
});
