/**
 * The welcome intro says where the app runs: the browser line in a browser,
 * the desktop line in the desktop app.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../locales/en.json";

const env = vi.hoisted(() => ({ electron: false }));
vi.mock("@/lib/utils", async (orig) => ({
  ...(await orig<typeof import("@/lib/utils")>()),
  isElectron: () => env.electron,
}));

import { IntroStep } from "@/components/onboarding/steps/IntroStep";

function renderStep() {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <IntroStep next={() => {}} back={() => {}} dotStep={0} totalSteps={4} />
    </NextIntlClientProvider>,
  );
}

describe("IntroStep description", () => {
  beforeEach(() => {
    env.electron = false;
  });

  it("uses the desktop line in the desktop app", () => {
    env.electron = true;
    renderStep();
    expect(screen.getByText(en.welcome.intro.descriptionDesktop)).toBeTruthy();
    expect(screen.queryByText(/Runs in your browser/)).toBeNull();
  });

  it("keeps the browser line in a browser", () => {
    renderStep();
    expect(screen.getByText(en.welcome.intro.description)).toBeTruthy();
  });
});
