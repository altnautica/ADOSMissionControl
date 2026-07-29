/**
 * Tests for the node Settings "Swarm" page after it grew from a four-field
 * stub into the drone's full coordination surface.
 *
 * Four properties matter more than the fields themselves: formation is a
 * closed set (a free-text name produced no formation at all, silently), the
 * flocking gains stay collapsed and carry their float meaning, the two
 * separation values are gated because they are the safety layer, and the
 * runtime notice stays honest about what the Enabled toggle and GUIDED mode
 * actually gate, now that the onboard swarm runtime consumes these keys.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

import { SwarmSection } from "@/components/command/settings/SwarmSection";

const BASE_CONFIG = {
  video: { wfb: { fleet_slot: 4 } },
  swarm: {
    enabled: true,
    role: "member",
    mode: "hold",
    default_formation: "column",
    default_spacing: 5,
    flock: {
      cohesion: 40,
      alignment: 60,
      separation_gain: 150,
      radius_m: 30,
      neighbors: 7,
    },
    separation: { radius_m: 8, hard_m: 4 },
    tasks: {
      enabled: true,
      assigned_task_id: "survey-cell-12",
      bundle_position: 2,
    },
  },
};

afterEach(() => vi.restoreAllMocks());

/** Type into the int field named `label` and press ITS Apply — the page has
 * several, and clicking the wrong one is a test bug that looks like a
 * product bug. */
function editAndApply(label: string, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.click(within(input.parentElement as HTMLElement).getByText("Apply"));
}

function renderSection(config: Record<string, unknown> | null = BASE_CONFIG) {
  const setValue = vi.fn(async () => {});
  const utils = renderWithIntl(
    <SwarmSection config={config} readOnly={false} setValue={setValue} />,
  );
  return { setValue, utils };
}

describe("SwarmSection gate and honesty", () => {
  it("renders nothing for a node whose config advertises no swarm block", () => {
    const { utils } = renderSection({ video: {} });
    expect(utils.container.innerHTML).toBe("");
  });

  it("keeps the runtime notice honest about what Enabled + GUIDED gate", () => {
    renderSection();
    expect(
      screen.getByText(/commands the flight controller only while Enabled is on/),
    ).toBeTruthy();
  });
});

describe("SwarmSection identity", () => {
  it("reports the fleet-assigned slot read-only", () => {
    renderSection();
    expect(screen.getByText("Slot 4")).toBeTruthy();
    expect(screen.queryByLabelText("Fleet slot")).toBeNull();
  });
});

describe("SwarmSection formation", () => {
  it("offers exactly the five built-ins and no free-text box", () => {
    renderSection();
    fireEvent.click(screen.getByLabelText("Default formation"));
    for (const label of ["Line", "Column", "Wedge", "Grid", "Circle"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText("Diamond")).toBeNull();
  });

  it("writes the picked formation through the shared config writer", async () => {
    const { setValue } = renderSection();
    fireEvent.click(screen.getByLabelText("Default formation"));
    fireEvent.click(screen.getByText("Wedge"));
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith(
        "swarm.default_formation",
        "wedge",
      ),
    );
  });
});

describe("SwarmSection flocking disclosure", () => {
  it("keeps the gains collapsed until the operator asks for them", () => {
    renderSection();
    expect(screen.queryByLabelText("Cohesion gain (%)")).toBeNull();
    fireEvent.click(screen.getByText("Advanced parameters"));
    expect(screen.getByLabelText("Cohesion gain (%)")).toBeTruthy();
    expect(screen.getByLabelText("Alignment gain (%)")).toBeTruthy();
    expect(screen.getByLabelText("Separation gain (%)")).toBeTruthy();
    expect(screen.getByLabelText("Flocking radius (m)")).toBeTruthy();
    expect(screen.getByLabelText("Weighted neighbours")).toBeTruthy();
  });

  it("states the float weight each stored percent will apply as", () => {
    renderSection();
    fireEvent.click(screen.getByText("Advanced parameters"));
    expect(screen.getByText(/Applies as 0\.40\./)).toBeTruthy();
    expect(screen.getByText(/Applies as 0\.60\./)).toBeTruthy();
    expect(screen.getByText(/Applies as 1\.50\./)).toBeTruthy();
  });

  it("writes a gain as the integer percent, not the float", async () => {
    const { setValue } = renderSection();
    fireEvent.click(screen.getByText("Advanced parameters"));
    editAndApply("Cohesion gain (%)", "85");
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith("swarm.flock.cohesion", "85"),
    );
  });
});

describe("SwarmSection separation gate", () => {
  it("holds a safety-envelope write behind a confirm and applies it on accept", async () => {
    const { setValue } = renderSection();
    editAndApply("Repulsion radius (m)", "12");

    // Nothing written yet — the dialog is the gate, not a notification.
    expect(setValue).not.toHaveBeenCalled();
    expect(screen.getByText("Change the separation envelope?")).toBeTruthy();

    fireEvent.click(screen.getByText("Change it"));
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith("swarm.separation.radius_m", "12"),
    );
  });

  it("writes nothing when the operator cancels the confirm", () => {
    const { setValue } = renderSection();
    editAndApply("Hard floor (m)", "2");
    fireEvent.click(screen.getByText("Cancel"));
    expect(setValue).not.toHaveBeenCalled();
  });
});

describe("SwarmSection task allocation", () => {
  it("reports the current assignment read-only and exposes no bid internals", () => {
    renderSection();
    // Scope to each read-only row: the precedence ladder also renders a "2".
    const row = (label: string) =>
      screen.getByText(label).closest(".items-baseline") as HTMLElement;
    expect(within(row("Assigned task")).getByText("survey-cell-12")).toBeTruthy();
    expect(within(row("Bundle position")).getByText("2")).toBeTruthy();
    // Reported, never typed — and no bid vector, score or bundle listing.
    expect(within(row("Assigned task")).queryByRole("textbox")).toBeNull();
    expect(within(row("Bundle position")).queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/bid vector|bid score/i)).toBeNull();
  });
});

describe("SwarmSection mode precedence", () => {
  it("renders the ladder highest-authority first and offers no control", () => {
    const { utils } = renderSection();
    const items = [...utils.container.querySelectorAll("ol li")].map((li) =>
      li.textContent?.replace(/^\d/, "").trim(),
    );
    expect(items).toEqual([
      "Hard separation — a neighbour inside the hard floor",
      "Operator direct command",
      "Formation",
      "Flocking",
      "Hold",
    ]);
    expect(utils.container.querySelectorAll("ol input")).toHaveLength(0);
  });
});
