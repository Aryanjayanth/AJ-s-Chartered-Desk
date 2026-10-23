import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Lock, Minus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NoAccess, PageHeader } from "@/components/app/common";
import { useRoles, type Role } from "@/hooks/use-roles";
import {
  usePermissionMatrix,
  usePermissions,
  useResetPermissions,
  useSetPermission,
} from "@/hooks/use-permissions";
import {
  ACTIONS,
  DELETE_LOCKED,
  ACTION_BLURB,
  ACTION_LABEL,
  MODULES,
  MODULE_BLURB,
  MODULE_LABEL,
  type Grants,
  type GrantsByModule,
  type Module,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/roles")({
  head: () => ({
    meta: [
      { title: "Roles & Permissions — AJ's Chartered Desk" },
      { name: "description", content: "Decide what Staff and Cashier can do in each module." },
    ],
  }),
  component: RolesPage,
});

const EDITABLE_ROLES = ["staff", "cashier"] as const satisfies readonly Role[];

function RolesPage() {
  const { isManager, loading } = useRoles();
  const { usingFallback } = usePermissions();
  const matrix = usePermissionMatrix();
  const setPermission = useSetPermission();
  const reset = useResetPermissions();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);

  if (loading) return null;
  if (!isManager) return <NoAccess />;

  // Without the permissions migration there is no matrix to edit, and the
  // RPCs this page writes to do not exist. Say that plainly rather than
  // showing a grid whose every click fails.
  if (usingFallback || matrix.data === null)
    return (
      <div>
        <PageHeader
          title="Roles & Permissions"
          subtitle="Decide what Staff and Cashier can do in each module."
        />
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
          <h2 className="text-sm font-semibold text-destructive">Permission matrix unavailable</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The <code className="font-mono text-xs">role_permissions</code> migration has not been
            applied to this database, so there is nothing to edit yet. Roles are currently falling
            back to their built-in defaults.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Apply{" "}
            <code className="font-mono text-xs">
              supabase/migrations/20261006120000_module_permissions.sql
            </code>{" "}
            to the Supabase SQL editor, then reload this page.
          </p>
        </div>
      </div>
    );

  const toggle = async (role: Role, module: Module, key: keyof Grants) => {
    if (key === "delete" && DELETE_LOCKED[module]) return;
    const current = matrix.data?.[role]?.[module];
    if (!current) return;
    const next: Grants = { ...current, [key]: !current[key] };
    // Update only changes status, so it implies Edit access to the record.
    if (key === "update" && next.update) {
      next.edit = true;
    }
    // Nothing else is reachable without View, so turn the rest off with it
    // rather than storing a row that contradicts itself.
    if (key === "view" && !next.view) {
      next.create = next.edit = next.update = next.delete = next.amounts = false;
    }

    const id = `${role}:${module}`;
    setSaving(id);
    // Paint the cell immediately. The RPC is what decides, but waiting for the
    // refetch round-trip left the button looking unresponsive on a slow link.
    queryClient.setQueryData<Record<string, GrantsByModule>>(["permission-matrix"], (prev) =>
      prev ? { ...prev, [role]: { ...prev[role], [module]: next } } : prev,
    );
    await setPermission(role, module, next);
    setSaving(null);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Roles & Permissions"
        subtitle="Choose what Staff and Cashier can do in each module. Enforced by the database itself, not only by hiding screens."
        actions={
          <Button variant="outline" onClick={reset} disabled={matrix.isLoading}>
            <RotateCcw className="mr-1 h-4 w-4" />
            Restore defaults
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        {ACTIONS.map((a) => (
          <span key={a} className="inline-flex items-center gap-1.5">
            <span className="font-medium text-foreground">{ACTION_LABEL[a]}:</span>
            {ACTION_BLURB[a]}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Permissions for each role in each module. Toggling a cell changes what that role can do;
            turning View off also turns off the other actions for that module.
          </caption>
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Module</th>
              {EDITABLE_ROLES.map((r) => (
                <th key={r} className="w-44 px-3 py-3 text-center capitalize">
                  {r}
                  <div className="mt-0.5 font-normal normal-case text-[10px] text-muted-foreground">
                    click a cell to toggle
                  </div>
                </th>
              ))}
              <th className="w-40 px-3 py-3 text-center">Admin</th>
            </tr>
          </thead>
          {MODULES.flatMap((m) => {
            const rows = [{ key: m, label: MODULE_LABEL[m], blurb: MODULE_BLURB[m], tasks: false }];
            if (m === "jobs") {
              rows.push({ key: "jobs" as Module, label: "Tasks", blurb: "Task list, expanded job items and status updates. Shares the Jobs permission.", tasks: true });
            }
            return rows;
          }).map(({ key: module, label, blurb, tasks }) => (
            <tbody key={module} className="border-t">
              <tr>
                <td className="px-4 py-2">
                  <div className="font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">{blurb}</div>
                </td>
                {EDITABLE_ROLES.map((role) => {
                  const g = matrix.data?.[role]?.[module];
                  const busy = saving === `${role}:${module}`;
                  return (
                    <td key={role} className="align-top">
                      <div className={cn("grid grid-cols-2 gap-1 px-2 py-2", busy && "opacity-60")}>
                        {ACTIONS.filter((a) => a !== "update" || tasks).map((a) => {
                          const on = !!g?.[a];
                          const locked = a === "delete" && DELETE_LOCKED[module];
                          const dead = a !== "view" && !g?.view;
                          return (
                            <button
                              key={a}
                              type="button"
                              disabled={locked || dead}
                              aria-pressed={on}
                              aria-label={`${role} ${label}: ${ACTION_LABEL[a]}`}
                              onClick={() => toggle(role, module, a)}
                              title={
                                locked
                                  ? "Payment records are reversed, never deleted."
                                  : dead
                                    ? "Turn on View first."
                                    : `${on ? "Revoke" : "Grant"} ${ACTION_LABEL[a].toLowerCase()} on ${label} for ${role}`
                              }
                              className={cn(
                                "flex h-8 items-center justify-center gap-1 rounded-md border text-[11px] font-medium transition-colors",
                                on
                                  ? "border-primary bg-primary/15 text-primary"
                                  : "border-dashed border-border/70 text-muted-foreground/70",
                                (locked || dead) && "cursor-not-allowed opacity-40",
                                !locked && !dead && "hover:bg-accent",
                              )}
                            >
                              {locked ? (
                                <Lock className="h-3 w-3" />
                              ) : on ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                <Minus className="h-3 w-3" />
                              )}
                              {ACTION_LABEL[a]}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  );
                })}
                <td className="align-top">
                  <div className="grid grid-cols-2 gap-1 px-2 py-2">
                    {ACTIONS.filter((a) => a !== "update" || tasks).map((a) => {
                      const locked = a === "delete" && DELETE_LOCKED[module];
                      return (
                        <span
                          key={a}
                          title={
                            locked
                              ? "Payment records are reversed, never deleted."
                              : "Admin always has full access and cannot be restricted."
                          }
                          className={cn(
                            "flex h-8 items-center justify-center gap-1 rounded-md border text-[11px] font-medium",
                            locked
                              ? "border-transparent text-muted-foreground/40"
                              : "border-primary/40 bg-primary/10 text-primary",
                          )}
                        >
                          {locked ? (
                            <Lock className="h-3 w-3" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          {ACTION_LABEL[a]}
                        </span>
                      );
                    })}
                  </div>
                </td>
              </tr>
            </tbody>
          ))}
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        A grant applies to the whole firm: once Staff can view Clients they see every client, not
        only the ones assigned to them. Invoicing, receivables, reports, audit trail and settings
        are not part of this matrix — they stay with Admin so financial figures cannot be edited by
        a Cashier.
      </p>
    </div>
  );
}
