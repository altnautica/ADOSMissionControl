/**
 * @module app/mcp
 * @description The ADOS MCP tab. With no credentials (or signed out / demo) it
 * shows the marketing one-pager; once the operator has machine credentials it
 * shows the access-control console (generate / scope / revoke). The generate and
 * reveal-once dialogs are mounted here and self-gate on the tab store.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { useConvexAvailable } from "@/hooks/use-convex-available";
import { useAuthStore } from "@/stores/auth-store";
import { isDemoMode } from "@/lib/utils";
import { communityApi } from "@/lib/community-api";
import { useMcpTabStore, MCP_TAB_RESET } from "@/stores/mcp-tab-store";
import { McpLanding } from "@/components/mcp/McpLanding";
import { McpConsoleShell } from "@/components/mcp/McpConsoleShell";
import type { McpTokenRow } from "@/components/mcp/McpConsole";
import { GenerateCredentialModal } from "@/components/mcp/GenerateCredentialModal";
import { RevealCredentialModal } from "@/components/mcp/RevealCredentialModal";
import { McpSetupWizard } from "@/components/mcp/McpSetupWizard";

export default function McpPage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const convexAvailable = useConvexAvailable();
  const canMint = isAuthenticated && convexAvailable && !isDemoMode();

  const rows = useConvexSkipQuery(communityApi.mcpTokens.listMine, {
    enabled: isAuthenticated,
  }) as McpTokenRow[] | undefined;

  const loading = isAuthenticated && rows === undefined;
  const hasCredentials = Array.isArray(rows) && rows.length > 0;

  // Reset the tab's transient UI state when the operator navigates away, so a
  // return starts fresh: the once-only reveal is consumed (it can never re-appear),
  // the view returns to Overview, and no dialog is left open. This page instance
  // survives the landing<->console swap, so the cleanup fires only on a real route
  // change, not on that swap.
  useEffect(() => () => useMcpTabStore.setState(MCP_TAB_RESET), []);

  // Consume any un-dismissed reveal (and close the generate dialog) the moment the
  // operator signs out — the page does not unmount on sign-out, so without this the
  // reveal-once secret would keep showing to the next person at the machine.
  useEffect(() => {
    if (!isAuthenticated) {
      useMcpTabStore.setState({ revealed: null, generateOpen: false, revokeTokenId: null });
    }
  }, [isAuthenticated]);

  return (
    <>
      {loading ? (
        <McpLoading />
      ) : hasCredentials ? (
        <McpConsoleShell rows={rows} />
      ) : (
        <McpLanding canMint={canMint} isAuthenticated={isAuthenticated} />
      )}
      <GenerateCredentialModal />
      <RevealCredentialModal />
      <McpSetupWizard />
    </>
  );
}

/** A minimal loading state so an operator with credentials never flashes the
 *  marketing landing before the reactive list resolves. */
function McpLoading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 size={22} className="animate-spin text-text-tertiary" />
    </div>
  );
}
