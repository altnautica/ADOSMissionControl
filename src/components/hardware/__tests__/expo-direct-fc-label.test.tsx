/**
 * @license GPL-3.0-only
 *
 * The expo slider shapes only the sticks sent straight to the flight
 * controller. With the onboard pilot flying, the speed profile's curve
 * applies, so the slider says so, in the shared spec's words.
 */

import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";

import en from "../../../../locales/en.json";
import { specString } from "@/lib/cockpit/spec-strings";
import { ControllersSection } from "@/components/hardware/ControllersSection";

describe("Settings › Input · expo slider", () => {
  it("is labelled as applying to the direct flight-controller route only", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ControllersSection />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Stick expo (direct flight controller only)")).toBeInTheDocument();
    const hint = screen.getByTestId("expo-route-hint").textContent;
    expect(hint).toBe(specString("controls.expo_direct_only_summary"));
    expect(hint).toMatch(/speed profile/);
  });
});
