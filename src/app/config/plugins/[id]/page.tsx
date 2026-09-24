"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { PluginAgentClient } from "@/lib/agent/plugin-client";
import { communityApi } from "@/lib/community-api";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { useNodeDirectAgent } from "@/components/command/settings/use-node-direct-agent";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";

type Tab = "overview" | "permissions" | "events";

export default function PluginDetailPage() {
  const params = useParams<{ id: string }>();
  const installId = params?.id as Id<"cmd_pluginInstalls"> | undefined;
  // `?tab=permissions` opens a tab directly (the plugin card's "View
  // permissions" links here).
  const requestedTab = useSearchParams()?.get("tab");
  const [tab, setTab] = useState<Tab>(
    requestedTab === "permissions" || requestedTab === "events" ? requestedTab : "overview",
  );
  const [pendingRevoke, setPendingRevoke] = useState<{
    permissionId: string;
  } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const t = useTranslations("plugins");
  const { toast } = useToast();
  const router = useRouter();

  const data = useConvexSkipQuery(
    communityApi.plugins.getInstallWithPermissions,
    {
      args: installId ? { installId } : undefined,
      enabled: !!installId,
    },
  );
  const events = useConvexSkipQuery(communityApi.plugins.recentEvents, {
    args: installId ? { installId } : undefined,
    enabled: !!installId && tab === "events",
  });

  // A drone-bound install's agent half lives on THAT drone: its grants,
  // revokes and removal go to that node's agent only, never to whichever
  // node happens to be attached. A GCS-only install has no agent half.
  const installDroneId = data?.install.droneId ?? null;
  const installNode = useNodeDirectAgent(
    installDroneId ? (deviceIdFromNodeId(installDroneId) ?? installDroneId) : null,
  );
  const agentClient = useMemo(
    () =>
      installNode ? new PluginAgentClient(installNode.agentUrl, installNode.apiKey ?? "") : null,
    [installNode],
  );

  const grant = useMutation(communityApi.plugins.grantPermission);
  const revoke = useMutation(communityApi.plugins.revokePermission);
  const remove = useMutation(communityApi.plugins.removeInstall);

  /** Run the agent half of an action, then the cloud record. Stops (with a
   * toast) at the first refusal so the two never disagree. */
  const applyChange = async (
    onAgent: (client: PluginAgentClient) => Promise<unknown>,
    onCloud: () => Promise<unknown>,
  ): Promise<boolean> => {
    try {
      if (installDroneId) {
        if (!agentClient) {
          toast(t("needsNodeAgent"), "error");
          return false;
        }
        await onAgent(agentClient);
      }
      await onCloud();
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
      return false;
    }
  };

  if (data === undefined) {
    return <p className="p-4 text-sm text-text-tertiary">Loading...</p>;
  }
  if (data === null) {
    return (
      <div className="p-4 text-sm text-text-tertiary">
        <p>Plugin not found.</p>
        <Link href="/config/plugins" className="text-accent-primary underline">
          Back to plugins
        </Link>
      </div>
    );
  }

  const { install, permissions } = data;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <Link
        href="/config/plugins"
        className="inline-flex items-center gap-1 text-xs text-text-tertiary hover:text-text-primary"
      >
        <ArrowLeft className="h-3 w-3" /> Back to plugins
      </Link>

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold text-text-primary">
              {install.name}
            </h1>
            <span className="text-xs text-text-tertiary">v{install.version}</span>
          </div>
          <code className="text-xs text-text-tertiary">{install.pluginId}</code>
        </div>
        <Button
          variant="danger"
          size="sm"
          icon={<Trash2 className="h-3 w-3" />}
          onClick={() => setConfirmRemove(true)}
        >
          Remove
        </Button>
      </header>

      <nav className="flex gap-1 border-b border-border-default" aria-label="Plugin tabs">
        {(["overview", "permissions", "events"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "border-b-2 px-3 py-2 text-sm capitalize",
              tab === t
                ? "border-accent-primary text-text-primary"
                : "border-transparent text-text-tertiary hover:text-text-primary",
            )}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <Field label="Status" value={install.status} capitalize />
          <Field label="Source" value={install.source} capitalize />
          {install.signerId && <Field label="Signer" value={install.signerId} mono />}
          <Field label="Halves" value={install.halves.join(", ")} capitalize />
          <Field
            label="Installed"
            value={new Date(install.installedAt).toLocaleString()}
          />
          {install.enabledAt && (
            <Field
              label="Enabled"
              value={new Date(install.enabledAt).toLocaleString()}
            />
          )}
          <Field label="Manifest hash" value={install.manifestHash.slice(0, 16) + "..."} mono />
        </dl>
      )}

      {tab === "permissions" && (
        <ul className="divide-y divide-border-default rounded-md border border-border-default">
          {permissions.length === 0 ? (
            <li className="px-3 py-3 text-xs text-text-tertiary">
              No permissions declared.
            </li>
          ) : (
            permissions.map((perm) => (
              <li
                key={perm._id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <code className="font-mono text-sm text-text-primary">
                    {perm.permissionId}
                  </code>
                  {perm.required && (
                    <span className="ml-2 rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] uppercase text-text-tertiary">
                      Required
                    </span>
                  )}
                </div>
                <Button
                  variant={perm.granted ? "secondary" : "primary"}
                  size="sm"
                  onClick={async () => {
                    if (!installId) return;
                    if (perm.granted) {
                      setPendingRevoke({ permissionId: perm.permissionId });
                    } else {
                      await applyChange(
                        (client) => client.grant(install.pluginId, perm.permissionId),
                        () => grant({ installId, permissionId: perm.permissionId }),
                      );
                    }
                  }}
                >
                  {perm.granted ? t("revokePermission") : "Grant"}
                </Button>
              </li>
            ))
          )}
        </ul>
      )}

      <ConfirmDialog
        open={!!pendingRevoke}
        title={t("revokeConfirmTitle")}
        message={t("revokeConfirmMessage", {
          permission: pendingRevoke?.permissionId ?? "",
        })}
        variant="danger"
        confirmLabel={t("revokePermission")}
        onConfirm={async () => {
          if (!installId || !pendingRevoke) return;
          const { permissionId } = pendingRevoke;
          const ok = await applyChange(
            (client) => client.revoke(install.pluginId, permissionId),
            () => revoke({ installId, permissionId }),
          );
          if (ok) toast(t("revokeSuccess"), "success");
          setPendingRevoke(null);
        }}
        onCancel={() => setPendingRevoke(null)}
      />

      <ConfirmDialog
        open={confirmRemove}
        title={t("removeConfirmTitle")}
        message={t("removeConfirmMessage", { name: install.name })}
        variant="danger"
        confirmLabel={t("removeConfirmAction")}
        onConfirm={async () => {
          setConfirmRemove(false);
          if (!installId) return;
          const ok = await applyChange(
            (client) => client.remove(install.pluginId),
            () => remove({ installId }),
          );
          if (ok) router.push("/config/plugins");
        }}
        onCancel={() => setConfirmRemove(false)}
      />

      {tab === "events" && (
        <ul className="space-y-1 text-xs">
          {events === undefined ? (
            <li className="text-text-tertiary">Loading events...</li>
          ) : events.length === 0 ? (
            <li className="text-text-tertiary">No events recorded yet.</li>
          ) : (
            events.map((evt) => (
              <li
                key={evt._id}
                className={cn(
                  "rounded border px-3 py-2",
                  evt.severity === "error"
                    ? "border-status-error/40 bg-status-error/10"
                    : evt.severity === "warning"
                      ? "border-status-warning/40 bg-status-warning/10"
                      : "border-border-default bg-bg-secondary",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-text-primary">{evt.type}</span>
                  <time className="text-text-tertiary">
                    {new Date(evt.createdAt).toLocaleString()}
                  </time>
                </div>
                <p className="mt-0.5 text-text-secondary">{evt.message}</p>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  capitalize,
}: {
  label: string;
  value: string;
  mono?: boolean;
  capitalize?: boolean;
}) {
  return (
    <div>
      <dt className="text-text-tertiary">{label}</dt>
      <dd
        className={cn(
          "text-text-primary",
          mono && "font-mono",
          capitalize && "capitalize",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
