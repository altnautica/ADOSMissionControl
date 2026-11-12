/**
 * The agent's MAVLink WebSocket URL, derived from the URL the agent answered on.
 *
 * Only a real HTTP(S) agent has one. The demo connects to `mock://demo`, whose
 * hostname would otherwise yield `ws://demo:8765/` and a reconnect loop that
 * fills the console on every route.
 *
 * @license GPL-3.0-only
 */
export function agentMavlinkWsUrl(agentUrl: string): string | null {
  try {
    const url = new URL(agentUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `ws://${url.hostname}:8765/`;
  } catch {
    return null;
  }
}
