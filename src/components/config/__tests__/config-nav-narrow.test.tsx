/**
 * @license GPL-3.0-only
 *
 * Below md the config nav is a full-width tab strip above the content rather
 * than a fixed 200 px column, and marks the current page.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../tests/helpers/intl-wrapper";
import { ConfigNav } from "../ConfigNav";
import ConfigLayout from "@/app/config/layout";

vi.mock("next/navigation", () => ({ usePathname: () => "/config/theme" }));

describe("ConfigNav at narrow widths", () => {
  it("is a full-width strip below md and the side column from md", () => {
    render(<ConfigNav />, { wrapper: IntlWrapper });
    const nav = screen.getByRole("navigation");
    expect(nav.className).toMatch(/(^| )w-full( |$)/);
    expect(nav.className).toContain("md:w-[200px]");
    expect(nav.className).not.toMatch(/(^| )w-\[200px\]/);
    expect(screen.getByRole("link", { current: "page" }).getAttribute("href")).toBe("/config/theme");
  });

  it("stacks the nav above the content below md", () => {
    const { container } = render(<ConfigLayout><p>body</p></ConfigLayout>, { wrapper: IntlWrapper });
    expect((container.firstChild as HTMLElement).className).toContain("flex-col md:flex-row");
  });
});
