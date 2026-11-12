/**
 * @license GPL-3.0-only
 *
 * Every alert switch, preview button and the volume slider has an accessible
 * name.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../tests/helpers/intl-wrapper";
import { NotificationsSection } from "../NotificationsSection";
import { useSettingsStore } from "@/stores/settings-store";

describe("NotificationsSection accessibility", () => {
  it("names the alert switches, preview buttons and volume slider", () => {
    useSettingsStore.setState({ audioEnabled: true });
    render(<NotificationsSection />, { wrapper: IntlWrapper });
    const switches = screen.getAllByRole("switch");
    expect(switches.length).toBeGreaterThanOrEqual(7);
    for (const s of switches) expect(s.getAttribute("aria-label")).toBeTruthy();
    expect(screen.getByRole("slider").getAttribute("aria-label")).toMatch(/\d+/);
    const previews = screen.getAllByRole("button").filter((b) => b.getAttribute("title"));
    for (const b of previews) expect(b.getAttribute("aria-label")).toBe(b.getAttribute("title"));
  });
});
