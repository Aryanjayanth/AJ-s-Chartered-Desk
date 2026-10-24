/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRoles, type Role } from "@/hooks/use-roles";
import {
  DELETE_LOCKED,
  fallbackGrants,
  noGrantsByModule,
  parseGrants,
  matrixToGrants,
  type Action,
  type Grants,
  type GrantsByModule,
  type MatrixRow,
  type Module,
} from "@/lib/permissions";
import { isUndefinedFunction } from "@/lib/supabase-read";
import { errMsg } from "@/lib/format";

/**
 * What the signed-in user may do in each module, as decided by the firm Admin.
 *
 * Every check here is cosmetic: Postgres answers the same question through
 * has_capability() inside the RLS policies, so a hidden button is never what
 * keeps data private. This hook only stops the UI offering actions that the
 * database would reject anyway.
 */

export function usePermissions() {
  const { roles } = useRoles();
  // Set by the queryFn when the RPC is missing, so the UI can say so rather
  // than silently pretending the matrix is authoritative.
  const fellBack = useRef(false);

  const q = useQuery({
    queryKey: ["my-permissions", roles],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_permissions");
      if (error) {
        // Before the permissions migration is applied the RPC simply is not
        // there. Fall back to the role defaults rather than locking the user
        // out of the whole application; any other error stays a hard failure.
        if (isUndefinedFunction(error)) {
          fellBack.current = true;
          return fallbackGrants(roles);
        }
        fellBack.current = false;
        throw error;
      }
      fellBack.current = false;
      return parseGrants(data);
    },
  });

  // A fresh deny-all matrix while loading, rather than a shared module-level
  // object that a caller could mutate.
  const grants: GrantsByModule = q.data ?? noGrantsByModule();
  const can = (module: Module, action: Action) => !!grants[module]?.[action];

  return {
    grants,
    loading: q.isLoading,
    /** True when the matrix is unavailable and role defaults are standing in. */
    usingFallback: fellBack.current,
    can,
    canView: (module: Module) => can(module, "view"),
    canCreate: (module: Module) => can(module, "create"),
    canEdit: (module: Module) => can(module, "edit"),
    canUpdate: (module: Module) => can(module, "update") || can(module, "edit"),
    canDelete: (module: Module) => can(module, "delete") && !DELETE_LOCKED[module],
    canSeeAmounts: (module: Module) => can(module, "amounts"),
    /** View is the gate for everything else: no point editing what you cannot open. */
    canAny: (module: Module) => can(module, "view"),
  };
}

/** The editable matrix, for the Roles & Permissions screen. */
export function usePermissionMatrix() {
  return useQuery({
    queryKey: ["permission-matrix"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("permission_matrix");
      if (error) {
        if (isUndefinedFunction(error)) return null;
        throw error;
      }
      return matrixToGrants((data ?? []) as MatrixRow[]);
    },
  });
}

export function useSetPermission() {
  const qc = useQueryClient();
  return async (role: Role, module: Module, next: Grants): Promise<void> => {
    let res = await supabase.rpc("set_role_permission", {
      _role: role,
      _module: module,
      _view: next.view,
      _create: next.create,
      _edit: next.edit,
      _update: next.update,
      _delete: next.delete,
      _amounts: next.amounts,
    });
    // Fallback if database still has 7-parameter version without _update
    if (res.error && res.error.message?.includes("function")) {
      res = await (supabase.rpc as any)("set_role_permission", {
        _role: role,
        _module: module,
        _view: next.view,
        _create: next.create,
        _edit: next.edit,
        _delete: next.delete,
        _amounts: next.amounts,
      });
    }
    if (res.error) {
      toast.error(errMsg(res.error));
      return;
    }
    qc.invalidateQueries({ queryKey: ["permission-matrix"] });
    qc.invalidateQueries({ queryKey: ["my-permissions"] });
  };
}

export function useResetPermissions() {
  const qc = useQueryClient();
  return async () => {
    const { error } = await supabase.rpc("reset_role_permissions");
    if (error) {
      toast.error(errMsg(error));
      return;
    }
    toast.success("Permissions restored to defaults");
    qc.invalidateQueries({ queryKey: ["permission-matrix"] });
    qc.invalidateQueries({ queryKey: ["my-permissions"] });
  };
}
