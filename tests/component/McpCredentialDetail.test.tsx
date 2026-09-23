/**
 * McpCredentialDetail reach preview: a minted credential is evaluated for the
 * fleet relay it connects through (agent-only tools are unreachable), and a
 * revoked or expired credential reports zero callable tools.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";
import { McpCredentialDetail } from "@/components/mcp/McpCredentialDetail";
import type { McpTokenRow } from "@/components/mcp/McpConsole";
import { useMcpTabStore } from "@/stores/mcp-tab-store";
import { summarizeCredentialReach, type ScopeToolDescriptor } from "@/components/mcp/mcp-scope-model";
import catalog from "@/data/mcp/tools-catalog.json";

const TOOLS = catalog.tools as ScopeToolDescriptor[];

function row(overrides: Partial<McpTokenRow>): McpTokenRow {
  return {
    _id: "c1",
    tokenId: "mct_a",
    scopes: ["read", "safe_write", "admin"],
    allowedNodes: [],
    label: "Laptop",
    createdAt: 1,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ...overrides,
  };
}

describe("McpCredentialDetail reach preview", () => {
  beforeEach(() => {
    useMcpTabStore.getState().selectCredential("mct_a");
  });

  it("counts reach for the fleet relay, not a LAN connection", () => {
    const scopes = { scopes: ["read", "safe_write", "admin"], allowedNodes: [] };
    const fleet = summarizeCredentialReach(scopes, TOOLS, { flightEnforced: false, fleetMode: true });
    const lan = summarizeCredentialReach(scopes, TOOLS, { flightEnforced: false, fleetMode: false });
    // The catalog carries agent-only tools, so the two modes differ.
    expect(lan.callable).toBeGreaterThan(fleet.callable);

    renderWithIntl(<McpCredentialDetail rows={[row({})]} />);
    expect(screen.getByText(`${fleet.callable} of ${fleet.total} built-in tools callable`)).toBeTruthy();
  });

  it("reports zero callable tools for an expired credential", () => {
    renderWithIntl(<McpCredentialDetail rows={[row({ expiresAt: 1000 })]} />);
    expect(screen.getByText(new RegExp(`^0 of ${TOOLS.length} built-in tools callable`))).toBeTruthy();
    expect(screen.getByText(/has expired/i)).toBeTruthy();
  });
});
