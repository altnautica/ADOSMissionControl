/**
 * Render test for the reusable LinkUpPlaceholder: each variant shows its
 * headline + the right CTA, and copy interpolates the last-seen value.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../helpers/intl-wrapper";
import { LinkUpPlaceholder } from "@/components/shared/link-up/LinkUpPlaceholder";

describe("LinkUpPlaceholder", () => {
  it("agent-offline: shows the offline headline, last-seen, and Reconnect", () => {
    renderWithIntl(
      <LinkUpPlaceholder variant="agent-offline" lastSeenLabel="12s ago" />,
    );
    expect(screen.getByText(/agent offline/i)).toBeTruthy();
    expect(screen.getByText(/12s ago/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /reconnect/i })).toBeTruthy();
  });

  it("stale-pairing: offers Re-pair + Remove and never the USB connect prompt", () => {
    renderWithIntl(
      <LinkUpPlaceholder
        variant="stale-pairing"
        onPrimary={() => {}}
        onSecondary={() => {}}
      />,
    );
    expect(screen.getByText(/needs re-pairing/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /re-pair node/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /remove node/i })).toBeTruthy();
    // The misleading "connect a flight controller" CTA must be gone here.
    expect(
      screen.queryByRole("button", { name: /connect flight controller/i }),
    ).toBeNull();
  });
});
