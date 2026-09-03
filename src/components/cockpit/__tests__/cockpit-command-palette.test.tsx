import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../locales/en.json";

// Spy on the shared dispatch pipeline while keeping the real registry + context
// builder, so a selection is asserted to route through `activate` (never a
// palette-local side effect).
vi.mock("@/lib/skills", async () => {
  const actual = await vi.importActual<typeof import("@/lib/skills")>(
    "@/lib/skills",
  );
  return { ...actual, activate: vi.fn(() => Promise.resolve()) };
});

import { CockpitCommandPalette } from "@/components/cockpit/CockpitCommandPalette";
import { activate, registerBuiltins } from "@/lib/skills";
import { useDroneManager } from "@/stores/drone-manager";

const DRONE = "drone-1";

function renderPalette(onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <CockpitCommandPalette droneId={DRONE} onClose={onClose} />
      </NextIntlClientProvider>,
    ),
  };
}

describe("CockpitCommandPalette", () => {
  beforeEach(() => {
    registerBuiltins();
    useDroneManager.setState({ selectedDroneId: DRONE });
    (activate as unknown as ReturnType<typeof vi.fn>).mockClear();
  });
  afterEach(() => {
    cleanup();
    useDroneManager.setState({ selectedDroneId: null });
  });

  it("lists the drone's available commands", () => {
    renderPalette();
    // Arm is always present (not gated behind autonomous nav).
    expect(screen.getByText(messages.skills.arm.label)).toBeTruthy();
  });

  it("filters commands by the search query", () => {
    renderPalette();
    const input = screen.getByPlaceholderText(messages.commandPalette.placeholder);
    fireEvent.change(input, { target: { value: "arm" } });
    expect(screen.getByText(messages.skills.arm.label)).toBeTruthy();
    // A non-matching command is filtered out.
    expect(screen.queryByText(messages.skills.kill.label)).toBeNull();
  });

  it("shows the empty state when nothing matches", () => {
    renderPalette();
    const input = screen.getByPlaceholderText(messages.commandPalette.placeholder);
    fireEvent.change(input, { target: { value: "zzzznomatch" } });
    expect(screen.getByText(messages.commandPalette.noResults)).toBeTruthy();
  });

  it("fires the chosen command through the shared pipeline and closes", () => {
    const { onClose } = renderPalette();
    fireEvent.click(screen.getByText(messages.skills.arm.label));
    expect(activate).toHaveBeenCalledTimes(1);
    expect((activate as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "arm",
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const { onClose } = renderPalette();
    const input = screen.getByPlaceholderText(messages.commandPalette.placeholder);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
