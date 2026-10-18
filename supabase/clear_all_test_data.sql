-- ==============================================================================
-- AJ's Chartered Desk — Safe Reset / Clear All Test Data Script
-- Preserves: Super Admin (platform_admins), Firms, Users, Roles & Permissions, Master Services
-- Wipes: All test clients, jobs, payments, invoices, expenses & transactional ledger
-- ==============================================================================

do $$
declare
  t text;
  r record;
begin
  -- 1. Wipe Transaction Tables in Foreign-Key Dependency Order (Safe table existence check)
  foreach t in array array[
    'payment_allocations',
    'payment_reversals',
    'invoice_items',
    'invoices',
    'payments',
    'job_clearing',
    'job_status_history',
    'expenses',
    'jobs',
    'client_services',
    'client_contacts',
    'clients',
    'bank_transactions',
    'discounts'
  ] loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      execute format('delete from public.%I;', t);
    end if;
  end loop;

  -- 2. Clean Transactional Audit Logs (Keep System & Role setup)
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'audit_logs') then
    delete from public.audit_logs where action not in ('role_permission_set', 'system_init');
  end if;

  -- 3. Reset Sequential Document Numbering in doc_sequences (if present)
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'doc_sequences') then
    update public.doc_sequences set current_val = 0;
  end if;

  -- 4. Reset Postgres Sequences back to 1
  for r in (
    select sequence_name 
    from information_schema.sequences 
    where sequence_schema = 'public' 
      and sequence_name in ('client_seq', 'job_seq', 'invoice_seq', 'payment_seq', 'expense_seq', 'service_seq')
  ) loop
    execute format('alter sequence public.%I restart with 1;', r.sequence_name);
  end loop;

  raise notice 'All test transaction data successfully purged. Super Admin, Roles, and Settings preserved.';
end $$;
