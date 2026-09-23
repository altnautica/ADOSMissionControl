/**
 * iNav OSD encoders: alarms, preferences, custom OSD elements.
 *
 * @module protocol/msp/encoders/inav/osd
 */

import type {
  INavOsdAlarms,
  INavOsdPreferences,
  INavCustomOsdElement,
  INavCustomOsdElementsInfo,
} from '../../msp-decoders-inav';

/**
 * Encode MSP2_INAV_OSD_SET_ALARMS (0x2015) payload.
 *
 * 28 bytes matching decodeMspINavOsdAlarms layout:
 * U8 rssi, U16 flyMinutes, U16 maxAltitude, U16 distance,
 * U16 maxNegAltitude, U16 gforce, S16 gforceAxisMin, S16 gforceAxisMax,
 * U8 current, S16 imuTempMin, S16 imuTempMax,
 * S16 baroTempMin, S16 baroTempMax, S16 adsbDistanceWarning, S16 adsbDistanceAlert
 */
export function encodeMspINavSetOsdAlarms(a: INavOsdAlarms): Uint8Array {
  const buf = new ArrayBuffer(28);
  const dv = new DataView(buf);
  dv.setUint8(0, a.rssi);
  dv.setUint16(1, a.flyMinutes, true);
  dv.setUint16(3, a.maxAltitude, true);
  dv.setUint16(5, a.distance, true);
  dv.setUint16(7, a.maxNegAltitude, true);
  dv.setUint16(9, a.gforce, true);
  dv.setInt16(11, a.gforceAxisMin, true);
  dv.setInt16(13, a.gforceAxisMax, true);
  dv.setUint8(15, a.current);
  dv.setInt16(16, a.imuTempMin, true);
  dv.setInt16(18, a.imuTempMax, true);
  dv.setInt16(20, a.baroTempMin, true);
  dv.setInt16(22, a.baroTempMax, true);
  dv.setInt16(24, a.adsbDistanceWarning, true);
  dv.setInt16(26, a.adsbDistanceAlert, true);
  return new Uint8Array(buf);
}

/**
 * Encode MSP2_INAV_OSD_SET_PREFERENCES (0x2017) payload.
 *
 * 10 bytes matching decodeMspINavOsdPreferences layout.
 */
export function encodeMspINavSetOsdPreferences(p: INavOsdPreferences): Uint8Array {
  return new Uint8Array([
    p.videoSystem,
    p.mainVoltageDecimals,
    p.ahiReverseRoll,
    p.crosshairsStyle,
    p.leftSidebarScroll,
    p.rightSidebarScroll,
    p.sidebarScrollArrows,
    p.units,
    p.statsEnergyUnit,
    p.adsbWarningStyle,
  ]);
}

/**
 * Encode MSP2_INAV_SET_CUSTOM_OSD_ELEMENTS (0x2102) payload for one element.
 * The FC accepts exactly 1 + partCount x 3 + 3 + textLength bytes:
 *
 * U8  index
 * partCount x (U8 type, U16 value)
 * U8  visibilityType, U16 visibilityValue
 * textLength bytes of ASCII text, NUL-padded
 *
 * `info` is the FC's own MSP2_INAV_CUSTOM_OSD_ELEMENTS reply, so the frame
 * always matches the size the firmware checks for.
 */
export function encodeMspINavSetCustomOsdElement(
  el: INavCustomOsdElement,
  info: INavCustomOsdElementsInfo,
): Uint8Array {
  if (el.parts.length !== info.partCount) {
    throw new Error(`Custom OSD element needs ${info.partCount} parts, got ${el.parts.length}`);
  }
  const buf = new Uint8Array(1 + info.partCount * 3 + 3 + info.textLength);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, el.index);
  let offset = 1;
  for (const part of el.parts) {
    dv.setUint8(offset, part.type);
    dv.setUint16(offset + 1, part.value, true);
    offset += 3;
  }
  dv.setUint8(offset, el.visibility.type);
  dv.setUint16(offset + 1, el.visibility.value, true);
  offset += 3;
  const text = el.text.slice(0, info.textLength);
  for (let i = 0; i < text.length; i++) {
    buf[offset + i] = text.charCodeAt(i) & 0x7f;
  }
  return buf;
}
