"use client";

import { CommandPage } from "@/components/command/CommandPage";
import { SilentErrorBoundary } from "@/components/ui/SilentErrorBoundary";

export default function CommandRoute() {
  return (
    <SilentErrorBoundary label="CommandPage">
      <CommandPage />
    </SilentErrorBoundary>
  );
}
