/**
 * SilentErrorBoundary recovery: a boundary that outlives its children (a
 * layout) must render them again once its reset key changes, instead of
 * staying on the fallback until a full reload.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SilentErrorBoundary } from "../SilentErrorBoundary";

function Page({ broken }: { broken: boolean }) {
  if (broken) throw new Error("render failed");
  return <p>page content</p>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SilentErrorBoundary", () => {
  it("shows the fallback, then renders the next route once the reset key changes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender } = render(
      <SilentErrorBoundary resetKey="/community/changelog" fallback={<p>failed</p>}>
        <Page broken />
      </SilentErrorBoundary>,
    );
    expect(screen.getByText("failed")).toBeTruthy();

    rerender(
      <SilentErrorBoundary resetKey="/community/contact" fallback={<p>failed</p>}>
        <Page broken={false} />
      </SilentErrorBoundary>,
    );
    expect(screen.getByText("page content")).toBeTruthy();
    expect(screen.queryByText("failed")).toBeNull();
  });

  it("stays on the fallback while the reset key is unchanged", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender } = render(
      <SilentErrorBoundary resetKey="/a" fallback={<p>failed</p>}>
        <Page broken />
      </SilentErrorBoundary>,
    );
    rerender(
      <SilentErrorBoundary resetKey="/a" fallback={<p>failed</p>}>
        <Page broken={false} />
      </SilentErrorBoundary>,
    );
    expect(screen.getByText("failed")).toBeTruthy();
  });
});
