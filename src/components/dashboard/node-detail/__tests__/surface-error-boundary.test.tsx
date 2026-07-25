/**
 * @module surface-error-boundary.test
 * @description Guards that a node-detail surface which throws during render is
 * contained: the boundary renders its fallback instead of letting the error
 * unwind to the route-level boundary and blank the whole console. Also guards
 * the reset paths, since a fallback pinned over a healthy surface would be its
 * own defect.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SurfaceErrorBoundary } from "@/components/dashboard/node-detail/SurfaceErrorBoundary";

function Boom(): never {
  throw new Error("surface exploded");
}

function Healthy() {
  return <p>healthy surface</p>;
}

const MESSAGE = "This view failed to render.";
const RETRY = "Try again";

describe("SurfaceErrorBoundary", () => {
  beforeEach(() => {
    // React logs the caught error; silence it so the run stays readable.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children untouched while nothing throws", () => {
    render(
      <SurfaceErrorBoundary message={MESSAGE} retryLabel={RETRY}>
        <Healthy />
      </SurfaceErrorBoundary>,
    );
    expect(screen.getByText("healthy surface")).toBeTruthy();
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it("contains a throwing surface and shows the fallback instead of rethrowing", () => {
    expect(() =>
      render(
        <SurfaceErrorBoundary message={MESSAGE} retryLabel={RETRY}>
          <Boom />
        </SurfaceErrorBoundary>,
      ),
    ).not.toThrow();

    expect(screen.getByText(MESSAGE)).toBeTruthy();
    expect(screen.getByRole("button", { name: RETRY })).toBeTruthy();
  });

  it("clears the fallback when the retry control is pressed", () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error("surface exploded");
      return <p>healthy surface</p>;
    }

    render(
      <SurfaceErrorBoundary message={MESSAGE} retryLabel={RETRY}>
        <Flaky />
      </SurfaceErrorBoundary>,
    );
    expect(screen.getByText(MESSAGE)).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: RETRY }));

    expect(screen.getByText("healthy surface")).toBeTruthy();
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it("clears the fallback when the key changes, so switching tabs recovers", () => {
    const { rerender } = render(
      <SurfaceErrorBoundary key="radio" message={MESSAGE} retryLabel={RETRY}>
        <Boom />
      </SurfaceErrorBoundary>,
    );
    expect(screen.getByText(MESSAGE)).toBeTruthy();

    // A different key remounts the boundary, which is how the panel drops a
    // caught error when the operator moves to another tab.
    rerender(
      <SurfaceErrorBoundary key="overview" message={MESSAGE} retryLabel={RETRY}>
        <Healthy />
      </SurfaceErrorBoundary>,
    );

    expect(screen.getByText("healthy surface")).toBeTruthy();
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });
});
