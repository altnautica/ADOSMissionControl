import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTelemetryStore } from '@/stores/telemetry-store';
import { RingBuffer } from '@/lib/ring-buffer';

describe('telemetry-store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useTelemetryStore.setState({
      _version: 0,
      attitude: new RingBuffer(600),
      position: new RingBuffer(300),
      battery: new RingBuffer(120),
      gps: new RingBuffer(300),
      gps2: new RingBuffer(300),
      vfr: new RingBuffer(600),
      rc: new RingBuffer(600),
      sysStatus: new RingBuffer(60),
      radio: new RingBuffer(120),
      ekf: new RingBuffer(60),
      vibration: new RingBuffer(120),
      servoOutput: new RingBuffer(300),
      wind: new RingBuffer(60),
      terrain: new RingBuffer(60),
      localPosition: new RingBuffer(300),
      debug: new RingBuffer(300),
      gimbal: new RingBuffer(60),
      obstacle: new RingBuffer(30),
      scaledImu: new RingBuffer(120),
      homePosition: new RingBuffer(12),
      powerStatus: new RingBuffer(60),
      distanceSensor: new RingBuffer(120),
      fenceStatus: new RingBuffer(60),
      estimatorStatus: new RingBuffer(60),
      cameraTrigger: new RingBuffer(100),
      navController: new RingBuffer(120),
    });
  });

  afterEach(() => {
    // Flush any pending RAF/setTimeout version bumps before restoring real timers
    vi.advanceTimersByTime(20);
    vi.useRealTimers();
  });

  it('initial state has empty ring buffers', () => {
    const state = useTelemetryStore.getState();
    expect(state.attitude.length).toBe(0);
    expect(state.position.length).toBe(0);
    expect(state.battery.length).toBe(0);
    expect(state.gps.length).toBe(0);
    expect(state._version).toBe(0);
  });

  it('pushAttitude() adds to attitude ring buffer', () => {
    const data = { roll: 0.1, pitch: 0.2, yaw: 0.3, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0, timestamp: Date.now() } as any;
    useTelemetryStore.getState().pushAttitude(data);

    const state = useTelemetryStore.getState();
    expect(state.attitude.length).toBe(1);
    expect(state.attitude.latest()).toEqual(data);
  });

  it('pushPosition() adds to position ring buffer', () => {
    const data = { lat: 12.97, lon: 77.59, alt: 100, relativeAlt: 50, vx: 0, vy: 0, vz: 0, hdg: 180, timestamp: Date.now() } as any;
    useTelemetryStore.getState().pushPosition(data);

    const state = useTelemetryStore.getState();
    expect(state.position.length).toBe(1);
    expect(state.position.latest()).toEqual(data);
  });

  it('pushBattery() adds battery data', () => {
    const data = { voltage: 12.6, current: 5.0, remaining: 80, timestamp: Date.now() } as any;
    useTelemetryStore.getState().pushBattery(data);

    const state = useTelemetryStore.getState();
    expect(state.battery.length).toBe(1);
    expect(state.battery.latest()).toEqual(data);
  });

  it('clear() resets all ring buffers', () => {
    const attData = { roll: 0.1, pitch: 0.2, yaw: 0.3, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0, timestamp: Date.now() } as any;
    const posData = { lat: 12.97, lon: 77.59, alt: 100, relativeAlt: 50, vx: 0, vy: 0, vz: 0, hdg: 180, timestamp: Date.now() } as any;
    const store = useTelemetryStore.getState();
    store.pushAttitude(attData);
    store.pushPosition(posData);

    expect(useTelemetryStore.getState().attitude.length).toBe(1);
    expect(useTelemetryStore.getState().position.length).toBe(1);

    useTelemetryStore.getState().clear();

    const after = useTelemetryStore.getState();
    expect(after.attitude.length).toBe(0);
    expect(after.position.length).toBe(0);
  });

  it('_version increments on push operations', () => {
    expect(useTelemetryStore.getState()._version).toBe(0);

    useTelemetryStore.getState().pushAttitude({ roll: 0, pitch: 0, yaw: 0, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0, timestamp: 0 } as any);
    vi.advanceTimersByTime(16);
    expect(useTelemetryStore.getState()._version).toBe(1);

    useTelemetryStore.getState().pushBattery({ voltage: 12, current: 1, remaining: 90, timestamp: 0 } as any);
    vi.advanceTimersByTime(16);
    expect(useTelemetryStore.getState()._version).toBe(2);

    useTelemetryStore.getState().pushGps({ fixType: 3, satellitesVisible: 10, lat: 0, lon: 0, alt: 0, timestamp: 0 } as any);
    vi.advanceTimersByTime(16);
    expect(useTelemetryStore.getState()._version).toBe(3);
  });

  it('ring buffers respect capacity limits', () => {
    // homePosition has capacity 12
    const store = useTelemetryStore.getState();
    for (let i = 0; i < 20; i++) {
      store.pushHomePosition({ lat: i, lon: i, alt: i, timestamp: i } as any);
    }

    const hp = useTelemetryStore.getState().homePosition;
    expect(hp.length).toBe(12);
    expect(hp.isFull).toBe(true);
    // Oldest should be entry 8 (entries 0-7 overwritten)
    expect(hp.get(0)).toEqual({ lat: 8, lon: 8, alt: 8, timestamp: 8 });
  });

  it('pushBatch() adds multiple channels in one version bump', () => {
    const versionBefore = useTelemetryStore.getState()._version;

    useTelemetryStore.getState().pushBatch({
      attitude: { roll: 0.1, pitch: 0.2, yaw: 0.3, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0, timestamp: 0 } as any,
      battery: { voltage: 12, current: 1, remaining: 90, timestamp: 0 } as any,
    });

    vi.advanceTimersByTime(16);

    const state = useTelemetryStore.getState();
    expect(state.attitude.length).toBe(1);
    expect(state.battery.length).toBe(1);
    // Only one version increment for the entire batch
    expect(state._version).toBe(versionBefore + 1);
  });
});
