/**
 * @license GPL-3.0-only
 *
 * The About block renders in the browser build too: app version and the
 * third-party licences link. The update check stays desktop-only.
 */

import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";

import messages from "../../../../locales/en.json";
import { APP_VERSION } from "@/lib/app-version";
import { AboutSection } from "../AboutSection";

vi.mock("@/hooks/use-platform", () => ({ usePlatform: () => ({ isElectron: false }) }));

describe("AboutSection · web build", () => {
  it("shows the version and the licences link without the update check", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AboutSection />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(`Version ${APP_VERSION}`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Third-party licences" })).toHaveAttribute("href", expect.stringContaining("dependencies"));
    expect(screen.queryByRole("button", { name: "Check for updates" })).toBeNull();
  });
});
