/**
 * Tests for the node Settings "Swarm" page: the capability gate (renders only
 * when the node's config surface advertises the swarm block) and the
 * config-writer binding of the participation switch and the stored
 * coordination fields.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

import { SwarmSection } from "@/components/command/settings/SwarmSection";

afterEach(() => {
  vi.restoreAllMocks();
});

const SWARM_CONFIG = {
  swarm: {
    enabled: false,
    role: "auto",
    default_formation: "line",
    default_spacing: 10,
  },
};

function renderSection(config: Record<string, unknown> | null) {
  const setValue = vi.fn(async () => {});
  const utils = renderWithIntl(
    <SwarmSection config={config} readOnly={false} setValue={setValue} />,
  );
  return { setValue, utils };
}

describe("SwarmSection capability gate", () => {
  it("renders nothing when the node does not advertise the block", () => {
    const { utils } = renderSection({});
    expect(utils.container.innerHTML).toBe("");
  });

  it("renders nothing while the config has not loaded", () => {
    const { utils } = renderSection(null);
    expect(utils.container.innerHTML).toBe("");
  });
});

describe("SwarmSection fields", () => {
  it("renders the stored values from the node's own config", () => {
    renderSection(SWARM_CONFIG);
    expect(screen.getByText("Swarm")).toBeTruthy();
    expect(screen.getByDisplayValue("auto")).toBeTruthy();
    expect(screen.getByDisplayValue("line")).toBeTruthy();
    expect(screen.getByDisplayValue("10")).toBeTruthy();
  });

  it("writes the participation switch through the shared config writer", async () => {
    const { setValue } = renderSection(SWARM_CONFIG);
    fireEvent.click(screen.getByText("Enable swarm participation"));
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith("swarm.enabled", "true"),
    );
  });

  it("rejects an out-of-range spacing before any write", async () => {
    const { setValue } = renderSection(SWARM_CONFIG);
    const input = screen.getByLabelText("Default spacing (m)");
    fireEvent.change(input, { target: { value: "0" } });
    expect(await screen.findByText(/between 1 and 1000/)).toBeTruthy();
    expect(setValue).not.toHaveBeenCalled();
  });
});
