"use client";

/**
 * @module LinkBadgesRow
 * @description Renders connection link pills for a drone — one pill per active link.
 * Each pill shows the transport type, primary indicator, and a remove button (for non-last links).
 * @license GPL-3.0-only
 */

import { Usb, Globe, Radio, Bluetooth, X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDroneManager } from "@/stores/drone-manager";
import { useConnectDialogStore } from "@/stores/connect-dialog-store";
import type { LinkInfo, Transport } from "@/lib/protocol/types";

const TYPE_ICONS: Record<Transport["type"], typeof Usb> = {
  webserial: Usb,
  websocket: Globe,
  tcp: Globe,
  "udp-proxy": Globe,
  "mqtt-mavlink": Radio,
  ble: Bluetooth,
};

const TYPE_LABELS: Record<Transport["type"], string> = {
  webserial: "Serial",
  websocket: "WS",
  tcp: "TCP",
  "udp-proxy": "UDP",
  "mqtt-mavlink": "MQTT",
  ble: "BLE",
};

interface Props {
  droneId: string;
  links: LinkInfo[];
  /** Show the "+" button to add another link. */
  showAddButton?: boolean;
}

export function LinkBadgesRow({ droneId, links, showAddButton = true }: Props) {
  const detachLink = useDroneManager((s) => s.detachLinkFromDrone);
  const openConnectDialog = useConnectDialogStore((s) => s.openDialog);

  if (links.length === 0) return null;

  async function handleRemove(linkId: string) {
    await detachLink(droneId, linkId);
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {links.map((link) => {
        const Icon = TYPE_ICONS[link.type] ?? Globe;
        const label = TYPE_LABELS[link.type] ?? link.type;
        const canRemove = links.length > 1;
        return (
          <div
            key={link.id}
            className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded border",
              link.isPrimary
                ? "border-accent-primary/40 bg-accent-primary/10 text-accent-primary"
                : "border-border-default bg-bg-tertiary text-text-secondary",
            )}
            title={`${label} ${link.isPrimary ? "(primary)" : "(secondary)"}${link.isConnected ? "" : " — disconnected"}`}
          >
            <Icon size={9} />
            <span>{label}</span>
            <span
              className={cn(
                "w-1 h-1 rounded-full",
                link.isConnected ? "bg-status-success" : "bg-status-error",
              )}
            />
            {canRemove && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(link.id);
                }}
                className="ml-0.5 hover:text-status-error transition-colors"
                title="Remove this link"
              >
                <X size={9} />
              </button>
            )}
          </div>
        );
      })}
      {showAddButton && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            // Open connect dialog. Mode toggle inside lets user add as link to this drone.
            openConnectDialog();
          }}
          className="inline-flex items-center justify-center w-4 h-4 text-[10px] text-text-tertiary hover:text-accent-primary border border-border-default rounded transition-colors"
          title="Add another link to this drone"
        >
          <Plus size={9} />
        </button>
      )}
    </div>
  );
}
