"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RthAllConfirmDialog } from "@/components/shared/rth-all-confirm-dialog";
import { Map, Plug, Home } from "lucide-react";
import { useConnectDialogStore } from "@/stores/connect-dialog-store";

export function QuickActionsBar() {
  const router = useRouter();
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

      <RthAllConfirmDialog open={rthOpen} onClose={() => setRthOpen(false)} />
    </>
  );
}
