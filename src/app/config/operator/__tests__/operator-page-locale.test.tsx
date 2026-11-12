/**
 * @license GPL-3.0-only
 *
 * Settings › Operator & Aircraft: the page header reads in the operator's
 * language.
 */

import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";

import de from "../../../../../locales/de.json";

vi.mock("@/components/config/operator/OperatorProfileEditor", () => ({ OperatorProfileEditor: () => null }));
vi.mock("@/components/config/operator/AircraftRegistryEditor", () => ({ AircraftRegistryEditor: () => null }));
vi.mock("@/components/config/operator/BatteryRegistryEditor", () => ({ BatteryRegistryEditor: () => null }));
vi.mock("@/components/config/operator/EquipmentRegistryEditor", () => ({ EquipmentRegistryEditor: () => null }));

import OperatorPage from "../page";

describe("Operator page · locale", () => {
  it("renders the German header", () => {
    render(
      <NextIntlClientProvider locale="de" messages={de}>
        <OperatorPage />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Betreiber & Luftfahrzeuge" })).toBeInTheDocument();
    expect(screen.getByText(de.operatorRegistry.pageBlurb)).toBeInTheDocument();
  });
});
