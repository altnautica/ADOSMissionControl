/**
 * Every option list wrapped with `useOptionLabels` has each label (and
 * description) in the English `optionLabels` catalog, and a translated
 * catalog changes what the mapper renders.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import messages from "../../locales/en.json";
import { optionLabelKey, useOptionLabels } from "@/lib/i18n/option-labels";
import { BF_SERIAL_FUNCTIONS, BF_SERIAL_FUNCTIONS_EXTENDED } from "@/components/fc/betaflight/bf-ports-constants";
import { ACCEL_STEPS, AIRSPEED_STEPS, BARO_STEPS, COMPASSMOT_STEPS, COMPASS_STEPS, ESC_CAL_STEPS, GYRO_STEPS, LEVEL_STEPS } from "@/components/fc/calibration/calibration-types";
import { DEVICE_OPTIONS } from "@/components/fc/comms/blackbox-constants";
import { PX4_BAUD_OPTIONS } from "@/components/fc/comms/ports-constants";
import { FIRMWARE_STACKS, VEHICLE_TYPES } from "@/components/fc/firmware/firmware-constants";
import { ROVER_FRAME_CLASS_OPTIONS, ROVER_FRAME_TYPE_OPTIONS, SUB_FRAME_CONFIG_OPTIONS } from "@/components/fc/frame/ardupilot-frame-enums";
import { MNT_MODE_OPTIONS, MNT_TYPE_OPTIONS } from "@/components/fc/gimbal/gimbal-constants";
import { EZ_TUNE_FIELDS } from "@/components/fc/inav/ez-tune-fields";
import { TIMER_OUTPUT_MODE_OPTIONS } from "@/components/fc/inav/inav-output-mapping";
import { LOW_POWER_DISARM_OPTIONS, PIT_MODE_OPTIONS } from "@/components/fc/misc/vtx-constants";
import { ESC_PROTOCOLS } from "@/components/fc/motors/bf-motor-protocols";
import { COPTER_ACRO_PARAMS, FILTER_PARAMS, PLANE_ACRO_PARAMS, ROVER_NAV_PARAMS } from "@/components/fc/pid/pid-constants";
import { LIMITS, SENSOR_TYPES, TRIGGER_OPTIONS } from "@/components/fc/px4/px4-thermal-params";
import { FS_OPTION_BITS } from "@/components/fc/safety/failsafe-constants";
import { AP_GPS_AUTO_CONFIG_OPTIONS, AP_GPS_AUTO_SWITCH_OPTIONS, AP_GPS_MB_TYPE_OPTIONS, AP_GPS_NAVFILTER_OPTIONS, AP_GPS_PRIMARY_OPTIONS, AP_GPS_RATE_OPTIONS, AP_GPS_SBAS_OPTIONS, AP_GPS_TYPE_OPTIONS } from "@/components/fc/sensors/ap-gps-constants";
import { SANITY_CHECK_OPTIONS, SBAS_MODE_OPTIONS } from "@/components/fc/sensors/gps-constants";
import { STREAM_GROUPS } from "@/components/fc/streams/stream-rate-params";

const LISTS: Record<string, readonly { label?: string; description?: string }[]> = {
  ACCEL_STEPS,
  AIRSPEED_STEPS,
  AP_GPS_AUTO_CONFIG_OPTIONS,
  AP_GPS_AUTO_SWITCH_OPTIONS,
  AP_GPS_MB_TYPE_OPTIONS,
  AP_GPS_NAVFILTER_OPTIONS,
  AP_GPS_PRIMARY_OPTIONS,
  AP_GPS_RATE_OPTIONS,
  AP_GPS_SBAS_OPTIONS,
  AP_GPS_TYPE_OPTIONS,
  BARO_STEPS,
  BF_SERIAL_FUNCTIONS,
  BF_SERIAL_FUNCTIONS_EXTENDED,
  COMPASSMOT_STEPS,
  COMPASS_STEPS,
  COPTER_ACRO_PARAMS,
  DEVICE_OPTIONS,
  ESC_CAL_STEPS,
  ESC_PROTOCOLS,
  EZ_TUNE_FIELDS,
  FILTER_PARAMS,
  FIRMWARE_STACKS,
  FS_OPTION_BITS,
  GYRO_STEPS,
  LEVEL_STEPS,
  LIMITS,
  LOW_POWER_DISARM_OPTIONS,
  MNT_MODE_OPTIONS,
  MNT_TYPE_OPTIONS,
  PIT_MODE_OPTIONS,
  PLANE_ACRO_PARAMS,
  PX4_BAUD_OPTIONS,
  ROVER_FRAME_CLASS_OPTIONS,
  ROVER_FRAME_TYPE_OPTIONS,
  ROVER_NAV_PARAMS,
  SANITY_CHECK_OPTIONS,
  SBAS_MODE_OPTIONS,
  SENSOR_TYPES,
  STREAM_GROUPS,
  SUB_FRAME_CONFIG_OPTIONS,
  TIMER_OUTPUT_MODE_OPTIONS,
  TRIGGER_OPTIONS,
  VEHICLE_TYPES,
};

describe("option label catalog", () => {
  it("has every wrapped label and description in English", () => {
    const catalog = (messages as Record<string, unknown>).optionLabels as Record<string, string>;
    const missing: string[] = [];
    for (const [name, list] of Object.entries(LISTS)) {
      for (const o of list) {
        if (typeof o.label !== "string") {
          missing.push(`${name}: entry without a label`);
          continue;
        }
        if (catalog?.[optionLabelKey(o.label)] !== o.label) missing.push(o.label);
        if (typeof o.description === "string" && catalog?.[optionLabelKey(o.description)] !== o.description) missing.push(o.description);
      }
    }
    expect(missing).toEqual([]);
  });

  it("swaps labels for the active locale's text", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale="de" messages={{ optionLabels: { [optionLabelKey("Auto")]: "Automatisch" } }}>
        {children}
      </NextIntlClientProvider>
    );
    const { result } = renderHook(() => useOptionLabels(), { wrapper });
    expect(result.current([{ value: 0, label: "Auto" }])[0].label).toBe("Automatisch");
  });
});
