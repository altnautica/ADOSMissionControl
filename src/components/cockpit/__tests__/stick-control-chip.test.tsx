import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => {
  const t = Object.assign((k: string) => k, { has: () => false });
  return { useTranslations: () => t };
});

const pilotState = { pilot: null as null | { controlMode: string | null; inputSrc: string | null } };
vi.mock("@/lib/cockpit/use-pilot-state", () => ({
  usePilotState: () => pilotState,
}));

import { StickControlChip } from "../StickControlChip";
import { useInputStore } from "@/stores/input-store";

beforeEach(() => {
  useInputStore.setState({ manualControlEnabled: false, activeController: "gamepad" });
});

describe("StickControlChip", () => {
  it("in ados control names the ADOS Pilot route with the live input session and shows no FC switch", () => {
    pilotState.pilot = { controlMode: "ados", inputSrc: "gamepad" };
    render(<StickControlChip droneId="d1" />);
    const row = screen.getByTestId("cockpit-stick");
    expect(row.dataset.route).toBe("ados");
    expect(row.textContent).toContain("Sticks are with ADOS Pilot");
    expect(row.textContent).toContain("gamepad");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(row.textContent).not.toContain("stickOff");
  });

  it("in fc_manual shows the FC RC-override switch, labelled as the FC route", () => {
    pilotState.pilot = { controlMode: "fc_manual", inputSrc: null };
    render(<StickControlChip droneId="d1" />);
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-label")).toBe("stickFc");
    expect(screen.getByTestId("cockpit-stick").dataset.route).toBe("fc");
  });
});
