/**
 * The AI PID analysis route checks the model's suggestions against the
 * safety ranges and the vehicle values sent with the request before
 * returning them.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

let sessionCookie: string | null = "session-token";
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ Host: "localhost:4000" }),
  cookies: async () => ({ get: () => (sessionCookie ? { value: sessionCookie } : undefined) }),
}));

const { fetchMutation } = vi.hoisted(() => ({
  fetchMutation: vi.fn(async () => ({ allowed: true, remaining: 4, weeklyLimit: 5 })),
}));
vi.mock("convex/nextjs", () => ({ fetchMutation }));

import { POST } from "@/app/api/pid-analysis/route";

function postJson(body: unknown): NextRequest {
  return new NextRequest("http://localhost:4000/api/pid-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function modelReply(content: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    { status: 200 },
  );
}

const request = {
  vehicleType: "copter",
  currentParams: { ATC_RAT_RLL_P: 0.135, ATC_RAT_RLL_D: 0.004 },
  analysisMetrics: {
    tuneScore: 60,
    fftPeaks: [],
    stepResponse: [],
    tracking: [],
    motorImbalance: 0,
    vibrationLevel: "low",
    issues: [],
  },
};

describe("POST /api/pid-analysis", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.com");
    sessionCookie = "session-token";
    fetchMutation.mockClear();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("drops unknown params and limits unsafe values", async () => {
    fetchMock.mockResolvedValueOnce(
      modelReply({
        recommendations: [
          {
            id: "rec-1",
            title: "Roll",
            explanation: "",
            priority: "important",
            confidence: 90,
            parameters: [
              { param: "ATC_RAT_RLL_P", currentValue: 0.5, suggestedValue: 1.35, delta: 0.85 },
              { param: "ATC_RAT_RLL_D", currentValue: 0.004, suggestedValue: 0.003, delta: -0.001 },
            ],
          },
          {
            id: "rec-2",
            title: "Disable checks",
            explanation: "",
            priority: "critical",
            confidence: 95,
            parameters: [{ param: "ARMING_CHECK", currentValue: 1, suggestedValue: 0, delta: -1 }],
          },
        ],
        summary: "ok",
      }),
    );

    const res = await POST(postJson(request));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recommendations).toHaveLength(1);
    expect(body.recommendations[0].id).toBe("rec-1");
    expect(body.recommendations[0].parameters).toEqual([
      { param: "ATC_RAT_RLL_P", currentValue: 0.135, suggestedValue: 0.185, delta: expect.closeTo(0.05) },
      { param: "ATC_RAT_RLL_D", currentValue: 0.004, suggestedValue: 0.003, delta: expect.closeTo(-0.001) },
    ]);
  });

  it("rejects a request without a known vehicle type", async () => {
    const res = await POST(postJson({ ...request, vehicleType: "boat" }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for sign-in when accounts are enabled and there is no session", async () => {
    sessionCookie = null;
    const res = await POST(postJson(request));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves a self-hosted install without Convex with no sign-in or quota", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
    sessionCookie = null;
    fetchMock.mockResolvedValueOnce(modelReply({ recommendations: [], summary: "ok" }));
    const res = await POST(postJson(request));
    expect(res.status).toBe(200);
    expect(fetchMutation).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.summary).toBe("ok");
    expect(body.remaining).toBeUndefined();
  });
});
