# AJ's Chartered Desk — Complete Guide

CA practice management & billing for multiple firms. Indian ₹ formatting, DD-MM-YYYY dates.

## 1. Who can do what

There are three roles. **Admin** is the firm's top role and always has full
access to its own data — it cannot be restricted, so a firm can never lock
itself out. What **Staff** and **Cashier** may do is decided per module by an
Admin on the **Roles & Permissions** screen, and stored in `role_permissions`.

| Module                             | Actions the Admin can grant per role |
| ---------------------------------- | ----------------------------------- |
| Clients                            | View, Create, Edit, Delete, Amounts |
| Services                           | View, Create, Edit, Delete, Amounts |
| Jobs                               | View, Create, Edit, Delete, Amounts |
| Recurring Jobs                     | View, Create, Edit, Delete, Amounts |
| Payment Records                    | View, Create, Edit (reverse), Amounts |
| Expenses                           | View, Create, Edit, Delete, Amounts |

Notes on the matrix:

- **View gates everything else.** Turning View off turns off the other four for
  that module, because there is no point editing what you cannot open.
- **Amounts** is separate from View, so a Cashier can record a payment without
  seeing every fee and invoice total in the practice.
- **Delete is refused for Payment Records** for every role, including Admin.
  A payment is corrected by reversing it, which is why the Delete cell is locked.
- A grant is firm-wide. Once Staff can view Clients they see every client, not
  only the ones assigned to them.
- Defaults preserve the previous behaviour: Staff read the practice modules and
  can move job status; Cashier records and views payments.
- Invoicing, receivables, reports, audit trail, users, roles, import/export and
  settings are **not** in the matrix — they stay with Admin.

Fixed roles outside the matrix:

| Role              | Access                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| Super Admin       | Firms Console: create/suspend firms, invite admins, open any firm with full access, switch firms      |
| Admin             | Everything in their firm, incl. users, roles, audit, settings, import/export, invoicing, reports      |
| Staff / Cashier   | Exactly what the Admin's matrix grants them                                                          |

Each firm sees only its own data (enforced by the database, not the screens).

## 2. Onboarding

1. Super admin signs in → Firms Console → **Create firm** (name, logo, city, phone, admin email).
2. The Admin receives an invite email → sets password on the Set Password page.
3. Admin fills **Settings** (firm details, GSTIN, PAN, bank details, default GST %), invites team from **Users**, then tunes what Staff and Cashier can do under **Roles & Permissions**.
4. Nobody can join a firm by self sign-up; invites only.

## 3. Day-to-day workflow

```text
Services -> Clients -> Client Services -> Jobs (auto) -> Invoices -> Payments -> Clearing -> Receivables -> Reconciliation -> Reports
```

1. **Services** — what your firm offers: name, service type, and a recurring toggle. If recurring, pick a frequency. Mandatory: name, type, billing type, frequency. **No fee or due-day rule here** — both are set per assignment.
2. **Clients** — profile, PAN/TAN/GSTIN, contacts, photo, assigned staff.
3. **Client Services** — link a client to a service with the agreed fee, frequency, start/end date, due days and assigned staff. The form previews the first job that will be generated, e.g. _Apr 2026 (01-04-2026 to 30-04-2026) → due 20-05-2026_. Periods roll from the start month, so a quarterly retainer starting 20-11-2026 covers 01-11-2026 to 31-01-2027.
4. **Jobs** — generated automatically once a day (first time a billing user opens the app); never duplicated. Status: Pending → In Progress → Completed / On Hold / Cancelled. Every change is logged with reason. Past due date shows as Overdue automatically.
5. **Invoices** — pick completed jobs (and/or extra line), discount with reason, GST. Totals calculated by the database. Printable invoice. Cancel only with reason (after reversing allocations). Never deleted.
6. **Payments** — record cash/bank/UPI/cheque/card with reference. Reverse with reason if wrong.
7. **Payment Clearing** — choose client; all their unallocated payments are pooled. "Auto-fill oldest first" settles oldest invoices; partial amounts mark invoices Partially Paid. Confirm to save. Allocations can be reversed.
8. **Unallocated Payments** — advances not yet applied.
9. **Outstanding** — every unpaid invoice; **Clear** opens clearing, **Remind** copies a reminder message.
10. **Ageing** — owed amounts by Current / 1–30 / 31–60 / 61–90 / 90+ days.
11. **Reconciliation** — import bank CSV (Date, Description, Reference, Amount, Debit/Credit or separate Credit/Debit columns). Suggested match by reference (UTR/cheque no.), else same amount within 3 days. Client name in the bank line is NOT required. Confirm match, pick a payment manually, mark reconciled, or ignore. Duplicate lines flagged.
12. **Exceptions** — items needing attention.
13. **Reports** — charts (monthly invoiced vs collected, payment modes, ageing, invoice/job status, top debtors, reconciliation) + 16 tabular reports with date/client/service filters, CSV export, print/PDF.
14. **Audit Trail** — every create/change/cancel/reversal with user, time, old/new values.
15. **Import / Export** (Administration) — bulk data movement, admin only.
    - **Export**: tick any of Clients, Services, Retainers, Jobs, Invoices, Payments → CSV or Excel (one sheet per entity). A snapshot of every record in the firm.
    - **Import**: Clients, Services and Retainers only. Download the template first — the Excel one has a `Format` sheet documenting every column and dropdowns on enum columns so invalid values can't be entered.
    - Every row is validated and shown before anything is written. Rows that already exist (clients match on PAN, services on name, retainers on client+service) are flagged as duplicates and default to **Skip**; choose per row or in bulk to Skip / Overwrite / Create as new copy.
    - Blank optional columns are left alone rather than cleared.
    - Invoices, Payments and Jobs are export-only — see below.

## 4. Business rules (enforced in database)

- Invoice subtotal, discount and CGST/SGST/IGST are computed by `create_invoice`; payment allocation by `allocate_payment`. Those tables carry no INSERT grant for staff, so **import cannot create them** — only the app or the API can. Opening balances belong in invoices.
- Allocation can't exceed payment balance or invoice outstanding; payment and invoice must be same client and firm.
- Invoice status auto: Unpaid → Partially Paid → Paid; linked jobs auto-close when paid.
- No deletion of financial records — cancel/reverse with reason only.
- Recurring jobs de-duplicated per client service and period.
- Overdue is calculated from due dates at read time.

## 5. Technical overview

- Frontend: React 19 + TanStack Start, Tailwind, recharts. Routes in `src/routes/_authenticated/*`.
- Backend: Supabase (Postgres + auth). Full SQL in `docs/backend.sql` (tables, row security, functions, triggers, demo data).
- Key database functions: `create_invoice`, `cancel_invoice`, `allocate_payment`, `reverse_allocation`, `reverse_payment`, `update_job_status`, `generate_recurring_jobs`, `create_firm`, `set_acting_firm`, `firm_overview`, role helpers `is_finance/is_manager/is_cashier/is_super_admin`, `current_firm_id`.
- Server functions: `src/lib/firms.functions.ts` (invite user, create firm).
- Photos/logos stored as small resized images in the database.

## 6. Known items / next steps

- Remaining security notices refer to actions signed-in users must be able to run; each checks role and firm inside.
- Change the super admin password from the one shared in chat.
- Demo data has been removed.
