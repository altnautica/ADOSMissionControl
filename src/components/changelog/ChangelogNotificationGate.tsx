/**
 * @module ChangelogNotificationGate
 * @description Guards the changelog notification modal behind Convex availability.
 * Prevents useQuery from being called without a ConvexReactClient parent.
 * Wrapped in an error boundary so changelog failures never crash the app.
 * @license GPL-3.0-only
 */

"use client";

import { useConvexAvailable } from "@/hooks/use-convex-available";
import { SilentErrorBoundary } from "@/components/ui/SilentErrorBoundary";
import { ChangelogNotificationModal } from "./ChangelogNotificationModal";

function ChangelogNotificationInner() {
  const convexAvailable = useConvexAvailable();

  if (!convexAvailable) return null;

  return <ChangelogNotificationModal />;
}

export function ChangelogNotificationGate() {
  return (
    <SilentErrorBoundary label="changelog-notification">
      <ChangelogNotificationInner />
    </SilentErrorBoundary>
  );
}
