/**
 * Tab stays inside the onboarding wizard's visible step and inside the
 * disclaimer gate: off-screen steps are inert and focus wraps at the edges
 * instead of reaching the shell behind.
 *
 * @license GPL-3.0-only
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("../steps/DisclaimerBody", () => ({ DisclaimerBody: () => <div /> }));
// vi.mock factories are hoisted above the imports, so React loads here.
const { stepStub } = vi.hoisted(() => ({
  stepStub: (name: string) => async () => {
    const { createElement } = await import("react");
    return {
      [name]: ({ next }: { next?: () => void }) =>
        createElement("button", { type: "button", onClick: next }, name),
    };
  },
}));
vi.mock("../steps/LanguageStep", stepStub("LanguageStep"));
vi.mock("../steps/IntroStep", stepStub("IntroStep"));
vi.mock("../steps/DisclaimerStep", stepStub("DisclaimerStep"));
vi.mock("../steps/PreferencesStep", stepStub("PreferencesStep"));
vi.mock("../steps/RegionStep", stepStub("RegionStep"));
vi.mock("../steps/ThemeStep", stepStub("ThemeStep"));
vi.mock("../steps/DownloadStep", stepStub("DownloadStep"));
vi.mock("../steps/ReadyStep", stepStub("ReadyStep"));

import { useSettingsStore } from "@/stores/settings-store";
import { WelcomeModal } from "../WelcomeModal";
import { DisclaimerGate } from "../DisclaimerGate";

afterEach(cleanup);

describe("onboarding wizard focus", () => {
  it("makes every step but the current one inert", () => {
    useSettingsStore.setState({ _hasHydrated: true, onboarded: false });
    render(<WelcomeModal />);
    const current = screen.getByRole("button", { name: "LanguageStep" });
    expect(current.closest("[inert]")).toBeNull();
    expect(screen.getByText("IntroStep").closest("[inert]")).not.toBeNull();
    act(() => fireEvent.click(current));
    expect(screen.getByText("IntroStep").closest("[inert]")).toBeNull();
    expect(screen.getByText("LanguageStep").closest("[inert]")).not.toBeNull();
  });

  it("wraps Tab inside the wizard", () => {
    useSettingsStore.setState({ _hasHydrated: true, onboarded: false });
    render(
      <>
        <button type="button">outside</button>
        <WelcomeModal />
      </>,
    );
    const only = screen.getByRole("button", { name: "LanguageStep" });
    only.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(only);
  });
});

describe("disclaimer gate focus", () => {
  it("pulls Tab back from the shell behind into the gate", () => {
    useSettingsStore.setState({ _hasHydrated: true, onboarded: true, disclaimerAccepted: false, disclaimerVersion: 0 });
    render(
      <>
        <button type="button">shell</button>
        <DisclaimerGate />
      </>,
    );
    screen.getByRole("button", { name: "shell" }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });
});
