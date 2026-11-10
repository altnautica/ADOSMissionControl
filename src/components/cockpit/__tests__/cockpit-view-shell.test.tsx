/**
 * @license GPL-3.0-only
 *
 * The flight screen's shell: the built-in flight column (Take off / Land,
 * RTH, Pause) stays on screen with the optional skill layer off, and the
 * page underneath the full-viewport flight screen leaves the tab order while
 * it is up, with the overlays above it (confirm sheets, toasts) left usable.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { CockpitView } from "@/components/cockpit/CockpitView";
import { useCockpitStore } from "@/stores/cockpit-store";

afterEach(() => {
  cleanup();
  useCockpitStore.getState().setEnabled(true);
});

describe("flight screen shell", () => {
  it("keeps Pause, RTH and Take off on screen with the skill layer off", () => {
    useCockpitStore.getState().setEnabled(false);
    renderWithIntl(<CockpitView droneId="shell-drone" />);
    const col = screen.getByTestId("left-column");
    expect(col.querySelector("[aria-label='Pause (brake)']")).not.toBeNull();
    expect(col.querySelector("[aria-label='Return home']")).not.toBeNull();
    expect(col.querySelector("[aria-label='Take off']")).not.toBeNull();
  });

  it("makes the hidden page inert while it is up, and restores it on exit", () => {
    const header = document.createElement("header");
    header.innerHTML = "<button>Fly another drone</button>";
    const toast = document.createElement("div");
    toast.style.position = "fixed";
    document.body.append(header, toast);
    const preInert = document.createElement("nav");
    preInert.setAttribute("inert", "");
    document.body.append(preInert);

    const { unmount } = renderWithIntl(<CockpitView droneId="shell-drone" />);
    expect(header.hasAttribute("inert")).toBe(true);
    expect(toast.hasAttribute("inert")).toBe(false);
    expect(screen.getByTestId("flight-screen").closest("[inert]")).toBeNull();

    unmount();
    expect(header.hasAttribute("inert")).toBe(false);
    expect(preInert.hasAttribute("inert")).toBe(true);
    header.remove();
    toast.remove();
    preInert.remove();
  });

  it("makes a banner that mounts mid-flight inert too, and restores it on exit", async () => {
    const { unmount } = renderWithIntl(<CockpitView droneId="shell-drone" />);
    const frame = screen.getByTestId("flight-screen");
    const column = frame.parentElement as HTMLElement;
    const banner = document.createElement("div");
    banner.innerHTML = "<button>Dismiss</button>";
    column.prepend(banner);
    const late = document.createElement("aside");
    document.body.append(late);
    await Promise.resolve();
    expect(banner.hasAttribute("inert")).toBe(true);
    expect(late.hasAttribute("inert")).toBe(true);
    expect(frame.closest("[inert]")).toBeNull();

    unmount();
    expect(banner.hasAttribute("inert")).toBe(false);
    expect(late.hasAttribute("inert")).toBe(false);
    late.remove();
  });
});
