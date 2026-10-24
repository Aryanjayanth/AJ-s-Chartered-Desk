-- ==============================================================================
-- AJ's Chartered Desk — Clear / Reset All Practice Test Data
-- Preserves: Super Admin, Firms, User Profiles, Auth, Roles & Permissions, Settings, Master Services
-- Wipes: All test Clients, Compliance Jobs, Invoices, Payments, Receipts, Settlements, Expenses & Audit Ledger
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. REUSABLE RPC: clear_firm_test_data (Callable by Firm Admins / Super Admin)
-- ------------------------------------------------------------------------------
create or replace function public.clear_firm_test_data(p_firm_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  is_mgr boolean;
  is_admin boolean;
  t text;
begin
  -- Resolve target firm: either passed explicitly or active firm of caller
  target_id := coalesce(p_firm_id, public.current_firm_id());
  
  if target_id is null then
    raise exception 'No active firm found. Please provide a valid firm_id.';
  end if;

  -- Verify permissions: Caller must be a manager of this firm or a platform super admin
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and firm_id = target_id
      and role = 'admin'
  ) into is_mgr;

  select exists (
    select 1 from public.platform_admins
    where user_id = auth.uid()
  ) into is_admin;

  if not (coalesce(is_mgr, false) or coalesce(is_admin, false)) then
    raise exception 'Access denied: Only a Firm Admin or Super Admin can reset practice data.';
  end if;

  -- Wipe transactional records in FK dependency order for the target firm
  foreach t in array array[
    'payment_allocations',
    'payment_reversals',
    'invoice_items',
    'invoices',
    'payments',
    'job_clearing',
    'job_conditions',
    'job_status_history',
    'recurring_payments',
    'jobs',
    'expenses',
    'bank_transactions',
    'client_services',
    'client_contacts',
    'clients',
    'discounts'
  ] loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      if exists (
        select 1 from information_schema.columns 
        where table_schema = 'public' and table_name = t and column_name = 'firm_id'
      ) then
        execute format('delete from public.%I where firm_id = %L;', t, target_id);
      end if;
    end if;
  end loop;

  -- Reset document numbering sequences for this firm
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'doc_counters') then
    delete from public.doc_counters where firm_id = target_id;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'doc_sequences') then
    update public.doc_sequences set current_val = 0 where firm_id = target_id;
  end if;

  -- Clean firm transactional audit logs (preserve system & role logs)
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'audit_logs') then
    delete from public.audit_logs 
    where firm_id = target_id 
      and action not in ('role_permission_set', 'system_init');
  end if;

  return jsonb_build_object(
    'success', true,
    'firm_id', target_id,
    'message', 'All practice test data has been successfully purged.'
  );
end;
$$;

grant execute on function public.clear_firm_test_data(uuid) to authenticated;


-- ------------------------------------------------------------------------------
-- 2. ONE-SHOT WIPE SCRIPT (Run directly in Supabase SQL Editor to wipe ALL firms)
-- ------------------------------------------------------------------------------
do $$
declare
  t text;
  r record;
begin
  -- Wipe all transaction tables across all firms
  foreach t in array array[
    'payment_allocations',
    'payment_reversals',
    'invoice_items',
    'invoices',
    'payments',
    'job_clearing',
    'job_conditions',
    'job_status_history',
    'recurring_payments',
    'jobs',
    'expenses',
    'bank_transactions',
    'client_services',
    'client_contacts',
    'clients',
    'discounts'
  ] loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      execute format('delete from public.%I;', t);
    end if;
  end loop;

  -- Clean Transactional Audit Logs (Keep System & Role setup)
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'audit_logs') then
    delete from public.audit_logs where action not in ('role_permission_set', 'system_init');
  end if;

  -- Reset Sequential Document Numbering
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'doc_counters') then
    truncate table public.doc_counters;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'doc_sequences') then
    update public.doc_sequences set current_val = 0;
  end if;

  -- Reset Postgres Sequences back to 1
  for r in (
    select sequence_name 
    from information_schema.sequences 
    where sequence_schema = 'public' 
      and sequence_name in ('client_seq', 'job_seq', 'invoice_seq', 'payment_seq', 'expense_seq', 'service_seq')
  ) loop
    execute format('alter sequence public.%I restart with 1;', r.sequence_name);
  end loop;

  raise notice 'All test transaction data successfully purged across all firms. Super Admin, Roles, and Settings preserved.';
end $$;
