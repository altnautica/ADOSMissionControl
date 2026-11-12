/**
 * @license GPL-3.0-only
 *
 * Flash Tool › backup row reads in the operator's language: the flash button
 * and the backup progress line come from locale keys.
 */

import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { fireEvent, render, screen } from "@testing-library/react";

import de from "../../../../../locales/de.json";

vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => ({ isHardBlocked: false, hardBlockMessage: "" }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../ParamRestoreDialog", () => ({ ParamRestoreDialog: () => null }));

import { FirmwareBackupRestore } from "../FirmwareBackupRestore";

describe("FirmwareBackupRestore · locale", () => {
  it("labels the flash button and backup progress from keys", () => {
    const onMessage = vi.fn();
    const protocol = { getAllParameters: () => new Promise(() => {}) } as never;
    render(
      <NextIntlClientProvider locale="de" messages={de}>
        <FirmwareBackupRestore protocol={protocol} selectedDroneId="d1" targetLabel="Alpha" isFlashing={false}
          allChecked serialSupported usbSupported onFlash={vi.fn()} blockedReason={null}
          onMessage={onMessage} onParamBackupChecked={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: de.fcPanels.firmwareBackupRestore.flashFirmware })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: de.fcPanels.firmwareBackupRestore.backupParameters }));
    expect(onMessage).toHaveBeenCalledWith(de.fcPanels.firmwareBackupRestore.downloading);
  });
});
