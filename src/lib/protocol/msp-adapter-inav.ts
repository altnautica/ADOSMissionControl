/**
 * iNav-specific MSP adapter functions.
 *
 * Mission upload/download, safehomes, geozones, battery config, mixer,
 * servo config, OSD, tuning (MC braking, rate dynamics, EZ tune), FW
 * approach, programming (logic conditions, programming PIDs, global vars),
 * and temp-sensor config readout.
 *
 * All multi-byte MSP2 codes (>254) route through the V2 encoder
 * automatically via the `MspSerialQueue`.
 *
 * This module is a facade over the msp-adapter/inav/ folder. Each feature
 * lives in its own file; this barrel just re-exports them.
 *
 * @module protocol/msp-adapter-inav
 */

export {
  inavDownloadMission,
  inavUploadMission,
  inavDownloadSafehomes,
  inavUploadSafehomes,
  inavDownloadGeozones,
  inavUploadGeozones,
} from './msp-adapter/inav/mission'

export {
  inavGetBatteryConfig,
  inavSetBatteryConfig,
  inavSelectBatteryProfile,
  inavGetActiveProfiles,
  inavSelectControlProfile,
} from './msp-adapter/inav/battery'

export {
  inavGetMixerConfig,
  inavSelectMixerProfile,
  inavGetOutputMapping,
  inavGetTimerOutputModes,
  inavSetTimerOutputMode,
  inavGetServoConfigs,
  inavSetServoConfig,
  inavDownloadMotorMixer,
  inavUploadMotorMixer,
  inavDownloadServoMixer,
  inavUploadServoMixer,
} from './msp-adapter/inav/mixer'

export { inavGetTempSensorConfigs, inavGetTemperatures, inavGetCalibrationData } from './msp-adapter/inav/sensors'

export {
  inavGetMcBraking,
  inavSetMcBraking,
  inavGetRateDynamics,
  inavSetRateDynamics,
  inavGetEzTune,
  inavSetEzTune,
} from './msp-adapter/inav/tuning'

export {
  inavGetFwApproach,
  inavSetFwApproach,
} from './msp-adapter/inav/fw-approach'

export {
  inavGetOsdLayoutsHeader,
  inavGetOsdAlarms,
  inavSetOsdAlarms,
  inavGetOsdPreferences,
  inavSetOsdPreferences,
  inavGetCustomOsdElements,
  inavSetCustomOsdElement,
} from './msp-adapter/inav/osd'

export {
  inavDownloadLogicConditions,
  inavUploadLogicCondition,
  inavDownloadLogicConditionsStatus,
  inavDownloadGvarStatus,
  inavSetGvar,
  inavDownloadProgrammingPids,
  inavUploadProgrammingPid,
  inavDownloadProgrammingPidStatus,
} from './msp-adapter/inav/programming'
