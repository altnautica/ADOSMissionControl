/**
 * Renders the node Settings tab with genuinely no path to the node (no
 * direct client, no stored pairing record) and asserts it degrades to
 * read-only WITH the no-path reason visible — the honest counterpart of
 * the cloud-writable proxy path covered in the use-node-config tests.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

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

import { NodeSettingsTab } from "@/components/command/settings/NodeSettingsTab";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import { renderWithIntl } from "../helpers/intl-wrapper";
import en from "../../locales/en.json";

const initialConnectionState = useAgentConnectionStore.getState();

beforeEach(() => {
  useLocalNodesStore.setState({ nodes: [] });
  usePairingStore.setState({ pairedDrones: [] });
  useAgentConnectionStore.setState({
    client: null,
    cloudMode: true,
    nodeDeviceId: "dev-unpaired",
  });
});

afterEach(() => {
  useAgentConnectionStore.setState(initialConnectionState, true);
});

describe("NodeSettingsTab with no path to the node", () => {
  it("renders the read-only state with the no-path reason", () => {
    renderWithIntl(
      <NodeSettingsTab droneId="dev-unpaired" profile="ground-station" />,
    );
    // The reason copy from the locale file, not a hardcoded duplicate.
    expect(
      screen.getByText(en.nodeSettings.readOnlyNoAgent),
    ).toBeInTheDocument();
  });
});
