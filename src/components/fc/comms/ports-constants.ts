export const NUM_PORTS = 8;

/** Standard hardware labels for serial ports. */
export const HARDWARE_LABELS: string[] = [
  "USB", "Telem1", "Telem2", "GPS1", "GPS2", "USER", "USER", "USER",
];

/** Module-level const to avoid re-render loops in usePanelParams. */
export const PORT_PARAMS: string[] = Array.from({ length: NUM_PORTS }, (_, i) => [
  `SERIAL${i}_PROTOCOL`,
  `SERIAL${i}_BAUD`,
]).flat();

export const PX4_PORTS = [
  { label: "TELEM1", baudParam: "SER_TEL1_BAUD" },
  { label: "TELEM2", baudParam: "SER_TEL2_BAUD" },
  { label: "TELEM3", baudParam: "SER_TEL3_BAUD" },
  { label: "GPS1", baudParam: "SER_GPS1_BAUD" },
];

export const PX4_PORT_PARAMS: string[] = PX4_PORTS.map((p) => p.baudParam);

export const PX4_BAUD_OPTIONS = [
  { value: "0", label: "Auto" },
  { value: "9600", label: "9600" },
  { value: "19200", label: "19200" },
  { value: "38400", label: "38400" },
  { value: "57600", label: "57600" },
  { value: "115200", label: "115200" },
  { value: "230400", label: "230400" },
  { value: "460800", label: "460800" },
  { value: "921600", label: "921600" },
];
