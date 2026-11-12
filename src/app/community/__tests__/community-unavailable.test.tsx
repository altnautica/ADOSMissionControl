/**
 * A build without a cloud backend tells the operator which variable to set,
 * in a complete sentence, and every locale translates the section error.
 *
 * @license GPL-3.0-only
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../locales/en.json";

vi.mock("next/navigation", () => ({ usePathname: () => "/community/changelog" }));
vi.mock("@/hooks/use-convex-available", () => ({ useConvexAvailable: () => false }));

import CommunityLayout from "../layout";

afterEach(cleanup);

describe("community without a cloud backend", () => {
  it("names the environment variable and does not promise a roadmap", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <CommunityLayout>body</CommunityLayout>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/NEXT_PUBLIC_CONVEX_URL\.$/)).toBeTruthy();
    expect(container.textContent?.toLowerCase()).not.toContain("roadmap");
  });

  it("every locale names the variable and translates the section error", () => {
    const dir = join(__dirname, "../../../../locales");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "en.json")) {
      const nav = JSON.parse(readFileSync(join(dir, file), "utf8")).communityNav;
      expect(nav.unavailableSetup, file).toContain("{envVar}");
      expect(nav.sectionError, file).not.toBe(messages.communityNav.sectionError);
    }
  });
});
