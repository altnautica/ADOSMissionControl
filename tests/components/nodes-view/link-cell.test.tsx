/**
 * The board's link column, rendered against the real English catalogue.
 *
 * The cell falls back to the coarse link state when the node reports no
 * diagnosis, so this is one of the places a transmitting-but-unproven link can
 * quietly render as unremarkable. It must not: an operator scanning the board
 * has to be able to see the difference between a link that works and one that
 * has only ever been assumed to.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { renderWithIntl } from "../../helpers/intl-wrapper";
import { LinkCell } from "@/components/command/nodes-view/LinkCell";
import { normalizeRadio } from "@/stores/agent-capabilities/normalizer";
import type { RadioLinkState } from "@/lib/api/ground-station/types";

afterEach(cleanup);

/** A radio snapshot in one coarse state, with no diagnosis to prefer over it. */
function radioIn(state: RadioLinkState) {
  return normalizeRadio({ state, rssiDbm: -52 })!;
}

describe("LinkCell coarse-state fallback", () => {
  it("labels a transmitting-but-unproven link instead of showing a raw key", () => {
    renderWithIntl(<LinkCell radio={radioIn("rf_unverified")} freshness="fresh" />);
    expect(screen.getByText("Transmitting, unverified")).toBeDefined();
  });

  it("colours it as a warning, not as neutral and not as healthy", () => {
    const { container } = renderWithIntl(
      <LinkCell radio={radioIn("rf_unverified")} freshness="fresh" />,
    );
    const chip = container.querySelector("[title]");
    expect(chip).not.toBeNull();
    expect(chip!.className).toContain("status-warning");
    expect(chip!.className).not.toContain("status-success");
    expect(chip!.className).not.toContain("text-text-tertiary");
  });

  it("keeps a connected link reading as healthy", () => {
    const { container } = renderWithIntl(
      <LinkCell radio={radioIn("connected")} freshness="fresh" />,
    );
    expect(container.querySelector("[title]")!.className).toContain(
      "status-success",
    );
  });

  it("prefers the node's own diagnosis over the coarse state when it has one", () => {
    const radio = normalizeRadio({ state: "rf_unverified", linkDiag: "deaf" })!;
    renderWithIntl(<LinkCell radio={radio} freshness="fresh" />);
    expect(screen.queryByText("Transmitting, unverified")).toBeNull();
    expect(screen.getByText("Deaf (no RF seen)")).toBeDefined();
  });

  it("shows nothing rather than a state when the node is not being heard", () => {
    renderWithIntl(<LinkCell radio={radioIn("rf_unverified")} freshness="none" />);
    expect(screen.queryByText("Transmitting, unverified")).toBeNull();
    expect(screen.getByText("—")).toBeDefined();
  });
});
