"use client";

/**
 * @module components/fc/security/SigningPanel
 * @description MAVLink v2 message signing management for the selected drone.
 *
 * Key material lives in this browser's IndexedDB as raw bytes (MAVLink
 * signing hashes the key itself), readable by script running on the page.
 * The agent is a transparent pipe plus a one-shot enrollment helper; it
 * never persists a key.
 *
 * This file is a thin composition. State and action handlers live in
 * `signing/use-signing-actions.ts`. Branch UIs live as sub-components in
 * `signing/`. Modals (Export, Import) are imported as-is.
 */

import { Shield } from "lucide-react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useSigningStore } from "@/stores/signing-store";
import { allocateLocalLinkId } from "@/lib/protocol/link-id-allocator";
import { ExportKeyModal } from "./ExportKeyModal";
import { ImportKeyModal } from "./ImportKeyModal";
import { usePrivateBrowsingDetection } from "./signing/use-private-browsing-detection";
import { useSigningActions } from "./signing/use-signing-actions";
import { SigningUnsupportedNotice } from "./signing/SigningUnsupportedNotice";
import { SigningDisabledSection } from "./signing/SigningDisabledSection";
import { SigningEnabledSection } from "./signing/SigningEnabledSection";

export function SigningPanel() {
  const client = useAgentConnectionStore((s) => s.client);
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const droneId = selectedDroneId ?? "";

  const state = useSigningStore((s) => s.drones[droneId]);

  const privateBrowsing = usePrivateBrowsingDetection();

  const actions = useSigningActions(droneId);

  const supported = state?.capability?.supported ?? false;
  const reason = state?.capability?.reason ?? "unknown";
  const firmware = state?.capability?.firmware_name ?? "unknown";

  let bodyNode;
  if (!droneId) {
    bodyNode = <p className="text-sm text-text-tertiary">No drone selected.</p>;
  } else if (!supported) {
    bodyNode = <SigningUnsupportedNotice firmware={firmware} reason={reason} />;
  } else if (!state?.hasBrowserKey) {
    bodyNode = (
      <SigningDisabledSection
        busy={actions.busy}
        enrollStartedAt={actions.enrollStartedAt}
        enrollFailed={actions.enrollFailed}
        onEnable={actions.handleEnable}
        onImport={() => actions.setImportOpen(true)}
        onResetEnroll={() => {
          actions.setEnrollStartedAt(null);
          actions.setEnrollFailed(false);
          void actions.handleEnable();
        }}
        onCancelEnroll={() => {
          actions.setEnrollStartedAt(null);
          actions.setEnrollFailed(false);
          actions.setBusy(false);
        }}
      />
    );
  } else {
    bodyNode = (
      <SigningEnabledSection
        droneId={droneId}
        state={state}
        busy={actions.busy}
        error={actions.error}
        cloudSyncIntent={actions.cloudSyncIntent}
        cloudRowPresent={actions.cloudRowPresent}
        cloudSyncBusy={actions.cloudSyncBusy}
        cloudSyncError={actions.cloudSyncError}
        isAuthenticated={actions.isAuthenticated}
        authLoading={actions.authLoading}
        onRotate={actions.handleRotate}
        onDisable={actions.handleDisable}
        onSettleNewKey={(fcHolds) => void actions.handleSettleNewKey(fcHolds)}
        onSettleDisable={(signingOff) => void actions.handleSettleDisable(signingOff)}
        onExport={() => actions.setExportOpen(true)}
        onCloudSyncToggle={actions.handleCloudSyncToggle}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Shield size={20} className="text-accent-primary" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-semibold text-text-primary">MAVLink signing</h1>
            <p className="text-xs text-text-tertiary">
              HMAC-SHA256 authentication of every command sent to the flight controller.
            </p>
          </div>
        </div>
        {privateBrowsing && (
          <div
            role="note"
            className="border border-status-warning/40 bg-status-warning/5 px-3 py-2 text-xs text-text-secondary"
          >
            Private browsing detected. Signing keys enrolled in this window are scoped to the session. They will be lost when the window closes.
          </div>
        )}
        {bodyNode}
      </div>
      {client && droneId && actions.exportOpen && (
        <ExportKeyModal
          client={client}
          droneId={droneId}
          linkId={allocateLocalLinkId()}
          open={actions.exportOpen}
          onClose={() => actions.setExportOpen(false)}
        />
      )}
      {droneId && actions.importOpen && (
        <ImportKeyModal
          droneId={droneId}
          open={actions.importOpen}
          onClose={() => actions.setImportOpen(false)}
        />
      )}
    </div>
  );
}
