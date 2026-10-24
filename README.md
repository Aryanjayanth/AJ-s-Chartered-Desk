# AJ's Chartered Desk

> **Enterprise Practice Management, Compliance Automation & Billing Platform for Chartered Accountants**  
> Developed by **Aryan Jayanth** (`sankaaryanjayanth@gmail.com`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Framework](https://img.shields.io/badge/Framework-TanStack%20Start%20%2F%20React%2019-2563eb.svg)](https://tanstack.com/start)
[![Styling](https://img.shields.io/badge/Styling-Tailwind%20CSS%20v4-38bdf8.svg)](https://tailwindcss.com)
[![Database](https://img.shields.io/badge/Database-Supabase%20%2F%20PostgreSQL%2015+-059669.svg)](https://supabase.com)
[![Build Status](https://img.shields.io/badge/Build-Passing-emerald.svg)](#)

---

## Executive Overview

**AJ's Chartered Desk** is an enterprise-grade, multi-tenant practice management, compliance automation, and financial billing platform engineered specifically for **Chartered Accountant (CA) firms, tax practitioners, and audit firms in India**.

It encapsulates real-world Indian regulatory and practice operations — including Indian Rupee (`₹`) financial formatting, `DD-MM-YYYY` calendar cycles, PAN/TAN/GSTIN format validation, automated recurring compliance retainers, payment clearing workflows, and strict PostgreSQL-enforced financial immutability.

---

## Key Modules & Platform Capabilities

### 🏢 1. Multi-Tenant Firm Isolation & Super Admin Platform

- **PostgreSQL Row Level Security (RLS)**: Enforces firm-level data isolation on all business tables using restrictive policies (`firm_id = current_firm_id()`).
- **Super Admin Console**: Platform operators can provision firms, manage subscriptions, invite firm owners, and seamlessly switch contexts using `acting_firm_id`.
- **Platform Privacy Toggle**: Allows platform operators to inspect system status with full privacy safeguards.

### 👥 2. Client 360 & Retainer Schedules

- **Client Directory**: Centralized client profiles tracking PAN, TAN, GSTIN, business structures (Individual, Private Ltd, LLP, Partnership, Trust), multiple contacts, and assigned staff.
- **Client Services & Retainers**: Retainer agreements (`client_services`) define agreed fees, recurrence frequencies (Monthly, Quarterly, Half-Yearly, Yearly), start/end dates, due-day rules, and designated staff.
- **Rolling Period Mathematics**: Accurately computes statutory period windows (e.g. `01-04-2026 to 30-04-2026` due `20-05-2026`).

### ⚡ 3. Automated Recurring Jobs & Operational Tasks

- **Automated Job Generator**: Automated daily generation via `pg_cron` (`generate_recurring_jobs_all`) and on-demand session generation with strict de-duplication rules.
- **Granular Lifecycle Tracking**: Status transitions (`Pending` → `In Progress` → `Completed` / `On Hold` / `Cancelled`) logged with audit reasons.
- **Overdue Calculations**: Statutory deadlines derived dynamically at read time without reliance on polling jobs.
- **Task & Subtask Checklists**: Pre-configured compliance checklists (GST returns, tax audit, TDS filings) to ensure systematic team execution.

### 💳 4. Payment Clearing Desk & Financial Allocation Engine

- **Unallocated Advance Pooling**: Client payments and deposits are logged into a unified money jar.
- **Full-Window Allocation Workspace**: Clean workspace to inspect available advances, view open job fees and reimbursable outlays, and apply manual allocations or 1-click Quick Auto-Fill.
- **Discounts & Waivers**: Apply authorized discounts directly during settlement without creating phantom balance anomalies.
- **Over-Allocation Prevention**: Real-time validation prevents allocating more than available receipt balances or outstanding dues.

### 🧾 5. Invoicing & Billing

- **Compliant Tax Invoices**: Automatically breaks down CGST, SGST, IGST, and itemized service fees.
- **Automated Invoicing on Job Completion**: Jobs flagged with `auto_invoice` trigger secure, automated invoice creation and billing item linkage upon completion.
- **Print & PDF Generation**: Professional tax invoices formatted for immediate client dispatch.
- **Financial Immutability**: Financial records are append-only. Corrections and adjustments are processed strictly through security-definer cancellation and reversal RPCs.

### 🛡️ 6. Granular Roles & Permissions Matrix

- **Five Grantable Capabilities**: `view`, `create`, `edit`, `delete`, and `amounts`.
- **Cosmetic vs. Real Security**: List views carrying monetary figures (`jobs_list`, `payments_list`, `expenses_list`) mask figures to `NULL` in the database if the caller lacks the `amounts` capability, preventing sensitive fee exposure.
- **Admin Lockout Protection**: Owner and Admin roles maintain unconditional access, ensuring a firm can never accidentally lock itself out.

### 📊 7. Receivables, Ageing & Analytics

- **Receivables Ageing Analysis**: Categorized by standard ageing buckets (`Current`, `1–30`, `31–60`, `61–90`, `90+` days) with descending outstanding ranking.
- **Bank Statement Reconciliation**: CSV parser with automated reference matching (UTR, cheque numbers), date tolerances, and duplicate detection.
- **Audit Trail**: Every creation, status change, discount, and reversal is stamped with user, timestamp, and before/after state.

---

## Production Readiness Review

> [!IMPORTANT]
> **Production Status: READY FOR DEPLOYMENT**  
> The core system architecture, business rules, financial ledger immutability, and security layers are engineered to production standards. Below is the pre-launch verification checklist.

### Production Architecture Verification

| Dimension            | Implementation                                                     | Production Status |
| :------------------- | :----------------------------------------------------------------- | :---------------: |
| **Multi-Tenancy**    | Restrictive PostgreSQL RLS with `current_firm_id()`                |    ✅ Verified    |
| **Data Integrity**   | Business rules and totals computed via triggers and DB RPCs        |    ✅ Verified    |
| **Financial Ledger** | Append-only payments; reversal RPCs; no plain `DELETE`             |    ✅ Verified    |
| **Data Masking**     | DB-level `amounts` column masking for Cashier / Staff roles        |    ✅ Verified    |
| **Sequential Codes** | Concurrency-safe atomic document counters (`PAY-`, `INV-`, `JOB-`) |    ✅ Verified    |
| **Build & Bundle**   | Zero TypeScript compilation errors; code-split production bundle   |    ✅ Verified    |

---

## Pre-Launch Production Checklist

Before pointing production DNS and onboarding paying firms, complete the following items:

### 1. Supabase Production Settings

- [ ] **Custom SMTP Provider**: Configure a dedicated transactional email provider (Resend, SendGrid, Amazon SES, or Postmark) in **Supabase Dashboard → Authentication → SMTP Settings**. Default Supabase email limits are strictly rate-limited (~3 emails/hour).
- [ ] **Site URL & Redirect URLs**: Set your live domain (e.g., `https://desk.yourfirm.com/**`) under **Authentication → URL Configuration**.
- [ ] **Database Backups**: Enable Point-In-Time Recovery (PITR) or daily automated backups in Supabase.
- [ ] **Automated Cron Jobs**: Ensure `pg_cron` extension is active and schedules `generate_recurring_jobs_all` to execute daily at midnight:
  ```sql
  SELECT cron.schedule('generate-daily-recurring-jobs', '0 0 * * *', 'SELECT public.generate_recurring_jobs_all();');
  ```

### 2. Environment Variables

Configure your production environment variables on your hosting provider:

```env
VITE_SUPABASE_URL=https://your-production-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-production-anon-key
SUPABASE_URL=https://your-production-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-production-service-role-key
```

### 3. Clear Test / Demo Data

If test records were entered during staging, run [`supabase/clear_all_test_data.sql`](supabase/clear_all_test_data.sql) in the Supabase SQL Editor. This safely purges mock clients, jobs, payments, invoices, and sequence counters while preserving Super Admins, Firms, Users, Roles, and Master Services.

---

## Tech Stack

- **Framework**: [TanStack Start](https://tanstack.com/start) & [TanStack Router](https://tanstack.com/router)
- **Frontend**: [React 19](https://react.dev), [Tailwind CSS v4](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com), [Recharts](https://recharts.org), [Lucide React](https://lucide.dev)
- **Backend / Database**: [Supabase](https://supabase.com) (PostgreSQL 15+, Row Level Security, Stored Procedures/RPCs, pg_cron)
- **State & Data Fetching**: [TanStack Query v5](https://tanstack.com/query)
- **Build Engine**: [Vite 8](https://vitejs.dev), TypeScript

---

## Getting Started

### Local Setup

```sh
# 1. Clone repository
git clone https://github.com/Aryanjayanth/AJ-s-Chartered-Desk.git
cd AJ-s-Chartered-Desk

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Fill in your Supabase credentials in .env

# 4. Start local development server
npm run dev
```

### Building for Production

```sh
# Type-check and compile optimized production build
npm run build

# Preview production build locally
npm run preview
```

### Database Initialization

To initialize a fresh database instance:

1. Open your Supabase Project SQL Editor.
2. Execute [`supabase/full_schema_setup.sql`](supabase/full_schema_setup.sql). This establishes the complete database schema, security definer functions, triggers, permissions matrix, and role defaults in a single step.

---

## Repository Structure

```
├── archive/                     # Archived historical migrations & legacy backups (git-ignored)
├── docs/                        # Architecture guides, workflow specs, and schema copies
├── public/                      # Static assets, branding logos, and favicon
├── scripts/                     # Build tools and schema consolidation scripts
├── src/
│   ├── components/app/          # Core business widgets (DataTables, JobForm, Sidebars)
│   ├── components/ui/           # Reusable atomic UI components (shadcn/ui)
│   ├── hooks/                   # Custom hooks (usePermissions, useRoles, useFirm)
│   ├── lib/                     # Currency formatting, date math, server functions, entities
│   └── routes/                  # File-based router pages (_authenticated/*, auth, etc.)
└── supabase/
    ├── clear_all_test_data.sql  # Safe staging data purge script
    ├── config.toml              # Supabase CLI configuration
    └── full_schema_setup.sql    # Authoritative single-file master database schema
```

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.  
Copyright (c) 2026 **Aryan Jayanth**. All rights reserved.
