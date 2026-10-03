import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MsePlayer, type MsePlayerError } from "../mse-player";

class FakeMediaSource {
  static instances: FakeMediaSource[] = [];
  readyState = "closed";
  private listeners = new Map<string, Array<() => void>>();
  constructor() {
    FakeMediaSource.instances.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  endOfStream() {}
  fireSourceOpen() {
    this.readyState = "open";
    for (const fn of this.listeners.get("sourceopen") ?? []) fn();
  }
}

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  binaryType = "blob";
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

function fakeVideo(): HTMLVideoElement {
  // Only the fields the player touches; a real element would try to load the
  // blob URL.
  const video = { src: "", currentTime: 0, paused: false };
  return video as unknown as HTMLVideoElement;
}

/** Fire `sourceopen` on the newest MediaSource and let the token mint settle. */
async function openLatestSource() {
  FakeMediaSource.instances[FakeMediaSource.instances.length - 1].fireSourceOpen();
  await vi.advanceTimersByTimeAsync(0);
}

describe("MsePlayer recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeMediaSource.instances = [];
    FakeWebSocket.instances = [];
    vi.stubGlobal("MediaSource", FakeMediaSource);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mse");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reports a failed token mint and keeps retrying on the fixed cadence", async () => {
    const errors: MsePlayerError[] = [];
    const getRelayToken = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("mint failed"))
      .mockRejectedValueOnce(new Error("mint failed"))
      .mockResolvedValue("tok");
    const player = new MsePlayer();
    player.start("dev-1", fakeVideo(), "wss://relay.example.com", {
      onError: (e) => errors.push(e),
      getRelayToken,
    });

    await openLatestSource();
    expect(errors.map((e) => e.code)).toEqual(["relay-token-unavailable"]);
    expect(FakeWebSocket.instances).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2_999);
    expect(getRelayToken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await openLatestSource();
    expect(getRelayToken).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(3_000);
    await openLatestSource();
    expect(getRelayToken).toHaveBeenCalledTimes(3);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe(
      "wss://relay.example.com/ws/stream/dev-1?token=tok",
    );
    player.stop();
  });

  it("keeps redialling a relay that closes before open, reporting from the second close", async () => {
    const errors: MsePlayerError[] = [];
    const player = new MsePlayer();
    player.start("dev-1", fakeVideo(), "wss://relay.example.com", {
      onError: (e) => errors.push(e),
      getRelayToken: () => Promise.resolve("tok"),
    });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await openLatestSource();
      expect(FakeWebSocket.instances).toHaveLength(attempt);
      FakeWebSocket.instances[attempt - 1].onclose?.();
      await vi.advanceTimersByTimeAsync(3_000);
    }
    expect(errors.map((e) => e.code)).toEqual(["relay-refused", "relay-refused", "relay-refused"]);
    await openLatestSource();
    expect(FakeWebSocket.instances).toHaveLength(5);
    player.stop();
  });

  it("abandons a socket stuck before open and dials again", async () => {
    const player = new MsePlayer();
    player.start("dev-1", fakeVideo(), "wss://relay.example.com", {
      getRelayToken: () => Promise.resolve("tok"),
    });
    await openLatestSource();
    const hung = FakeWebSocket.instances[0];

    await vi.advanceTimersByTimeAsync(4_999);
    expect(hung.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(hung.closed).toBe(true);
    expect(hung.onopen).toBeNull();

    await vi.advanceTimersByTimeAsync(3_000);
    await openLatestSource();
    expect(FakeWebSocket.instances).toHaveLength(2);
    player.stop();
  });

  it("stops dialling once the caller stops the player", async () => {
    const getRelayToken = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("down"));
    const player = new MsePlayer();
    player.start("dev-1", fakeVideo(), "wss://relay.example.com", { getRelayToken });
    await openLatestSource();
    player.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getRelayToken).toHaveBeenCalledTimes(1);
    expect(FakeMediaSource.instances).toHaveLength(1);
  });
});
