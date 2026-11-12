/**
 * @license GPL-3.0-only
 *
 * Settings › Controls: "Reset to ADOS default" only loads the default into the
 * draft (Save keeps it, Cancel restores the saved table); Replay tour and
 * Reset tips confirm with a toast; the lightbar test reads platform support
 * after mount so the server markup does not depend on it.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IntlWrapper, renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { ControlsSettings } from "../ControlsSettings";
import { ReplayTourRow, TestRow } from "../ControlsSettingsCards";
import { GeneralSection } from "../GeneralSection";
import { effectiveBindings, useControlsStore } from "@/stores/controls-store";
import * as ds4Feedback from "@/lib/input/ds4-feedback";

const toast = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/input/ds4-feedback", async (orig) => ({
  ...(await orig<typeof ds4Feedback>()),
  lightbarSupported: () => true,
}));

afterEach(() => {
  cleanup();
  toast.mockClear();
  useControlsStore.setState({ bindings: null, tourSeen: false });
});

describe("Reset to ADOS default", () => {
  it("changes only the draft; Cancel restores the saved bindings", () => {
    const custom = effectiveBindings({ bindings: null }).slice(0, -1);
    useControlsStore.setState({ bindings: custom });
    renderWithIntl(<ControlsSettings />);
    fireEvent.click(screen.getByTestId("controls-reset"));
    expect(useControlsStore.getState().bindings).toEqual(custom);
    expect((screen.getByTestId("controls-save") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("controls-cancel"));
    expect(useControlsStore.getState().bindings).toEqual(custom);
    expect((screen.getByTestId("controls-save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Save after reset stores the ADOS default profile", () => {
    useControlsStore.setState({ bindings: effectiveBindings({ bindings: null }).slice(0, -1) });
    renderWithIntl(<ControlsSettings />);
    fireEvent.click(screen.getByTestId("controls-reset"));
    fireEvent.click(screen.getByTestId("controls-save"));
    expect(useControlsStore.getState().bindings).toBeNull();
  });
});

describe("confirmation toasts", () => {
  it("Replay controller tour confirms", () => {
    renderWithIntl(<ReplayTourRow />);
    fireEvent.click(screen.getByTestId("controls-tour-replay"));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("controller tour"), "success");
  });

  it("Reset tips confirms", () => {
    renderWithIntl(<GeneralSection />);
    fireEvent.click(screen.getByTestId("reset-tips"));
    expect(toast).toHaveBeenCalledWith("Tips will show again.", "success");
  });
});

describe("lightbar test", () => {
  it("renders disabled on the server and enables after mount where supported", () => {
    const html = renderToString(<IntlWrapper><TestRow /></IntlWrapper>);
    expect(html).toMatch(/<button[^>]*disabled[^>]*title="[^"]*lightbar/i);
    renderWithIntl(<TestRow />);
    expect((screen.getByRole("button", { name: "Lightbar" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
