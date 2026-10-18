# AJ's Chartered Desk

> **CA Practice Management, Compliance & Billing Platform**  
> Developed by **Aryan Jayanth** (`sankaaryanjayanth@gmail.com`)

AJ's Chartered Desk is the smarter workspace for Chartered Accountants — an enterprise-grade multi-tenant practice management, compliance automation, and billing platform engineered specifically for Chartered Accountant (CA) firms, tax practitioners, and audit firms in India.

It features native Indian compliance workflows including Indian currency formatting (`₹`), date formatting (`DD-MM-YYYY`), PAN/TAN/GSTIN validation, GST computation with SAC codes, multi-firm data isolation via PostgreSQL Row Level Security (RLS), and comprehensive financial audit trails.

---

## Key Features

### 🏢 Multi-Tenant Firm Isolation

- Hard data isolation between accounting firms enforced by PostgreSQL Row Level Security (RLS).
- Firm switcher with Super Admin platform mode for managing multiple firms securely.
- Role-based invitations and team member onboarding.

### 👥 Client & Service Retainer Management

- Full Client 360 directory with PAN, TAN, GSTIN, business type, contact details, and assigned staff.
- Service master catalog with standard SAC codes (e.g. `998221`, `998222`), default fees, and due date rules.
- Retainer schedules (`client_services`) supporting Monthly, Quarterly, Half-Yearly, and Yearly recurring compliance.

### ⚡ Automated Recurring Jobs & Auto-Invoicing

- **Automated Job Generation**: Daily `pg_cron` generation and 1-click manual generation of periodic compliance work (GSTR-3B, GSTR-1, TDS, Audits) with zero duplicates.
- **Auto-Invoicing on Completion**: Optional toggle per service, client retainer, or individual job to automatically raise an invoice the moment work is marked `Completed`.
- **Linked Job-Billing Bridge**: Direct 1-click navigation between operational jobs and legal invoices. Click any billing status badge to view or raise its associated invoice.

### 📋 Operations & Work Management

- Granular job lifecycles (`Pending` → `In Progress` → `Completed` / `On Hold` / `Cancelled`) with logged change reasons and audit trails.
- Overdue tracking dynamically calculated from statutory deadlines without cron dependencies.
- Staff assignment and workload filtering.

### 💰 Invoicing, Billing & Payments

- Professional GST invoices with automated CGST/SGST/IGST breakdown, SAC codes, and discounts with reason tracking.
- Printable tax invoice PDF preview and download.
- Payment allocation engine supporting cash, bank, UPI, NEFT/RTGS, and cheques.
- Unallocated payment advance pooling with FIFO auto-settlement against oldest unpaid invoices.
- Strict financial immutability: zero permanent deletes; all adjustments use reversal/cancellation RPCs.

### 📊 Receivables & Bank Reconciliation

- Accounts receivable ageing analysis categorized by standard buckets (Current, 1–30, 31–60, 61–90, 90+ days).
- CSV bank statement parser with automated UTR/cheque reference matching and date/amount tolerance checking.

---

## Tech Stack

- **Framework**: [TanStack Start](https://tanstack.com/start) / [TanStack Router](https://tanstack.com/router)
- **Frontend**: [React 19](https://react.dev), [Tailwind CSS v4](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com), [Recharts](https://recharts.org), [Lucide React](https://lucide.dev)
- **Backend / Database**: [Supabase](https://supabase.com) (PostgreSQL 15+, Row Level Security, Stored Procedures/RPCs, pg_cron)
- **State & Data Fetching**: [TanStack Query](https://tanstack.com/query)
- **Build Tool**: [Vite 8](https://vitejs.dev), TypeScript

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) (v20+ recommended)
- A Supabase project with database schema applied from [`supabase/full_schema_setup.sql`](supabase/full_schema_setup.sql)

### Environment Configuration

Create a `.env` file in the root directory (see [`.env.example`](.env.example)):

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

### Installation & Development

```sh
# Install dependencies
npm install

# Start local development server
npm run dev

# Run TypeScript check
npx tsc --noEmit

# Build for production
npm run build

# Preview production build
npm run preview
```

---

## Database Schema & Migrations

The complete, authoritative database schema is maintained in [`supabase/full_schema_setup.sql`](supabase/full_schema_setup.sql). Individual incremental migrations are tracked in [`supabase/migrations/`](supabase/migrations/).

All business rules, allocation limits, recurring de-duplication, invoice calculations, and auto-invoicing live directly inside PostgreSQL triggers and security-definer RPCs to guarantee transactional integrity.

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.  
Copyright (c) 2026 **Aryan Jayanth**.
