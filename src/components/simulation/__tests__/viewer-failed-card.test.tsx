/**
 * @license GPL-3.0-only
 *
 * A 3D view that failed to start says so in words, keeps the raw error as a
 * detail line, and offers Retry and the surface's way out.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { ViewerFailedCard } from "../ViewerFailedCard";

afterEach(cleanup);

describe("ViewerFailedCard", () => {
  it("says the 3D view is unavailable, keeps the raw error as detail, and offers Retry and the way out", () => {
    const onRetry = vi.fn();
    const onFallback = vi.fn();
    renderWithIntl(
      <ViewerFailedCard
        message="WebGL is not supported"
        onRetry={onRetry}
        fallback={{ label: "Switch to 2D", onClick: onFallback }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("3D view is unavailable on this device");
    expect(screen.getByText("WebGL is not supported")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch to 2D" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });
});
