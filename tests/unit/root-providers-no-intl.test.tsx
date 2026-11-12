/**
 * The Convex provider and the global error page render outside the locale
 * provider (the root layout wraps the locale provider in the Convex one, and
 * the global error page replaces the root layout). A translation hook there
 * throws and takes every route down, so both must render without one: in
 * local-only mode and with a backend configured (which mounts the auth
 * provider and the auth bridge).
 */

import type { ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ConvexReactClient } from "convex/react";

// The auth provider talks to the backend's auth routes; stand in with Convex's
// own auth context, signed out, so the auth bridge runs its real hooks.
// (A hoisted mock factory cannot see top-level imports, hence the import here.)
vi.mock("@convex-dev/auth/nextjs", async () => {
  const { ConvexProviderWithAuth } = await import("convex/react");
  const useAuth = () => ({
    isLoading: false,
    isAuthenticated: false,
    fetchAccessToken: async () => null,
  });
  return {
    ConvexAuthNextjsProvider: ({
      client,
      children,
    }: {
      client: ConvexReactClient;
      children: ReactNode;
    }) => (
      <ConvexProviderWithAuth client={client} useAuth={useAuth}>
        {children}
      </ConvexProviderWithAuth>
    ),
  };
});

import ConvexClientProvider from "@/app/ConvexClientProvider";
import GlobalError from "@/app/global-error";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A socket that never connects: the client is built but never reaches out. */
class InertWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = 0;
  onopen = null;
  onclose = null;
  onerror = null;
  onmessage = null;
  send() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

describe("root providers without an intl context", () => {
  it("renders the Convex provider's children in local-only mode", () => {
    render(
      <ConvexClientProvider>
        <p>child</p>
      </ConvexClientProvider>,
    );
    expect(screen.getByText("child")).toBeTruthy();
  });

  it("renders the Convex provider's children and its auth bridge with a backend configured", async () => {
    // The backend address is read when the module loads, so the provider is
    // imported again after the stub.
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://ados-test.invalid");
    vi.stubGlobal("WebSocket", InertWebSocket);
    vi.resetModules();
    const { default: Provider } = await import("@/app/ConvexClientProvider");
    // The auth bridge sits in a boundary that only warns, so a hook throwing
    // there shows up as that warning.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <Provider>
        <p>child</p>
      </Provider>,
    );
    expect(screen.getByText("child")).toBeTruthy();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("auth-bridge"))).toEqual([]);
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
