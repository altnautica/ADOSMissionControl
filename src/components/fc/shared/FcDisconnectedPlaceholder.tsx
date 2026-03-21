"use client";

import { useTranslations } from "next-intl";
import { WifiOff } from "lucide-react";
import { useConnectDialogStore } from "@/stores/connect-dialog-store";

interface FcDisconnectedPlaceholderProps {
  droneName: string;
}

export function FcDisconnectedPlaceholder({ droneName }: FcDisconnectedPlaceholderProps) {
  const t = useTranslations("fcShared");
  const openDialog = useConnectDialogStore((s) => s.openDialog);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
      <WifiOff size={32} className="text-text-tertiary" />
      <p className="text-sm text-text-secondary">
        {t("connectTo", { name: droneName })}
      </p>
      <p className="text-xs text-text-tertiary max-w-xs text-center">
        {t("disconnectedMessage")}
      </p>
      <button
        onClick={openDialog}
        className="mt-2 px-4 py-2 text-xs font-semibold bg-accent-primary text-white hover:bg-accent-primary/80 transition-colors"
      >
        {t("connect")}
      </button>
    </div>
  );
}
