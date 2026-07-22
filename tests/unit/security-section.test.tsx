/**
 * Tests for the node Settings "Security" page: the pairing-key state mapped
 * from the redacted config field without ever rendering a value, the two
 * exposed auth switches writing through the shared config writer, and the
 * dashboard-PIN posture read through the stored pairing record — with the
 * honest no-record absence.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

// happy-dom's localStorage.setItem is not a function in this config, so the
// persist middleware in local-nodes-store (whose storage is captured at import)
// would throw on setState. Install a working in-memory localStorage BEFORE the
// store modules load (vi.hoisted runs before imports).
vi.hoisted(() => {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
});

import {
  SecuritySection,
  apiKeyStateKey,
} from "@/components/command/settings/SecuritySection";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

const initialConnection = useAgentConnectionStore.getState();

beforeEach(() => {
  // Partial (non-replace) reset: the local-nodes store is persisted, and a
  // full replace would tear out the persist plumbing under the test env.
  useLocalNodesStore.setState({ nodes: [] });
});

afterEach(() => {
  useAgentConnectionStore.setState(initialConnection, true);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderSection(config: Record<string, unknown> | null) {
  const setValue = vi.fn(async () => {});
  renderWithIntl(
    <SecuritySection config={config} readOnly={false} setValue={setValue} />,
  );
  return { setValue };
}

const CONFIG = {
  security: {
    api: { api_key: "***" },
    setup_token_required: false,
  },
  mavlink: { ws_proxy_enforce_auth: false },
};

describe("apiKeyStateKey", () => {
  it("maps the redacted field to a state and never depends on the value", () => {
    expect(apiKeyStateKey({ security: { api: { api_key: "***" } } })).toBe(
      "set",
    );
    // Any non-empty string reads set — the value itself is irrelevant.
    expect(apiKeyStateKey({ security: { api: { api_key: "x" } } })).toBe("set");
    expect(apiKeyStateKey({ security: { api: { api_key: "" } } })).toBe(
      "notSet",
    );
    expect(apiKeyStateKey({ security: {} })).toBe("notReported");
    expect(apiKeyStateKey(null)).toBe("notReported");
  });
});

describe("SecuritySection key state", () => {
  it("renders the set state without rendering any key material", () => {
    renderSection(CONFIG);
    expect(screen.getByText("Set")).toBeTruthy();
    // The redaction sentinel itself never renders.
    expect(screen.queryByText("***")).toBeNull();
    // No rotate control is fabricated; the hint names the honest path.
    expect(screen.queryByText(/rotate/i)).toBeNull();
    expect(screen.getByText(/unpair the node and pair it again/)).toBeTruthy();
  });

  it("renders not-set and not-reported distinctly", () => {
    renderSection({ security: { api: { api_key: "" } } });
    expect(screen.getByText("Not set")).toBeTruthy();
  });
});

describe("SecuritySection auth switches", () => {
  it("writes the WS enforcement flag through the shared config writer", async () => {
    const { setValue } = renderSection(CONFIG);
    fireEvent.click(screen.getByText("Enforce raw MAVLink WebSocket auth"));
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith(
        "mavlink.ws_proxy_enforce_auth",
        "true",
      ),
    );
  });

  it("writes the setup-token requirement through the shared config writer", async () => {
    const { setValue } = renderSection(CONFIG);
    fireEvent.click(screen.getByText("Require setup token"));
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith(
        "security.setup_token_required",
        "true",
      ),
    );
  });
});

describe("SecuritySection dashboard PIN posture", () => {
  it("states the honest absence when no pairing record names the node", () => {
    renderSection(CONFIG);
    expect(
      screen.getByText(/can only be read through a stored pairing record/),
    ).toBeTruthy();
  });

  it("reads the PIN posture through the stored pairing record", async () => {
    useAgentConnectionStore.setState({ nodeDeviceId: "dev-1" } as never);
    useLocalNodesStore.setState({
      nodes: [
        {
          deviceId: "dev-1",
          name: "bench",
          hostname: "http://node.local:8080",
          apiKey: "KEY",
          profile: "drone",
        },
      ],
    } as never);
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ pin_set: true, locked: false, locked_until: null }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderSection(CONFIG);

    await waitFor(() => expect(screen.getByText("PIN set")).toBeTruthy());
    // Set / reset stays on the Health tab card; this page only points there.
    expect(screen.getByText(/Health tab/)).toBeTruthy();
  });

  it("reads 'could not read' when the posture query fails", async () => {
    useAgentConnectionStore.setState({ nodeDeviceId: "dev-1" } as never);
    useLocalNodesStore.setState({
      nodes: [
        {
          deviceId: "dev-1",
          name: "bench",
          hostname: "http://node.local:8080",
          apiKey: "KEY",
          profile: "drone",
        },
      ],
    } as never);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 502 })),
    );

    renderSection(CONFIG);

    await waitFor(() => expect(screen.getByText("Could not read")).toBeTruthy());
  });
});
