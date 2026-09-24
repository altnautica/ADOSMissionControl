/**
 * Streaming MSP byte parser (state machine).
 *
 * Handles interleaved MSPv1 and MSPv2 frames in a single byte stream. Only
 * replies ('>') and error replies ('!') are emitted; a request frame ('<'),
 * such as one echoed back by a half-duplex link, is parsed and dropped.
 *
 * @module protocol/msp/msp-parser
 */

import { crc8DvbS2Update, xorChecksum } from './msp-codec';

// ── Types ──────────────────────────────────────────────────

export interface ParsedMspFrame {
  version: 1 | 2;
  command: number;
  payload: Uint8Array;
  direction: 'response' | 'error';
}

type FrameCallback = (frame: ParsedMspFrame) => void;

// ── Parser States ──────────────────────────────────────────

const enum State {
  IDLE = 0,
  PROTO_IDENTIFIER = 1,
  DIRECTION_V1 = 2,
  DIRECTION_V2 = 3,
  FLAG_V2 = 4,
  PAYLOAD_LENGTH_V1 = 5,
  PAYLOAD_LENGTH_JUMBO_LOW = 6,
  PAYLOAD_LENGTH_JUMBO_HIGH = 7,
  PAYLOAD_LENGTH_V2_LOW = 8,
  PAYLOAD_LENGTH_V2_HIGH = 9,
  CODE_V1 = 10,
  CODE_JUMBO_V1 = 11,
  CODE_V2_LOW = 12,
  CODE_V2_HIGH = 13,
  PAYLOAD_V1 = 14,
  PAYLOAD_V2 = 15,
  CHECKSUM_V1 = 16,
  CHECKSUM_V2 = 17,
}

// ── Protocol bytes ─────────────────────────────────────────

const DOLLAR = 0x24;
const M_CHAR = 0x4d;
const X_CHAR = 0x58;
const FROM_FC = 0x3e; // '>'
const TO_FC = 0x3c; // '<'
const ERROR_CHAR = 0x21; // '!'

const JUMBO_FRAME_MIN_SIZE = 255;

/**
 * Largest payload the parser will buffer. No flight-controller reply comes
 * close; a larger declared length is noise (e.g. a stray `$X` in CLI text),
 * and honouring it would swallow the following valid frames.
 */
export const MSP_MAX_PAYLOAD = 4096;

// ── Parser Class ───────────────────────────────────────────

export class MspParser {
  private state: State = State.IDLE;
  private version: 1 | 2 = 1;
  private isError = false;
  /** The frame being parsed is a request ('<'): checked, then dropped. */
  private isRequest = false;
  private code = 0;
  private expectedLength = 0;
  private receivedLength = 0;
  private buffer: Uint8Array = new Uint8Array(0);
  private crcV2 = 0;

  private frameCallbacks: FrameCallback[] = [];

  /** Feed raw bytes from transport. Parsed frames fire onFrame callbacks. */
  feed(data: Uint8Array): void {
    for (let i = 0; i < data.length; i++) {
      this.processByte(data[i]);
    }
  }

  /** Register a callback for completed MSP frames. Returns unsubscribe function. */
  onFrame(callback: FrameCallback): () => void {
    this.frameCallbacks.push(callback);
    return () => {
      const idx = this.frameCallbacks.indexOf(callback);
      if (idx !== -1) this.frameCallbacks.splice(idx, 1);
    };
  }

  /** Reset parser state (call on disconnect). */
  reset(): void {
    this.state = State.IDLE;
    this.version = 1;
    this.isError = false;
    this.isRequest = false;
    this.code = 0;
    this.expectedLength = 0;
    this.receivedLength = 0;
    this.buffer = new Uint8Array(0);
    this.crcV2 = 0;
  }

