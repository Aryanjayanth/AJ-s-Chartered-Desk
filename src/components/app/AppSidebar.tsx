import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  ClipboardList,
  ListChecks,
  FileText,
  Repeat,
  ReceiptIndianRupee,
  Wallet,
  Shuffle,
  CircleDollarSign,
  AlertTriangle,
  CalendarClock,
  BarChart3,
  UserCog,
  ShieldCheck,
  History,
  Settings,
  Building2,
  ChevronDown,
  ArrowLeftRight,
  Layers,
  BadgePercent,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useRoles, type Role } from "@/hooks/use-roles";
import { usePermissions } from "@/hooks/use-permissions";
import { useCurrentFirm, useSuperAdmin } from "@/hooks/use-firm";
import { useAdminPrivacy } from "@/hooks/use-admin-privacy";
import type { Module } from "@/lib/permissions";
import { EntityAvatar } from "./EntityAvatar";
import { cn } from "@/lib/utils";

const M: Role[] = ["admin"];

/** Nav items that follow the Admin's permission matrix rather than a role. */
type Item = {
  title: string;
  url: string;
  icon: typeof Users;
  roles?: Role[];
  module?: Module;
};
const groups: { label: string; items: Item[]; open?: boolean }[] = [
  {
    label: "Practice",
    open: true,
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, roles: M },
      { title: "Clients", url: "/clients", icon: Users, module: "clients" },
      { title: "Services", url: "/services", icon: Briefcase, module: "services" },
      { title: "Jobs", url: "/jobs", icon: ClipboardList, module: "jobs" },
      { title: "Tasks", url: "/tasks", icon: ListChecks, module: "jobs" },
      { title: "Recurring Jobs", url: "/recurring", icon: Repeat, module: "recurring" },
      { title: "Expenses", url: "/expenses", icon: ReceiptIndianRupee, module: "expenses" },
    ],
  },
  {
    label: "Billing & Payments",
    open: true,
    items: [
      { title: "Payment Entry", url: "/payments", icon: Wallet, module: "payments" },
      { title: "Payment Clearing", url: "/clearing", icon: Layers, roles: M },
      { title: "Deductions & TDS", url: "/deductions", icon: BadgePercent, module: "jobs" },
      { title: "Unallocated", url: "/unallocated", icon: CircleDollarSign, roles: M },
      { title: "Invoices", url: "/invoices", icon: FileText, roles: M },
    ],
  },
  {
    label: "Receivables & Reports",
    open: true,
    items: [
      { title: "Outstanding", url: "/outstanding", icon: AlertTriangle, roles: M },
      { title: "Ageing", url: "/ageing", icon: CalendarClock, roles: M },
      { title: "Reports", url: "/reports", icon: BarChart3, roles: M },
    ],
  },
  {
    label: "Administration",
    open: true,
    items: [
      { title: "Users", url: "/users", icon: UserCog, roles: M },
      { title: "Roles & Permissions", url: "/roles", icon: ShieldCheck, roles: M },
      { title: "Audit Trail", url: "/audit", icon: History, roles: M },
      { title: "Import / Export", url: "/import-export", icon: ArrowLeftRight, roles: M },
      { title: "Settings", url: "/settings", icon: Settings, roles: M },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { has, loading } = useRoles();
  const { canView } = usePermissions();
  const { isSuperAdmin } = useSuperAdmin();
  const { privacyMode } = useAdminPrivacy();
  const { data: firm } = useCurrentFirm();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (u: string) => path === u || path.startsWith(u + "/");
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      groups.map((g) => [g.label, !!g.open || g.items.some((i) => isActive(i.url))]),
    ),
  );

  const isPlatformMode = isSuperAdmin && privacyMode;

  return (
    <Sidebar collapsible="icon" className="no-print">
      <SidebarHeader className="border-b border-sidebar-border py-2.5 px-2 group-data-[collapsible=icon]:p-2">
        <Link
          to={isPlatformMode ? "/admin" : "/dashboard"}
          className="flex items-center gap-2.5 rounded-md p-1 transition-colors hover:bg-sidebar-accent/50 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center">
            {!isPlatformMode && firm?.logo_url ? (
              <img src={firm.logo_url} alt={firm.name} className="h-full w-full object-contain" />
            ) : (
              <img
                src="/logo.png"
                alt="AJ's Chartered Desk"
                className="h-8 w-8 object-contain mix-blend-screen"
              />
            )}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold leading-tight text-sidebar-foreground">
                {isPlatformMode ? "AJ's Chartered Desk" : (firm?.name ?? "AJ's Chartered Desk")}
              </div>
              <div className="text-[11px] leading-tight text-muted-foreground opacity-75">
                {isPlatformMode ? "Super Admin" : "AJ's Chartered Desk"}
              </div>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-1 py-2 overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {/* Platform Links for Super Admin */}
        {isSuperAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Platform</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/admin")} tooltip="Firms Console">
                    <Link to="/admin">
                      <Building2 className="h-4 w-4" />
                      <span>Firms Console</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/settings")} tooltip="Settings">
                    <Link to="/settings">
                      <Settings className="h-4 w-4" />
                      <span>Settings</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Firm practice modules (hidden when Super Admin has privacy mode active) */}
        {!loading &&
          firm &&
          !isPlatformMode &&
          groups.map((g) => {
            const items = g.items.filter((i) =>
              i.module ? canView(i.module) : has(...(i.roles ?? M)),
            );
            if (!items.length) return null;
            const isOpen = collapsed || open[g.label];
            return (
              <SidebarGroup key={g.label}>
                <SidebarGroupLabel asChild>
                  <button
                    type="button"
                    onClick={() => setOpen((o) => ({ ...o, [g.label]: !o[g.label] }))}
                    className="flex w-full items-center justify-between"
                  >
                    {g.label}
                    <ChevronDown
                      className={cn("h-3.5 w-3.5 transition-transform", !isOpen && "-rotate-90")}
                    />
                  </button>
                </SidebarGroupLabel>
                {isOpen && (
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {items.map((i) => (
                        <SidebarMenuItem key={i.url}>
                          <SidebarMenuButton asChild isActive={isActive(i.url)} tooltip={i.title}>
                            <Link to={i.url}>
                              <i.icon className="h-4 w-4" />
                              <span>{i.title}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                )}
              </SidebarGroup>
            );
          })}
      </SidebarContent>
    </Sidebar>
  );
}
