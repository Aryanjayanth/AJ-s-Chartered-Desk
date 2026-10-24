import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { Building2, Lock, Unlock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "@/components/app/AppSidebar";
import { GlobalSearch } from "@/components/app/GlobalSearch";
import { UserMenu } from "@/components/app/UserMenu";
import { FirmSwitcher } from "@/components/app/FirmSwitcher";
import { CompleteBackupButton } from "@/components/app/CompleteBackupButton";
import { useCurrentFirm, useSuperAdmin } from "@/hooks/use-firm";
import { usePermissions } from "@/hooks/use-permissions";
import { useAdminPrivacy } from "@/hooks/use-admin-privacy";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { today } from "@/lib/format";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: Layout,
});

function Layout() {
  const { isSuperAdmin, loading: l1 } = useSuperAdmin();
  const { privacyMode, setPrivacyMode } = useAdminPrivacy();
  const firm = useCurrentFirm();
  const { canEdit } = usePermissions();
  const qc = useQueryClient();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const noFirm = !l1 && !firm.isLoading && !firm.data && path !== "/admin";
  // pg_cron already generates these for every active firm; this only covers a
  // firm created after the last cron tick. Gated on the same Edit permission so
  // a Cashier's browser never attempts it.
  const mayGenerate = canEdit("recurring");

  // Auto-generate due recurring jobs once per firm per session
  useEffect(() => {
    const fid = firm.data?.id;
    if (!fid || !mayGenerate) return;
    const key = `recurring-run-${fid}-${today()}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    supabase.rpc("generate_recurring_jobs", { _upto: today() }).then(({ data, error }) => {
      if (!error && data && data > 0) {
        toast.success(`${data} recurring job(s) populated automatically`);
        qc.invalidateQueries();
      }
    });
  }, [firm.data?.id, mayGenerate, qc]);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-muted/30">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur md:px-6">
            <SidebarTrigger />
            {firm.data && !privacyMode && <GlobalSearch />}
            <div className="ml-auto flex items-center gap-2.5">
              {!privacyMode && firm.data && <FirmSwitcher />}
              {!privacyMode && firm.data && (
                <CompleteBackupButton
                  variant="outline"
                  size="sm"
                  className="hidden sm:inline-flex text-xs h-8 px-2.5 font-medium border-border/80 hover:bg-muted"
                  label="Complete Backup"
                />
              )}
              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    const next = !privacyMode;
                    setPrivacyMode(next);
                    toast.success(next ? "Locked: Admin Mode" : "Unlocked: Full Controls Enabled");
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/80 bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title={privacyMode ? "Locked" : "Unlocked"}
                >
                  {privacyMode ? (
                    <Lock className="h-4 w-4 text-slate-400" />
                  ) : (
                    <Unlock className="h-4 w-4 text-emerald-500" />
                  )}
                </button>
              )}
              <UserMenu />
            </div>
          </header>
          <main className="flex-1 p-5 md:p-8">
            {noFirm ? (
              <div className="mx-auto mt-16 max-w-md rounded-xl border bg-card p-10 text-center">
                <Building2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                {isSuperAdmin ? (
                  <>
                    <h2 className="text-lg font-semibold">Pick a firm to work in</h2>
                    <p className="mb-5 mt-1 text-sm text-muted-foreground">
                      Open a firm from the console, or create a new one.
                    </p>
                    <Button asChild>
                      <Link to="/admin">Go to Firms Console</Link>
                    </Button>
                  </>
                ) : (
                  <>
                    <h2 className="text-lg font-semibold">No firm access</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Your account isn't linked to an active firm. Ask your firm Admin to invite
                      you.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <Outlet />
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
