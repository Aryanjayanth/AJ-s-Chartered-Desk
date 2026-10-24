/**
 * The six practice modules an Admin can hand out, and the five things they can
 * do in each. The authoritative copy of these flags lives in Postgres
 * (role_permissions + has_capability); this file only holds the labels and the
 * shape used to render them, so there is no second source of truth to drift.
 *
 * "Amounts" is what separates "can see the record" from "can see the money".
 * Without it, granting View would silently expose every fee and invoice total,
 * which is the one thing cashiers are normally kept away from.
 */
export const MODULES = [
  "clients",
  "services",
  "jobs",
  "recurring",
  "payments",
  "expenses",
] as const;
export type Module = (typeof MODULES)[number];

export const ACTIONS = ["view", "create", "edit", "update", "delete", "amounts"] as const;
export type Action = (typeof ACTIONS)[number];

export type Grants = Record<Action, boolean>;
export type GrantsByModule = Record<Module, Grants>;

export const MODULE_LABEL: Record<Module, string> = {
  clients: "Clients",
  services: "Services",
  jobs: "Jobs",
  recurring: "Recurring Jobs",
  payments: "Payment Records",
  expenses: "Expenses",
};

export const MODULE_BLURB: Record<Module, string> = {
  clients: "The client register and each client's profile.",
  services: "The service catalogue and the fee-bearing service definitions.",
  jobs: "Compliance jobs: create them, work on them, move their status.",
  recurring: "Retainer schedules, automatic job generation and standing payments.",
  payments: "Money received: record it, see it, reverse it.",
  expenses: "Firm overheads and job costs.",
};

export const ACTION_LABEL: Record<Action, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  update: "Update",
  delete: "Delete",
  amounts: "Amounts",
};

export const ACTION_BLURB: Record<Action, string> = {
  view: "Open the list and its records.",
  create: "Add new records.",
  edit: "Change existing records.",
  update: "Change the status of work only (done / in progress / etc.).",
  delete: "Remove records. Refused for anything with financial history.",
  amounts: "See fees, amounts and totals. Turning this off shows a dash instead.",
};

/**
 * Payment rows are corrected by reversing them, never by deleting them, so the
 * Delete cell is switched off for everyone including Admin.
 */
export const DELETE_LOCKED: Partial<Record<Module, true>> = { payments: true };

/** Nothing is permitted until the server has answered. */
export const NO_GRANTS: Grants = {
  view: false,
  create: false,
  edit: false,
  update: false,
  delete: false,
  amounts: false,
};

/**
 * Grants used when the my_permissions() RPC is not reachable, i.e. the
 * permissions migration has not been applied yet. This mirrors
 * permission_defaults() in Postgres, which was chosen to reproduce the roles'
 * behaviour from before the matrix existed — so a firm running the older schema
 * sees exactly what it saw before, rather than an empty application.
 *
 * Only a missing function falls back to this. Any other failure (RLS denial,
 * network) stays denied, because guessing there could over-grant.
 */
export function fallbackGrants(roles: readonly string[]): GrantsByModule {
  // Before the migration the database still returns the old enum labels, so
  // "owner" and "accountant" arrive here instead of "admin". Treat them as
  // Admin, which is exactly what the migration maps them to.
  const admin = roles.some((r) => r === "admin" || r === "owner" || r === "accountant");
  const out = {} as GrantsByModule;
  for (const m of MODULES) {
    if (admin) {
      out[m] = {
        view: true,
        create: true,
        edit: true,
        update: true,
        // Payments are reversed, never deleted.
        delete: m !== "payments",
        amounts: true,
      };
    } else if (roles.includes("staff")) {
      out[m] = {
        view: true,
        create: false,
        edit: m === "jobs",
        update: m === "jobs",
        delete: false,
        amounts: false,
      };
    } else if (roles.includes("cashier")) {
      const pay = m === "payments";
      out[m] = { view: pay, create: pay, edit: false, update: false, delete: false, amounts: pay };
    } else {
      out[m] = NO_GRANTS;
    }
  }
  return out;
}

/** A fresh, fully-denied matrix. Never share one instance between callers: the
 *  Roles screen mutates per-role, so a shared object would make editing Staff
 *  silently repaint Cashier. */
export function noGrantsByModule(): GrantsByModule {
  return Object.fromEntries(MODULES.map((m) => [m, { ...NO_GRANTS }])) as GrantsByModule;
}

/** Turn the my_permissions() jsonb payload into a fully populated matrix. */
export function parseGrants(raw: unknown): GrantsByModule {
  const src = (raw ?? {}) as Record<string, Partial<Grants> | undefined>;
  const out = {} as GrantsByModule;
  for (const m of MODULES) {
    const g = src[m];
    out[m] = {
      view: !!g?.view,
      create: !!g?.create,
      edit: !!g?.edit,
      update: !!(g?.update ?? g?.edit),
      delete: !!g?.delete,
      amounts: !!g?.amounts,
    };
  }
  return out;
}

export type MatrixRow = {
  role: string;
  module: Module;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_update: boolean;
  can_delete: boolean;
  can_amounts: boolean;
  editable: boolean;
};

export function matrixToGrants(rows: MatrixRow[]): Record<string, GrantsByModule> {
  const out: Record<string, GrantsByModule> = {};
  for (const r of rows) {
    // Each role gets its own matrix, and each module its own Grants object, so
    // that toggling one cell cannot repaint another role's column.
    const perRole = (out[r.role] ??= noGrantsByModule());
    perRole[r.module] = {
      view: r.can_view,
      create: r.can_create,
      edit: r.can_edit,
      update: r.can_update ?? r.can_edit,
      delete: r.can_delete,
      amounts: r.can_amounts,
    };
  }
  return out;
}
