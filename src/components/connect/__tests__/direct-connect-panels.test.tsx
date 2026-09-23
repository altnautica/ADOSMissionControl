/**
 * @module connect/direct-connect-panels.test
 * @description The direct-connect panels' ownership and bookkeeping paths:
 * a port that opened but failed detection is closed, a link attach records no
 * recent connection, a direct connect records the identity a reconnect needs,
 * link mode without a target cannot connect, and the serial port selection
 * follows the device rather than its position in the permitted-port list.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";

interface FakePort {
  port: SerialPort;
  label: string;
  vendorId?: number;
  productId?: number;
}

const h = vi.hoisted(() => {
  // Persisted stores reached through the panels' imports resolve the global
  // at module load; give them a deterministic in-memory one.
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: (i: number) => Array.from(mem.keys())[i] ?? null,
      get length() {
        return mem.size;
      },
    },
  });
  return {
    ports: [] as FakePort[],
    onConnect: null as null | ((info: FakePort) => void),
    requestNewPort: vi.fn(),
    detect: vi.fn(),
    save: vi.fn(),
    serialDisconnect: vi.fn(),
    bleDisconnect: vi.fn(),
  };
});

vi.mock("@/lib/serial-port-manager", () => ({
  serialPortManager: {
    init: () => {},
    getKnownPorts: async () => [...h.ports],
    requestNewPort: h.requestNewPort,
    onConnect: (cb: (info: FakePort) => void) => {
      h.onConnect = cb;
      return () => {};
    },
    onDisconnect: () => () => {},
  },
}));
vi.mock("@/lib/protocol/transport/webserial", () => ({
  WebSerialTransport: class {
    static isSupported() {
      return true;
    }
    readonly type = "webserial";
    async connectToPort() {}
    async connect() {}
    disconnect = h.serialDisconnect;
  },
}));
vi.mock("@/lib/protocol/transport/ble", () => ({
  BluetoothTransport: class {
    static isSupported() {
      return true;
    }
    readonly type = "ble";
    deviceName = "FC-BLE";
    async connect() {}
    disconnect = h.bleDisconnect;
  },
}));
vi.mock("@/lib/protocol/connect-with-detection", () => ({
  connectWithDetection: h.detect,
}));
vi.mock("@/lib/recent-connections", () => ({
  saveRecentConnection: h.save,
}));
vi.mock("@/lib/connection-presets", () => ({
  savePreset: vi.fn(),
}));
vi.mock("@/components/connect/ConnectionPresets", () => ({
  ConnectionPresets: () => null,
}));
vi.mock("@/components/connect/RecentConnections", () => ({
  RecentConnections: () => null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

import messages from "../../../../locales/en.json";
import { SerialPanel } from "../SerialPanel";
import { BluetoothPanel } from "../BluetoothPanel";
import { DirectMavlinkPanel } from "../DirectMavlinkPanel";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";

const FC: FakePort = {
  port: {} as SerialPort,
  label: "Flight controller",
  vendorId: 0x1209,
  productId: 0x5741,
};
const RADIO: FakePort = {
  port: {} as SerialPort,
  label: "Telemetry radio",
  vendorId: 0x0403,
  productId: 0x6015,
};
const GPS: FakePort = { port: {} as SerialPort, label: "GPS puck" };

const DETECTED = {
  adapter: {},
  vehicleInfo: {
    firmwareVersionString: "ArduCopter V4.5.0",
    vehicleClass: "copter",
    systemId: 1,
  },
  firmwareType: "ardupilot-copter",
};

const addDrone = vi.fn();
const attachLinkToDrone = vi.fn();

function wrap(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function portCombobox() {
  return screen.getByRole("combobox", { name: "Port" });
}

async function choosePort(label: string) {
  fireEvent.click(portCombobox());
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

const connectButton = () => screen.getByRole("button", { name: "Connect" });

beforeEach(() => {
  h.ports = [];
  h.onConnect = null;
  h.requestNewPort.mockReset();
  h.detect.mockReset();
  h.save.mockReset();
  h.serialDisconnect.mockReset().mockResolvedValue(undefined);
  h.bleDisconnect.mockReset().mockResolvedValue(undefined);
  addDrone.mockReset();
  attachLinkToDrone.mockReset().mockResolvedValue({ ok: true });
  useDroneManager.setState({ addDrone, attachLinkToDrone, drones: new Map() });
});

afterEach(() => {
  cleanup();
});

describe("SerialPanel port selection", () => {
  it("keeps the chosen port selected when a hot-plug reorders the list", async () => {
    h.ports = [RADIO, FC];
    wrap(<SerialPanel />);
    await choosePort("Flight controller");
    expect(portCombobox().textContent).toBe("Flight controller");

    // A new device takes the first row; the FC moves down one.
    h.ports = [GPS, RADIO, FC];
    await act(async () => {
      h.onConnect?.(GPS);
    });
    await waitFor(() =>
      expect(screen.getByText(/1209/)).toBeTruthy(),
    );
    expect(portCombobox().textContent).toBe("Flight controller");
  });

  it("selects the port the chooser returned, even one already permitted", async () => {
    h.ports = [FC, RADIO];
    wrap(<SerialPanel />);
    await screen.findByText(/2 permitted port/);
    h.requestNewPort.mockResolvedValue(FC);

    fireEvent.click(screen.getByRole("button", { name: "Request Port" }));

    await waitFor(() =>
      expect(portCombobox().textContent).toBe("Flight controller"),
    );
  });
});

describe("SerialPanel connect bookkeeping", () => {
  it("closes the port and records nothing when detection fails", async () => {
    h.ports = [FC];
    h.detect.mockRejectedValue(new Error("No heartbeat"));
    wrap(<SerialPanel />);
    await waitFor(() => expect(connectButton().hasAttribute("disabled")).toBe(false));

    fireEvent.click(connectButton());

    await screen.findByText("No heartbeat");
    expect(h.serialDisconnect).toHaveBeenCalledTimes(1);
    expect(h.save).not.toHaveBeenCalled();
    expect(addDrone).not.toHaveBeenCalled();
  });

  it("records the firmware and the port's USB identity on a direct connect", async () => {
    h.ports = [FC];
    h.detect.mockResolvedValue(DETECTED);
    wrap(<SerialPanel />);
    await waitFor(() => expect(connectButton().hasAttribute("disabled")).toBe(false));

    fireEvent.click(connectButton());

    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.save.mock.calls[0][0]).toMatchObject({
      type: "serial",
      firmwareType: "ardupilot-copter",
      portVendorId: 0x1209,
      portProductId: 0x5741,
    });
    expect(h.serialDisconnect).not.toHaveBeenCalled();
  });

  it("records no recent connection for a link attach", async () => {
    h.ports = [FC];
    wrap(<SerialPanel targetDroneId="fc:existing" />);
    await waitFor(() => expect(connectButton().hasAttribute("disabled")).toBe(false));

    fireEvent.click(connectButton());

    await waitFor(() => expect(attachLinkToDrone).toHaveBeenCalledTimes(1));
    expect(h.save).not.toHaveBeenCalled();
    expect(h.detect).not.toHaveBeenCalled();
    expect(h.serialDisconnect).not.toHaveBeenCalled();
  });
});

describe("BluetoothPanel", () => {
  it("releases the GATT link when detection fails", async () => {
    h.detect.mockRejectedValue(new Error("No heartbeat"));
    wrap(<BluetoothPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Scan & Connect" }));

    await screen.findByText("No heartbeat");
    expect(h.bleDisconnect).toHaveBeenCalledTimes(1);
    expect(h.save).not.toHaveBeenCalled();
  });
});

describe("DirectMavlinkPanel link mode", () => {
  it("cannot connect until a target drone is chosen", async () => {
    h.ports = [FC];
    useDroneManager.setState({
      drones: new Map([
        [
          "fc:existing",
          {
            id: "fc:existing",
            name: "Quad",
            vehicleInfo: { systemId: 1 },
          } as unknown as ManagedDrone,
        ],
      ]),
    });
    wrap(<DirectMavlinkPanel onClose={() => {}} />);
    await waitFor(() => expect(connectButton().hasAttribute("disabled")).toBe(false));

    fireEvent.click(screen.getByRole("radio", { name: "Add link to existing drone" }));

    expect(connectButton().hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText("Choose the drone this link belongs to before connecting."),
    ).toBeTruthy();
  });
});
