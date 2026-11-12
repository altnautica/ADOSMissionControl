/**
 * The node's command-path rows and banners: FC system id with the reconciler
 * outcome, the proxy edges, injector arbitration, agent signing, the
 * unsigned-traffic banner and the software-encode badge.
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl as render } from "../../../../../tests/helpers/intl-wrapper";
import { AgentDiagnosticsView } from "../AgentDiagnosticsStrip";
import { parseAgentDiagnostics, type DiagnosticsSource } from "@/lib/agent/agent-diagnostics";
import { DEMO_STATUS_EXTRAS } from "@/mock/agent/status-extras";
import { UNSIGNED_RISK_COPY } from "@/components/fc/security/signing/UnsignedRiskBanner";

function renderWith(overrides: DiagnosticsSource) {
  render(
    <AgentDiagnosticsView
      diagnostics={parseAgentDiagnostics({ ...DEMO_STATUS_EXTRAS, ...overrides })}
    />,
  );
}

describe("AgentDiagnosticsView", () => {
  it("renders the FC system id with the reconciler outcome", () => {
    renderWith({
      fc_identity: { enabled: true, outcome: "deferred_armed", wanted_system_id: 2, current_system_id: 1 },
    });
    expect(screen.getByText("1 · Change deferred while armed (slot wants 2)")).toBeDefined();
  });

  it("renders the proxy edges the router holds", () => {
    renderWith({
      mavlink_proxy_posture: { tcp_listening: false, udp_listening: [true, false], ws_listening: null },
    });
    expect(
      screen.getByText("TCP not listening · UDP 1/2 listening · WS not configured"),
    ).toBeDefined();
  });

  it("renders the injector arbitration and agent signing rows", () => {
    renderWith({ injector_arbitration: "inactive_no_local_arbiter", agent_signing: "active" });
    expect(screen.getByText("On, but no arbiter runs on this node")).toBeDefined();
    expect(screen.getByText("Signing its own traffic")).toBeDefined();
  });

  it("shows the unsigned-traffic banner only when the risk is reported true", () => {
    renderWith({ agent_commands_unsigned_rejected_risk: true });
    expect(screen.getByRole("alert").textContent).toContain(UNSIGNED_RISK_COPY);
  });

  it("shows no banner for an unmeasured risk", () => {
    renderWith({ agent_commands_unsigned_rejected_risk: null });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("badges a forced software encode", () => {
    renderWith({ video: { encoder_forced_software: true } });
    expect(screen.getByText("Software encode")).toBeDefined();
  });

  it("does not badge a hardware encode", () => {
    renderWith({ video: { encoder_forced_software: false } });
    expect(screen.queryByText("Software encode")).toBeNull();
  });
});
