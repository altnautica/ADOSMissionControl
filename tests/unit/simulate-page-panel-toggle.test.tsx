/**
 * @module simulate-page-panel-toggle.test
 * @description The collapsed right-panel opener on /simulate is an icon-only
 * button; it must carry an accessible name.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// Every dynamic subtree renders a stub that exposes `onClose` when given one,
// so the test can collapse the right panel.
vi.mock("next/dynamic", () => ({
  default: () =>
    function Stub(props: { onClose?: () => void }) {
      return props.onClose ? (
        <button type="button" onClick={props.onClose}>
          close-panel
        </button>
      ) : null;
    },
}));
vi.mock("@/components/simulation/SimulateLeftPanel", () => ({
  SimulateLeftPanel: () => null,
}));
vi.mock("@/hooks/use-simulation-keyboard", () => ({
  useSimulationKeyboard: () => {},
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import SimulatePage from "@/app/simulate/page";
import { useMissionStore } from "@/stores/mission-store";

const messages = {
  simulate: {
    emptyTitle: "Nothing to simulate yet",
    emptyBody: "Plan a mission first.",
    emptyAction: "Plan a mission",
    showPanel: "Show panel",
  },
};

describe("SimulatePage collapsed panel toggle", () => {
  it("has an accessible name and reopens the panel", () => {
    useMissionStore.setState({
      waypoints: [
        { id: "a", lat: 12.9, lon: 77.5, alt: 50, command: "WAYPOINT" },
        { id: "b", lat: 12.91, lon: 77.51, alt: 50, command: "WAYPOINT" },
      ],
    });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SimulatePage />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "close-panel" }));
    const opener = screen.getByRole("button", { name: "Show panel" });
    fireEvent.click(opener);
    expect(screen.queryByRole("button", { name: "Show panel" })).toBeNull();
    expect(screen.getByRole("button", { name: "close-panel" })).toBeInTheDocument();
  });
});
