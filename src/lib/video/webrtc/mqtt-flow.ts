/**
 * @module video/webrtc/mqtt-flow
 * @description MQTT-relayed SDP signaling path. Used when the browser
 * cannot reach the agent's local WHEP endpoint directly. The SDP
 * offer is published to `ados/{deviceId}/webrtc/offer`; the agent's
 * relay forwards it to local mediamtx and publishes the answer to
 * `ados/{deviceId}/webrtc/answer`. Media flows direct peer-to-peer
 * via STUN-punched ICE candidates after the handshake.
 * @license GPL-3.0-only
 */

import { useVideoStore } from "@/stores/video-store";
import {
  CROSS_NETWORK_ICE_SERVERS,
  ICE_GATHER_TIMEOUT_MS,
  MQTT_ANSWER_TIMEOUT_MS,
  MQTT_CONNECT_TIMEOUT_MS,
  ONTRACK_TIMEOUT_MS,
} from "../webrtc-constants";
import {
  abortable,
  checkAborted,
  classifyError,
} from "../webrtc-helpers";
import {
  closePeerConnection,
  reportHealth,
  tryIceRestart,
} from "./peer-utils";
import { attachSeiTransform } from "./sei-transform";
import { getPc, setPc } from "./session-state";
import { startStatsPolling, stopStatsPolling } from "./stats-tracker";
import {
  getMqttBrokerCredential,
  getMqttBrokerUrl,
} from "@/lib/mqtt-broker-credential";

/**
 * Start a WebRTC stream via MQTT-relayed SDP signaling.
 *
 * Used when the browser cannot reach the agent's local WHEP endpoint
 * directly (cross-network case — cellular phone, different LAN).
 *
 * @param deviceId — Cloud device ID of the paired agent.
 * @returns The MediaStream to attach to a <video> element.
 */
