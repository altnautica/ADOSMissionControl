/**
 * Smoke tests for McpAuditLog: the honest empty state (no fabricated rows)
 * and that real events render. The audit query is mocked so the
 * component's rendering + filtering can be exercised without a Convex backend.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

const { audit } = vi.hoisted(() => ({
  audit: { rows: [] as unknown[] | undefined, state: "ready" as string },
}));

vi.mock("@/hooks/use-convex-skip-query", () => ({
  useConvexSkipQueryState: () => ({ data: audit.rows, state: audit.state }),
}));
vi.mock("@/lib/community-api", () => ({
  communityApi: { mcpTokens: { recentAudit: {} } },
}));

import { McpAuditLog } from "@/components/mcp/McpAuditLog";
import type { McpTokenRow } from "@/components/mcp/McpConsole";

const CREDS: McpTokenRow[] = [
  {
    _id: "c1",
    tokenId: "mct_a",
    scopes: ["read"],
    allowedNodes: [],
    label: "Laptop",
    createdAt: 1,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
  },
];

describe("McpAuditLog", () => {
  beforeEach(() => {
    audit.rows = [];
    audit.state = "ready";
  });

  it("shows the honest empty state when there is no activity", () => {
    renderWithIntl(<McpAuditLog credentials={CREDS} />);
    expect(screen.getByText(/No MCP activity recorded yet/i)).toBeTruthy();
    // the self-reported caveat is always present (no fabricated reading)
    expect(screen.getByText(/not an independent log/i)).toBeTruthy();
  });

  it("does not claim 'no activity' while the query is loading or failed", () => {
    audit.rows = undefined;
    audit.state = "loading";
    const { unmount } = renderWithIntl(<McpAuditLog credentials={CREDS} />);
    expect(screen.queryByText(/No MCP activity/i)).toBeNull();
    expect(screen.getByText(/Loading activity/i)).toBeTruthy();
    unmount();

    audit.state = "error";
    renderWithIntl(<McpAuditLog credentials={CREDS} />);
    expect(screen.queryByText(/No MCP activity/i)).toBeNull();
    expect(screen.getByText(/Activity log unavailable/i)).toBeTruthy();
  });

  it("renders real events with their tool and result", () => {
    audit.rows = [
      {
        _id: "e1",
        tokenId: "mct_a",
        tool: "params.set",
        node: "node-01",
        decision: "confirmed",
        result: "ATC_RAT_RLL_P = 0.135",
        plane: "cloud_relay",
        latencyMs: 42,
        tsUs: 0,
        createdAt: 2,
        argsRedacted: false,
        sensitiveRead: false,
      },
    ];
    renderWithIntl(<McpAuditLog credentials={CREDS} />);
    expect(screen.getByText("params.set")).toBeTruthy();
    expect(screen.getByText(/ATC_RAT_RLL_P/)).toBeTruthy();
    expect(screen.queryByText(/No MCP activity/i)).toBeNull();
  });
});
