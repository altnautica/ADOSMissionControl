/**
 * @license GPL-3.0-only
 *
 * A deep-link pairing dialog shows the code it is claiming while the claim is
 * in flight, instead of an empty body.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../../locales/en.json";

vi.mock("convex/react", () => ({
  // The claim never settles, so the dialog stays in its claiming state.
  useMutation: () => () => new Promise(() => {}),
}));
vi.mock("../../AgentConnectPanel", () => ({ AgentConnectPanel: () => null }));
vi.mock("@/components/auth/SignInModal", () => ({ SignInModal: () => null }));

import { ConvexAvailableContext } from "@/hooks/use-convex-available";
import { useAuthStore } from "@/stores/auth-store";
import { PairingDialog } from "../../PairingDialog";

describe("PairingDialog deep link", () => {
  it("shows the code being claimed while the claim is in flight", () => {
    useAuthStore.setState({ isAuthenticated: true, isLoading: false });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ConvexAvailableContext.Provider value={true}>
          <PairingDialog open onClose={() => {}} initialCode="ABC123" />
        </ConvexAvailableContext.Provider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("status").textContent).toContain("ABC123");
  });
});
