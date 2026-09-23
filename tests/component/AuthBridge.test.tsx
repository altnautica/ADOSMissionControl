/**
 * AuthBridge keeps auth loading until the signed-in identity resolves, so
 * the signing keystore is never purged as if the operator had signed out
 * while their user id is still in flight.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";

const { convexAuth, queries, purgeForUser, refs } = vi.hoisted(() => ({
  convexAuth: { current: { isAuthenticated: false, isLoading: true } },
  queries: {
    userId: undefined as string | null | undefined,
    profile: undefined as Record<string, unknown> | null | undefined,
  },
  purgeForUser: vi.fn<(userId: string | null) => Promise<number>>(),
  refs: { getMyUserId: { name: "getMyUserId" }, getMyProfile: { name: "getMyProfile" } },
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => convexAuth.current,
}));
vi.mock("@/lib/community-api", () => ({
  communityApi: { profiles: refs },
}));
vi.mock("@/hooks/use-convex-skip-query", () => ({
  useConvexSkipQuery: (query: unknown, opts?: { enabled?: boolean }) => {
    if (opts?.enabled === false) return undefined;
    return query === refs.getMyUserId ? queries.userId : queries.profile;
  },
}));
vi.mock("@/lib/protocol/signing-keystore", () => ({ purgeForUser }));

import { AuthBridge } from "@/components/auth/AuthBridge";
import { useAuthStore } from "@/stores/auth-store";

function setConvex(next: { isAuthenticated: boolean; isLoading: boolean }) {
  convexAuth.current = next;
}

describe("AuthBridge keystore purge", () => {
  beforeEach(() => {
    purgeForUser.mockReset();
    purgeForUser.mockResolvedValue(0);
    setConvex({ isAuthenticated: false, isLoading: true });
    queries.userId = undefined;
    queries.profile = undefined;
    useAuthStore.setState({ isAuthenticated: false, isLoading: true, user: null });
  });

  it("never purges as signed out while a signed-in identity is pending", () => {
    const view = render(<AuthBridge />);

    // Convex confirms the token; the user id and profile have not arrived.
    setConvex({ isAuthenticated: true, isLoading: false });
    act(() => view.rerender(<AuthBridge />));
    act(() => view.rerender(<AuthBridge />));

    expect(useAuthStore.getState().isLoading).toBe(true);
    expect(purgeForUser).not.toHaveBeenCalled();

    queries.userId = "user_1";
    queries.profile = { _id: "profile_1", fullName: "Pilot", email: "pilot@example.com" };
    act(() => view.rerender(<AuthBridge />));

    expect(useAuthStore.getState().user?.id).toBe("user_1");
    expect(purgeForUser).toHaveBeenCalledTimes(1);
    expect(purgeForUser).toHaveBeenCalledWith("user_1");
    expect(purgeForUser).not.toHaveBeenCalledWith(null);
  });

  it("settles on the user id when the account has no profile row", () => {
    setConvex({ isAuthenticated: true, isLoading: false });
    queries.userId = "user_2";
    queries.profile = null;
    render(<AuthBridge />);

    const state = useAuthStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.user?.id).toBe("user_2");
    expect(purgeForUser).toHaveBeenCalledWith("user_2");
    expect(purgeForUser).not.toHaveBeenCalledWith(null);
  });

  it("purges other accounts' keys on a real sign-out", () => {
    setConvex({ isAuthenticated: true, isLoading: false });
    queries.userId = "user_1";
    queries.profile = { _id: "profile_1", email: "pilot@example.com" };
    const view = render(<AuthBridge />);
    expect(purgeForUser).toHaveBeenLastCalledWith("user_1");

    setConvex({ isAuthenticated: false, isLoading: false });
    act(() => view.rerender(<AuthBridge />));

    expect(useAuthStore.getState().user).toBeNull();
    expect(purgeForUser).toHaveBeenLastCalledWith(null);
  });
});
