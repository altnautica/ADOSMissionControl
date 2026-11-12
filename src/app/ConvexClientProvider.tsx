"use client";

import { ReactNode, useMemo } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { AuthBridge } from "@/components/auth/AuthBridge";
import { SilentErrorBoundary } from "@/components/ui/SilentErrorBoundary";
import { ConvexAvailableContext } from "@/hooks/use-convex-available";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

// Placeholder address for local-only mode (no backend configured). The
// .invalid TLD never resolves (RFC 2606); the client exists only so the
// convex/react hooks (useQuery / useMutation) have a provider context and do
// not throw. It is never contacted: local-only mode reports
// convexAvailable=false, so queries pass "skip" (no subscription) and
// mutations are gated off at every call site.
const LOCAL_ONLY_ADDRESS = "https://ados-local.invalid";

export default function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  const hasBackend = Boolean(CONVEX_URL);
  // Always build a client so the Convex hooks have a provider context, even in
  // local-only mode. Without a provider, useQuery / useMutation throw
  // "Could not find Convex client" at the hook call and crash the route.
  const client = useMemo(
    () => new ConvexReactClient(CONVEX_URL || LOCAL_ONLY_ADDRESS),
    [],
  );

  if (!hasBackend) {
    // Local-only mode: no real backend, no auth. The provider is still mounted
    // (with a non-resolving client) so Convex hooks render instead of throwing;
    // useConvexAvailable() stays false so callers skip every real call.
    return (
      <ConvexAvailableContext.Provider value={false}>
        <ConvexProvider client={client}>{children}</ConvexProvider>
      </ConvexAvailableContext.Provider>
    );
  }

  return (
    <ConvexAvailableContext.Provider value={true}>
      <ConvexAuthNextjsProvider client={client}>
        <SilentErrorBoundary label="auth-bridge">
          <AuthBridge />
        </SilentErrorBoundary>
        {children}
      </ConvexAuthNextjsProvider>
    </ConvexAvailableContext.Provider>
  );
}