export async function startStreamViaMqttSignaling(
  deviceId: string,
  signal?: AbortSignal,
  auth?: { username?: string | null; password?: string | null },
): Promise<MediaStream> {
  const store = useVideoStore.getState();
  const startedAt = Date.now();

  // Report testing state immediately so the UX dropdown shows the live
  // attempt.
  reportHealth("p2p-mqtt", { state: "testing", stage: "starting" });

  // Clean up any stale connection before starting fresh.
  const existing = getPc();
  if (existing) {
    closePeerConnection(existing);
    setPc(null);
    stopStatsPolling();
  }

  // mqtt.js client lives outside the inner Promise so the outer try/finally
  // guarantees cleanup on every code path (success, timeout, error).
  type MqttClient = {
    on: (event: string, cb: (...args: unknown[]) => void) => void;
    subscribe: (topic: string, cb?: (err: Error | null) => void) => void;
    // The publish callback carries broker-side refusals. At QoS 1 an
    // unauthorized publish arrives here as an error built from the PUBACK
    // reason code; at QoS 0 the protocol provides no acknowledgement at
    // all, so a refusal there is undetectable by design.
    publish: (
      topic: string,
      payload: string | Buffer,
      opts?: { qos?: 0 | 1 | 2 },
      cb?: (err?: Error | null) => void,
    ) => void;
    end: (force?: boolean) => void;
  };
  let mqttClient: MqttClient | null = null;

  // Hold a local pc reference for the handlers' closure.
  let localPc: RTCPeerConnection | null = null;

  try {
    checkAborted(signal);

    const newPc = new RTCPeerConnection({
      iceServers: CROSS_NETWORK_ICE_SERVERS,
      iceTransportPolicy: "all",
    });
    localPc = newPc;
    setPc(newPc);

    // ICE restart on transient disconnect. Closure captures newPc (const),
    // so even if pc has been replaced by a parallel call, this handler
    // still acts on its own connection (and bails via the
    // newPc !== getPc() check).
    newPc.onconnectionstatechange = () => {
      if (newPc !== getPc()) return; // a newer pc has taken over
      const state = newPc.connectionState;
      if (state === "disconnected") {
        console.warn("[webrtc-client] P2P MQTT disconnected — attempting ICE restart");
        tryIceRestart(newPc);
      } else if (state === "failed" || state === "closed") {
        console.warn("[webrtc-client] P2P MQTT terminal state:", state);
        const s = useVideoStore.getState();
        s.setStreaming(false);
        s.updateStats(0, 0);
        stopStatsPolling();
        reportHealth("p2p-mqtt", {
          state: "failed",
          stage: "connected",
          code: "ice-disconnect",
          error: `Connection ${state}`,
        });
      }
    };

    localPc.addTransceiver("video", { direction: "recvonly" });
    localPc.addTransceiver("audio", { direction: "recvonly" });

    const offer = await abortable(localPc.createOffer(), signal);
    checkAborted(signal);
    await abortable(localPc.setLocalDescription(offer), signal);
    checkAborted(signal);

    // === Stage: ICE gathering ===
    reportHealth("p2p-mqtt", { state: "testing", stage: "ice-gathering" });
    await new Promise<void>((resolve) => {
      if (localPc!.iceGatheringState === "complete") { resolve(); return; }
      const check = () => {
        if (localPc?.iceGatheringState === "complete") {
          localPc.removeEventListener("icegatheringstatechange", check);
          resolve();
        }
      };
      localPc!.addEventListener("icegatheringstatechange", check);
      // 8s ceiling. Slow cellular needs more time.
      setTimeout(resolve, ICE_GATHER_TIMEOUT_MS);
    });
    checkAborted(signal);

    // === Stage: SDP exchange via MQTT ===
    reportHealth("p2p-mqtt", { state: "testing", stage: "sdp-exchange" });
    const mqttModule = await import("mqtt");
    checkAborted(signal);
    const connectFn = mqttModule.connect
      ?? (mqttModule.default as { connect?: typeof mqttModule.connect })?.connect
      ?? mqttModule.default;
    if (typeof connectFn !== "function") {
      throw new Error("mqtt.connect not found in module");
    }

    const topicOffer = `ados/${deviceId}/webrtc/offer`;
    const topicAnswer = `ados/${deviceId}/webrtc/answer`;

    const mqttConnectOptions: Record<string, unknown> = {
      protocolVersion: 5,
      clean: true,
      reconnectPeriod: 0,
    };
    const cred = auth ?? getMqttBrokerCredential();
    if (cred?.username && cred?.password) {
      mqttConnectOptions.username = cred.username;
      mqttConnectOptions.password = cred.password;
    }
    mqttClient = (connectFn as typeof mqttModule.connect)(
      getMqttBrokerUrl(),
      mqttConnectOptions,
    ) as unknown as MqttClient;

    // Wait for broker connect (separate timeout from answer wait so we can
    // distinguish "broker unreachable" from "agent unreachable").
    await abortable(
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error("MQTT broker connect timeout")),
          MQTT_CONNECT_TIMEOUT_MS,
        );
        mqttClient!.on("connect", () => { clearTimeout(t); resolve(); });
        mqttClient!.on("error", (err: unknown) => {
          clearTimeout(t);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      }),
      signal,
    );
    checkAborted(signal);

    // Subscribe + publish + wait for answer (single composite timeout).
    const answerSdp = await abortable(
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`MQTT signaling timeout — no answer within ${MQTT_ANSWER_TIMEOUT_MS / 1000}s`)),
          MQTT_ANSWER_TIMEOUT_MS,
        );

        mqttClient!.on("error", (err: unknown) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        });

        mqttClient!.on("message", (topic: unknown, payload: unknown) => {
          if (topic !== topicAnswer) return;
          clearTimeout(timer);
          const raw = (payload as Buffer).toString("utf-8");

          // Agent publishes JSON error when mediamtx WHEP fails (e.g. no
          // active video stream). SDP always starts with "v=0"; JSON error
          // starts with "{". Fail fast with a descriptive message instead
          // of passing garbage to setRemoteDescription.
          if (raw.startsWith("{")) {
            try {
              const errPayload = JSON.parse(raw) as { error?: string; status?: number };
              if (errPayload.error) {
                const status = errPayload.status ?? 0;
                const msg = status === 404
                  ? "Agent video pipeline not running (no stream published to mediamtx)"
                  : `Agent WHEP relay error: ${errPayload.error} (status ${status})`;
                reject(new Error(msg));
                return;
              }
            } catch {
              // Not valid JSON, fall through to treat as SDP
            }
          }

          resolve(raw);
        });

        mqttClient!.subscribe(topicAnswer, (err: Error | null) => {
          if (err) {
            clearTimeout(timer);
            reject(new Error(`MQTT subscribe failed: ${err.message}`));
            return;
          }
          // Subscribed → publish offer (with low-latency SDP hint).
          //
          // The offer goes out at QoS 1, so the broker returns a PUBACK
          // carrying a reason code. A broker that refuses the publish
          // (reason 135, "Not authorized" — the credential can subscribe
          // but not publish) reports that refusal here and nowhere else:
          // the answer simply never arrives, and without this callback the
          // only symptom is the composite timeout above firing 30s later
          // with a message blaming the agent for a broker-side denial.
          // Surface it immediately, and name the real cause.
          const offerSdp = localPc!.localDescription!.sdp;
          mqttClient!.publish(topicOffer, offerSdp, { qos: 1 }, (pubErr) => {
            if (!pubErr) return;
            clearTimeout(timer);
            reject(
              new Error(
                `Broker refused the video signaling offer (${pubErr.message}). ` +
                  "This session can receive video state but cannot start a stream.",
              ),
            );
          });
        });
      }),
      signal,
    );
    checkAborted(signal);

    // === Stage: ontrack wait ===
    reportHealth("p2p-mqtt", { state: "testing", stage: "ontrack-wait" });
    const trackPromise = new Promise<MediaStream>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`No video track received within ${ONTRACK_TIMEOUT_MS / 1000} seconds`)),
        ONTRACK_TIMEOUT_MS,
      );
      localPc!.ontrack = (event) => {
        if (event.streams[0]) {
          clearTimeout(timeout);
          resolve(event.streams[0]);
        }
      };
    });

    await abortable(localPc.setRemoteDescription({ type: "answer", sdp: answerSdp }), signal);
    const stream = await abortable(trackPromise, signal);
    checkAborted(signal);

    // === Stage: connected ===
    const elapsedMs = Date.now() - startedAt;
    store.setStreamUrl(`mqtt://${deviceId}/webrtc`);
    store.setStreaming(true);
    store.setTransport("p2p-mqtt");
    // Report connection establishment time, NOT live RTT.
    reportHealth("p2p-mqtt", { state: "ok", stage: "connected", connectMs: elapsedMs });
    startStatsPolling();
    // Attach SEI script transform on the receiver to enable true
    // camera→monitor latency. Pass-through only — never modifies
    // frames; no-ops on browsers without RTCRtpScriptTransform.
    attachSeiTransform(localPc);

    return stream;
  } catch (err) {
    // Tear down the local pc on any failure. Only clear the global if we're
    // still the active pc.
    if (localPc) {
      closePeerConnection(localPc);
      if (localPc === getPc()) setPc(null);
    }
    const { code, message } = classifyError(err);
    reportHealth("p2p-mqtt", { state: "failed", code, error: message });
    throw err;
  } finally {
    // Guaranteed mqtt.js client cleanup. Earlier the .end(true) call
    // lived inside the inner Promise handlers — if any unrelated error
    // path threw before reaching them, the broker connection leaked.
    if (mqttClient) {
      try { mqttClient.end(true); } catch { /* noop */ }
    }
  }
}
