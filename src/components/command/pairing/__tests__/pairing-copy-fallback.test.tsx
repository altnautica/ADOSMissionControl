/**
 * @license GPL-3.0-only
 *
 * Copy code on a page with no clipboard (plain http on a LAN address) says the
 * copy failed and selects the code, instead of doing nothing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../../locales/en.json";

const toast = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: () => async () => ({ requestId: "req-1", code: "XYZ789" }),
}));
vi.mock("../use-claim-watch", () => ({ useConvexClaimWatch: () => () => () => {} }));
vi.mock("@/components/auth/SignInModal", () => ({ SignInModal: () => null }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));

import { ConvexAvailableContext } from "@/hooks/use-convex-available";
import { useAuthStore } from "@/stores/auth-store";
import { AgentConnectPanel } from "../../AgentConnectPanel";

describe("AgentConnectPanel copy code", () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", original ?? { value: undefined, configurable: true });
  });

  it("toasts and selects the code when there is no clipboard", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    useAuthStore.setState({ isAuthenticated: true, isLoading: false });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ConvexAvailableContext.Provider value={true}>
          <AgentConnectPanel open onClose={() => {}} initialTab="generate" />
        </ConvexAvailableContext.Provider>
      </NextIntlClientProvider>,
    );

    const copy = await screen.findByTitle(messages.command.copyCode);
    fireEvent.click(copy);
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(messages.command.pairing.copyFailed, "error"),
    );
    expect(window.getSelection()?.toString()).toContain("XYZ789");
  });
});
