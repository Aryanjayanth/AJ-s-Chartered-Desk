/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/app/DataTable";
import { NoAccess, PageHeader } from "@/components/app/common";
import { useRoles, ROLES, type Role } from "@/hooks/use-roles";
import { errMsg, fmtDate, label } from "@/lib/format";
import { useState } from "react";
import { UserPlus, Link2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCurrentFirm } from "@/hooks/use-firm";
import { InviteDialog } from "@/components/app/InviteDialog";
import { generateLoginLink } from "@/lib/firms.functions";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({
    meta: [
      { title: "Users — CA PracticeDesk" },
      { name: "description", content: "Manage team members and roles." },
    ],
  }),
  component: UsersPage,
});

function UsersPage() {
  const { isManager, loading } = useRoles();
  const { data: firm } = useCurrentFirm();
  const [invite, setInvite] = useState(false);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const qc = useQueryClient();
  const runGenLink = useServerFn(generateLoginLink);

  const q = useQuery({
    queryKey: ["users-roles"],
    enabled: isManager,
    queryFn: async () => {
      const [p, r] = await Promise.all([
        supabase.from("profiles").select("*").not("firm_id", "is", null).order("created_at"),
        supabase.from("user_roles").select("*"),
      ]);
      if (p.error) throw p.error;
      return (p.data ?? []).map((u) => ({
        ...u,
        roles: (r.data ?? []).filter((x) => x.user_id === u.id).map((x) => x.role as Role),
      }));
    },
  });

  if (loading) return null;
  if (!isManager) return <NoAccess />;

  const toggle = async (userId: string, role: Role, on: boolean) => {
    const { error } = on
      ? await supabase.from("user_roles").insert({ user_id: userId, role })
      : await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
    if (error) return toast.error(errMsg(error));
    toast.success(`${label(role)} ${on ? "granted" : "removed"}`);
    qc.invalidateQueries();
  };

  const copyUserLink = async (userEmail: string) => {
    setGeneratingFor(userEmail);
    try {
      const res = await runGenLink({
        data: {
          email: userEmail,
          firmId: firm?.id,
          redirectTo: `${window.location.origin}/set-password`,
        },
      });
      if (res.link) {
        await navigator.clipboard.writeText(res.link);
        toast.success(`Direct login link for ${userEmail} copied to clipboard!`);
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setGeneratingFor(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Users"
        subtitle="Invite team members by email and give them a role. What each role may do is set under Roles & Permissions."
        actions={
          <Button onClick={() => setInvite(true)}>
            <UserPlus className="mr-1 h-4 w-4" />
            Invite user
          </Button>
        }
      />
      <InviteDialog
        firm={invite && firm ? { id: firm.id, name: firm.name } : null}
        onClose={() => setInvite(false)}
      />
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        empty="No users yet."
        search={(u) => `${u.full_name} ${u.email}`}
        exportFilename="team_users"
        exportTransform={(u) => ({
          Name: u.full_name,
          Email: u.email,
          "Joined Date": fmtDate(u.created_at),
          Roles: u.roles.join(", "),
        })}
        columns={[
          {
            key: "full_name",
            header: "Name",
            render: (u) => <span className="font-medium">{u.full_name}</span>,
          },
          { key: "email", header: "Email" },
          { key: "c", header: "Joined", render: (u) => fmtDate(u.created_at) },
          ...ROLES.map((r) => ({
            key: r,
            header: label(r),
            render: (u: any) => (
              <Checkbox
                checked={u.roles?.includes(r)}
                onCheckedChange={(c) => toggle(u.id, r, !!c)}
              />
            ),
          })),
          {
            key: "link",
            header: "Direct Link",
            render: (u: any) => (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                disabled={generatingFor === u.email || !u.email}
                onClick={() => u.email && copyUserLink(u.email)}
                title="Copy direct login / password reset link"
              >
                <Link2 className="h-3.5 w-3.5" />
                {generatingFor === u.email ? "Generating…" : "Copy Link"}
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}
