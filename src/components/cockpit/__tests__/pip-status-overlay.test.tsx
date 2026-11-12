/**
 * @license GPL-3.0-only
 *
 * The picture-in-picture inset's not-live states read the shared spec words:
 * reconnecting (`cockpit.pip.reconnecting`), connecting, and no signal with a
 * Retry.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/cockpit/spec-strings", async (orig) => ({
  ...(await orig<typeof import("@/lib/cockpit/spec-strings")>()),
  specString: (key: string) => `<${key}>`,
}));

import { PipStatusOverlay } from "../PipStatusOverlay";

afterEach(cleanup);

describe("PiP inset status", () => {
  it("reads the spec reconnecting text while the leg is lost", () => {
    render(<PipStatusOverlay status="lost" onRetry={() => {}} />);
    expect(screen.getByText("<cockpit.pip.reconnecting>")).toBeTruthy();
    expect(screen.getByLabelText("<cockpit.pip.reconnecting>")).toBeTruthy();
  });

  it("offers Retry on no signal", () => {
    const retry = vi.fn();
    render(<PipStatusOverlay status="error" onRetry={retry} />);
    expect(screen.getByText("<cockpit.pip.no_signal>")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("<video.state.retry>"));
    expect(retry).toHaveBeenCalled();
  });

  it("names connecting while it connects", () => {
    render(<PipStatusOverlay status="connecting" onRetry={() => {}} />);
    expect(screen.getByLabelText("<cockpit.pip.connecting>")).toBeTruthy();
  });
});
