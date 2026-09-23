/**
 * @license GPL-3.0-only
 *
 * A viewer whose code chunk fails to load (a stale tab after a redeploy)
 * shows the viewer's error overlay in place, and the surrounding view keeps
 * rendering, instead of the error escaping to the route boundary.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../locales/en.json";

// Every dynamic viewer resolves to a component that throws the way a failed
// chunk import surfaces during render.
vi.mock("next/dynamic", () => ({
  default: () =>
    function FailedChunk(): never {
      throw new Error("ChunkLoadError: Loading chunk failed");
    },
}));

import { WorldModelViewport } from "@/components/atlas/WorldModelViewport";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorldModelViewport chunk failure", () => {
  it("renders the viewer error overlay and keeps the surrounding view", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <p>drone view</p>
        <WorldModelViewport viewer="splat" artifactUrl="https://example.com/world.splat" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Could not load the splat world model.")).toBeTruthy();
    expect(screen.getByText("drone view")).toBeTruthy();
  });
});
