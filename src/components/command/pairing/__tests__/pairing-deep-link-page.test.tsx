/**
 * @license GPL-3.0-only
 *
 * The pairing deep link: the dialog is a real modal named for what it does,
 * a link's host or code reaches the Add tab, and a code from an earlier visit
 * never reopens on a code-less `/pair`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../../locales/en.json";

let search = new URLSearchParams();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useSearchParams: () => search,
}));
vi.mock("convex/react", () => ({
  useMutation: () => () => new Promise(() => {}),
}));
vi.mock("../../AgentConnectPanel", () => ({
  AgentConnectPanel: () => <div data-testid="tabbed-body" />,
}));
vi.mock("@/components/auth/SignInModal", () => ({ SignInModal: () => null }));

import { ConvexAvailableContext } from "@/hooks/use-convex-available";
import { useAuthStore } from "@/stores/auth-store";
import { usePairDialogStore } from "@/stores/pair-dialog-store";
import { PairingDialog } from "../../PairingDialog";
import PairDeepLinkPage from "@/app/pair/page";

function wrap(node: React.ReactNode, convex = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ConvexAvailableContext.Provider value={convex}>{node}</ConvexAvailableContext.Provider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  search = new URLSearchParams();
  replace.mockClear();
  window.sessionStorage.clear();
  usePairDialogStore.setState({ open: false, prefillHost: null });
  useAuthStore.setState({ isAuthenticated: true, isLoading: false });
});
afterEach(cleanup);

describe("PairingDialog chrome", () => {
  it("is a named modal dialog", () => {
    wrap(<PairingDialog open onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Pair new node" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("hands a link's host to the Add tab", () => {
    wrap(<PairingDialog open onClose={() => {}} initialHost="drone.local" />);
    expect(usePairDialogStore.getState().prefillHost).toBe("drone.local");
  });
});

describe("/pair page", () => {
  it("opens the tabbed dialog for a short code", () => {
    search = new URLSearchParams("code=AB");
    wrap(<PairDeepLinkPage />);
    expect(screen.getByTestId("tabbed-body")).toBeTruthy();
    expect(screen.queryByText("AB")).toBeNull();
  });

  it("never reopens a code stashed by an earlier visit", () => {
    window.sessionStorage.setItem("ados.pair.deep_link", JSON.stringify({ code: "OLD123" }));
    wrap(<PairDeepLinkPage />);
    expect(screen.queryByText("OLD123")).toBeNull();
    expect(screen.getByTestId("tabbed-body")).toBeTruthy();
    expect(window.sessionStorage.getItem("ados.pair.deep_link")).toBeNull();
  });

  it("without a cloud backend hands the host to the shell's Add tab", () => {
    search = new URLSearchParams("code=ABC123&host=drone.local");
    wrap(<PairDeepLinkPage />, false);
    expect(usePairDialogStore.getState()).toMatchObject({ open: true, prefillHost: "drone.local" });
    expect(replace).toHaveBeenCalledWith("/");
  });
});
