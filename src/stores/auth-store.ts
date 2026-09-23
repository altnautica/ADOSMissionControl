/**
 * @module auth-store
 * @description Zustand store for authentication state.
 * Tracks whether the user is signed in and their profile.
 * Auth is entirely optional — the app works fully without it.
 * @license GPL-3.0-only
 */

import { create } from "zustand";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

interface AuthStoreState {
  /** Whether the user is authenticated. */
  isAuthenticated: boolean;
  /** Whether auth state is still loading. */
  isLoading: boolean;
  /** The authenticated user, or null. */
  user: AuthUser | null;

  setAuth: (user: AuthUser | null) => void;
  setLoading: (loading: boolean) => void;
  signOut: () => void;
}

export const useAuthStore = create<AuthStoreState>((set) => ({
  isAuthenticated: false,
  isLoading: true,
  user: null,

  setAuth: (user) =>
    set({
      user,
      isAuthenticated: user !== null,
      isLoading: false,
    }),
  setLoading: (isLoading) => set({ isLoading }),
  signOut: () =>
    set({
      user: null,
      isAuthenticated: false,
    }),
}));
