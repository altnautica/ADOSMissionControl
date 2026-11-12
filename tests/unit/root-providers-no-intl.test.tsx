/**
 * The Convex provider and the global error page render outside the locale
 * provider (the root layout wraps the locale provider in the Convex one, and
 * the global error page replaces the root layout). A translation hook there
 * throws and takes every route down, so both must render without one.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@convex-dev/auth/react", () => ({
  ConvexAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ConvexClientProvider from "@/app/ConvexClientProvider";
import GlobalError from "@/app/global-error";

describe("root providers without an intl context", () => {
  it("renders the Convex provider's children", () => {
    render(
      <ConvexClientProvider>
        <p>child</p>
      </ConvexClientProvider>,
    );
    expect(screen.getByText("child")).toBeTruthy();
  });

  it("renders the global error page", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getByText } = render(<GlobalError error={new Error("boom")} reset={() => {}} />, {
      container: document.createElement("div"),
    });
    spy.mockRestore();
    expect(getByText(/something went wrong/i)).toBeTruthy();
  });
});
