/**
 * The "let the agent sign its own traffic" toggle reaches the enrollment
 * request as `agent_holds_key`, the enroll answer's `agent_holds_key` is read
 * back, the off-card copy follows the toggle, and the panel warns while the
 * FC would drop the agent's unsigned frames.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithIntl as render } from "../../../../../../tests/helpers/intl-wrapper";
import { enrollSigningKey } from "@/lib/agent/agent-client/extras";
import { SigningDisabledSection } from "../SigningDisabledSection";
import { UnsignedRiskBanner, UNSIGNED_RISK_COPY } from "../UnsignedRiskBanner";
import { enrollNewKey } from "../enroll-key";

vi.mock("@/lib/protocol/signing-keystore", () => ({
  importAndStore: vi.fn().mockResolvedValue({ keyId: "abcd1234", enrolledAt: "t" }),
}));

afterEach(() => {
  cleanup();
});

describe("enrollSigningKey", () => {
  let fetchMock: Mock;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ sent: true, verified: true, key_id: "abcd1234", enrolled_at: "t" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends agent_holds_key with the enrollment", async () => {
    await enrollSigningKey({ baseUrl: "http://192.168.1.50:8080", apiKey: "k" }, "00".repeat(32), 1, true);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({ link_id: 1, agent_holds_key: true });
  });

  it("defaults agent_holds_key to false", async () => {
    await enrollSigningKey({ baseUrl: "http://192.168.1.50:8080", apiKey: "k" }, "00".repeat(32), 1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).agent_holds_key).toBe(false);
  });
});

describe("SigningDisabledSection", () => {
  it("reports the agent-holds-key toggle", () => {
    const onChange = vi.fn();
    render(
      <SigningDisabledSection
        busy={false}
        enrollStartedAt={null}
        enrollFailed={false}
        onEnable={() => {}}
        onImport={() => {}}
        onResetEnroll={() => {}}
        onCancelEnroll={() => {}}
        agentHoldsKey={false}
        onAgentHoldsKeyChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("says where the key lives according to the toggle", () => {
    const props = {
      busy: false,
      enrollStartedAt: null,
      enrollFailed: false,
      onEnable: () => {},
      onImport: () => {},
      onResetEnroll: () => {},
      onCancelEnroll: () => {},
      onAgentHoldsKeyChange: () => {},
    };
    const { rerender } = render(<SigningDisabledSection {...props} agentHoldsKey={false} />);
    expect(screen.getByText(/The key lives only in this browser/)).toBeTruthy();
    rerender(<SigningDisabledSection {...props} agentHoldsKey={true} />);
    expect(screen.queryByText(/The key lives only in this browser/)).toBeNull();
    expect(screen.getByText(/kept in this browser and on the node/)).toBeTruthy();
  });
});

describe("enrollNewKey", () => {
  const answer = (agentHoldsKey: boolean | undefined) => ({
    enrollSigningKey: vi.fn().mockResolvedValue({
      sent: true,
      verified: true,
      key_id: "abcd1234",
      enrolled_at: "t",
      ...(agentHoldsKey === undefined ? {} : { agent_holds_key: agentHoldsKey }),
    }),
  });

  it("reports whether the node kept the key", async () => {
    for (const [reply, expected] of [[true, true], [false, false], [undefined, false]] as const) {
      const outcome = await enrollNewKey({
        client: answer(reply),
        droneId: "d1",
        linkId: 1,
        userId: null,
        agentHoldsKey: true,
      });
      expect(outcome.kind).toBe("enrolled");
      if (outcome.kind === "enrolled") expect(outcome.nodeHoldsKey).toBe(expected);
    }
  });
});

describe("UnsignedRiskBanner", () => {
  it("renders only for a true risk", () => {
    const { rerender } = render(<UnsignedRiskBanner risk={true} />);
    expect(screen.getByRole("alert").textContent).toBe(UNSIGNED_RISK_COPY);
    rerender(<UnsignedRiskBanner risk={null} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