  private processByte(byte: number): void {
    switch (this.state) {
      // ── Sync char 1 ────────────────────────────────────
      case State.IDLE:
        if (byte === DOLLAR) {
          this.state = State.PROTO_IDENTIFIER;
        }
        break;

      // ── Sync char 2 (M or X) ──────────────────────────
      case State.PROTO_IDENTIFIER:
        if (byte === M_CHAR) {
          this.version = 1;
          this.state = State.DIRECTION_V1;
        } else if (byte === X_CHAR) {
          this.version = 2;
          this.state = State.DIRECTION_V2;
        } else {
          this.state = State.IDLE;
        }
        break;

      // ── Direction (V1 and V2) ──────────────────────────
      // Only '>' (reply), '<' (request echo) and '!' (error) are valid; any
      // other byte means the '$M'/'$X' was noise, so resync.
      case State.DIRECTION_V1:
      case State.DIRECTION_V2:
        if (byte !== FROM_FC && byte !== TO_FC && byte !== ERROR_CHAR) {
          this.state = State.IDLE;
          break;
        }
        this.isError = byte === ERROR_CHAR;
        this.isRequest = byte === TO_FC;
        this.state = this.state === State.DIRECTION_V1 ? State.PAYLOAD_LENGTH_V1 : State.FLAG_V2;
        break;

      // ── V2 Flag byte ──────────────────────────────────
      case State.FLAG_V2:
        // flags byte (currently ignored, reserved)
        this.crcV2 = crc8DvbS2Update(0, byte);
        this.state = State.CODE_V2_LOW;
        break;

      // ── V1: Payload length ─────────────────────────────
      case State.PAYLOAD_LENGTH_V1:
        this.expectedLength = byte;
        if (byte === JUMBO_FRAME_MIN_SIZE) {
          // Jumbo: real length comes after command byte
          this.state = State.CODE_JUMBO_V1;
        } else {
          this.initBuffer();
          this.state = State.CODE_V1;
        }
        break;

      // ── V1: Command byte (standard) ────────────────────
      case State.CODE_V1:
        this.code = byte;
        this.state = this.expectedLength > 0 ? State.PAYLOAD_V1 : State.CHECKSUM_V1;
        break;

      // ── V1: Command byte (jumbo, length follows) ───────
      case State.CODE_JUMBO_V1:
        this.code = byte;
        this.state = State.PAYLOAD_LENGTH_JUMBO_LOW;
        break;

      // ── V1: Jumbo length low byte ──────────────────────
      case State.PAYLOAD_LENGTH_JUMBO_LOW:
        this.expectedLength = byte;
        this.state = State.PAYLOAD_LENGTH_JUMBO_HIGH;
        break;

      // ── V1: Jumbo length high byte ─────────────────────
      case State.PAYLOAD_LENGTH_JUMBO_HIGH:
        this.expectedLength |= byte << 8;
        if (this.expectedLength > MSP_MAX_PAYLOAD) {
          this.state = State.IDLE;
          break;
        }
        this.initBuffer();
        this.state = this.expectedLength > 0 ? State.PAYLOAD_V1 : State.CHECKSUM_V1;
        break;

      // ── V2: Command low byte ──────────────────────────
      case State.CODE_V2_LOW:
        this.code = byte;
        this.crcV2 = crc8DvbS2Update(this.crcV2, byte);
        this.state = State.CODE_V2_HIGH;
        break;

      // ── V2: Command high byte ─────────────────────────
      case State.CODE_V2_HIGH:
        this.code |= byte << 8;
        this.crcV2 = crc8DvbS2Update(this.crcV2, byte);
        this.state = State.PAYLOAD_LENGTH_V2_LOW;
        break;

      // ── V2: Payload length low byte ────────────────────
      case State.PAYLOAD_LENGTH_V2_LOW:
        this.expectedLength = byte;
        this.crcV2 = crc8DvbS2Update(this.crcV2, byte);
        this.state = State.PAYLOAD_LENGTH_V2_HIGH;
        break;

      // ── V2: Payload length high byte ───────────────────
      case State.PAYLOAD_LENGTH_V2_HIGH:
        this.expectedLength |= byte << 8;
        if (this.expectedLength > MSP_MAX_PAYLOAD) {
          this.state = State.IDLE;
          break;
        }
        this.crcV2 = crc8DvbS2Update(this.crcV2, byte);
        this.initBuffer();
        this.state = this.expectedLength > 0 ? State.PAYLOAD_V2 : State.CHECKSUM_V2;
        break;

      // ── V1: Payload accumulation ───────────────────────
      case State.PAYLOAD_V1:
        this.buffer[this.receivedLength++] = byte;
        if (this.receivedLength >= this.expectedLength) {
          this.state = State.CHECKSUM_V1;
        }
        break;

      // ── V2: Payload accumulation ───────────────────────
      case State.PAYLOAD_V2:
        this.buffer[this.receivedLength++] = byte;
        this.crcV2 = crc8DvbS2Update(this.crcV2, byte);
        if (this.receivedLength >= this.expectedLength) {
          this.state = State.CHECKSUM_V2;
        }
        break;

      // ── V1: Checksum verification ─────────────────────
      case State.CHECKSUM_V1: {
        const expected = xorChecksum(this.expectedLength, this.code, this.buffer.subarray(0, this.receivedLength));
        if (expected === byte) {
          this.emitFrame();
        }
        // CRC fail: silently drop (matching BF Configurator behavior)
        this.state = State.IDLE;
        break;
      }

      // ── V2: Checksum verification ─────────────────────
      case State.CHECKSUM_V2:
        if (this.crcV2 === byte) {
          this.emitFrame();
        }
        this.state = State.IDLE;
        break;
    }
  }

  private initBuffer(): void {
    this.buffer = new Uint8Array(this.expectedLength);
    this.receivedLength = 0;
  }

  private emitFrame(): void {
    if (this.isRequest) return;
    const frame: ParsedMspFrame = {
      version: this.version,
      command: this.code,
      payload: this.buffer.slice(0, this.receivedLength),
      direction: this.isError ? 'error' : 'response',
    };
    for (const cb of this.frameCallbacks) {
      cb(frame);
    }
  }
}
