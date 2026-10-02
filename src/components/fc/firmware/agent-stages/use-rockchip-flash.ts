"use client";

/**
 * @module fc/firmware/agent-stages/use-rockchip-flash
 * @description Owns the lifecycle of a single Rockchip eMMC flash run:
 * download → SHA-256 → minisign verify → claim USB → write. Kept out
 * of the WebFlashCard component so the card stays focused on layout
 * and the hook is independently testable.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toast";
import type { AdosAgentWebFlashInstall } from "@/lib/protocol/firmware/ados-agent-manifest";
import type { FlashProgress } from "@/lib/protocol/firmware/types";
import { RockchipBootromFlasher } from "@/lib/protocol/firmware/rockchip-bootrom";
import { verifyLiteAgentImageSignature } from "@/lib/protocol/firmware/minisign-public-key";
import type { UsbDeviceInfo } from "@/lib/usb-device-manager";
import { concatBytes, sha256Hex } from "./utils";

export interface UseRockchipFlashArgs {
  webFlashInstall: AdosAgentWebFlashInstall | null;
  rockchipDevices: UsbDeviceInfo[];
}

export interface UseRockchipFlashApi {
  progress: FlashProgress | null;
  isFlashing: boolean;
  statusMessage: string;
  setStatusMessage: (msg: string) => void;
  confirming: boolean;
  confirmDeviceLabel: string;
  setConfirmDeviceLabel: (label: string) => void;
  handleFlash: () => void;
  handleCancelConfirm: () => void;
  handleAbort: () => void;
  runFlash: () => Promise<void>;
}

export function useRockchipFlash({
  webFlashInstall,
  rockchipDevices,
}: UseRockchipFlashArgs): UseRockchipFlashApi {
  const t = useTranslations("flashTool.ados");
  const { toast } = useToast();

  // Flash lifecycle state. Local to the agent flash flow so the FC
  // flash flow (FlashManager + ParsedFirmware) stays untouched.
  const [progress, setProgress] = useState<FlashProgress | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  // Confirmation gate. Clicking the Flash button surfaces a Cancel /
  // Confirm pill and (when more than one Rockchip device is visible) a
  // device picker. Confirm runs the existing flash flow; Cancel reverts
  // to the idle state without touching USB.
  const [confirming, setConfirming] = useState(false);
  const [confirmDeviceLabel, setConfirmDeviceLabel] = useState<string>("");

  const flasherRef = useRef<RockchipBootromFlasher | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Tear down any in-flight flash on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      flasherRef.current?.dispose().catch(() => {});
    };
  }, []);

  // Drop the confirmation pill if the operator yanks USB or the device
  // list otherwise empties out — there's nothing left to flash to.
  useEffect(() => {
    if (confirming && rockchipDevices.length === 0) {
      setConfirming(false);
      setConfirmDeviceLabel("");
    }
  }, [confirming, rockchipDevices]);

  // Warn the user before they navigate away (or close the tab) while a
  // flash is in flight. Aborting an eMMC write mid-stream leaves the
  // board with a half-written boot partition; the next power-on will
  // hit u-boot in maskrom recovery rather than booting cleanly.
  useEffect(() => {
    if (!isFlashing) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Some browsers honor returnValue, others ignore it but still
      // surface the prompt as long as preventDefault fired.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isFlashing]);

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
    flasherRef.current?.abort();
  }, []);

  // Step 1 of the flash flow: surface the confirmation pill. The actual
  // USB work happens in runFlash, which only runs after explicit user
  // confirm. This guards against accidental clicks (a misdirected click
  // would otherwise erase the eMMC of whichever Rockchip board happens
  // to be plugged in).
  const handleFlash = useCallback(() => {
    if (!webFlashInstall || !webFlashInstall.imageUrl) {
      toast(t("toast.noImageUrl"), "error");
      return;
    }
    if (rockchipDevices.length === 0) {
      toast(t("toast.connectBoardFirst"), "warning");
      return;
    }
    // Default-select the first visible device. The confirmation pill
    // exposes a picker when more than one device is visible, so the
    // operator can swap before confirming.
    setConfirmDeviceLabel(rockchipDevices[0].label);
    setConfirming(true);
  }, [webFlashInstall, rockchipDevices, toast, t]);

  const handleCancelConfirm = useCallback(() => {
    setConfirming(false);
    setConfirmDeviceLabel("");
  }, []);

  // Step 2 of the flash flow: actual download → verify → claim → write.
  // Runs only after the operator clicks Confirm (or implicitly when the
  // pill has nothing to disambiguate).
  const runFlash = useCallback(async () => {
    if (!webFlashInstall || !webFlashInstall.imageUrl) {
      toast(t("toast.noImageUrl"), "error");
      return;
    }
    if (rockchipDevices.length === 0) {
      toast(t("toast.connectBoardFirst"), "warning");
      return;
    }

    // Resolve the chosen device up front so a hot-unplug between the
    // pill and the click can't pivot us onto the wrong board.
    const chosen =
      rockchipDevices.find((d) => d.label === confirmDeviceLabel) ??
      rockchipDevices[0];

    setConfirming(false);
    setIsFlashing(true);
    setStatusMessage("");
    setProgress({ phase: "idle", percent: 0, message: t("status.preparing") });

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      // 1. Download the image with progress.
      setProgress({
        phase: "bootloader_init",
        percent: 0,
        message: t("status.downloading"),
      });
      const res = await fetch(webFlashInstall.imageUrl, {
        signal: abort.signal,
      });
      if (!res.ok) {
        throw new Error(t("error.imageDownloadFailed", { status: res.status }));
      }
      const total =
        webFlashInstall.imageSizeBytes > 0
          ? webFlashInstall.imageSizeBytes
          : Number(res.headers.get("Content-Length") ?? "0");
      const reader = res.body?.getReader();
      if (!reader) throw new Error(t("error.noReadableBody"));
      const chunks: Uint8Array[] = [];
      let received = 0;
      // Stream the download so the progress bar stays useful for a
      // 50 MB image on a slow link.
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        if (total > 0) {
          const pct = Math.min(4, Math.floor((received / total) * 5));
          setProgress({
            phase: "bootloader_init",
            percent: pct,
            message: t("status.downloadingProgress", {
              received: (received / (1024 * 1024)).toFixed(1),
              total: (total / (1024 * 1024)).toFixed(1),
            }),
            bytesWritten: received,
            bytesTotal: total,
          });
        }
      }
      const compressed = concatBytes(chunks);

      // 2. SHA-256 verification before we touch the device.
      setProgress({
        phase: "verifying",
        percent: 4,
        message: t("status.verifyingChecksum"),
      });
      if (webFlashInstall.sha256) {
        const actual = await sha256Hex(compressed);
        if (actual.toLowerCase() !== webFlashInstall.sha256.toLowerCase()) {
          throw new Error(
            t("error.checksumMismatch", {
              expected: webFlashInstall.sha256,
              actual,
            }),
          );
        }
      }

      // 2b. Ed25519 minisign signature against the vendored lite-agent
      //     public key. SHA-256 alone is not enough — the manifest, the
      //     image, and the SHA all come from the same GitHub Releases
      //     surface, so a compromised release endpoint could feed a
      //     consistent bogus triple. The signature ties the image bytes
      //     to a key we ship inside this client.
      if (webFlashInstall.minisignSignature) {
        setProgress({
          phase: "verifying",
          percent: 5,
          message: t("status.verifyingSignature"),
        });
        await verifyLiteAgentImageSignature(
          compressed,
          webFlashInstall.minisignSignature,
        );
      } else {
        throw new Error(t("error.missingSignature"));
      }

      // 3. Use the device the operator confirmed. Already-authorized,
      //    no picker reopen.
      const device: USBDevice = chosen.device;

      const flasher = new RockchipBootromFlasher(device);
      flasherRef.current = flasher;

      // 4. Prepare: confirm a rockusb loader answers. A board still in
      //    maskrom is refused within a few seconds with instructions to
      //    boot it into loader mode.
      setProgress({
        phase: "bootloader_init",
        percent: 5,
        message: t("status.connecting"),
      });
      await flasher.prepare({ signal: abort.signal });

      // 5. Stream the image into eMMC.
      await flasher.flash(compressed, (p) => setProgress(p), abort.signal);

      toast(t("toast.flashComplete"), "success");
    } catch (err) {
      let userMessage = err instanceof Error ? err.message : t("error.unknown");
      if (err instanceof DOMException) {
        if (err.name === "NotFoundError") {
          userMessage = t("error.noBoardSelected");
        } else if (err.name === "SecurityError") {
          userMessage = t("error.webusbBlocked");
        } else if (err.name === "NetworkError") {
          userMessage = t("error.usbDisconnected");
        } else if (err.name === "AbortError") {
          userMessage = t("error.flashAborted");
        }
      }
      if (!userMessage.toLowerCase().includes("aborted")) {
        toast(t("toast.flashFailed"), "error");
        setProgress({ phase: "error", percent: 0, message: userMessage });
      } else {
        setProgress({ phase: "idle", percent: 0, message: userMessage });
      }
    } finally {
      setIsFlashing(false);
      const f = flasherRef.current;
      flasherRef.current = null;
      abortRef.current = null;
      if (f) {
        f.dispose().catch(() => {});
      }
    }
  }, [webFlashInstall, rockchipDevices, confirmDeviceLabel, toast, t]);

  return {
    progress,
    isFlashing,
    statusMessage,
    setStatusMessage,
    confirming,
    confirmDeviceLabel,
    setConfirmDeviceLabel,
    handleFlash,
    handleCancelConfirm,
    handleAbort,
    runFlash,
  };
}
