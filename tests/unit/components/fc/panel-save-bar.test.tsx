/**
 * The shared parameter-panel save bar: panel gating passes through, and the
 * Write to Flash button is busy and inert while a commit is in flight.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "../../../helpers/intl-wrapper";
import { PanelSaveBar } from "@/components/fc/shared/PanelSaveBar";
import messages from "../../../../locales/en.json";

const bar = messages.panelCommit.bar;

describe("PanelSaveBar", () => {
  it("passes the panel's gating and hints through", () => {
    const onSave = vi.fn();
    renderWithIntl(
      <PanelSaveBar onSave={onSave} saving={false} saveDisabled={false} onRevert={vi.fn()} revertDisabled
        showFlash={false} onFlash={vi.fn()} showConnectHint={false} showUnsavedHint />,
    );
    fireEvent.click(screen.getByRole("button", { name: bar.saveToFc }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: bar.revert })).toBeDisabled();
    expect(screen.queryByRole("button", { name: bar.writeToFlash })).toBeNull();
    expect(screen.getByText(bar.unsavedChanges)).toBeDefined();
    expect(screen.queryByText(bar.connectToSave)).toBeNull();
  });

  it("disables Write to Flash while the commit is in flight", () => {
    const onFlash = vi.fn();
    renderWithIntl(
      <PanelSaveBar onSave={vi.fn()} saving={false} saveDisabled showFlash onFlash={onFlash} flashing />,
    );
    const flash = screen.getByRole("button", { name: bar.writeToFlash });
    expect(flash).toBeDisabled();
    expect(flash.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(flash);
    expect(onFlash).not.toHaveBeenCalled();
  });
});
