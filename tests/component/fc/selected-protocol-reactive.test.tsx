/**
 * An FC panel follows the drone manager's selection: a connect after mount
 * offers the read, and the read goes to the drone connected at click time.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../../helpers/intl-wrapper";
import { selectTestProtocol } from "../../helpers/selected-drone";
import { ControlProfilePanel } from "@/components/fc/inav/ControlProfilePanel";

afterEach(() => selectTestProtocol(null));

describe("FC panel selection", () => {
  it("offers the read once a drone connects after the panel mounted", async () => {
    selectTestProtocol(null);
    renderWithIntl(<ControlProfilePanel />);
    expect(screen.queryByRole("button", { name: /read/i })).toBeNull();

    const getActiveProfiles = vi.fn(async () => ({ controlProfile: 1, batteryProfile: 0, mixerProfile: 0 }));
    act(() => selectTestProtocol({ getActiveProfiles }));

    fireEvent.click(screen.getByRole("button", { name: /read/i }));
    await waitFor(() => expect(getActiveProfiles).toHaveBeenCalledTimes(1));
  });

  it("drops the read controls when the drone disconnects", () => {
    selectTestProtocol({ getActiveProfiles: vi.fn() });
    renderWithIntl(<ControlProfilePanel />);
    expect(screen.getByRole("button", { name: /read/i })).toBeTruthy();

    act(() => selectTestProtocol(null));
    expect(screen.queryByRole("button", { name: /read/i })).toBeNull();
  });
});
