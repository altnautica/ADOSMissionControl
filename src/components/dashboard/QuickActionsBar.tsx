"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Map, Plug, Home } from "lucide-react";
import { useConnectDialogStore } from "@/stores/connect-dialog-store";
import {
  activeFleetDrones,
  describeFleetOutcome,
  returnFleetToLaunch,
} from "@/lib/fleet-commands";

export function QuickActionsBar() {
  const router = useRouter();
  const { toast } = useToast();
  const [rthOpen, setRthOpen] = useState(false);
  const openDialog = useConnectDialogStore((s) => s.openDialog);

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<Map size={14} />}
          onClick={() => router.push("/plan")}
        >
          New Mission
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Plug size={14} />}
          onClick={openDialog}
        >
          Connect Drone
        </Button>
        <Button
          variant="danger"
          size="sm"
          icon={<Home size={14} />}
          onClick={() => setRthOpen(true)}
        >
          RTH All
        </Button>
      </div>

      <ConfirmDialog
        open={rthOpen}
        onConfirm={() => {
          setRthOpen(false);
          if (activeFleetDrones().length === 0) {
            toast("No active drones to recall", "warning");
            return;
          }
          void (async () => {
            const outcome = await returnFleetToLaunch();
            const { message, variant } = describeFleetOutcome(outcome, "RTH");
            toast(message, variant);
          })();
        }}
        onCancel={() => setRthOpen(false)}
        title="Return to Home — All Drones"
        message="This will command ALL active drones to return to their home positions immediately. This action cannot be undone."
        confirmLabel="RTH All"
        variant="danger"
      />
    </>
  );
}
