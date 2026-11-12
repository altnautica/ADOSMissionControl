/**
 * Main DroneProtocol interface : the top-level API surface for the GCS.
 *
 * @module protocol/types/protocol
 */

// Re-export the settings value/metadata shapes so consumers can import them
// from the protocol contract barrel rather than reaching into the MSP layer.
export type { SettingInfo, SettingValue } from '../../msp/settings';
export { settingNumber } from '../../msp/settings';
export type { MspSerialPort } from '../../msp/decoders/config/serial';
export type { MspOsdConfig, MspOsdGeneralConfig } from '../../msp/decoders/config/osd';
export type { BfRxConfig } from '../../msp/decoders/config/rx';
export type { HsvColor, BfLedModeColor } from '../betaflight';
export type { MspModeBox, MspModeRange, MspAdjustmentRange } from '../../msp/msp-decoders-status';

import type { DroneProtocolBase } from './base';
import type { DroneProtocolMspExtensions } from './msp-extensions';
import type { DroneProtocolSubscriptions } from './subscriptions';
import type { DroneProtocolVehicleIo } from './vehicle-io';

export type { LinkInfo, FtpDirEntry, GuidedGotoOptions, CommandQueueSnapshot } from './base';

/**
 * Top-level protocol interface that the GCS talks to.
 *
 * Implementations (MAVLink, future MSP) fulfill this contract.
 * The Zustand `DroneManager` store holds a `DroneProtocol` per
 * connected vehicle and bridges telemetry callbacks into reactive
 * store state.
 */
export interface DroneProtocol
  extends DroneProtocolBase,
    DroneProtocolVehicleIo,
    DroneProtocolMspExtensions,
    DroneProtocolSubscriptions {}
