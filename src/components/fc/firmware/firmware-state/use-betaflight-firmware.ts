/**
 * @module fc/firmware/firmware-state/use-betaflight-firmware
 * @description Owns the Betaflight slice of the firmware picker: target
 * / release catalog, custom-build options, cloud-build request +
 * status polling, and the effects that load releases and build options
 * as the selection changes.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef, useState } from "react";
import type {
  FirmwareStack,
  BetaflightTarget,
  BetaflightRelease,
  BetaflightBuildOptions,
  BetaflightBuildStatus,
} from "@/lib/protocol/firmware/types";
import { bfManifest } from "./manifests";

type Toast = (message: string, kind: "success" | "error" | "info" | "warning") => void;

export function useBetaflightFirmware(firmwareStack: FirmwareStack, toast: Toast) {
  const [bfTargets, setBfTargets] = useState<BetaflightTarget[]>([]);
  const [bfReleases, setBfReleases] = useState<BetaflightRelease[]>([]);
  const [bfLoading, setBfLoading] = useState(false);
  const [bfError, setBfError] = useState("");
  const [selectedBfTarget, setSelectedBfTarget] = useState("");
  const [selectedBfRelease, setSelectedBfRelease] = useState("");
  const [bfCustomBuild, setBfCustomBuild] = useState(false);
  const [bfBuildOptions, setBfBuildOptions] = useState<BetaflightBuildOptions | null>(null);
  const [bfSelectedOptions, setBfSelectedOptions] = useState<string[]>([]);
  const [bfBuildStatus, setBfBuildStatus] = useState<BetaflightBuildStatus | null>(null);
  const [bfBuildPolling, setBfBuildPolling] = useState(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current); };
  }, []);

  async function loadBfTargets() {
    setBfLoading(true); setBfError("");
    try {
      const targets = await bfManifest.getTargets();
      setBfTargets(targets);
      if (targets.length > 0 && !selectedBfTarget) setSelectedBfTarget(targets[0].target);
    } catch (err) { setBfError(err instanceof Error ? err.message : "Failed to load Betaflight targets"); }
    finally { setBfLoading(false); }
  }

  async function loadBfReleases(target: string) {
    try {
      const releases = await bfManifest.getReleasesForTarget(target);
      setBfReleases(releases);
      if (releases.length > 0) setSelectedBfRelease(releases[0].release);
    } catch { setBfReleases([]); }
  }

  async function loadBfBuildOptions(release: string) {
    try { const opts = await bfManifest.getBuildOptions(release); setBfBuildOptions(opts); }
    catch { setBfBuildOptions(null); }
  }

  useEffect(() => {
    if (firmwareStack === "betaflight" && selectedBfTarget) loadBfReleases(selectedBfTarget);
  }, [selectedBfTarget, firmwareStack]);

  useEffect(() => {
    if (firmwareStack === "betaflight" && bfCustomBuild && selectedBfRelease) loadBfBuildOptions(selectedBfRelease);
  }, [selectedBfRelease, bfCustomBuild, firmwareStack]);

  async function handleBfCloudBuild() {
    if (!selectedBfTarget || !selectedBfRelease) return;
    setBfBuildPolling(true); setBfBuildStatus(null);
    try {
      const status = await bfManifest.requestBuild({ target: selectedBfTarget, release: selectedBfRelease, options: bfSelectedOptions });
      setBfBuildStatus(status);
      if (status.status !== "success" && status.status !== "error") pollBfBuild(status.key);
    } catch (err) { setBfBuildPolling(false); toast(err instanceof Error ? err.message : "Cloud build failed", "error"); }
  }

  function pollBfBuild(key: string, attempt = 0) {
    if (attempt > 60) { setBfBuildPolling(false); setBfBuildStatus((prev) => prev ? { ...prev, status: "error" } : null); return; }
    pollTimeoutRef.current = setTimeout(async () => {
      try {
        const status = await bfManifest.pollBuildStatus(key);
        setBfBuildStatus(status);
        if (status.status === "success" || status.status === "error") { setBfBuildPolling(false); return; }
        pollBfBuild(key, attempt + 1);
      } catch { setBfBuildPolling(false); }
    }, 5000);
  }

  function toggleBfOption(option: string) {
    setBfSelectedOptions((prev) => prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]);
  }

  return {
    bfTargets, bfReleases, bfLoading, bfError,
    selectedBfTarget, setSelectedBfTarget,
    selectedBfRelease, setSelectedBfRelease,
    bfCustomBuild, setBfCustomBuild,
    bfBuildOptions, bfSelectedOptions, bfBuildStatus, bfBuildPolling,
    handleBfCloudBuild, toggleBfOption,
    loadBfTargets,
    loadBfTargetsRetry: () => { bfManifest.clearCache(); loadBfTargets(); },
  };
}
