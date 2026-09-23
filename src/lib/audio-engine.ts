/**
 * Web Audio API oscillator engine for GCS audio alerts.
 * No audio files needed — synthesizes all sounds from oscillators.
 * Lazy AudioContext creation (browser autoplay policy).
 *
 * @module audio-engine
 * @license GPL-3.0-only
 */

type WaveType = "sine" | "square" | "sawtooth" | "triangle";

interface ToneStep {
  frequency: number;
  duration: number;
  type: WaveType;
}

type SoundPattern = ToneStep[];

const SOUND_PATTERNS: Record<string, SoundPattern> = {
  low_battery: [
    { frequency: 880, duration: 150, type: "square" },
    { frequency: 660, duration: 150, type: "square" },
    { frequency: 440, duration: 150, type: "square" },
  ],
  gps_lost: [
    { frequency: 1200, duration: 100, type: "sine" },
    { frequency: 1200, duration: 100, type: "sine" },
    { frequency: 800, duration: 100, type: "sine" },
  ],
  rc_lost: [
    { frequency: 600, duration: 100, type: "sawtooth" },
    { frequency: 900, duration: 100, type: "sawtooth" },
    { frequency: 1200, duration: 100, type: "sawtooth" },
  ],
  failsafe: [
    { frequency: 1400, duration: 80, type: "square" },
    { frequency: 800, duration: 80, type: "square" },
    { frequency: 1400, duration: 80, type: "square" },
    { frequency: 800, duration: 80, type: "square" },
    { frequency: 1400, duration: 80, type: "square" },
    { frequency: 800, duration: 80, type: "square" },
    { frequency: 1400, duration: 80, type: "square" },
    { frequency: 800, duration: 80, type: "square" },
    { frequency: 1400, duration: 80, type: "square" },
    { frequency: 800, duration: 80, type: "square" },
  ],
  arm: [
    { frequency: 523, duration: 80, type: "sine" },
    { frequency: 659, duration: 80, type: "sine" },
    { frequency: 784, duration: 80, type: "sine" },
  ],
  disarm: [
    { frequency: 784, duration: 80, type: "sine" },
    { frequency: 659, duration: 80, type: "sine" },
    { frequency: 523, duration: 80, type: "sine" },
  ],
  waypoint_reached: [
    { frequency: 1047, duration: 60, type: "sine" },
  ],
  mission_complete: [
    { frequency: 523, duration: 80, type: "sine" },
    { frequency: 659, duration: 80, type: "sine" },
    { frequency: 784, duration: 80, type: "sine" },
    { frequency: 1047, duration: 120, type: "sine" },
  ],
  error: [
    { frequency: 200, duration: 200, type: "square" },
    { frequency: 200, duration: 200, type: "square" },
  ],
};

const COOLDOWN_MS = 5000;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private enabled = true;
  private volume = 0.7;
  private lastPlayed = new Map<string, number>();

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = this.volume;
      this.gainNode.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /** Schedule one pattern from the context's current time, tones 20 ms apart. */
  private scheduleTones(ctx: AudioContext, pattern: ToneStep[]): void {
    const gain = this.gainNode;
    if (!gain) return;
    let offset = ctx.currentTime;
    const GAP = 0.02;
    for (const step of pattern) {
      const osc = ctx.createOscillator();
      osc.type = step.type;
      osc.frequency.value = step.frequency;
      osc.connect(gain);
      osc.start(offset);
      osc.stop(offset + step.duration / 1000);
      offset += step.duration / 1000 + GAP;
    }
  }

  /**
   * Play an alert tone. A context the autoplay policy still holds suspended
   * would queue the tones and release them all at the first user gesture,
   * long after the event, so the alert is skipped instead and its cooldown is
   * not consumed; the resume attempt lets the next alert sound.
   */
  play(sound: string): void {
    if (!this.enabled) return;
    if (typeof window === "undefined") return;

    const pattern = SOUND_PATTERNS[sound];
    if (!pattern) return;

    const now = Date.now();
    const lastTime = this.lastPlayed.get(sound) ?? 0;
    if (now - lastTime < COOLDOWN_MS) return;

    const ctx = this.ensureContext();
    if (ctx.state !== "running") {
      ctx.resume().catch(() => {});
      return;
    }
    this.lastPlayed.set(sound, now);
    this.scheduleTones(ctx, pattern);
  }

  /** Play a sound, bypassing cooldown. Used by settings preview buttons, whose
   * click is the user gesture that lets a suspended context resume. */
  playForce(sound: string): void {
    if (!this.enabled) return;
    if (typeof window === "undefined") return;

    const pattern = SOUND_PATTERNS[sound];
    if (!pattern) return;

    const ctx = this.ensureContext();
    if (ctx.state === "running") {
      this.scheduleTones(ctx, pattern);
      return;
    }
    ctx
      .resume()
      .then(() => this.scheduleTones(ctx, pattern))
      .catch(() => {});
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume;
    }
  }

  getEnabled(): boolean {
    return this.enabled;
  }

  getVolume(): number {
    return this.volume;
  }
}

export const audioEngine = new AudioEngine();
