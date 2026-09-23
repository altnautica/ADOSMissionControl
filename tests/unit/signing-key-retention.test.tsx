/**
 * The FC never acknowledges SETUP_SIGNING, so a key that may be on it must
 * never be discarded by this browser. These drive the real enrollment,
 * disable, and export flows against an in-memory keystore and check what the
 * browser still holds afterwards.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

const storeById = new Map<symbol, Map<string, unknown>>();

vi.mock("idb-keyval", () => ({
  createStore: (_db: string, name: string) => {
    const token = Symbol(name);
    storeById.set(token, new Map());
    return token;
  },
  get: async (key: IDBValidKey, store: symbol) => storeById.get(store)?.get(String(key)),
  set: async (key: IDBValidKey, value: unknown, store: symbol) => {
    storeById.get(store)?.set(String(key), value);
  },
  del: async (key: IDBValidKey, store: symbol) => {
    storeById.get(store)?.delete(String(key));
  },
  keys: async (store: symbol) => Array.from(storeById.get(store)?.keys() ?? []),
}));

vi.mock("convex/react", () => ({ useConvex: () => undefined }));
vi.mock("@/lib/api/signing-events", () => ({ emitSigningEvent: vi.fn(async () => {}) }));

import { useSigningActions } from "@/components/fc/security/signing/use-signing-actions";
import { ExportKeyModal } from "@/components/fc/security/ExportKeyModal";
import { getRecord, getSigner, importAndStore } from "@/lib/protocol/signing-keystore";
import { AgentHttpError } from "@/lib/agent/agent-client/transport";
import { enrollSigningKey } from "@/lib/agent/agent-client/extras";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useSigningStore } from "@/stores/signing-store";
import type { AgentClient } from "@/lib/agent/client";

const DRONE = "drone-1";
const initialConnection = useAgentConnectionStore.getState();

function stubClient(enroll: (...args: unknown[]) => Promise<unknown>) {
  const client = {
    getSigningCapability: vi.fn(async () => ({
      supported: true,
      reason: "ok",
      firmware_name: "ArduPilot",
      firmware_version: null,
      signing_params_present: false,
    })),
    enrollSigningKey: vi.fn(enroll),
    disableSigningOnFc: vi.fn(async () => ({ success: true })),
  };
  useAgentConnectionStore.setState({ client: client as never });
  return client;
}

async function seedKey(): Promise<string> {
  const rec = await importAndStore({ droneId: DRONE, userId: null, keyBytes: new Uint8Array(32).fill(7), linkId: 1 });
  return rec.keyId;
}

beforeEach(() => {
  for (const s of storeById.values()) s.clear();
  useSigningStore.getState().clearAll();
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  useAgentConnectionStore.setState(initialConnection, true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("enrollment that may have reached the FC", () => {
  it("keeps the new key and the previous one when the request does not complete", async () => {
    const oldKeyId = await seedKey();
    stubClient(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { result } = renderHook(() => useSigningActions(DRONE));

    await act(async () => {
      await result.current.handleEnable();
    });

    const rec = await getRecord(DRONE);
    expect(rec?.enrollmentState).toBe("unconfirmed");
    expect(rec?.keyId).not.toBe(oldKeyId);
    expect(rec?.previous?.keyId).toBe(oldKeyId);
    expect(useSigningStore.getState().drones[DRONE]?.enrollmentState).toBe("unconfirmed");

    // The operator reports the FC kept the old key: it is restored.
    await act(async () => {
      await result.current.handleSettleNewKey("previous");
    });
    const settled = await getRecord(DRONE);
    expect(settled?.keyId).toBe(oldKeyId);
    expect(settled?.enrollmentState).toBe("enrolled");
  });

  it("keeps the key when the agent reports the repeat frame failed after the first went out", async () => {
    const oldKeyId = await seedKey();
    // The agent's real answer to a failed second SETUP_SIGNING send.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ detail: "enrollment may have partially applied", partially_applied: true, key_id: "abcd1234" }),
      { status: 500 },
    )));
    const ctx = { baseUrl: "http://192.168.1.50:8080", apiKey: "k" };
    stubClient((...args: unknown[]) => enrollSigningKey(ctx, args[0] as string, args[1] as number));
    const { result } = renderHook(() => useSigningActions(DRONE));

    await act(async () => {
      await result.current.handleEnable();
    });

    const rec = await getRecord(DRONE);
    expect(rec?.enrollmentState).toBe("unconfirmed");
    expect(rec?.previous?.keyId).toBe(oldKeyId);
    expect(result.current.error).toMatch(/first key frame reached the flight controller/);
  });

  it("discards the new key when the agent answered without sending", async () => {
    const oldKeyId = await seedKey();
    stubClient(async () => {
      throw new AgentHttpError(503, '{"detail":"MAVLink command link unavailable"}');
    });
    const { result } = renderHook(() => useSigningActions(DRONE));

    await act(async () => {
      await result.current.handleEnable();
    });

    const rec = await getRecord(DRONE);
    expect(rec?.keyId).toBe(oldKeyId);
    expect(rec?.enrollmentState).toBe("enrolled");
  });
});

describe("disable", () => {
  it("keeps the key, still signing, until the operator confirms unsigned commands work", async () => {
    await seedKey();
    stubClient(async () => ({}));
    const { result } = renderHook(() => useSigningActions(DRONE));

    await act(async () => {
      await result.current.handleDisable();
    });

    expect((await getRecord(DRONE))?.enrollmentState).toBe("disable_unconfirmed");
    expect(await getSigner(DRONE)).not.toBeNull();

    await act(async () => {
      await result.current.handleSettleDisable(true);
    });
    expect(await getRecord(DRONE)).toBeNull();
  });
});

describe("export", () => {
  it("keeps the enrolled key and offers the copy again when the clipboard refuses", async () => {
    const client = stubClient(async () => ({ success: true, key_id: "abcd1234", enrolled_at: "2026-01-01T00:00:00Z" }));
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {
      throw new DOMException("Document is not focused", "NotAllowedError");
    });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(
      <ExportKeyModal client={client as unknown as AgentClient} droneId={DRONE} linkId={3} open onClose={() => {}} />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "EXPORT" } });
    fireEvent.click(screen.getByText("Rotate and copy"));

    await waitFor(() => expect(screen.getByText("Copy again")).toBeTruthy());
    const rec = await getRecord(DRONE);
    expect(rec?.enrollmentState).toBe("enrolled");
    expect(rec?.linkId).toBe(3);

    writeText.mockImplementation(async () => {});
    fireEvent.click(screen.getByText("Copy again"));
    await waitFor(() => expect(screen.getByText("Copied to clipboard")).toBeTruthy());
    expect(writeText).toHaveBeenLastCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  it("does not claim the clipboard was cleared when the wipe is refused", async () => {
    const client = stubClient(async () => ({ success: true, key_id: "abcd1234", enrolled_at: "2026-01-01T00:00:00Z" }));
    const writeText = vi.fn<(text: string) => Promise<void>>(async (text) => {
      if (text === "") throw new DOMException("Document is not focused", "NotAllowedError");
    });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(
      <ExportKeyModal client={client as unknown as AgentClient} droneId={DRONE} linkId={3} open onClose={() => {}} />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "EXPORT" } });
    fireEvent.click(screen.getByText("Rotate and copy"));
    await waitFor(() => expect(screen.getByText("Copied to clipboard")).toBeTruthy());

    fireEvent.click(screen.getByText("Clear now"));
    await waitFor(() => expect(screen.getByText(/could not be cleared/)).toBeTruthy());
    expect(screen.queryByText("Clipboard cleared.")).toBeNull();
    expect(writeText).toHaveBeenLastCalledWith("");
  });
});
