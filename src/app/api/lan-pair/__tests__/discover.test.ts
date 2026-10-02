// @vitest-environment node
/**
 * The LAN scan route answers only a local-network caller and runs one
 * multicast scan at a time.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { opened } = vi.hoisted(() => ({ opened: { count: 0 } }));

vi.mock("bonjour-service", () => ({
  Bonjour: class {
    constructor() {
      opened.count += 1;
    }
    find() {
      return { on: () => undefined, stop: () => undefined };
    }
    destroy() {}
  },
}));

import { GET } from "../discover/route";

function scan(host = "localhost:4000"): Promise<Response> {
  return GET(
    new NextRequest(`http://${host}/api/lan-pair/discover`, { headers: { host } }),
  );
}

beforeEach(() => {
  opened.count = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("discover", () => {
  it("refuses a page served under a public name without scanning", async () => {
    const res = await scan("cloud.example.com");
    expect(res.status).toBe(403);
    expect(opened.count).toBe(0);
  });

  it("refuses a second scan while one is open, then accepts once it closes", async () => {
    const first = scan();
    const second = await scan();
    expect(second.status).toBe(429);
    expect(opened.count).toBe(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect((await first).status).toBe(200);

    const third = scan();
    await vi.advanceTimersByTimeAsync(3000);
    expect((await third).status).toBe(200);
    expect(opened.count).toBe(2);
  });
});
