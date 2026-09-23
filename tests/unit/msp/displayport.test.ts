/**
 * MSP DisplayPort (182) decoder + screen-model tests.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  decodeMspDisplayPort,
  DISPLAYPORT_SUBCMD,
  DP_ATTR_BLINK,
} from "@/lib/protocol/msp/decoders/config/displayport";
import { DisplayPortScreen } from "@/lib/osd/displayport-screen";
import { useDisplayPortStore } from "@/stores/displayport-store";
import type { DisplayPortOp } from "@/lib/protocol/msp/decoders/config/displayport";
import type { DroneProtocol } from "@/lib/protocol/types";

function dv(bytes: number[]): DataView {
  return new DataView(new Uint8Array(bytes).buffer);
}

function writeStringFrame(row: number, col: number, attr: number, text: string): number[] {
  return [DISPLAYPORT_SUBCMD.WRITE_STRING, row, col, attr, ...[...text].map((c) => c.charCodeAt(0))];
}

describe("decodeMspDisplayPort", () => {
  it("decodes WRITE_STRING with row-then-col order and attribute bits", () => {
    const op = decodeMspDisplayPort(dv(writeStringFrame(2, 5, DP_ATTR_BLINK | 0x02, "ALT 120")));
    expect(op.kind).toBe("writeString");
    if (op.kind !== "writeString") throw new Error("wrong kind");
    expect(op.row).toBe(2);
    expect(op.col).toBe(5);
    expect(op.text).toBe("ALT 120");
    expect(op.blink).toBe(true);
    expect(op.fontPage).toBe(2);
  });

  it("decodes the control sub-commands", () => {
    expect(decodeMspDisplayPort(dv([DISPLAYPORT_SUBCMD.CLEAR_SCREEN])).kind).toBe("clear");
    expect(decodeMspDisplayPort(dv([DISPLAYPORT_SUBCMD.DRAW_SCREEN])).kind).toBe("draw");
    expect(decodeMspDisplayPort(dv([DISPLAYPORT_SUBCMD.HEARTBEAT])).kind).toBe("heartbeat");
    const opt = decodeMspDisplayPort(dv([DISPLAYPORT_SUBCMD.OPTIONS, 0, 2]));
    expect(opt).toEqual({ kind: "options", fontType: 0, resolution: 2 });
  });
});

describe("DisplayPortScreen", () => {
  it("applies write/clear/draw to the grid", () => {
    const s = new DisplayPortScreen(30, 16);
    s.applyOp(decodeMspDisplayPort(dv(writeStringFrame(2, 5, 0, "ALT 120"))));
    const done = s.applyOp(decodeMspDisplayPort(dv([DISPLAYPORT_SUBCMD.DRAW_SCREEN])));
    expect(done).toBe(true);
    expect(s.toLines()[2].slice(5, 12)).toBe("ALT 120");

    s.applyOp(decodeMspDisplayPort(dv([DISPLAYPORT_SUBCMD.CLEAR_SCREEN])));
    expect(s.toLines()[2].trim()).toBe("");
  });

  it("resizes the grid on an OPTIONS resolution change", () => {
    const s = new DisplayPortScreen(30, 16);
    s.applyOp(decodeMspDisplayPort(dv([DISPLAYPORT_SUBCMD.OPTIONS, 0, 2]))); // HD_6022 = 60x22
    expect(s.cols).toBe(60);
    expect(s.rows).toBe(22);
  });

  it("renders non-ASCII font glyphs as a placeholder", () => {
    const s = new DisplayPortScreen(30, 16);
    s.applyOp(decodeMspDisplayPort(dv([DISPLAYPORT_SUBCMD.WRITE_STRING, 0, 0, 0, 0xb0, 0x41]))); // glyph + 'A'
    expect(s.toLines()[0].slice(0, 2)).toBe("·A");
  });

  it("blanks the grid when the FC releases the display", () => {
    const s = new DisplayPortScreen(30, 16);
    s.applyOp(decodeMspDisplayPort(dv(writeStringFrame(1, 0, 0, "ARMED"))));
    s.applyOp(decodeMspDisplayPort(dv([DISPLAYPORT_SUBCMD.RELEASE])));
    expect(s.toLines()[1].trim()).toBe("");
  });

  it("renders codes from a non-ASCII font page as a placeholder, not letters", () => {
    const s = new DisplayPortScreen(30, 16);
    s.applyOp(decodeMspDisplayPort(dv(writeStringFrame(0, 0, 0x01, "AB"))));
    expect(s.toLines()[0].slice(0, 2)).toBe("··");
  });
});

describe("displayport store", () => {
  it("drops the live frame when the FC releases the display", () => {
    let emit: (op: DisplayPortOp) => void = () => {};
    const protocol = {
      onDisplayPort: (cb: (op: DisplayPortOp) => void) => {
        emit = cb;
        return () => {};
      },
    } as unknown as DroneProtocol;
    useDisplayPortStore.getState().attach(protocol);

    emit(decodeMspDisplayPort(dv(writeStringFrame(1, 0, 0, "ARMED"))));
    emit(decodeMspDisplayPort(dv([DISPLAYPORT_SUBCMD.DRAW_SCREEN])));
    expect(useDisplayPortStore.getState().lastFrameAt).not.toBeNull();

    emit(decodeMspDisplayPort(dv([DISPLAYPORT_SUBCMD.RELEASE])));
    const after = useDisplayPortStore.getState();
    expect(after.lastFrameAt).toBeNull();
    expect(after.lines.join("").trim()).toBe("");
    after.detach();
  });
});
