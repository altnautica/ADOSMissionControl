/**
 * The disclaimer gate scrolls on a short window instead of clipping its title
 * and Accept button off both ends.
 *
 * @license GPL-3.0-only
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("../steps/DisclaimerBody", () => ({ DisclaimerBody: () => <div /> }));

import { useSettingsStore } from "@/stores/settings-store";
import { DisclaimerGate } from "../DisclaimerGate";

describe("DisclaimerGate on a short window", () => {
  it("scrolls and keeps the top of the content reachable", () => {
    useSettingsStore.setState({ _hasHydrated: true, onboarded: true, disclaimerAccepted: false, disclaimerVersion: 0 });
    render(<DisclaimerGate />);
    const gate = screen.getByRole("dialog");
    expect(gate.className).toContain("overflow-y-auto");
    expect(gate.className).not.toContain("overflow-hidden");
    expect(gate.className).toContain("[justify-content:safe_center]");
    expect(gate.className).not.toMatch(/(^|\s)justify-center(\s|$)/);
  });
});
