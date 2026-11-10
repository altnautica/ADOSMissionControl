/**
 * The demo FC's peripherals and stored plans: the geofence and rally points,
 * the vehicle camera, Betaflight's LED strip, mode and adjustment ranges,
 * serial ports, OSD font and onboard storage. `MockProtocol` extends this, so
 * the demo vehicle carries them without growing mock-protocol.ts.
 *
 * @license GPL-3.0-only
 */

import type {
  CameraInformationCallback, CommandResult, FenceElement, MspAdjustmentRange, MspModeRange,
  RallyPointItem, VehicleInfo,
} from "@/lib/protocol/types";
import { MOCK_FENCE_POLYGON } from "./mock-protocol-data";
import { MockRanges } from "./mock-protocol-ranges";
import { MockBfStorage } from "./mock-protocol-bf-storage";
import { MockCamera } from "./mock-protocol-camera";

function ok(message = "OK"): CommandResult { return { success: true, resultCode: 0, message }; }

/** MSP firmwares: no MAVLink camera behind them. */
const MSP_FIRMWARES: Partial<Record<VehicleInfo["firmwareType"], true>> = { betaflight: true, inav: true };

export abstract class MockProtocolPeripherals {
  private rallyPoints: RallyPointItem[] = [];
  private fenceElements: FenceElement[] = [];

  abstract emitStatusText(severity: number, text: string): void;
  abstract getVehicleInfo(): VehicleInfo;

  // ── Commands ───────────────────────────────────────────
  /** COMMAND_LONG: the vehicle camera acks its own commands; the rest are accepted. */
  async sendCommand(commandId: number, params: number[] = []): Promise<CommandResult> {
    return (await this.camera.ackCommand(commandId, params)) ?? ok("Command sent");
  }

  // ── Vehicle camera (MAVLink) ───────────────────────────
  private camera = new MockCamera(() => !MSP_FIRMWARES[this.getVehicleInfo().firmwareType]);
  onCameraInformation(cb: CameraInformationCallback): () => void { return this.camera.onCameraInformation(cb); }
  imageStartCapture(): Promise<CommandResult> { return this.camera.imageStartCapture(); }
  setCameraZoom(step: 1 | -1): Promise<CommandResult> { return this.camera.setCameraZoom(step); }

  // ── Fence / Rally ──────────────────────────────────────
  // PX4 stores the geofence as a mission plan (mission_type = fence). Round-trip
  // the uploaded elements so the demo mission-fence path is real, not a no-op.
  async uploadFenceMission(elements: FenceElement[]): Promise<CommandResult> {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 500);
    await promise;
    this.fenceElements = elements.map((el) => ({ ...el }));
    this.emitStatusText(6, `Fence uploaded (${elements.length} elements)`);
    return ok("Fence uploaded");
  }
  async downloadFenceMission(): Promise<FenceElement[]> {
    if (this.fenceElements.length > 0) return this.fenceElements.map((el) => ({ ...el }));
    // No fence uploaded yet: return the mock polygon as a single inclusion zone.
    return [{
      kind: "polygon",
      role: "inclusion",
      vertices: MOCK_FENCE_POLYGON.map((p) => ({ lat: p.lat, lon: p.lon })),
    }];
  }
  async uploadRallyPoints(pts: RallyPointItem[]): Promise<CommandResult> {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 300);
    await promise;
    this.rallyPoints = pts.map((p) => ({ ...p }));
    this.emitStatusText(6, `${pts.length} rally points uploaded`);
    return ok("Rally points uploaded");
  }
  async downloadRallyPoints() { return [...this.rallyPoints]; }

  // ── Betaflight LED strip (mock) ────────────────────────
  async getLedStripConfig(): Promise<number[]> {
    // 8 LEDs, palette colour index cycling 0..7 (color field = bits 22..25).
    return Array.from({ length: 8 }, (_, i) => (i << 22) >>> 0);
  }
  async setLedStripConfig(): Promise<CommandResult> { return ok("LED config written"); }
  async getLedColors() {
    // A 16-entry rainbow palette.
    return Array.from({ length: 16 }, (_, i) => ({ h: Math.round((i * 360) / 16), s: 255, v: 255 }));
  }
  async setLedColors(): Promise<CommandResult> { return ok("LED colours written"); }
  async getLedStripModeColors() {
    const out: { mode: number; fun: number; color: number }[] = [];
    for (let mode = 0; mode < 6; mode++)
      for (let dir = 0; dir < 6; dir++) out.push({ mode, fun: dir, color: (mode + dir) % 16 });
    for (let fun = 0; fun < 11; fun++) out.push({ mode: 6, fun, color: fun % 16 });
    out.push({ mode: 7, fun: 0, color: 0 });
    return out;
  }
  async setLedStripModeColors(): Promise<CommandResult> { return ok("Mode colours written"); }

  // ── Mode and adjustment ranges (mock) ──────────────────
  private ranges = new MockRanges();
  async getModeBoxes() { return this.ranges.boxes(); }
  async getModeRanges() { return this.ranges.modeRanges(); }
  async setModeRanges(r: MspModeRange[]): Promise<CommandResult> { return this.ranges.setModeRanges(r); }
  async getAdjustmentRanges() { return this.ranges.adjustmentRanges(); }
  async setAdjustmentRanges(r: MspAdjustmentRange[]): Promise<CommandResult> { return this.ranges.setAdjustmentRanges(r); }

  // ── Betaflight serial ports (mock, MSP2 32-bit mask) ───
  async getSerialConfig() {
    return [
      { identifier: 20, functions: 1, mspBaudRate: 0, gpsBaudRate: 0, telemetryBaudRate: 0, blackboxBaudRate: 0 }, // USB VCP: MSP
      { identifier: 51, functions: 1 << 16, mspBaudRate: 5, gpsBaudRate: 0, telemetryBaudRate: 0, blackboxBaudRate: 0 }, // UART1: FrSky OSD (bit 16)
      { identifier: 52, functions: 1 << 6, mspBaudRate: 0, gpsBaudRate: 5, telemetryBaudRate: 0, blackboxBaudRate: 0 }, // UART2: Serial RX
    ];
  }
  async setSerialConfig(): Promise<CommandResult> { return ok("Serial config written"); }
  serialConfigExtended(): boolean { return true; }
  async sendDshotCommand(): Promise<CommandResult> { return ok("DShot command sent"); }
  async uploadOsdFont(glyphs: Uint8Array[], onProgress?: (done: number, total: number) => void): Promise<CommandResult> { onProgress?.(glyphs.length, glyphs.length); return ok(`Uploaded ${glyphs.length} font glyphs`); }
  private bfStorage = new MockBfStorage();
  getOsdConfig() { return this.bfStorage.getOsdConfig(); }
  writeOsdLayout(...a: Parameters<MockBfStorage["writeOsdLayout"]>) { return this.bfStorage.writeOsdLayout(...a); }
  getDataflashSummary() { return this.bfStorage.getDataflashSummary(); }
  downloadBlackbox(...a: Parameters<MockBfStorage["downloadBlackbox"]>) { return this.bfStorage.downloadBlackbox(...a); }
  eraseDataflash() { return this.bfStorage.eraseDataflash(); }
  getVtxPowerLevels() { return this.bfStorage.getVtxPowerLevels(); }
}
