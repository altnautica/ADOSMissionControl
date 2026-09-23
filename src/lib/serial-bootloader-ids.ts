/**
 * Known serial-bootloader USB identities for flight controllers, plus a
 * VID/PID matcher and a Web Serial filter builder.
 *
 * Native-USB flight controllers (e.g. STM32H7 boards) re-enumerate as a
 * SEPARATE USB device when they reboot from the running app into their
 * serial bootloader. The new device usually carries a different VID/PID,
 * so a previously-opened port handle is dead and must be re-acquired by
 * matching the freshly-enumerated device against this table.
 *
 * The table is only a candidate filter to narrow the search and to drive
 * the device picker. Web Serial exposes only VID/PID (not the USB product
 * string), so the bootloader handshake is the real proof a port is in
 * bootloader mode — the matcher just shortlists likely ports.
 *
 * @module serial-bootloader-ids
 */

/** A USB vendor/product pair that identifies a board in serial bootloader mode. */
export interface BootloaderId {
  vendorId: number;
  /** When omitted, matches any product under this vendor. */
  productId?: number;
  label: string;
}

/**
 * PX4-family serial bootloaders. These vendors are autopilot-specific, so a
 * vendor-only match is safe (any such device appearing during a flash is the
 * flight controller). PX4 reuses one vendor for both app and bootloader with
 * overlapping product ids; the bootloader handshake disambiguates.
 */
export const PX4_BOOTLOADER_IDS: readonly BootloaderId[] = [
  { vendorId: 0x26ac, label: "PX4 / 3DR bootloader" },
  { vendorId: 0x3185, label: "Auterion bootloader" },
  { vendorId: 0x2dae, label: "CubePilot bootloader" },
  { vendorId: 0x3162, label: "Holybro bootloader" },
];

/**
 * ArduPilot serial bootloaders. Vendor 0x1209 is a shared open-source-hardware
 * vendor, so it MUST be matched by exact product id to avoid false positives.
 * CubePilot boards keep their own vendor in the bootloader (0x2DAE with a
 * per-model bootloader product id), and older boards still ship a bootloader
 * under the 3DR vendor.
 */
export const ARDUPILOT_BOOTLOADER_IDS: readonly BootloaderId[] = [
  { vendorId: 0x1209, productId: 0x5740, label: "ArduPilot bootloader" },
  { vendorId: 0x1209, productId: 0x5741, label: "ArduPilot bootloader" },
  { vendorId: 0x2dae, productId: 0x1001, label: "CubeBlack bootloader" },
  { vendorId: 0x2dae, productId: 0x1002, label: "CubeYellow bootloader" },
  { vendorId: 0x2dae, productId: 0x1005, label: "CubePurple bootloader" },
  { vendorId: 0x26ac, label: "3DR-vendor bootloader" },
];

/** Union table for the generic serial flash path. */
export const ALL_FC_BOOTLOADER_IDS: readonly BootloaderId[] = [
  ...PX4_BOOTLOADER_IDS,
  ...ARDUPILOT_BOOTLOADER_IDS,
];

/** True when a device's VID/PID matches any entry in `ids`. */
export function matchesBootloader(
  info: { vendorId?: number; productId?: number },
  ids: readonly BootloaderId[],
): boolean {
  if (info.vendorId === undefined) return false;
  return ids.some(
    (id) =>
      id.vendorId === info.vendorId &&
      (id.productId === undefined || id.productId === info.productId),
  );
}

/** Convert a bootloader-id table into Web Serial `requestPort` filters. */
export function toSerialFilters(
  ids: readonly BootloaderId[],
): { usbVendorId: number; usbProductId?: number }[] {
  return ids.map((id) =>
    id.productId !== undefined
      ? { usbVendorId: id.vendorId, usbProductId: id.productId }
      : { usbVendorId: id.vendorId },
  );
}
