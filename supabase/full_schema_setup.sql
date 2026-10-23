-- ==============================================================================
-- AJ's Chartered Desk: Master Database Schema & Complete Migrations
-- ==============================================================================
-- Consolidated Master SQL script containing all 25 migration steps in sequence.
-- Can be executed in the Supabase SQL Editor on a fresh project to establish the
-- entire schema, functions, triggers, RLS policies, permissions, and automation.
-- ==============================================================================

-- TABLE OF CONTENTS / MIGRATIONS INCLUDED:
--    1. 20261001094459_4f8ffcda-6ba3-49e4-9bb1-93664b8100cc.sql
--    2. 20261001094510_953d0d46-30cf-431b-a336-b8f69e1d5b6b.sql
--    3. 20261001103748_99ff9f1e-789a-4ba5-88b2-1dae669024f6.sql
--    4. 20261001103801_9ebefd9f-0bff-4c51-ad45-897b97854f33.sql
--    5. 20261001140028_3a4854f4-184b-435d-b839-6423d24b7a8a.sql
--    6. 20261002104000_delete_firm_rpc.sql
--    7. 20261002203000_auto_invoice.sql
--    8. 20261004120000_client_contacts_and_validation.sql
--    9. 20261004130000_relax_client_contacts.sql
--   10. 20261004140000_drop_client_financial_year.sql
--   11. 20261004150000_services_rework.sql
--   12. 20261005090000_job_payment_workflow_schema.sql
--   13. 20261006120000_module_permissions.sql
--   14. 20261006150000_doc_numbering.sql
--   15. 20261006160000_sequential_master_codes.sql
--   16. 20261006170000_expenses_module.sql
--   17. 20261006180000_fix_stamp_doc_no.sql
--   18. 20261007134500_relax_expense_description.sql
--   19. 20261007140000_client_level_payments.sql
--   20. 20261007142000_fix_invoice_generation_and_advance.sql
--   21. 20261007142500_auto_invoice_on_square_off.sql
--   22. 20261007151000_security_advisor_hardening.sql
--   23. 20261007152000_invite_otp_support.sql
--   24. 20261008130000_fix_recurring_jobs_generation.sql
--   25. 20261009140000_multi_firm_and_recurring_tasks.sql
-- ==============================================================================


-- ==============================================================================
-- Migration 1 of 25: 20261001094459_4f8ffcda-6ba3-49e4-9bb1-93664b8100cc.sql
-- ==============================================================================

create type public.app_role as enum ('owner','admin','accountant','staff','cashier');

create table public.profiles (
  id uuid primary key,
  full_name text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role app_role not null,
  unique(user_id, role)
);

create or replace function public.has_role(_user_id uuid, _role app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id=_user_id and role=_role) $$;
create or replace function public.is_manager() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles where user_id=auth.uid() and role in ('owner','admin')) $$;
create or replace function public.is_finance() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles where user_id=auth.uid() and role in ('owner','admin','accountant')) $$;
create or replace function public.is_staff_plus() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles where user_id=auth.uid() and role in ('owner','admin','accountant','staff')) $$;
create or replace function public.is_cashier() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles where user_id=auth.uid() and role='cashier') $$;

-- signup trigger
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare first boolean;
begin
  select not exists(select 1 from public.user_roles where role='owner') into first;
  insert into public.profiles(id, full_name, email) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.email);
  insert into public.user_roles(user_id, role) values (new.id, case when first then 'owner'::app_role else 'staff'::app_role end);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create sequence public.client_seq; create sequence public.service_seq; create sequence public.job_seq;
create sequence public.invoice_seq; create sequence public.payment_seq;

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  client_code text not null unique default ('CL' || lpad(nextval('public.client_seq')::text,4,'0')),
  name text not null,
  client_type text not null default 'Company',
  mobile text, email text, address text, pan text, tan text, gstin text,
  gst_type text, business_type text, industry text, financial_year text default '2026-27',
  assigned_staff uuid references public.profiles(id),
  status text not null default 'active' check (status in ('active','inactive','suspended')),
  notes text, is_demo boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.clients(name); create index on public.clients(assigned_staff);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  service_code text not null unique default ('SV' || lpad(nextval('public.service_seq')::text,3,'0')),
  name text not null,
  service_type text not null default 'Other',
  description text,
  frequency text not null default 'monthly' check (frequency in ('one_time','monthly','quarterly','half_yearly','yearly')),
  billing_type text not null default 'recurring' check (billing_type in ('recurring','one_time')),
  default_fee numeric(14,2) not null default 0 check (default_fee >= 0),
  due_days int not null default 20,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.client_services (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  agreed_fee numeric(14,2) not null check (agreed_fee >= 0),
  frequency text not null check (frequency in ('one_time','monthly','quarterly','half_yearly','yearly')),
  start_date date not null default current_date,
  end_date date,
  due_days int not null default 20,
  assigned_staff uuid references public.profiles(id),
  status text not null default 'active' check (status in ('active','paused','stopped')),
  notes text,
  created_at timestamptz not null default now()
);
create index on public.client_services(client_id);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_code text not null unique default ('JB' || lpad(nextval('public.job_seq')::text,5,'0')),
  client_id uuid not null references public.clients(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  client_service_id uuid references public.client_services(id) on delete restrict,
  title text not null,
  period_start date, period_end date,
  fee numeric(14,2) not null default 0 check (fee >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  net_amount numeric(14,2) generated always as (fee - discount) stored,
  due_date date,
  assigned_staff uuid references public.profiles(id),
  status text not null default 'pending' check (status in ('pending','in_progress','completed','cancelled','on_hold')),
  financial_status text not null default 'open' check (financial_status in ('open','invoiced','closed')),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (discount <= fee)
);
create unique index jobs_recurring_unique on public.jobs(client_service_id, period_start) where client_service_id is not null and period_start is not null;
create index on public.jobs(client_id); create index on public.jobs(status); create index on public.jobs(assigned_staff);

create table public.job_status_history (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete restrict,
  old_status text, new_status text not null, reason text,
  changed_by uuid default auth.uid(), changed_at timestamptz not null default now()
);
create index on public.job_status_history(job_id);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique default ('INV-' || lpad(nextval('public.invoice_seq')::text,5,'0')),
  client_id uuid not null references public.clients(id) on delete restrict,
  invoice_date date not null default current_date,
  due_date date not null default (current_date + 15),
  description text,
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  tax_rate numeric(5,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0 check (total >= 0),
  amount_paid numeric(14,2) not null default 0,
  outstanding numeric(14,2) generated always as (total - amount_paid) stored,
  status text not null default 'unpaid' check (status in ('draft','unpaid','partially_paid','paid','cancelled')),
  cancel_reason text, notes text, is_demo boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.invoices(client_id); create index on public.invoices(status);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete restrict,
  description text not null,
  amount numeric(14,2) not null check (amount >= 0)
);
create index on public.invoice_items(invoice_id); create index on public.invoice_items(job_id);

create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.invoices(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete restrict,
  original_amount numeric(14,2) not null,
  discount_amount numeric(14,2) not null check (discount_amount >= 0),
  net_amount numeric(14,2) not null,
  reason text, approved_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  payment_code text not null unique default ('PAY' || lpad(nextval('public.payment_seq')::text,5,'0')),
  client_id uuid not null references public.clients(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  mode text not null check (mode in ('cash','bank','upi','cheque','card','other')),
  payment_date date not null default current_date,
  reference text, narration text,
  job_id uuid references public.jobs(id),
  allocated_amount numeric(14,2) not null default 0,
  status text not null default 'unallocated' check (status in ('unallocated','partially_allocated','allocated','reversed')),
  reconciled boolean not null default false,
  is_demo boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.payments(client_id); create index on public.payments(status); create index on public.payments(created_by);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  reversed boolean not null default false,
  reversed_at timestamptz,
  allocated_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.payment_allocations(payment_id); create index on public.payment_allocations(invoice_id);

create table public.payment_reversals (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.payments(id) on delete restrict,
  reversal_ref text not null default ('REV-' || substr(gen_random_uuid()::text,1,8)),
  reason text not null,
  reversed_by uuid default auth.uid(),
  reversed_at timestamptz not null default now()
);

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  txn_date date not null, description text, reference text,
  amount numeric(14,2) not null, direction text not null default 'credit' check (direction in ('credit','debit')),
  matched_payment_id uuid references public.payments(id),
  status text not null default 'unmatched' check (status in ('unmatched','reconciled','ignored')),
  import_batch text, imported_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid, action text not null, module text not null, record_id text,
  old_value jsonb, new_value jsonb, reason text,
  created_at timestamptz not null default now()
);
create index on public.audit_logs(created_at desc); create index on public.audit_logs(module);

create table public.settings (
  id int primary key default 1 check (id = 1),
  firm_name text not null default 'Your CA Firm',
  address text, gstin text, pan text, phone text, email text,
  bank_details text, invoice_terms text default 'Payment due within 15 days.',
  default_tax_rate numeric(5,2) not null default 18
);
insert into public.settings(id, firm_name, address, gstin) values (1,'Sharma & Associates, Chartered Accountants','2nd Floor, MG Road, Bengaluru 560001','29AAAFS1234K1Z5');

-- GRANTS
grant select, insert, update on public.profiles, public.clients, public.services, public.client_services, public.jobs, public.settings, public.bank_transactions to authenticated;
grant select, insert, delete on public.user_roles to authenticated;
grant select, insert on public.job_status_history, public.invoices, public.invoice_items, public.discounts, public.payments, public.payment_allocations, public.payment_reversals to authenticated;
grant select on public.audit_logs to authenticated;
grant all on public.profiles, public.user_roles, public.clients, public.services, public.client_services, public.jobs, public.job_status_history, public.invoices, public.invoice_items, public.discounts, public.payments, public.payment_allocations, public.payment_reversals, public.bank_transactions, public.audit_logs, public.settings to service_role;
grant usage on all sequences in schema public to authenticated;

-- RLS
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.clients enable row level security;
alter table public.services enable row level security;
alter table public.client_services enable row level security;
alter table public.jobs enable row level security;
alter table public.job_status_history enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.discounts enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.payment_reversals enable row level security;
alter table public.bank_transactions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.settings enable row level security;

create policy "profiles read" on public.profiles for select to authenticated using (id = auth.uid() or public.is_staff_plus());
create policy "profiles self update" on public.profiles for update to authenticated using (id = auth.uid() or public.is_manager());
create policy "roles read" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_manager());
create policy "roles manage ins" on public.user_roles for insert to authenticated with check (public.has_role(auth.uid(),'owner') or (public.is_manager() and role <> 'owner'));
create policy "roles manage del" on public.user_roles for delete to authenticated using (public.has_role(auth.uid(),'owner') or (public.is_manager() and role <> 'owner'));

create policy "clients read" on public.clients for select to authenticated using (public.is_finance() or (public.has_role(auth.uid(),'staff') and assigned_staff = auth.uid()));
create policy "clients ins" on public.clients for insert to authenticated with check (public.is_manager());
create policy "clients upd" on public.clients for update to authenticated using (public.is_manager());

create policy "services read" on public.services for select to authenticated using (public.is_staff_plus());
create policy "services ins" on public.services for insert to authenticated with check (public.is_manager());
create policy "services upd" on public.services for update to authenticated using (public.is_manager());

create policy "cs read" on public.client_services for select to authenticated using (public.is_finance() or (public.has_role(auth.uid(),'staff') and (assigned_staff = auth.uid() or exists(select 1 from public.clients c where c.id=client_id and c.assigned_staff=auth.uid()))));
create policy "cs ins" on public.client_services for insert to authenticated with check (public.is_manager());
create policy "cs upd" on public.client_services for update to authenticated using (public.is_manager());

create policy "jobs read" on public.jobs for select to authenticated using (public.is_finance() or (public.has_role(auth.uid(),'staff') and assigned_staff = auth.uid()));
create policy "jobs ins" on public.jobs for insert to authenticated with check (public.is_manager() or public.is_finance());
create policy "jobs upd" on public.jobs for update to authenticated using (public.is_finance());

create policy "jsh read" on public.job_status_history for select to authenticated using (exists(select 1 from public.jobs j where j.id = job_id));

create policy "inv read" on public.invoices for select to authenticated using (public.is_finance());
create policy "items read" on public.invoice_items for select to authenticated using (public.is_finance());
create policy "disc read" on public.discounts for select to authenticated using (public.is_finance());

create policy "pay read" on public.payments for select to authenticated using (public.is_finance() or created_by = auth.uid());
create policy "pay ins" on public.payments for insert to authenticated with check ((public.is_finance() or public.is_cashier()) and created_by = auth.uid() and status = 'unallocated' and allocated_amount = 0);
create policy "alloc read" on public.payment_allocations for select to authenticated using (public.is_finance());
create policy "rev read" on public.payment_reversals for select to authenticated using (public.is_finance());

create policy "bank read" on public.bank_transactions for select to authenticated using (public.is_finance());
create policy "bank ins" on public.bank_transactions for insert to authenticated with check (public.is_finance());
create policy "bank upd" on public.bank_transactions for update to authenticated using (public.is_finance());

create policy "audit read" on public.audit_logs for select to authenticated using (public.is_manager());
create policy "settings read" on public.settings for select to authenticated using (true);
create policy "settings upd" on public.settings for update to authenticated using (public.is_manager());

-- AUDIT trigger
create or replace function public.audit_trigger() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.audit_logs(user_id, action, module, record_id, old_value, new_value)
  values (auth.uid(), lower(TG_OP), TG_TABLE_NAME,
    coalesce((case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id',''),
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when TG_OP in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['clients','services','client_services','jobs','invoices','discounts','payments','payment_allocations','payment_reversals','user_roles','bank_transactions','settings'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_trigger()', t);
  end loop; end $$;

-- job status history trigger
create or replace function public.job_status_trigger() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if TG_OP='INSERT' then
    insert into public.job_status_history(job_id, old_status, new_status, reason, changed_by) values (new.id, null, new.status, 'Job created', auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.job_status_history(job_id, old_status, new_status, reason, changed_by) values (new.id, old.status, new.status, nullif(current_setting('app.status_reason', true),''), auth.uid());
  end if;
  return new;
end $$;
create trigger jobs_status_hist after insert or update of status on public.jobs for each row execute function public.job_status_trigger();

-- recompute invoice + payment
create or replace function public.recalc_invoice(_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare paid numeric; inv record;
begin
  select coalesce(sum(amount),0) into paid from public.payment_allocations where invoice_id=_id and not reversed;
  select * into inv from public.invoices where id=_id;
  update public.invoices set amount_paid = paid,
    status = case when inv.status in ('cancelled','draft') then inv.status
                  when paid >= inv.total and inv.total > 0 then 'paid'
                  when paid > 0 then 'partially_paid' else 'unpaid' end
  where id=_id;
  update public.jobs set financial_status = case when paid >= inv.total and inv.total>0 and inv.status <> 'cancelled' then 'closed' else 'invoiced' end
  where id in (select job_id from public.invoice_items where invoice_id=_id and job_id is not null) and inv.status <> 'cancelled';
end $$;

create or replace function public.recalc_payment(_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare alloc numeric; p record;
begin
  select coalesce(sum(amount),0) into alloc from public.payment_allocations where payment_id=_id and not reversed;
  select * into p from public.payments where id=_id;
  update public.payments set allocated_amount=alloc,
    status = case when p.status='reversed' then 'reversed' when alloc >= p.amount then 'allocated' when alloc>0 then 'partially_allocated' else 'unallocated' end
  where id=_id;
end $$;

-- allocation validation (enforced always)
create or replace function public.validate_allocation() returns trigger language plpgsql security definer set search_path=public as $$
declare p record; inv record; palloc numeric; ipaid numeric;
begin
  select * into p from public.payments where id=new.payment_id for update;
  select * into inv from public.invoices where id=new.invoice_id for update;
  if p.status='reversed' then raise exception 'Payment % is reversed', p.payment_code; end if;
  if inv.status in ('cancelled','draft') then raise exception 'Invoice % is not open for allocation', inv.invoice_no; end if;
  if p.client_id <> inv.client_id then raise exception 'Payment and invoice belong to different clients'; end if;
  select coalesce(sum(amount),0) into palloc from public.payment_allocations where payment_id=p.id and not reversed;
  select coalesce(sum(amount),0) into ipaid from public.payment_allocations where invoice_id=inv.id and not reversed;
  if palloc + new.amount > p.amount then raise exception 'Allocation exceeds available payment amount (available %)', p.amount - palloc; end if;
  if ipaid + new.amount > inv.total then raise exception 'Allocation exceeds invoice % outstanding (outstanding %)', inv.invoice_no, inv.total - ipaid; end if;
  return new;
end $$;
create trigger alloc_validate before insert on public.payment_allocations for each row execute function public.validate_allocation();

create or replace function public.after_allocation() returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.recalc_invoice(new.invoice_id); perform public.recalc_payment(new.payment_id); return new; end $$;
create trigger alloc_after after insert or update on public.payment_allocations for each row execute function public.after_allocation();

-- RPC: allocate
create or replace function public.allocate_payment(_payment_id uuid, _allocations jsonb) returns void language plpgsql security definer set search_path=public as $$
declare a jsonb;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  for a in select * from jsonb_array_elements(_allocations) loop
    if (a->>'amount')::numeric > 0 then
      insert into public.payment_allocations(payment_id, invoice_id, amount, allocated_by) values (_payment_id, (a->>'invoice_id')::uuid, (a->>'amount')::numeric, auth.uid());
    end if;
  end loop;
end $$;

-- RPC: unallocate one allocation
create or replace function public.reverse_allocation(_allocation_id uuid, _reason text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  update public.payment_allocations set reversed=true, reversed_at=now() where id=_allocation_id and not reversed;
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(),'allocation_reversed','payment_allocations',_allocation_id::text,_reason);
end $$;

-- RPC: reverse payment
create or replace function public.reverse_payment(_payment_id uuid, _reason text) returns void language plpgsql security definer set search_path=public as $$
declare r record;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  if coalesce(trim(_reason),'') = '' then raise exception 'Reason is required'; end if;
  if exists(select 1 from public.payments where id=_payment_id and status='reversed') then raise exception 'Already reversed'; end if;
  update public.payments set status='reversed' where id=_payment_id;
  for r in select id from public.payment_allocations where payment_id=_payment_id and not reversed loop
    update public.payment_allocations set reversed=true, reversed_at=now() where id=r.id;
  end loop;
  insert into public.payment_reversals(payment_id, reason, reversed_by) values (_payment_id, _reason, auth.uid());
  perform public.recalc_payment(_payment_id);
end $$;

-- RPC: job status
create or replace function public.update_job_status(_job_id uuid, _status text, _reason text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not (public.is_finance() or exists(select 1 from public.jobs where id=_job_id and assigned_staff=auth.uid())) then raise exception 'Not authorised'; end if;
  perform set_config('app.status_reason', coalesce(_reason,''), true);
  update public.jobs set status=_status where id=_job_id;
end $$;

-- RPC: create invoice from jobs
create or replace function public.create_invoice(_client_id uuid, _job_ids uuid[], _invoice_date date, _due_date date, _discount numeric, _discount_reason text, _tax_rate numeric, _notes text, _extra_desc text, _extra_amount numeric)
returns uuid language plpgsql security definer set search_path=public as $$
declare inv_id uuid; sub numeric := 0; j record; tax numeric; tot numeric;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  insert into public.invoices(client_id, invoice_date, due_date, notes, created_by) values (_client_id, _invoice_date, _due_date, _notes, auth.uid()) returning id into inv_id;
  for j in select * from public.jobs where id = any(coalesce(_job_ids,'{}')) loop
    if j.client_id <> _client_id then raise exception 'Job % belongs to another client', j.job_code; end if;
    if j.status='cancelled' then raise exception 'Job % is cancelled', j.job_code; end if;
    if exists(select 1 from public.invoice_items ii join public.invoices i on i.id=ii.invoice_id where ii.job_id=j.id and i.status<>'cancelled') then raise exception 'Job % is already invoiced', j.job_code; end if;
    insert into public.invoice_items(invoice_id, job_id, description, amount) values (inv_id, j.id, j.title, j.net_amount);
    sub := sub + j.net_amount;
  end loop;
  if coalesce(_extra_amount,0) > 0 then
    insert into public.invoice_items(invoice_id, description, amount) values (inv_id, coalesce(nullif(_extra_desc,''),'Professional fees'), _extra_amount);
    sub := sub + _extra_amount;
  end if;
  if sub <= 0 then raise exception 'Invoice must have at least one item'; end if;
  if coalesce(_discount,0) > sub then raise exception 'Discount cannot exceed subtotal'; end if;
  tax := round((sub - coalesce(_discount,0)) * coalesce(_tax_rate,0) / 100, 2);
  tot := sub - coalesce(_discount,0) + tax;
  update public.invoices set subtotal=sub, discount=coalesce(_discount,0), tax_rate=coalesce(_tax_rate,0), tax_amount=tax, total=tot,
    description=(select string_agg(description, ', ') from public.invoice_items where invoice_id=inv_id) where id=inv_id;
  if coalesce(_discount,0) > 0 then
    insert into public.discounts(invoice_id, original_amount, discount_amount, net_amount, reason, approved_by) values (inv_id, sub, _discount, sub-_discount, _discount_reason, auth.uid());
  end if;
  update public.jobs set financial_status='invoiced' where id = any(coalesce(_job_ids,'{}'));
  return inv_id;
end $$;

create or replace function public.cancel_invoice(_invoice_id uuid, _reason text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  if coalesce(trim(_reason),'')='' then raise exception 'Reason is required'; end if;
  if exists(select 1 from public.payment_allocations where invoice_id=_invoice_id and not reversed) then raise exception 'Reverse allocations on this invoice first'; end if;
  update public.invoices set status='cancelled', cancel_reason=_reason where id=_invoice_id;
  update public.jobs set financial_status='open' where id in (select job_id from public.invoice_items where invoice_id=_invoice_id);
end $$;

-- RPC: generate recurring jobs (idempotent)
create or replace function public.generate_recurring_jobs(_upto date) returns int language plpgsql security definer set search_path=public as $$
declare cs record; ps date; pe date; step interval; n int := 0; svc record; lbl text;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  for cs in select * from public.client_services where status='active' loop
    select * into svc from public.services where id=cs.service_id;
    if cs.frequency='one_time' then
      insert into public.jobs(client_id, service_id, client_service_id, title, period_start, period_end, fee, due_date, assigned_staff, created_by)
      values (cs.client_id, cs.service_id, cs.id, svc.name, cs.start_date, cs.start_date, cs.agreed_fee, cs.start_date + cs.due_days, cs.assigned_staff, auth.uid())
      on conflict do nothing;
      if found then n := n + 1; end if;
      continue;
    end if;
    step := case cs.frequency when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' when 'half_yearly' then interval '6 months' else interval '1 year' end;
    ps := date_trunc('month', cs.start_date)::date;
    while ps <= _upto and (cs.end_date is null or ps <= cs.end_date) loop
      pe := (ps + step - interval '1 day')::date;
      lbl := case cs.frequency when 'monthly' then to_char(ps,'Mon YYYY') when 'yearly' then 'FY ' || to_char(ps,'YYYY') else to_char(ps,'Mon YYYY') || ' – ' || to_char(pe,'Mon YYYY') end;
      insert into public.jobs(client_id, service_id, client_service_id, title, period_start, period_end, fee, due_date, assigned_staff, created_by)
      values (cs.client_id, cs.service_id, cs.id, svc.name || ' – ' || lbl, ps, pe, cs.agreed_fee, pe + cs.due_days, cs.assigned_staff, auth.uid())
      on conflict do nothing;
      if found then n := n + 1; end if;
      ps := (ps + step)::date;
    end loop;
  end loop;
  return n;
end $$;

-- cashier-safe client lookup
create or replace function public.client_lookup() returns table(id uuid, client_code text, name text) language sql stable security definer set search_path=public as $$
  select id, client_code, name from public.clients where status='active' and (public.is_finance() or public.is_cashier() or assigned_staff=auth.uid()) order by name $$;

create or replace function public.my_roles() returns setof app_role language sql stable security definer set search_path=public as $$
  select role from public.user_roles where user_id=auth.uid() $$;

revoke execute on function public.recalc_invoice(uuid), public.recalc_payment(uuid) from public, anon, authenticated;

-- DEMO DATA
insert into public.services(name, service_type, description, frequency, billing_type, default_fee, due_days) values
 ('GST Filing','GST','Monthly GSTR-1 & GSTR-3B','monthly','recurring',2000,20),
 ('TDS Filing','TDS','Quarterly TDS returns','quarterly','recurring',3000,31),
 ('Income Tax Return','Income Tax','Annual ITR filing','yearly','recurring',5000,120),
 ('Accounting','Accounting','Monthly bookkeeping','monthly','recurring',8000,15),
 ('Payroll','Payroll','Monthly payroll processing','monthly','recurring',3500,7),
 ('Audit','Audit','Statutory audit','one_time','one_time',50000,60);

insert into public.clients(name, client_type, mobile, email, address, pan, gstin, gst_type, business_type, industry, is_demo, notes) values
 ('ABC Pvt Ltd','Company','9876543210','accounts@abc.example','Koramangala, Bengaluru','AABCA1234F','29AABCA1234F1Z5','Regular','Private Limited','Manufacturing',true,'DEMO client'),
 ('XYZ Traders','Proprietorship','9123456780','xyz@traders.example','Chickpet, Bengaluru','ABCPX5678K','29ABCPX5678K1Z2','Regular','Proprietorship','Trading',true,'DEMO client'),
 ('LMN Industries','Partnership','9988776655','info@lmn.example','Peenya, Bengaluru','AAFFL9012M','29AAFFL9012M1Z8','Composition','Partnership','Engineering',true,'DEMO client');

do $$
declare abc uuid; xyz uuid; lmn uuid; gst uuid; tds uuid; itr uuid; acc uuid; aud uuid;
  cs1 uuid; cs2 uuid; cs3 uuid; cs4 uuid;
  j1 uuid; j2 uuid; j3 uuid; j4 uuid; j5 uuid; j6 uuid;
  i1 uuid; i2 uuid; i3 uuid; i4 uuid; p1 uuid; p2 uuid; p3 uuid;
begin
  select id into abc from public.clients where name='ABC Pvt Ltd';
  select id into xyz from public.clients where name='XYZ Traders';
  select id into lmn from public.clients where name='LMN Industries';
  select id into gst from public.services where name='GST Filing';
  select id into tds from public.services where name='TDS Filing';
  select id into itr from public.services where name='Income Tax Return';
  select id into acc from public.services where name='Accounting';
  select id into aud from public.services where name='Audit';

  insert into public.client_services(client_id, service_id, agreed_fee, frequency, start_date, due_days) values (abc,gst,2000,'monthly','2026-06-01',20) returning id into cs1;
  insert into public.client_services(client_id, service_id, agreed_fee, frequency, start_date, due_days) values (abc,acc,8000,'monthly','2026-06-01',15) returning id into cs2;
  insert into public.client_services(client_id, service_id, agreed_fee, frequency, start_date, due_days) values (xyz,gst,1500,'monthly','2026-07-01',20) returning id into cs3;
  insert into public.client_services(client_id, service_id, agreed_fee, frequency, start_date, due_days) values (lmn,tds,3000,'quarterly','2026-04-01',31) returning id into cs4;
  insert into public.client_services(client_id, service_id, agreed_fee, frequency, start_date, due_days) values (abc,itr,5000,'yearly','2026-04-01',120);

  insert into public.jobs(client_id, service_id, client_service_id, title, period_start, period_end, fee, due_date, status) values
   (abc,gst,cs1,'GST Filing – Jun 2026','2026-06-01','2026-06-30',2000,'2026-07-20','completed') returning id into j1;
  insert into public.jobs(client_id, service_id, client_service_id, title, period_start, period_end, fee, due_date, status) values
   (abc,acc,cs2,'Accounting – Jun 2026','2026-06-01','2026-06-30',8000,'2026-07-15','completed') returning id into j2;
  insert into public.jobs(client_id, service_id, client_service_id, title, period_start, period_end, fee, discount, due_date, status) values
   (xyz,gst,cs3,'GST Filing – Jul 2026','2026-07-01','2026-07-31',1500,0,'2026-08-20','completed') returning id into j3;
  insert into public.jobs(client_id, service_id, client_service_id, title, period_start, period_end, fee, due_date, status) values
   (lmn,tds,cs4,'TDS Filing – Apr 2026 – Jun 2026','2026-04-01','2026-06-30',3000,'2026-07-31','completed') returning id into j4;
  insert into public.jobs(client_id, service_id, title, fee, due_date, status) values
   (lmn,aud,'Statutory Audit FY 2025-26',50000,'2026-09-30','in_progress') returning id into j5;
  insert into public.jobs(client_id, service_id, client_service_id, title, period_start, period_end, fee, due_date, status) values
   (abc,gst,cs1,'GST Filing – Jul 2026','2026-07-01','2026-07-31',2000,'2026-08-20','pending') returning id into j6;

  -- invoice 1: ABC GST+Accounting, discount 1000
  insert into public.invoices(client_id, invoice_date, due_date, description, subtotal, discount, tax_rate, tax_amount, total, is_demo, notes)
   values (abc,'2026-07-05','2026-07-20','GST Filing – Jun 2026, Accounting – Jun 2026',10000,1000,0,0,9000,true,'DEMO') returning id into i1;
  insert into public.invoice_items(invoice_id, job_id, description, amount) values (i1,j1,'GST Filing – Jun 2026',2000),(i1,j2,'Accounting – Jun 2026',8000);
  insert into public.discounts(invoice_id, original_amount, discount_amount, net_amount, reason) values (i1,10000,1000,9000,'Long-standing client goodwill (DEMO)');
  -- invoice 2: XYZ
  insert into public.invoices(client_id, invoice_date, due_date, description, subtotal, total, is_demo, notes)
   values (xyz,'2026-08-05','2026-08-20','GST Filing – Jul 2026',1500,1500,true,'DEMO') returning id into i2;
  insert into public.invoice_items(invoice_id, job_id, description, amount) values (i2,j3,'GST Filing – Jul 2026',1500);
  -- invoice 3: LMN TDS (overdue)
  insert into public.invoices(client_id, invoice_date, due_date, description, subtotal, total, is_demo, notes)
   values (lmn,'2026-06-10','2026-06-25','TDS Filing – Apr 2026 – Jun 2026',3000,3000,true,'DEMO') returning id into i3;
  insert into public.invoice_items(invoice_id, job_id, description, amount) values (i3,j4,'TDS Filing Q1',3000);
  -- invoice 4: LMN audit with GST 18%
  insert into public.invoices(client_id, invoice_date, due_date, description, subtotal, tax_rate, tax_amount, total, is_demo, notes)
   values (lmn,'2026-09-01','2026-09-16','Statutory Audit FY 2025-26',50000,18,9000,59000,true,'DEMO') returning id into i4;
  insert into public.invoice_items(invoice_id, job_id, description, amount) values (i4,j5,'Statutory Audit FY 2025-26',50000);
  update public.jobs set financial_status='invoiced' where id in (j1,j2,j3,j4,j5);

  -- payments
  insert into public.payments(client_id, amount, mode, payment_date, reference, narration, is_demo) values (abc,9000,'upi','2026-07-18','UPI123456','Full payment (DEMO)',true) returning id into p1;
  insert into public.payments(client_id, amount, mode, payment_date, reference, narration, is_demo) values (lmn,30000,'bank','2026-09-10','NEFT889911','Part payment audit (DEMO)',true) returning id into p2;
  insert into public.payments(client_id, amount, mode, payment_date, reference, narration, is_demo) values (xyz,5000,'cash','2026-09-20',null,'Advance – unallocated (DEMO)',true) returning id into p3;
  insert into public.payments(client_id, amount, mode, payment_date, reference, narration, is_demo) values (abc,2000,'cheque','2026-09-25','CHQ004512','Received for July GST (DEMO)',true);

  insert into public.payment_allocations(payment_id, invoice_id, amount) values (p1,i1,9000);
  insert into public.payment_allocations(payment_id, invoice_id, amount) values (p2,i4,30000);

  insert into public.bank_transactions(txn_date, description, reference, amount, direction, import_batch) values
   ('2026-07-18','UPI/ABC PVT LTD','UPI123456',9000,'credit','DEMO'),
   ('2026-09-10','NEFT-LMN INDUSTRIES','NEFT889911',30000,'credit','DEMO'),
   ('2026-09-22','IMPS-UNKNOWN PARTY','IMPS77001',4500,'credit','DEMO'),
   ('2026-09-28','BANK CHARGES','CHG0928',236,'debit','DEMO');
end $$;



-- ==============================================================================
-- Migration 2 of 25: 20261001094510_953d0d46-30cf-431b-a336-b8f69e1d5b6b.sql
-- ==============================================================================

revoke execute on all functions in schema public from anon, public;
revoke execute on function public.handle_new_user(), public.audit_trigger(), public.job_status_trigger(), public.validate_allocation(), public.after_allocation(), public.recalc_invoice(uuid), public.recalc_payment(uuid) from authenticated;
grant execute on function public.has_role(uuid, app_role), public.is_manager(), public.is_finance(), public.is_staff_plus(), public.is_cashier(), public.allocate_payment(uuid, jsonb), public.reverse_allocation(uuid, text), public.reverse_payment(uuid, text), public.update_job_status(uuid, text, text), public.create_invoice(uuid, uuid[], date, date, numeric, text, numeric, text, text, numeric), public.cancel_invoice(uuid, text), public.generate_recurring_jobs(date), public.client_lookup(), public.my_roles() to authenticated;
alter default privileges in schema public revoke execute on functions from anon, public;



-- ==============================================================================
-- Migration 3 of 25: 20261001103748_99ff9f1e-789a-4ba5-88b2-1dae669024f6.sql
-- ==============================================================================

create table public.firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  owner_email text,
  phone text,
  city text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
create table public.platform_admins (user_id uuid primary key, created_at timestamptz not null default now());
create table public.firm_invites (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  email text not null,
  role public.app_role not null default 'owner',
  full_name text,
  accepted boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, update on public.firms to authenticated; grant all on public.firms to service_role;
grant select on public.platform_admins to authenticated; grant all on public.platform_admins to service_role;
grant select on public.firm_invites to authenticated; grant all on public.firm_invites to service_role;
alter table public.firms enable row level security;
alter table public.platform_admins enable row level security;
alter table public.firm_invites enable row level security;

create or replace function public.is_super_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.platform_admins where user_id=auth.uid()) $$;

alter table public.profiles add column firm_id uuid references public.firms(id), add column acting_firm_id uuid references public.firms(id), add column avatar_url text;

create or replace function public.current_firm_id() returns uuid language sql stable security definer set search_path=public as $$
  select case when public.is_super_admin() then p.acting_firm_id
              else (select f.id from public.firms f where f.id=p.firm_id and f.status='active') end
  from public.profiles p where p.id=auth.uid() $$;

create policy "firms read" on public.firms for select to authenticated using (public.is_super_admin() or id=public.current_firm_id());
create policy "firms upd" on public.firms for update to authenticated using (public.is_super_admin() or (id=public.current_firm_id() and public.is_manager()));
create policy "pa read" on public.platform_admins for select to authenticated using (user_id=auth.uid());
create policy "inv read" on public.firm_invites for select to authenticated using (public.is_super_admin() or (firm_id=public.current_firm_id() and public.is_manager()));

-- role helpers include super admin
create or replace function public.is_finance() returns boolean language sql stable security definer set search_path=public as $$
  select public.is_super_admin() or exists(select 1 from public.user_roles where user_id=auth.uid() and role in ('owner','admin','accountant')) $$;
create or replace function public.is_manager() returns boolean language sql stable security definer set search_path=public as $$
  select public.is_super_admin() or exists(select 1 from public.user_roles where user_id=auth.uid() and role in ('owner','admin')) $$;
create or replace function public.is_staff_plus() returns boolean language sql stable security definer set search_path=public as $$
  select public.is_super_admin() or exists(select 1 from public.user_roles where user_id=auth.uid() and role in ('owner','admin','accountant','staff')) $$;
create or replace function public.my_roles() returns setof public.app_role language sql stable security definer set search_path=public as $$
  select 'owner'::public.app_role where public.is_super_admin()
  union select role from public.user_roles where user_id=auth.uid() and not public.is_super_admin() $$;

-- default firm + backfill
insert into public.firms(id, name) select '00000000-0000-0000-0000-000000000001', coalesce((select firm_name from public.settings limit 1),'Default Firm');
update public.profiles set firm_id='00000000-0000-0000-0000-000000000001';

alter table public.settings drop constraint if exists settings_id_check;
create sequence if not exists public.settings_seq start 100;
alter table public.settings alter column id set default nextval('public.settings_seq');

do $$ declare t text; begin
  foreach t in array array['clients','services','client_services','jobs','job_status_history','invoices','invoice_items','discounts','payments','payment_allocations','payment_reversals','bank_transactions','audit_logs','settings'] loop
    execute format('alter table public.%I add column firm_id uuid references public.firms(id) default public.current_firm_id()', t);
    execute format('update public.%I set firm_id=%L', t, '00000000-0000-0000-0000-000000000001');
    if t <> 'audit_logs' then execute format('alter table public.%I alter column firm_id set not null', t); end if;
    execute format('create index on public.%I(firm_id)', t);
    execute format('create policy "firm isolation" on public.%I as restrictive for all to authenticated using (firm_id = public.current_firm_id()) with check (firm_id = public.current_firm_id())', t);
  end loop;
end $$;
alter table public.settings add constraint settings_firm_unique unique(firm_id);
grant insert on public.settings to service_role;

create policy "firm isolation" on public.profiles as restrictive for all to authenticated
  using (id=auth.uid() or firm_id=public.current_firm_id()) with check (id=auth.uid() or firm_id=public.current_firm_id());
create policy "firm isolation" on public.user_roles as restrictive for all to authenticated
  using (user_id=auth.uid() or exists(select 1 from public.profiles p where p.id=user_roles.user_id and p.firm_id=public.current_firm_id()))
  with check (exists(select 1 from public.profiles p where p.id=user_roles.user_id and p.firm_id=public.current_firm_id()));

create or replace function public.protect_profile_firm() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if (new.firm_id is distinct from old.firm_id or new.acting_firm_id is distinct from old.acting_firm_id)
     and auth.uid() is not null and not public.is_super_admin() then
    raise exception 'Not allowed to change firm';
  end if;
  return new;
end $$;
create trigger profiles_protect_firm before update on public.profiles for each row execute function public.protect_profile_firm();

alter table public.clients add column avatar_url text;

-- new user: super admin by email, otherwise pending invite
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare inv record;
begin
  if lower(new.email)='sankaaryanjayanth@gmail.com' then
    insert into public.profiles(id, full_name, email) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', 'Super Admin'), new.email);
    insert into public.platform_admins(user_id) values (new.id) on conflict do nothing;
    return new;
  end if;
  select * into inv from public.firm_invites where lower(email)=lower(new.email) and not accepted order by created_at desc limit 1;
  insert into public.profiles(id, full_name, email, firm_id)
  values (new.id, coalesce(inv.full_name, new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.email, inv.firm_id);
  if inv.id is not null then
    insert into public.user_roles(user_id, role) values (new.id, inv.role) on conflict do nothing;
    update public.firm_invites set accepted=true where id=inv.id;
  end if;
  return new;
end $$;

insert into public.platform_admins(user_id) select id from auth.users where lower(email)='sankaaryanjayanth@gmail.com' on conflict do nothing;
update public.profiles set firm_id=null, acting_firm_id='00000000-0000-0000-0000-000000000001' where lower(email)='sankaaryanjayanth@gmail.com';
delete from public.user_roles where user_id in (select user_id from public.platform_admins);

-- super admin RPCs
create or replace function public.set_acting_firm(_firm_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_super_admin() then raise exception 'Not authorised'; end if;
  update public.profiles set acting_firm_id=_firm_id where id=auth.uid();
end $$;

create or replace function public.create_firm(_name text, _owner_email text, _phone text, _city text, _logo_url text) returns uuid language plpgsql security definer set search_path=public as $$
declare fid uuid;
begin
  if not public.is_super_admin() then raise exception 'Not authorised'; end if;
  if coalesce(trim(_name),'')='' then raise exception 'Firm name is required'; end if;
  insert into public.firms(name, owner_email, phone, city, logo_url) values (trim(_name), lower(trim(_owner_email)), _phone, _city, _logo_url) returning id into fid;
  insert into public.settings(firm_id, firm_name, phone, email) values (fid, trim(_name), _phone, lower(trim(_owner_email)));
  return fid;
end $$;

create or replace function public.firm_overview() returns table(id uuid, name text, logo_url text, owner_email text, phone text, city text, status text, created_at timestamptz, users bigint, clients bigint, invoiced numeric, outstanding numeric)
language sql stable security definer set search_path=public as $$
  select f.id, f.name, f.logo_url, f.owner_email, f.phone, f.city, f.status, f.created_at,
    (select count(*) from public.profiles p where p.firm_id=f.id),
    (select count(*) from public.clients c where c.firm_id=f.id),
    (select coalesce(sum(total),0) from public.invoices i where i.firm_id=f.id and i.status<>'cancelled'),
    (select coalesce(sum(total-amount_paid),0) from public.invoices i where i.firm_id=f.id and i.status not in ('cancelled','paid'))
  from public.firms f where public.is_super_admin() order by f.created_at desc $$;

-- firm guards in existing RPCs
create or replace function public.client_lookup() returns table(id uuid, client_code text, name text) language sql stable security definer set search_path=public as $$
  select id, client_code, name from public.clients where status='active' and firm_id=public.current_firm_id()
    and (public.is_finance() or public.is_cashier() or assigned_staff=auth.uid()) order by name $$;

create or replace function public.generate_recurring_jobs(_upto date) returns integer language plpgsql security definer set search_path=public as $$
declare cs record; ps date; pe date; step interval; n int := 0; svc record; lbl text;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  for cs in select * from public.client_services where status='active' and firm_id=public.current_firm_id() loop
    select * into svc from public.services where id=cs.service_id;
    if cs.frequency='one_time' then
      insert into public.jobs(client_id, service_id, client_service_id, title, period_start, period_end, fee, due_date, assigned_staff, created_by)
      values (cs.client_id, cs.service_id, cs.id, svc.name, cs.start_date, cs.start_date, cs.agreed_fee, cs.start_date + cs.due_days, cs.assigned_staff, auth.uid())
      on conflict do nothing;
      if found then n := n + 1; end if;
      continue;
    end if;
    step := case cs.frequency when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' when 'half_yearly' then interval '6 months' else interval '1 year' end;
    ps := date_trunc('month', cs.start_date)::date;
    while ps <= _upto and (cs.end_date is null or ps <= cs.end_date) loop
      pe := (ps + step - interval '1 day')::date;
      lbl := case cs.frequency when 'monthly' then to_char(ps,'Mon YYYY') when 'yearly' then 'FY ' || to_char(ps,'YYYY') else to_char(ps,'Mon YYYY') || ' – ' || to_char(pe,'Mon YYYY') end;
      insert into public.jobs(client_id, service_id, client_service_id, title, period_start, period_end, fee, due_date, assigned_staff, created_by)
      values (cs.client_id, cs.service_id, cs.id, svc.name || ' – ' || lbl, ps, pe, cs.agreed_fee, pe + cs.due_days, cs.assigned_staff, auth.uid())
      on conflict do nothing;
      if found then n := n + 1; end if;
      ps := (ps + step)::date;
    end loop;
  end loop;
  return n;
end $$;

create or replace function public.firm_guard(_tbl text, _id uuid) returns void language plpgsql stable security definer set search_path=public as $$
declare ok boolean;
begin
  execute format('select exists(select 1 from public.%I where id=$1 and firm_id=public.current_firm_id())', _tbl) into ok using _id;
  if not ok then raise exception 'Record not found in this firm'; end if;
end $$;

create or replace function public.validate_allocation() returns trigger language plpgsql security definer set search_path=public as $$
declare p record; inv record; palloc numeric; ipaid numeric;
begin
  select * into p from public.payments where id=new.payment_id for update;
  select * into inv from public.invoices where id=new.invoice_id for update;
  if p.firm_id <> inv.firm_id or (auth.uid() is not null and p.firm_id is distinct from public.current_firm_id()) then raise exception 'Record not found in this firm'; end if;
  if p.status='reversed' then raise exception 'Payment % is reversed', p.payment_code; end if;
  if inv.status in ('cancelled','draft') then raise exception 'Invoice % is not open for allocation', inv.invoice_no; end if;
  if p.client_id <> inv.client_id then raise exception 'Payment and invoice belong to different clients'; end if;
  select coalesce(sum(amount),0) into palloc from public.payment_allocations where payment_id=p.id and not reversed;
  select coalesce(sum(amount),0) into ipaid from public.payment_allocations where invoice_id=inv.id and not reversed;
  if palloc + new.amount > p.amount then raise exception 'Allocation exceeds available payment amount (available %)', p.amount - palloc; end if;
  if ipaid + new.amount > inv.total then raise exception 'Allocation exceeds invoice % outstanding (outstanding %)', inv.invoice_no, inv.total - ipaid; end if;
  new.firm_id := p.firm_id;
  return new;
end $$;

create or replace function public.cancel_invoice(_invoice_id uuid, _reason text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('invoices', _invoice_id);
  if coalesce(trim(_reason),'')='' then raise exception 'Reason is required'; end if;
  if exists(select 1 from public.payment_allocations where invoice_id=_invoice_id and not reversed) then raise exception 'Reverse allocations on this invoice first'; end if;
  update public.invoices set status='cancelled', cancel_reason=_reason where id=_invoice_id;
  update public.jobs set financial_status='open' where id in (select job_id from public.invoice_items where invoice_id=_invoice_id);
end $$;

create or replace function public.reverse_allocation(_allocation_id uuid, _reason text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('payment_allocations', _allocation_id);
  update public.payment_allocations set reversed=true, reversed_at=now() where id=_allocation_id and not reversed;
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(),'allocation_reversed','payment_allocations',_allocation_id::text,_reason);
end $$;

create or replace function public.reverse_payment(_payment_id uuid, _reason text) returns void language plpgsql security definer set search_path=public as $$
declare r record;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('payments', _payment_id);
  if coalesce(trim(_reason),'') = '' then raise exception 'Reason is required'; end if;
  if exists(select 1 from public.payments where id=_payment_id and status='reversed') then raise exception 'Already reversed'; end if;
  update public.payments set status='reversed' where id=_payment_id;
  for r in select id from public.payment_allocations where payment_id=_payment_id and not reversed loop
    update public.payment_allocations set reversed=true, reversed_at=now() where id=r.id;
  end loop;
  insert into public.payment_reversals(payment_id, reason, reversed_by) values (_payment_id, _reason, auth.uid());
  perform public.recalc_payment(_payment_id);
end $$;

create or replace function public.update_job_status(_job_id uuid, _status text, _reason text) returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.firm_guard('jobs', _job_id);
  if not (public.is_finance() or exists(select 1 from public.jobs where id=_job_id and assigned_staff=auth.uid())) then raise exception 'Not authorised'; end if;
  perform set_config('app.status_reason', coalesce(_reason,''), true);
  update public.jobs set status=_status where id=_job_id;
end $$;

create or replace function public.allocate_payment(_payment_id uuid, _allocations jsonb) returns void language plpgsql security definer set search_path=public as $$
declare a jsonb;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('payments', _payment_id);
  for a in select * from jsonb_array_elements(_allocations) loop
    if (a->>'amount')::numeric > 0 then
      insert into public.payment_allocations(payment_id, invoice_id, amount, allocated_by) values (_payment_id, (a->>'invoice_id')::uuid, (a->>'amount')::numeric, auth.uid());
    end if;
  end loop;
end $$;

create or replace function public.create_invoice(_client_id uuid, _job_ids uuid[], _invoice_date date, _due_date date, _discount numeric, _discount_reason text, _tax_rate numeric, _notes text, _extra_desc text, _extra_amount numeric)
returns uuid language plpgsql security definer set search_path=public as $$
declare inv_id uuid; sub numeric := 0; j record; tax numeric; tot numeric;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('clients', _client_id);
  insert into public.invoices(client_id, invoice_date, due_date, notes, created_by) values (_client_id, _invoice_date, _due_date, _notes, auth.uid()) returning id into inv_id;
  for j in select * from public.jobs where id = any(coalesce(_job_ids,'{}')) loop
    if j.client_id <> _client_id then raise exception 'Job % belongs to another client', j.job_code; end if;
    if j.status='cancelled' then raise exception 'Job % is cancelled', j.job_code; end if;
    if exists(select 1 from public.invoice_items ii join public.invoices i on i.id=ii.invoice_id where ii.job_id=j.id and i.status<>'cancelled') then raise exception 'Job % is already invoiced', j.job_code; end if;
    insert into public.invoice_items(invoice_id, job_id, description, amount) values (inv_id, j.id, j.title, j.net_amount);
    sub := sub + j.net_amount;
  end loop;
  if coalesce(_extra_amount,0) > 0 then
    insert into public.invoice_items(invoice_id, description, amount) values (inv_id, coalesce(nullif(_extra_desc,''),'Professional fees'), _extra_amount);
    sub := sub + _extra_amount;
  end if;
  if sub <= 0 then raise exception 'Invoice must have at least one item'; end if;
  if coalesce(_discount,0) > sub then raise exception 'Discount cannot exceed subtotal'; end if;
  tax := round((sub - coalesce(_discount,0)) * coalesce(_tax_rate,0) / 100, 2);
  tot := sub - coalesce(_discount,0) + tax;
  update public.invoices set subtotal=sub, discount=coalesce(_discount,0), tax_rate=coalesce(_tax_rate,0), tax_amount=tax, total=tot,
    description=(select string_agg(description, ', ') from public.invoice_items where invoice_id=inv_id) where id=inv_id;
  if coalesce(_discount,0) > 0 then
    insert into public.discounts(invoice_id, original_amount, discount_amount, net_amount, reason, approved_by) values (inv_id, sub, _discount, sub-_discount, _discount_reason, auth.uid());
  end if;
  update public.jobs set financial_status='invoiced' where id = any(coalesce(_job_ids,'{}'));
  return inv_id;
end $$;

-- avatars storage policies
create policy "avatars public read" on storage.objects for select using (bucket_id='avatars');
create policy "avatars auth upload" on storage.objects for insert to authenticated with check (bucket_id='avatars');
create policy "avatars auth update" on storage.objects for update to authenticated using (bucket_id='avatars');



-- ==============================================================================
-- Migration 4 of 25: 20261001103801_9ebefd9f-0bff-4c51-ad45-897b97854f33.sql
-- ==============================================================================

revoke execute on function public.is_super_admin(), public.current_firm_id(), public.set_acting_firm(uuid), public.create_firm(text,text,text,text,text), public.firm_overview(), public.firm_guard(text,uuid), public.protect_profile_firm() from public, anon;
revoke execute on function public.protect_profile_firm(), public.firm_guard(text,uuid) from authenticated;



-- ==============================================================================
-- Migration 5 of 25: 20261001140028_3a4854f4-184b-435d-b839-6423d24b7a8a.sql
-- ==============================================================================

ALTER TABLE public.services ADD COLUMN IF NOT EXISTS sac_code text NOT NULL DEFAULT '998221';

CREATE OR REPLACE FUNCTION public.generate_recurring_jobs_for_firm(_firm uuid, _upto date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare cs record; ps date; pe date; step interval; n int := 0; svc record; lbl text;
begin
  for cs in select * from public.client_services where status='active' and firm_id=_firm loop
    select * into svc from public.services where id=cs.service_id;
    if cs.frequency='one_time' then
      insert into public.jobs(firm_id, client_id, service_id, client_service_id, title, period_start, period_end, fee, due_date, assigned_staff, created_by)
      values (_firm, cs.client_id, cs.service_id, cs.id, svc.name, cs.start_date, cs.start_date, cs.agreed_fee, cs.start_date + cs.due_days, cs.assigned_staff, auth.uid())
      on conflict do nothing;
      if found then n := n + 1; end if;
      continue;
    end if;
    step := case cs.frequency when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' when 'half_yearly' then interval '6 months' else interval '1 year' end;
    ps := date_trunc('month', cs.start_date)::date;
    while ps <= _upto and (cs.end_date is null or ps <= cs.end_date) loop
      pe := (ps + step - interval '1 day')::date;
      lbl := case cs.frequency when 'monthly' then to_char(ps,'Mon YYYY') when 'yearly' then 'FY ' || to_char(ps,'YYYY') else to_char(ps,'Mon YYYY') || ' – ' || to_char(pe,'Mon YYYY') end;
      insert into public.jobs(firm_id, client_id, service_id, client_service_id, title, period_start, period_end, fee, due_date, assigned_staff, created_by)
      values (_firm, cs.client_id, cs.service_id, cs.id, svc.name || ' – ' || lbl, ps, pe, cs.agreed_fee, pe + cs.due_days, cs.assigned_staff, auth.uid())
      on conflict do nothing;
      if found then n := n + 1; end if;
      ps := (ps + step)::date;
    end loop;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.generate_recurring_jobs(_upto date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  return public.generate_recurring_jobs_for_firm(public.current_firm_id(), _upto);
end $function$;

CREATE OR REPLACE FUNCTION public.generate_recurring_jobs_all()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare f record; n int := 0;
begin
  for f in select id from public.firms where status='active' loop
    n := n + public.generate_recurring_jobs_for_firm(f.id, current_date);
  end loop;
  return n;
end $function$;

-- Lock down internal / trigger functions
REVOKE EXECUTE ON FUNCTION public.generate_recurring_jobs_for_firm(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_recurring_jobs_all() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.after_allocation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_trigger() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.job_status_trigger() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_profile_firm() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_allocation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_invoice(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_payment(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.firm_guard(text, uuid) FROM PUBLIC, anon, authenticated;

-- App RPCs & RLS helpers: signed-in users only, never anonymous
REVOKE EXECUTE ON FUNCTION public.allocate_payment(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_invoice(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.client_lookup() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_firm(text, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_invoice(uuid, uuid[], date, date, numeric, text, numeric, text, text, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_firm_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.firm_overview() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_recurring_jobs(date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_cashier() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_finance() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_manager() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff_plus() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_roles() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reverse_allocation(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reverse_payment(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_acting_firm(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_job_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_payment(uuid, jsonb), public.cancel_invoice(uuid, text), public.client_lookup(), public.create_firm(text, text, text, text, text), public.create_invoice(uuid, uuid[], date, date, numeric, text, numeric, text, text, numeric), public.current_firm_id(), public.firm_overview(), public.generate_recurring_jobs(date), public.has_role(uuid, app_role), public.is_cashier(), public.is_finance(), public.is_manager(), public.is_staff_plus(), public.is_super_admin(), public.my_roles(), public.reverse_allocation(uuid, text), public.reverse_payment(uuid, text), public.set_acting_firm(uuid), public.update_job_status(uuid, text, text) TO authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('daily-recurring-jobs', '30 0 * * *', $$ select public.generate_recurring_jobs_all(); $$);



-- ==============================================================================
-- Migration 6 of 25: 20261002104000_delete_firm_rpc.sql
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.delete_firm(_firm_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare f_status text;
begin
  if not public.is_super_admin() then
    raise exception 'Not authorised: Only Super Admin can delete firms';
  end if;

  select status into f_status from public.firms where id = _firm_id;
  if f_status is null then
    raise exception 'Firm not found';
  end if;

  if f_status <> 'suspended' then
    raise exception 'Firm must be suspended before it can be deleted';
  end if;

  -- Nullify active / acting references
  update public.profiles set acting_firm_id = null where acting_firm_id = _firm_id;
  update public.profiles set firm_id = null where firm_id = _firm_id;

  -- Delete all associated firm data
  delete from public.firm_invites where firm_id = _firm_id;
  delete from public.audit_logs where firm_id = _firm_id;
  delete from public.payment_allocations where firm_id = _firm_id;
  delete from public.payment_reversals where firm_id = _firm_id;
  delete from public.discounts where firm_id = _firm_id;
  delete from public.invoice_items where firm_id = _firm_id;
  delete from public.invoices where firm_id = _firm_id;
  delete from public.payments where firm_id = _firm_id;
  delete from public.bank_transactions where firm_id = _firm_id;
  delete from public.job_status_history where firm_id = _firm_id;
  delete from public.jobs where firm_id = _firm_id;
  delete from public.client_services where firm_id = _firm_id;
  delete from public.clients where firm_id = _firm_id;
  delete from public.services where firm_id = _firm_id;
  delete from public.settings where firm_id = _firm_id;
  delete from public.firms where id = _firm_id;
end $function$;

REVOKE EXECUTE ON FUNCTION public.delete_firm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_firm(uuid) TO authenticated;



-- ==============================================================================
-- Migration 7 of 25: 20261002203000_auto_invoice.sql
-- ==============================================================================

-- ========================================================
-- Migration: Auto-Invoicing & Linked Status Enhancement
-- ========================================================

-- 1. Add auto_invoice columns
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS auto_invoice boolean NOT NULL DEFAULT false;
ALTER TABLE public.client_services ADD COLUMN IF NOT EXISTS auto_invoice boolean NOT NULL DEFAULT false;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS auto_invoice boolean NOT NULL DEFAULT false;

-- 2. Update generate_recurring_jobs to inherit auto_invoice from client_services
CREATE OR REPLACE FUNCTION public.generate_recurring_jobs(_upto date)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  cs record;
  ps date;
  pe date;
  step interval;
  n int := 0;
  svc record;
  lbl text;
BEGIN
  IF NOT public.is_finance() THEN RAISE EXCEPTION 'Not authorised'; END IF;
  FOR cs IN
    SELECT cs.*, c.name AS client_name, s.name AS service_name, s.due_days AS svc_due_days, s.auto_invoice AS svc_auto_invoice
    FROM public.client_services cs
    JOIN public.clients c ON c.id = cs.client_id
    JOIN public.services s ON s.id = cs.service_id
    WHERE cs.status = 'active' AND (cs.end_date IS NULL OR cs.end_date >= cs.start_date)
  LOOP
    ps := cs.start_date;
    step := CASE cs.frequency
      WHEN 'monthly' THEN interval '1 month'
      WHEN 'quarterly' THEN interval '3 month'
      WHEN 'half_yearly' THEN interval '6 month'
      WHEN 'yearly' THEN interval '1 year'
      ELSE interval '1 month'
    END;

    WHILE ps <= _upto AND (cs.end_date IS NULL OR ps <= cs.end_date) LOOP
      pe := (ps + step - interval '1 day')::date;
      IF pe > _upto THEN EXIT; END IF;

      lbl := cs.service_name || ' – ' || to_char(ps, 'Mon YYYY');

      IF NOT EXISTS (
        SELECT 1 FROM public.jobs
        WHERE client_service_id = cs.id AND period_start = ps
      ) THEN
        INSERT INTO public.jobs(
          firm_id,
          client_id,
          service_id,
          client_service_id,
          title,
          period_start,
          period_end,
          fee,
          discount,
          due_date,
          assigned_staff,
          status,
          financial_status,
          auto_invoice
        ) VALUES (
          cs.firm_id,
          cs.client_id,
          cs.service_id,
          cs.id,
          lbl,
          ps,
          pe,
          cs.agreed_fee,
          0,
          (pe + COALESCE(cs.due_days, 20)),
          cs.assigned_staff,
          'pending',
          'open',
          COALESCE(cs.auto_invoice, false)
        );
        n := n + 1;
      END IF;

      ps := (ps + step)::date;
    END LOOP;
  END LOOP;
  RETURN n;
END;
$$;

-- 3. Auto-invoice generation helper function
CREATE OR REPLACE FUNCTION public.auto_invoice_job(_job_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  j record;
  inv_id uuid;
  item_desc text;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = _job_id;
  IF j.id IS NULL OR j.financial_status <> 'open' OR j.net_amount <= 0 THEN
    RETURN NULL;
  END IF;

  -- Ensure not already invoiced
  IF EXISTS (
    SELECT 1 FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE ii.job_id = j.id AND i.status <> 'cancelled'
  ) THEN
    UPDATE public.jobs SET financial_status = 'invoiced' WHERE id = _job_id;
    RETURN NULL;
  END IF;

  item_desc := j.title;

  INSERT INTO public.invoices (
    firm_id,
    client_id,
    invoice_date,
    due_date,
    notes,
    description,
    subtotal,
    discount,
    tax_rate,
    tax_amount,
    total,
    amount_paid,
    status,
    created_by
  ) VALUES (
    COALESCE(j.firm_id, public.current_firm_id()),
    j.client_id,
    current_date,
    current_date + 15,
    'Auto-generated invoice on completion of job ' || j.job_code,
    item_desc,
    j.net_amount,
    0,
    0,
    0,
    j.net_amount,
    0,
    'unpaid',
    COALESCE(auth.uid(), j.created_by)
  ) RETURNING id INTO inv_id;

  INSERT INTO public.invoice_items (
    firm_id,
    invoice_id,
    job_id,
    description,
    amount
  ) VALUES (
    COALESCE(j.firm_id, public.current_firm_id()),
    inv_id,
    j.id,
    item_desc,
    j.net_amount
  );

  UPDATE public.jobs
  SET financial_status = 'invoiced'
  WHERE id = _job_id;

  RETURN inv_id;
END;
$$;

-- 4. Update update_job_status to trigger auto-invoice on completion
CREATE OR REPLACE FUNCTION public.update_job_status(_job_id uuid, _status text, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  j record;
BEGIN
  PERFORM public.firm_guard('jobs', _job_id);
  IF NOT (public.is_finance() OR EXISTS(SELECT 1 FROM public.jobs WHERE id = _job_id AND assigned_staff = auth.uid())) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  PERFORM set_config('app.status_reason', COALESCE(_reason, ''), true);
  UPDATE public.jobs SET status = _status WHERE id = _job_id;

  -- Invoices are strictly payment-driven and generated upon payment clearing
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_invoice_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_job_status(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_recurring_jobs(date) TO authenticated;



-- ==============================================================================
-- Migration 8 of 25: 20261004120000_client_contacts_and_validation.sql
-- ==============================================================================

-- Client contact fields + mandatory-field enforcement
-- Adds: Contact Name, Name of Concerned Person, Concerned Person's Phone, Concerned Person's Role
-- Enforces the mandatory set (Client Name, Type, Address, Phone, Contact Name,
-- Name of Concerned Person, Concerned Person's Phone) in the database so the
-- rule holds regardless of client — why: rules must hold regardless of client.

-- 1. New columns
alter table public.clients
  add column if not exists contact_name         text,
  add column if not exists contact_person_name  text,
  add column if not exists contact_person_phone text,
  add column if not exists contact_person_role  text;

-- 2. Backfill so pre-existing rows satisfy the new requirement.
--    Rows are only ever soft-edited afterwards; no financial record is touched.
update public.clients set
  address              = coalesce(nullif(btrim(address), ''), 'Not provided'),
  mobile               = coalesce(nullif(btrim(mobile), ''), 'Not provided'),
  client_type          = coalesce(nullif(btrim(client_type), ''), 'Company'),
  contact_name         = coalesce(nullif(btrim(contact_name), ''), 'Not provided'),
  contact_person_name  = coalesce(nullif(btrim(contact_person_name), ''), 'Not provided'),
  contact_person_phone = coalesce(nullif(btrim(contact_person_phone), ''), 'Not provided'),
  contact_person_role  = coalesce(nullif(btrim(contact_person_role), ''), 'Others');

-- 3. Hard NOT NULL on the mandatory columns
alter table public.clients
  alter column address              set not null,
  alter column mobile               set not null,
  alter column contact_name         set not null,
  alter column contact_person_name  set not null,
  alter column contact_person_phone set not null;

-- 4. Guard against blank / whitespace-only strings (NOT NULL alone allows '')
create or replace function public.validate_client_required() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v_missing text;
begin
  v_missing := concat_ws(', ',
    case when btrim(coalesce(new.name, '')) = ''                then 'Client Name' end,
    case when btrim(coalesce(new.client_type, '')) = ''          then 'Client Type' end,
    case when btrim(coalesce(new.address, '')) = ''               then 'Address' end,
    case when btrim(coalesce(new.mobile, '')) = ''                then 'Phone Number' end,
    case when btrim(coalesce(new.contact_name, '')) = ''          then 'Contact Name' end,
    case when btrim(coalesce(new.contact_person_name, '')) = ''   then 'Name of Concerned Person' end,
    case when btrim(coalesce(new.contact_person_phone, '')) = ''  then 'Concerned Person''s Phone Number' end
  );
  if v_missing <> '' then
    raise exception 'Missing required field(s): %', v_missing using errcode = '23502';
  end if;
  return new;
end $$;

drop trigger if exists clients_validate_required on public.clients;
create trigger clients_validate_required
  before insert or update on public.clients
  for each row execute function public.validate_client_required();

-- 5. Indexes for the new list filters
create index if not exists clients_client_type_idx on public.clients(client_type);
create index if not exists clients_industry_idx     on public.clients(industry);
create index if not exists clients_gst_type_idx     on public.clients(gst_type);
create index if not exists clients_contact_person_idx on public.clients(contact_person_name);



-- ==============================================================================
-- Migration 9 of 25: 20261004130000_relax_client_contacts.sql
-- ==============================================================================

-- Relax client contact requirements:
--   - Contact Name removed entirely (only ever held placeholder data)
--   - Name of Concerned Person + their phone are now optional
--   - New optional secondary phone number
-- Mandatory set is now: Client Name, Client Type, Address, Phone Number.
--
-- ORDER IS LOAD-BEARING. Two separate things reject the backfill, and both must
-- be dealt with before the UPDATE runs:
--   1. the clients_validate_required trigger  -> narrow the function first
--   2. NOT NULL on contact_person_name/phone -> drop the constraint first
-- Getting either one wrong aborts the whole transaction with
-- "Missing required field(s)" / "violates not-null constraint" and rolls back.

-- 1. Narrow the mandatory set. The trigger stays attached and now uses this body.
create or replace function public.validate_client_required() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v_missing text;
begin
  v_missing := concat_ws(', ',
    case when btrim(coalesce(new.name, '')) = ''        then 'Client Name' end,
    case when btrim(coalesce(new.client_type, '')) = ''  then 'Client Type' end,
    case when btrim(coalesce(new.address, '')) = ''      then 'Address' end,
    case when btrim(coalesce(new.mobile, '')) = ''       then 'Phone Number' end
  );
  if v_missing <> '' then
    raise exception 'Missing required field(s): %', v_missing using errcode = '23502';
  end if;
  return new;
end $$;

-- 2. Relax the columns BEFORE writing any data to them.
alter table public.clients
  drop column if exists contact_name,
  alter column contact_person_name  drop not null,
  alter column contact_person_phone drop not null;

-- 3. Secondary phone
alter table public.clients add column if not exists secondary_phone text;

-- 4. Now legal: the trigger permits blanks and the columns accept NULL.
update public.clients set
  contact_person_name  = nullif(contact_person_name, 'Not provided'),
  contact_person_phone = nullif(contact_person_phone, 'Not provided');

create index if not exists clients_secondary_phone_idx on public.clients(secondary_phone);



-- ==============================================================================
-- Migration 10 of 25: 20261004140000_drop_client_financial_year.sql
-- ==============================================================================

-- Drop the client financial_year column.
--
-- It was write-only: no report, job, invoice or RPC ever read it. The period a
-- client is billed for already lives in client_services (start_date, frequency,
-- due_days) and on the generated jobs, so this was a second place for the same
-- fact to go stale — why: one loose text field cannot represent a client
-- spanning several financial years.
--
-- Optional field, never mandatory, no dependent index — safe to drop.
alter table public.clients drop column if exists financial_year;



-- ==============================================================================
-- Migration 11 of 25: 20261004150000_services_rework.sql
-- ==============================================================================

-- Services rework: SAC codes, default fees and due-day rules move off the master.
--
-- What changed and why:
--   * sac_code is dropped outright. It was surfaced on the services screen AND
--     printed on invoice line items (invoice_items -> jobs -> services.sac_code).
--     Historic invoices simply stop showing it.
--   * default_fee and due_days are dropped from services. client_services
--     (the assignment) already carries its own agreed_fee and due_days, and the
--     service-level copies had drifted out of sync with real assignments --
--     they were only ever prefills. Dropping the columns loses no real data.
--   * The silent column defaults ('Other', 'recurring', 'monthly') are removed
--     so those three must be chosen deliberately rather than inherited.
--
-- Mandatory set for a service is now: name, service_type, billing_type, frequency.

-- 1. Remove the columns that now live on the assignment (or are gone entirely).
alter table public.services
  drop column if exists sac_code,
  drop column if exists default_fee,
  drop column if exists due_days;

-- 2. Remove the silent defaults so the user must pick these explicitly.
alter table public.services
  alter column service_type drop default,
  alter column billing_type drop default,
  alter column frequency  drop default;

-- 3. Enforce the mandatory set in the database, and keep billing_type and
--    frequency consistent with each other.
create or replace function public.validate_service_required() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v_missing text;
begin
  v_missing := concat_ws(', ',
    case when btrim(coalesce(new.name, '')) = ''         then 'Service Name' end,
    case when btrim(coalesce(new.service_type, '')) = '' then 'Service Type' end,
    case when btrim(coalesce(new.billing_type, '')) = '' then 'Billing Type' end,
    case when btrim(coalesce(new.frequency, '')) = ''    then 'Frequency' end,
    case when new.billing_type = 'one_time' and new.frequency <> 'one_time'
      then 'Frequency must be One-time for a non-recurring service' end,
    case when new.billing_type = 'recurring' and new.frequency = 'one_time'
      then 'Choose a recurring frequency' end
  );
  if v_missing <> '' then
    raise exception 'Missing required field(s): %', v_missing using errcode = '23502';
  end if;
  return new;
end $$;

drop trigger if exists services_validate_required on public.services;
create trigger services_validate_required
  before insert or update on public.services
  for each row execute function public.validate_service_required();

create index if not exists services_active_idx on public.services(active);



-- ==============================================================================
-- Migration 12 of 25: 20261005090000_job_payment_workflow_schema.sql
-- ==============================================================================

/* ==========================================================================
   Phase 1 -- Job-centric workflow: JOB -> PAYMENT -> CLEARING -> SQUARE-OFF -> INVOICE
   Invoice creation is impossible until the job's payment clearing is squared
   off. Enforcement lives in Postgres; the UI only reflects it.
   References become JOB-XXXX-MMYY / PAY-XXXX-MMYY / INV-XXXX-MMYY.
   Paste-safe: no line comments and no blank lines, because the Supabase SQL
   editor strips newlines and would otherwise swallow the rest of the script.
   ========================================================================== */
alter table public.jobs alter column job_code set default ('JOB-' || lpad(nextval('public.job_seq')::text, 4, '0') || '-' || to_char(current_date, 'MMYY'));
alter table public.payments alter column payment_code set default ('PAY-' || lpad(nextval('public.payment_seq')::text, 4, '0') || '-' || to_char(current_date, 'MMYY'));
alter table public.invoices alter column invoice_no set default ('INV-' || lpad(nextval('public.invoice_seq')::text, 4, '0') || '-' || to_char(current_date, 'MMYY'));
alter table public.jobs add column if not exists checklist jsonb not null default '[]'::jsonb;
alter table public.jobs add column if not exists completed_at timestamptz;
create or replace function public.stamp_job_completion() returns trigger language plpgsql as $$
begin
  if new.status = 'completed' then
    if tg_op = 'INSERT' then
      new.completed_at := coalesce(new.completed_at, now());
    elsif old.status is distinct from 'completed' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists jobs_stamp_completion on public.jobs;
create trigger jobs_stamp_completion before insert or update on public.jobs for each row execute function public.stamp_job_completion();
create table if not exists public.job_clearing (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete restrict,
  firm_id uuid not null default public.current_firm_id() references public.firms(id) on delete cascade,
  advance numeric(14,2) not null default 0 check (advance >= 0),
  tds_tcs numeric(14,2) not null default 0 check (tds_tcs >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  other_deduction numeric(14,2) not null default 0 check (other_deduction >= 0),
  other_addition numeric(14,2) not null default 0 check (other_addition >= 0),
  gross_fee numeric(14,2) not null default 0,
  final_amount numeric(14,2) not null default 0 check (final_amount >= 0),
  status text not null default 'draft' check (status in ('draft','cleared','squared_off')),
  cleared_at timestamptz, cleared_by uuid references public.profiles(id),
  squared_off_at timestamptz, squared_off_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id)
);
create index if not exists job_clearing_firm_idx on public.job_clearing(firm_id);
create or replace function public.job_clearing_recalc() returns trigger language plpgsql as $$
declare j record;
begin
  select fee, discount into j from public.jobs where id = new.job_id;
  new.gross_fee := coalesce(j.fee, 0);
  new.final_amount := greatest(new.gross_fee - coalesce(j.discount, 0) - new.advance - new.tds_tcs - new.discount - new.other_deduction + new.other_addition, 0);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists job_clearing_recalc_trg on public.job_clearing;
create trigger job_clearing_recalc_trg before insert or update on public.job_clearing for each row execute function public.job_clearing_recalc();
alter table public.job_clearing enable row level security;
drop policy if exists "job_clearing read" on public.job_clearing;
create policy "job_clearing read" on public.job_clearing for select to authenticated using (public.is_finance() or public.is_manager());
drop policy if exists "job_clearing write" on public.job_clearing;
create policy "job_clearing write" on public.job_clearing for all to authenticated using (public.is_finance()) with check (public.is_finance());
alter table public.payments alter column job_id set not null;
alter table public.invoices add column if not exists job_id uuid references public.jobs(id) on delete restrict;
alter table public.invoices add column if not exists payment_id uuid references public.payments(id) on delete restrict;
create index if not exists invoices_job_idx on public.invoices(job_id);
create index if not exists payments_job_idx on public.payments(job_id);
create unique index if not exists invoices_one_per_job on public.invoices(job_id) where job_id is not null and status <> 'cancelled';
drop policy if exists "pay ins" on public.payments;
create policy "pay ins" on public.payments for insert to authenticated with check ((public.is_finance() or public.is_cashier()) and created_by = auth.uid());
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default public.current_firm_id() references public.firms(id) on delete cascade,
  client_id uuid references public.clients(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete restrict,
  expense_date date not null default current_date,
  category text not null default 'Other',
  description text not null,
  amount numeric(14,2) not null check (amount > 0),
  mode text not null default 'other' check (mode in ('cash','bank','upi','cheque','card','other')),
  reference text, paid_to text, notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_firm_idx on public.expenses(firm_id);
create index if not exists expenses_client_idx on public.expenses(client_id);
create index if not exists expenses_job_idx on public.expenses(job_id);
alter table public.expenses enable row level security;
drop policy if exists "expenses read" on public.expenses;
create policy "expenses read" on public.expenses for select to authenticated using (public.is_staff_plus());
drop policy if exists "expenses write" on public.expenses;
create policy "expenses write" on public.expenses for all to authenticated using (public.is_finance()) with check (public.is_finance());
create table if not exists public.job_conditions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default public.current_firm_id() references public.firms(id) on delete cascade,
  code text not null,
  label text not null,
  description text,
  severity text not null default 'block' check (severity in ('block','warn')),
  enabled boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, code)
);
create index if not exists job_conditions_firm_idx on public.job_conditions(firm_id);
alter table public.job_conditions enable row level security;
drop policy if exists "job_conditions read" on public.job_conditions;
create policy "job_conditions read" on public.job_conditions for select to authenticated using (true);
drop policy if exists "job_conditions write" on public.job_conditions;
create policy "job_conditions write" on public.job_conditions for all to authenticated using (public.is_manager()) with check (public.is_manager());
create table if not exists public.recurring_payments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default public.current_firm_id() references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete restrict,
  label text not null,
  amount numeric(14,2) not null check (amount > 0),
  mode text not null default 'bank' check (mode in ('cash','bank','upi','cheque','card','other')),
  frequency text not null check (frequency in ('monthly','quarterly','half_yearly','yearly')),
  next_run_date date not null default current_date,
  last_run_at timestamptz,
  status text not null default 'active' check (status in ('active','paused','stopped')),
  reference text, notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recurring_payments_firm_idx on public.recurring_payments(firm_id);
alter table public.recurring_payments enable row level security;
drop policy if exists "recurring_payments read" on public.recurring_payments;
create policy "recurring_payments read" on public.recurring_payments for select to authenticated using (public.is_finance());
drop policy if exists "recurring_payments write" on public.recurring_payments;
create policy "recurring_payments write" on public.recurring_payments for all to authenticated using (public.is_manager()) with check (public.is_manager());
do $$ declare t text; begin
  foreach t in array array['job_clearing','expenses','job_conditions','recurring_payments'] loop
    execute format('create policy "firm isolation" on public.%I as restrictive for all to authenticated using (firm_id = public.current_firm_id()) with check (firm_id = public.current_firm_id())', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_trigger()', t);
  end loop;
end $$;
revoke execute on function public.auto_invoice_job(uuid) from public, anon, authenticated;
create or replace function public.update_job_status(_job_id uuid, _status text, _reason text) returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.firm_guard('jobs', _job_id);
  if not (public.is_finance() or exists(select 1 from public.jobs where id=_job_id and assigned_staff=auth.uid())) then raise exception 'Not authorised'; end if;
  perform set_config('app.status_reason', coalesce(_reason,''), true);
  update public.jobs set status=_status where id=_job_id;
end $$;
create or replace function public.assert_invoice_eligible(_job_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare j record; c record; inv record;
begin
  select * into j from public.jobs where id = _job_id;
  if j.id is null then raise exception 'Job not found'; end if;
  if j.status = 'cancelled' then raise exception 'Job % is cancelled', j.job_code; end if;
  select * into inv from public.invoices where job_id = _job_id and status <> 'cancelled' limit 1;
  if inv.id is not null then raise exception 'Job % is already invoiced as %', j.job_code, inv.invoice_no; end if;
  if j.status <> 'completed' then raise exception 'Job % must be completed before invoicing', j.job_code; end if;
  select * into c from public.job_clearing where job_id = _job_id;
  if c.id is null then raise exception 'Invoice cannot be created until payment clearing is completed.'; end if;
  if c.status = 'draft' then raise exception 'Invoice cannot be created until payment clearing is completed.'; end if;
  if c.status = 'cleared' then raise exception 'Invoice cannot be created until payment is squared off.'; end if;
  if c.final_amount <= 0 then raise exception 'Cleared amount for job % must be greater than zero', j.job_code; end if;
  return;
end $$;
create or replace function public.create_invoice(_client_id uuid, _job_ids uuid[], _invoice_date date, _due_date date, _discount numeric, _discount_reason text, _tax_rate numeric, _notes text, _extra_desc text, _extra_amount numeric) returns uuid language plpgsql security definer set search_path=public as $$
declare inv_id uuid; sub numeric := 0; j record; tax numeric; tot numeric; amt numeric;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('clients', _client_id);
  insert into public.invoices(client_id, invoice_date, due_date, notes, created_by) values (_client_id, _invoice_date, _due_date, _notes, auth.uid()) returning id into inv_id;
  for j in select * from public.jobs where id = any(coalesce(_job_ids,'{}'::uuid[])) loop
    if j.client_id <> _client_id then raise exception 'Job % belongs to another client', j.job_code; end if;
    perform public.assert_invoice_eligible(j.id);
    select coalesce((select c.final_amount from public.job_clearing c where c.job_id=j.id), j.net_amount) into amt;
    insert into public.invoice_items(invoice_id, job_id, description, amount) values (inv_id, j.id, j.title, amt);
    update public.invoices set job_id = j.id where id = inv_id and job_id is null;
    sub := sub + amt;
  end loop;
  if coalesce(_extra_amount,0) > 0 then
    insert into public.invoice_items(invoice_id, description, amount) values (inv_id, coalesce(nullif(_extra_desc,''),'Professional fees'), _extra_amount);
    sub := sub + _extra_amount;
  end if;
  if sub <= 0 then raise exception 'Invoice must have at least one item'; end if;
  if coalesce(_discount,0) > sub then raise exception 'Discount cannot exceed subtotal'; end if;
  tax := round((sub - coalesce(_discount,0)) * coalesce(_tax_rate,0) / 100, 2);
  tot := sub - coalesce(_discount,0) + tax;
  update public.invoices set subtotal=sub, discount=coalesce(_discount,0), tax_rate=coalesce(_tax_rate,0), tax_amount=tax, total=tot, description=(select string_agg(description, ', ') from public.invoice_items where invoice_id=inv_id) where id=inv_id;
  if coalesce(_discount,0) > 0 then
    insert into public.discounts(invoice_id, original_amount, discount_amount, net_amount, reason, approved_by) values (inv_id, sub, _discount, sub-_discount, _discount_reason, auth.uid());
  end if;
  update public.jobs set financial_status='invoiced' where id = any(coalesce(_job_ids,'{}'));
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(), 'invoice_created', 'invoices', inv_id, 'legacy multi-job path');
  return inv_id;
end $$;
create or replace function public.create_invoice_for_job(_job_id uuid, _payment_id uuid, _invoice_date date, _due_date date, _tax_rate numeric, _notes text, _extra_desc text, _extra_amount numeric) returns uuid language plpgsql security definer set search_path=public as $$
declare j record; c record; inv_id uuid; sub numeric; tax numeric; tot numeric;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  perform public.assert_invoice_eligible(_job_id);
  select * into j from public.jobs where id = _job_id;
  select * into c from public.job_clearing where job_id = _job_id;
  if _payment_id is not null then
    perform public.firm_guard('payments', _payment_id);
    if not exists(select 1 from public.payments where id = _payment_id and job_id = _job_id) then raise exception 'Payment does not belong to job %', j.job_code; end if;
  end if;
  sub := c.final_amount + coalesce(_extra_amount, 0);
  if sub <= 0 then raise exception 'Invoice must have at least one item'; end if;
  tax := round(sub * coalesce(_tax_rate, 0) / 100, 2);
  tot := sub + tax;
  insert into public.invoices(client_id, job_id, payment_id, invoice_date, due_date, notes, created_by) values (j.client_id, _job_id, _payment_id, coalesce(_invoice_date, current_date), coalesce(_due_date, current_date + 15), _notes, auth.uid()) returning id into inv_id;
  insert into public.invoice_items(invoice_id, job_id, description, amount) values (inv_id, _job_id, j.title, c.final_amount);
  if coalesce(_extra_amount,0) > 0 then
    insert into public.invoice_items(invoice_id, description, amount) values (inv_id, coalesce(nullif(_extra_desc,''),'Professional fees'), _extra_amount);
  end if;
  update public.invoices set subtotal=sub, tax_rate=coalesce(_tax_rate,0), tax_amount=tax, total=tot, description=(select string_agg(description, ', ') from public.invoice_items where invoice_id=inv_id) where id=inv_id;
  update public.jobs set financial_status='invoiced' where id=_job_id;
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(), 'invoice_created', 'invoices', inv_id, j.job_code);
  return inv_id;
end $$;
create or replace function public.save_job_clearing(_job_id uuid, _advance numeric, _tds_tcs numeric, _discount numeric, _other_deduction numeric, _other_addition numeric, _notes text) returns uuid language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  if exists(select 1 from public.job_clearing where job_id=_job_id and status<>'draft') then raise exception 'Clearing has already been completed and cannot be edited. Reverse it first.'; end if;
  insert into public.job_clearing(job_id, advance, tds_tcs, discount, other_deduction, other_addition, notes)
  values (_job_id, coalesce(_advance,0), coalesce(_tds_tcs,0), coalesce(_discount,0), coalesce(_other_deduction,0), coalesce(_other_addition,0), _notes)
  on conflict (job_id) do update set advance=excluded.advance, tds_tcs=excluded.tds_tcs, discount=excluded.discount, other_deduction=excluded.other_deduction, other_addition=excluded.other_addition, notes=excluded.notes
  returning id into cid;
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(), 'clearing_saved', 'job_clearing', cid, _job_id::text);
  return cid;
end $$;
create or replace function public.mark_job_cleared(_job_id uuid, _notes text) returns void language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  update public.job_clearing set status='cleared', cleared_at=now(), cleared_by=auth.uid(), notes=coalesce(_notes, notes) where job_id=_job_id returning id into cid;
  if cid is null then raise exception 'Save the clearing details before clearing the payment.'; end if;
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(), 'payment_cleared', 'job_clearing', cid, _job_id::text);
end $$;
create or replace function public.sq_off_job_clearing(_job_id uuid, _notes text) returns void language plpgsql security definer set search_path=public as $$
declare cid uuid; jc record;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  select * into jc from public.job_clearing where job_id=_job_id;
  if jc.id is null then raise exception 'Save the clearing details before squaring off.'; end if;
  if jc.status = 'draft' then raise exception 'Invoice cannot be created until payment clearing is completed.'; end if;
  if jc.status = 'squared_off' then raise exception 'Payment is already squared off.'; end if;
  update public.job_clearing set status='squared_off', squared_off_at=now(), squared_off_by=auth.uid(), notes=coalesce(_notes, notes) where id=jc.id returning id into cid;
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(), 'payment_squared_off', 'job_clearing', cid, _job_id::text);
end $$;
create or replace function public.reopen_job_clearing(_job_id uuid, _reason text) returns void language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  if exists(select 1 from public.invoices where job_id=_job_id and status<>'cancelled') then raise exception 'This job already has an invoice. Cancel the invoice before reopening the clearing.'; end if;
  update public.job_clearing set status='draft', cleared_at=null, cleared_by=null, squared_off_at=null, squared_off_by=null where job_id=_job_id returning id into cid;
  if cid is null then raise exception 'No clearing record found for this job.'; end if;
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(), 'clearing_reopened', 'job_clearing', cid, coalesce(_reason,''));
end $$;
create or replace function public.job_workflow(_job_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare j record; c record; inv record; npay int; nopen numeric; blocked text; avail bool;
begin
  select * into j from public.jobs where id=_job_id;
  if j.id is null then raise exception 'Job not found'; end if;
  perform public.firm_guard('jobs', _job_id);
  select * into c from public.job_clearing where job_id=_job_id;
  select * into inv from public.invoices where job_id=_job_id and status<>'cancelled' limit 1;
  select count(*) into npay from public.payments where job_id=_job_id and status<>'reversed';
  select coalesce(sum(greatest(amount - allocated_amount, 0)),0) into nopen from public.payments where job_id=_job_id and status<>'reversed';
  blocked := null; avail := false;
  if inv.id is not null then
    avail := false; blocked := format('Invoice %s already exists for this job.', inv.invoice_no);
  elsif j.status = 'cancelled' then
    avail := false; blocked := 'Job is cancelled.';
  elsif j.status <> 'completed' then
    avail := false; blocked := 'Job must be completed before payment clearing.';
  elsif c.id is null or c.status = 'draft' then
    avail := false; blocked := 'Invoice cannot be created until payment clearing is completed.';
  elsif c.status = 'cleared' then
    avail := false; blocked := 'Invoice cannot be created until payment is squared off.';
  else
    avail := true; blocked := null;
  end if;
  return jsonb_build_object(
    'job_id', j.id, 'job_code', j.job_code, 'job_status', j.status,
    'job_completed_at', j.completed_at, 'due_date', j.due_date,
    'overdue', (j.due_date is not null and j.due_date < current_date and coalesce(c.status,'') <> 'squared_off' and j.status <> 'cancelled'),
    'gross_fee', j.fee, 'job_discount', j.discount, 'net_amount', j.net_amount,
    'advance', coalesce(c.advance,0), 'tds_tcs', coalesce(c.tds_tcs,0),
    'clearing_discount', coalesce(c.discount,0), 'other_deduction', coalesce(c.other_deduction,0), 'other_addition', coalesce(c.other_addition,0),
    'clearing_status', coalesce(c.status,'draft'), 'clearing_id', c.id,
    'cleared_at', c.cleared_at, 'squared_off_at', c.squared_off_at,
    'final_amount', coalesce(c.final_amount, 0),
    'payment_count', npay, 'payment_unallocated', nopen,
    'invoice_id', inv.id, 'invoice_no', inv.invoice_no, 'invoice_status', inv.status,
    'invoice_available', avail, 'blocked_reason', blocked,
    'stages', jsonb_build_object(
      'created', true,
      'completed', (j.status = 'completed'),
      'payment_created', (npay > 0),
      'payment_cleared', (c.status in ('cleared','squared_off')),
      'squared_off', (c.status = 'squared_off'),
      'invoiced', (inv.id is not null)
    )
  );
end $$;
grant select, insert, update on public.job_clearing, public.expenses, public.job_conditions, public.recurring_payments to authenticated;
grant all on public.job_clearing, public.expenses, public.job_conditions, public.recurring_payments to service_role;
grant update on public.payments to authenticated;
revoke execute on function public.assert_invoice_eligible(uuid), public.save_job_clearing(uuid, numeric, numeric, numeric, numeric, numeric, text), public.mark_job_cleared(uuid, text), public.sq_off_job_clearing(uuid, text), public.reopen_job_clearing(uuid, text), public.job_workflow(uuid), public.create_invoice_for_job(uuid, uuid, date, date, numeric, text, text, numeric) from public, anon;
grant execute on function public.create_invoice_for_job(uuid, uuid, date, date, numeric, text, text, numeric), public.save_job_clearing(uuid, numeric, numeric, numeric, numeric, numeric, text), public.mark_job_cleared(uuid, text), public.sq_off_job_clearing(uuid, text), public.reopen_job_clearing(uuid, text), public.job_workflow(uuid), public.update_job_status(uuid, text, text), public.create_invoice(uuid, uuid[], date, date, numeric, text, numeric, text, text, numeric) to authenticated;



-- ==============================================================================
-- Migration 13 of 25: 20261006120000_module_permissions.sql
-- ==============================================================================

/* ==========================================================================
   Per-module permissions chosen by the firm Admin.
   1. The role enum narrows to admin / staff / cashier. "owner" becomes
      "admin" and "accountant" becomes "staff", so nobody silently loses the
      ability to sign in; an Admin then widens or narrows what Staff and
      Cashier can do from Roles & Permissions.
   2. Access to the practice modules (clients, services, jobs, recurring,
      payments, expenses) is no longer hard-coded into RLS. It is read from
      role_permissions, which the Admin edits. Admin always passes
      has_capability() so a firm can never lock itself out of its own data.
   3. Missing rows fall back to permission_defaults(), which reproduces the
      behaviour the app had before this migration, so a firm that never opens
      the matrix behaves exactly as it does today.
   4. Admin is deliberately not editable and Payments cannot be deleted: money
      is corrected by reverse/cancel RPCs, never by removing a row. Clients,
      Services, Jobs and Expenses may be deleted, and the existing ON DELETE
      RESTRICT foreign keys already refuse to delete anything that has
      financial history.
   Paste-safe: no line comments and no blank lines, because the Supabase SQL
   editor strips newlines and would otherwise swallow the rest of the script.
   ========================================================================== */
drop policy if exists "roles read" on public.user_roles;
drop policy if exists "roles manage ins" on public.user_roles;
drop policy if exists "roles manage del" on public.user_roles;
drop policy if exists "firm isolation" on public.user_roles;
/* has_role takes app_role as an argument, so the enum swap below cannot proceed
   until every policy that calls it has gone. These three are recreated further
   down against has_capability instead. */
drop policy if exists "clients read" on public.clients;
drop policy if exists "cs read" on public.client_services;
drop policy if exists "jobs read" on public.jobs;
/* Everything that names app_role in its signature or columns has to go before
   the type can be replaced. All of it is recreated and reseeded further down, so
   this also makes the script re-runnable; the cost is that a second run resets
   an Admin's permission choices back to the defaults. */
drop function if exists public.has_role(uuid, public.app_role);
drop function if exists public.my_roles();
drop function if exists public.permission_matrix();
drop function if exists public.set_role_permission(public.app_role, text, boolean, boolean, boolean, boolean, boolean);
drop function if exists public.permission_defaults(public.app_role, text);
drop function if exists public.effective_permissions(uuid, public.app_role, text);
drop function if exists public.ensure_role_permission(uuid, public.app_role, text);
drop table if exists public.role_permissions;
alter table public.firm_invites alter column role drop default;
alter table public.user_roles alter column role drop default;
create type public.app_role_v2 as enum ('admin','staff','cashier');
alter table public.user_roles alter column role type public.app_role_v2 using (case role::text when 'owner' then 'admin' when 'admin' then 'admin' when 'staff' then 'staff' else 'cashier' end)::public.app_role_v2;
alter table public.firm_invites alter column role type public.app_role_v2 using (case role::text when 'owner' then 'admin' when 'admin' then 'admin' when 'staff' then 'staff' else 'cashier' end)::public.app_role_v2;
alter table public.firm_invites alter column role set default 'staff';
alter table public.user_roles alter column role set default 'staff';
drop type public.app_role;
alter type public.app_role_v2 rename to app_role;
create or replace function public.has_role(_user_id uuid, _role public.app_role) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.user_roles where user_id=_user_id and role=_role) $$;
create or replace function public.is_manager() returns boolean language sql stable security definer set search_path=public as $$ select public.is_super_admin() or exists(select 1 from public.user_roles where user_id=auth.uid() and role='admin') $$;
create or replace function public.is_finance() returns boolean language sql stable security definer set search_path=public as $$ select public.is_manager() $$;
create or replace function public.is_staff_plus() returns boolean language sql stable security definer set search_path=public as $$ select public.is_super_admin() or exists(select 1 from public.user_roles where user_id=auth.uid() and role in ('admin','staff')) $$;
create or replace function public.is_cashier() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.user_roles where user_id=auth.uid() and role='cashier') $$;
create or replace function public.my_roles() returns setof public.app_role language sql stable security definer set search_path=public as $$ select 'admin'::public.app_role where public.is_super_admin() union select role from public.user_roles where user_id=auth.uid() and not public.is_super_admin() $$;
create policy "roles read" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_manager());
create policy "roles manage ins" on public.user_roles for insert to authenticated with check (public.is_manager());
create policy "roles manage del" on public.user_roles for delete to authenticated using (public.is_manager());
create policy "firm isolation" on public.user_roles as restrictive for all to authenticated using (user_id=auth.uid() or exists(select 1 from public.profiles p where p.id=user_roles.user_id and p.firm_id=public.current_firm_id())) with check (exists(select 1 from public.profiles p where p.id=user_roles.user_id and p.firm_id=public.current_firm_id()));
create table if not exists public.role_permissions (firm_id uuid not null default public.current_firm_id() references public.firms(id) on delete cascade, role public.app_role not null, module text not null check (module in ('clients','services','jobs','recurring','payments','expenses')), can_view boolean not null default false, can_create boolean not null default false, can_edit boolean not null default false, can_delete boolean not null default false, can_amounts boolean not null default false, updated_by uuid default auth.uid(), updated_at timestamptz not null default now(), primary key (firm_id, role, module));
create index if not exists role_permissions_firm_idx on public.role_permissions(firm_id);
alter table public.role_permissions enable row level security;
drop policy if exists "role_permissions read" on public.role_permissions;
drop policy if exists "role_permissions firm isolation" on public.role_permissions;
create policy "role_permissions read" on public.role_permissions for select to authenticated using (firm_id=public.current_firm_id());
create policy "role_permissions firm isolation" on public.role_permissions as restrictive for all to authenticated using (firm_id=public.current_firm_id()) with check (firm_id=public.current_firm_id());
/* Defaults reproduce the pre-migration behaviour: Admin everything, Staff read the practice modules and progress job status, Cashier records payments. Admin can delete every module except Payments, because payment rows are reversed rather than removed. */
/* Payments are never deletable for anyone: set_role_permission refuses the grant and the table has no DELETE grant. Admin still deletes Clients, Services, Jobs, Recurring and Expenses, whose ON DELETE RESTRICT foreign keys are what refuse a record with financial history. */
create or replace function public.permission_defaults(_role public.app_role, _module text) returns table(can_view boolean, can_create boolean, can_edit boolean, can_delete boolean, can_amounts boolean) language sql immutable as $$ select case when _role='admin' then true when _role='cashier' then _module='payments' else true end, case when _role='admin' then true when _role='cashier' then _module='payments' else false end, case when _role='admin' then true when _role='staff' then _module='jobs' else false end, case when _role='admin' then _module<>'payments' else false end, case when _role='admin' then true when _role='cashier' then _module='payments' else false end $$;
/* can_delete is forced false for payments here as well as in set_role_permission, so a row written by any other path still cannot make has_capability('payments','delete') true. The rule is enforced at the point of use, not only at the point of writing. */
create or replace function public.effective_permissions(_firm_id uuid, _role public.app_role, _module text) returns table(can_view boolean, can_create boolean, can_edit boolean, can_delete boolean, can_amounts boolean) language sql stable security definer set search_path=public as $$ select coalesce(rp.can_view, d.can_view), coalesce(rp.can_create, d.can_create), coalesce(rp.can_edit, d.can_edit), case when _module='payments' then false else coalesce(rp.can_delete, d.can_delete) end, coalesce(rp.can_amounts, d.can_amounts) from public.permission_defaults(_role, _module) d left join public.role_permissions rp on rp.firm_id=_firm_id and rp.role=_role and rp.module=_module $$;
create or replace function public.has_capability(_module text, _action text) returns boolean language sql stable security definer set search_path=public as $$ select public.is_manager() or exists (select 1 from public.my_roles() rr cross join lateral public.effective_permissions(public.current_firm_id(), rr, _module) p where case _action when 'view' then p.can_view when 'create' then p.can_create when 'edit' then p.can_edit when 'delete' then p.can_delete when 'amounts' then p.can_amounts else false end) $$;
create or replace function public.seed_role_permissions(_firm_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin insert into public.role_permissions(firm_id, role, module, can_view, can_create, can_edit, can_delete, can_amounts) select _firm_id, r.role, m.module, d.can_view, d.can_create, d.can_edit, d.can_delete, d.can_amounts from unnest(array['admin','staff','cashier']::public.app_role[]) r(role) cross join unnest(array['clients','services','jobs','recurring','payments','expenses']) m(module) cross join lateral public.permission_defaults(r.role, m.module) d on conflict (firm_id, role, module) do nothing; end $$;
select public.seed_role_permissions(id) from public.firms;
/* Returns the stored row for a role+module, creating it from the defaults if it is missing, so that an Admin editing one cell always writes a complete row. */
create or replace function public.ensure_role_permission(_firm_id uuid, _role public.app_role, _module text) returns void language plpgsql security definer set search_path=public as $$ begin insert into public.role_permissions(firm_id, role, module, can_view, can_create, can_edit, can_delete, can_amounts) select _firm_id, _role, _module, d.can_view, d.can_create, d.can_edit, d.can_delete, d.can_amounts from public.permission_defaults(_role, _module) d on conflict (firm_id, role, module) do nothing; end $$;
create or replace function public.permission_matrix() returns table(role public.app_role, module text, can_view boolean, can_create boolean, can_edit boolean, can_delete boolean, can_amounts boolean, editable boolean) language plpgsql security definer set search_path=public as $$ begin if not public.is_manager() then raise exception 'Not authorised'; end if; return query select r.role, m.module, coalesce(rp.can_view, d.can_view), coalesce(rp.can_create, d.can_create), coalesce(rp.can_edit, d.can_edit), case when m.module='payments' then false else coalesce(rp.can_delete, d.can_delete) end, coalesce(rp.can_amounts, d.can_amounts), r.role <> 'admin' from unnest(array['admin','staff','cashier']::public.app_role[]) r(role) cross join unnest(array['clients','services','jobs','recurring','payments','expenses']) m(module) cross join lateral public.permission_defaults(r.role, m.module) d left join public.role_permissions rp on rp.firm_id=public.current_firm_id() and rp.role=r.role and rp.module=m.module; end $$;
create or replace function public.set_role_permission(_role public.app_role, _module text, _view boolean, _create boolean, _edit boolean, _delete boolean, _amounts boolean) returns void language plpgsql security definer set search_path=public as $$ begin if not public.is_manager() then raise exception 'Not authorised'; end if; if _role = 'admin' then raise exception 'The Admin role always has full access and cannot be restricted.'; end if; if _module not in ('clients','services','jobs','recurring','payments','expenses') then raise exception 'Unknown module'; end if; if _delete and _module = 'payments' then raise exception 'Payment records are never deleted. Reverse the payment instead.'; end if; insert into public.role_permissions(firm_id, role, module, can_view, can_create, can_edit, can_delete, can_amounts) values (public.current_firm_id(), _role, _module, coalesce(_view,false), coalesce(_view,false) and coalesce(_create,false), coalesce(_view,false) and coalesce(_edit,false), coalesce(_view,false) and coalesce(_delete,false), coalesce(_view,false) and coalesce(_amounts,false)) on conflict (firm_id, role, module) do update set can_view=excluded.can_view, can_create=excluded.can_create, can_edit=excluded.can_edit, can_delete=excluded.can_delete, can_amounts=excluded.can_amounts, updated_by=auth.uid(), updated_at=now(); insert into public.audit_logs(user_id, action, module, record_id, new_value) values (auth.uid(), 'role_permission_changed', 'role_permissions', _role::text || ':' || _module, jsonb_build_object('view', coalesce(_view,false), 'create', coalesce(_view,false) and coalesce(_create,false), 'edit', coalesce(_view,false) and coalesce(_edit,false), 'delete', coalesce(_view,false) and coalesce(_delete,false), 'amounts', coalesce(_view,false) and coalesce(_amounts,false))); end $$;
/* Aggregates are computed in the inner grouped query and only assembled into jsonb outside it, because an aggregate may not contain another aggregate. my_roles() is cross joined rather than referenced in the select list so that a user holding several roles gets the union of their grants. */
create or replace function public.my_permissions() returns jsonb language sql stable security definer set search_path=public as $$ select coalesce(jsonb_object_agg(s.module, jsonb_build_object('view', s.can_view, 'create', s.can_create, 'edit', s.can_edit, 'delete', s.can_delete, 'amounts', s.can_amounts)), '{}'::jsonb) from (select m.module, bool_or(p.can_view) as can_view, bool_or(p.can_create) as can_create, bool_or(p.can_edit) as can_edit, bool_or(p.can_delete) as can_delete, bool_or(p.can_amounts) as can_amounts from unnest(array['clients','services','jobs','recurring','payments','expenses']) m(module) cross join public.my_roles() rr cross join lateral public.effective_permissions(public.current_firm_id(), rr, m.module) p group by m.module) s $$;
create or replace function public.reset_role_permissions() returns void language plpgsql security definer set search_path=public as $$ begin if not public.is_manager() then raise exception 'Not authorised'; end if; delete from public.role_permissions where firm_id=public.current_firm_id(); perform public.seed_role_permissions(public.current_firm_id()); insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(), 'role_permissions_reset', 'role_permissions', public.current_firm_id()::text, 'restored defaults'); end $$;
/* RLS now reads the matrix instead of hard-coded roles. A grant is firm-wide: once Staff can see Clients they see every client, not only assigned ones. */
drop policy if exists "clients read" on public.clients;
drop policy if exists "clients ins" on public.clients;
drop policy if exists "clients upd" on public.clients;
drop policy if exists "clients del" on public.clients;
create policy "clients read" on public.clients for select to authenticated using (public.has_capability('clients','view'));
create policy "clients ins" on public.clients for insert to authenticated with check (public.has_capability('clients','create'));
create policy "clients upd" on public.clients for update to authenticated using (public.has_capability('clients','edit')) with check (public.has_capability('clients','edit'));
create policy "clients del" on public.clients for delete to authenticated using (public.has_capability('clients','delete'));
drop policy if exists "services read" on public.services;
drop policy if exists "services ins" on public.services;
drop policy if exists "services upd" on public.services;
drop policy if exists "services del" on public.services;
create policy "services read" on public.services for select to authenticated using (public.has_capability('services','view'));
create policy "services ins" on public.services for insert to authenticated with check (public.has_capability('services','create'));
create policy "services upd" on public.services for update to authenticated using (public.has_capability('services','edit')) with check (public.has_capability('services','edit'));
create policy "services del" on public.services for delete to authenticated using (public.has_capability('services','delete'));
/* client_services carries the retainer schedule, so it answers to either the Recurring module (the /recurring page) or the Clients module (the client detail page). Either grant is enough. */
drop policy if exists "cs read" on public.client_services;
drop policy if exists "cs ins" on public.client_services;
drop policy if exists "cs upd" on public.client_services;
drop policy if exists "cs del" on public.client_services;
create policy "cs read" on public.client_services for select to authenticated using (public.has_capability('recurring','view') or public.has_capability('clients','view'));
create policy "cs ins" on public.client_services for insert to authenticated with check (public.has_capability('recurring','create') or public.has_capability('clients','create'));
create policy "cs upd" on public.client_services for update to authenticated using (public.has_capability('recurring','edit') or public.has_capability('clients','edit')) with check (public.has_capability('recurring','edit') or public.has_capability('clients','edit'));
create policy "cs del" on public.client_services for delete to authenticated using (public.has_capability('recurring','delete'));
drop policy if exists "jobs read" on public.jobs;
drop policy if exists "jobs ins" on public.jobs;
drop policy if exists "jobs upd" on public.jobs;
drop policy if exists "jobs del" on public.jobs;
create policy "jobs read" on public.jobs for select to authenticated using (public.has_capability('jobs','view'));
create policy "jobs ins" on public.jobs for insert to authenticated with check (public.has_capability('jobs','create'));
create policy "jobs upd" on public.jobs for update to authenticated using (public.has_capability('jobs','edit')) with check (public.has_capability('jobs','edit'));
create policy "jobs del" on public.jobs for delete to authenticated using (public.has_capability('jobs','delete'));
/* Colleague names are needed to render "Assigned to" on any list the caller can already read, so profiles read follows module access rather than a fixed role list. */
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (id = auth.uid() or public.has_capability('clients','view') or public.has_capability('jobs','view') or public.is_manager());
/* Payments deliberately have no update policy: allocated_amount and status are moved by allocate_payment / reverse_payment so the totals stay correct. The Payments Edit column therefore gates reversal. */
drop policy if exists "pay read" on public.payments;
drop policy if exists "pay ins" on public.payments;
drop policy if exists "alloc read" on public.payment_allocations;
drop policy if exists "rev read" on public.payment_reversals;
create policy "pay read" on public.payments for select to authenticated using (public.has_capability('payments','view'));
create policy "pay ins" on public.payments for insert to authenticated with check (public.has_capability('payments','create') and created_by=auth.uid());
create policy "alloc read" on public.payment_allocations for select to authenticated using (public.has_capability('payments','edit'));
create policy "rev read" on public.payment_reversals for select to authenticated using (public.has_capability('payments','edit'));
/* The expenses / recurring_payments tables arrive with the job-payment workflow migration, which is not on every database yet. Policies cannot be created against a missing relation, so these are applied only when the table is present; the matrix still lists Expenses as a module and it starts working the moment that migration lands. */
do $$ begin if to_regclass('public.expenses') is not null then drop policy if exists "expenses read" on public.expenses; drop policy if exists "expenses write" on public.expenses; drop policy if exists "expenses ins" on public.expenses; drop policy if exists "expenses upd" on public.expenses; create policy "expenses read" on public.expenses for select to authenticated using (public.has_capability('expenses','view')); create policy "expenses ins" on public.expenses for insert to authenticated with check (public.has_capability('expenses','create')); create policy "expenses upd" on public.expenses for update to authenticated using (public.has_capability('expenses','edit')) with check (public.has_capability('expenses','edit')); end if; if to_regclass('public.recurring_payments') is not null then drop policy if exists "recurring_payments read" on public.recurring_payments; drop policy if exists "recurring_payments write" on public.recurring_payments; drop policy if exists "recurring_payments ins" on public.recurring_payments; drop policy if exists "recurring_payments upd" on public.recurring_payments; drop policy if exists "recurring_payments del" on public.recurring_payments; create policy "recurring_payments read" on public.recurring_payments for select to authenticated using (public.has_capability('recurring','view')); create policy "recurring_payments ins" on public.recurring_payments for insert to authenticated with check (public.has_capability('recurring','create')); create policy "recurring_payments upd" on public.recurring_payments for update to authenticated using (public.has_capability('recurring','edit')) with check (public.has_capability('recurring','edit')); create policy "recurring_payments del" on public.recurring_payments for delete to authenticated using (public.has_capability('recurring','delete')); end if; end $$;
/* RLS filters rows, not columns, so a Cashier who may view payments would still receive every amount over PostgREST if the UI read the table directly. These two list RPCs blank the money columns server-side unless the caller holds the module's amounts grant, so the figure genuinely never reaches the browser. */
/* These six are SECURITY DEFINER, which bypasses RLS, so each one must repeat the
   firm filter and the view grant itself. Without the firm_id predicate they would
   return every firm's rows, and has_capability() inside them would still resolve
   against the CALLER's firm, so the money columns would be unmasked for another
   firm's data. */
create or replace function public.payments_list() returns table(id uuid, payment_code text, client_id uuid, job_id uuid, amount numeric, mode text, payment_date date, reference text, narration text, status text, created_at timestamptz) language sql stable security definer set search_path=public as $$ select p.id, p.payment_code, p.client_id, p.job_id, case when public.has_capability('payments','amounts') then p.amount end, p.mode, p.payment_date, p.reference, p.narration, p.status, p.created_at from public.payments p where p.firm_id=public.current_firm_id() and public.has_capability('payments','view') order by p.created_at desc $$;
create or replace function public.jobs_list() returns table(id uuid, job_code text, client_id uuid, client_name text, service_id uuid, service_name text, client_service_id uuid, title text, period_start date, period_end date, fee numeric, discount numeric, net_amount numeric, due_date date, assigned_staff uuid, assigned_staff_name text, status text, financial_status text, notes text, auto_invoice boolean, created_at timestamptz, invoice_id uuid, invoice_no text, invoice_status text) language sql stable security definer set search_path=public as $$ select j.id, j.job_code, j.client_id, c.name, j.service_id, s.name, j.client_service_id, j.title, j.period_start, j.period_end, case when public.has_capability('jobs','amounts') then j.fee end, case when public.has_capability('jobs','amounts') then j.discount end, case when public.has_capability('jobs','amounts') then j.net_amount end, j.due_date, j.assigned_staff, pf.full_name, j.status, j.financial_status, j.notes, j.auto_invoice, j.created_at, inv.id, inv.invoice_no, inv.status from public.jobs j left join public.clients c on c.id=j.client_id left join public.services s on s.id=j.service_id left join public.profiles pf on pf.id=j.assigned_staff left join lateral (select i.id, i.invoice_no, i.status from public.invoice_items ii join public.invoices i on i.id=ii.invoice_id where ii.job_id=j.id and i.status<>'cancelled' order by i.created_at desc limit 1) inv on true where j.firm_id=public.current_firm_id() and public.has_capability('jobs','view') order by j.due_date asc nulls last $$;
create or replace function public.recurring_list() returns table(id uuid, client_id uuid, client_name text, service_id uuid, service_name text, agreed_fee numeric, frequency text, start_date date, end_date date, due_days int, assigned_staff uuid, assigned_staff_name text, status text, notes text, auto_invoice boolean, created_at timestamptz) language sql stable security definer set search_path=public as $$ select cs.id, cs.client_id, c.name, cs.service_id, s.name, case when public.has_capability('recurring','amounts') then cs.agreed_fee end, cs.frequency, cs.start_date, cs.end_date, cs.due_days, cs.assigned_staff, pf.full_name, cs.status, cs.notes, cs.auto_invoice, cs.created_at from public.client_services cs left join public.clients c on c.id=cs.client_id left join public.services s on s.id=cs.service_id left join public.profiles pf on pf.id=cs.assigned_staff where cs.firm_id=public.current_firm_id() and public.has_capability('recurring','view') order by cs.created_at $$;
create or replace function public.client_services_list(_client_id uuid) returns table(id uuid, client_id uuid, service_id uuid, service_name text, service_type text, auto_invoice boolean, agreed_fee numeric, frequency text, start_date date, end_date date, due_days int, assigned_staff uuid, assigned_staff_name text, status text, notes text, created_at timestamptz) language sql stable security definer set search_path=public as $$ select cs.id, cs.client_id, cs.service_id, s.name, s.service_type, s.auto_invoice, case when public.has_capability('recurring','amounts') or public.has_capability('services','amounts') then cs.agreed_fee end, cs.frequency, cs.start_date, cs.end_date, cs.due_days, cs.assigned_staff, pf.full_name, cs.status, cs.notes, cs.created_at from public.client_services cs left join public.services s on s.id=cs.service_id left join public.profiles pf on pf.id=cs.assigned_staff where cs.client_id=_client_id and cs.firm_id=public.current_firm_id() and (public.has_capability('recurring','view') or public.has_capability('clients','view')) order by cs.created_at $$;
create or replace function public.client_jobs_list(_client_id uuid) returns table(id uuid, job_code text, client_id uuid, service_id uuid, service_name text, title text, period_start date, period_end date, fee numeric, discount numeric, net_amount numeric, due_date date, assigned_staff uuid, assigned_staff_name text, status text, financial_status text, notes text, auto_invoice boolean, created_at timestamptz, invoice_id uuid, invoice_no text, invoice_status text) language sql stable security definer set search_path=public as $$ select j.id, j.job_code, j.client_id, j.service_id, s.name, j.title, j.period_start, j.period_end, case when public.has_capability('jobs','amounts') then j.fee end, case when public.has_capability('jobs','amounts') then j.discount end, case when public.has_capability('jobs','amounts') then j.net_amount end, j.due_date, j.assigned_staff, pf.full_name, j.status, j.financial_status, j.notes, j.auto_invoice, j.created_at, inv.id, inv.invoice_no, inv.status from public.jobs j left join public.services s on s.id=j.service_id left join public.profiles pf on pf.id=j.assigned_staff left join lateral (select i.id, i.invoice_no, i.status from public.invoice_items ii join public.invoices i on i.id=ii.invoice_id where ii.job_id=j.id and i.status<>'cancelled' order by i.created_at desc limit 1) inv on true where j.client_id=_client_id and j.firm_id=public.current_firm_id() and public.has_capability('jobs','view') order by j.created_at desc $$;
create or replace function public.client_payments_list(_client_id uuid) returns table(id uuid, payment_code text, client_id uuid, job_id uuid, amount numeric, allocated_amount numeric, mode text, payment_date date, reference text, narration text, status text, created_at timestamptz) language sql stable security definer set search_path=public as $$ select p.id, p.payment_code, p.client_id, p.job_id, case when public.has_capability('payments','amounts') then p.amount end, case when public.has_capability('payments','amounts') then p.allocated_amount end, p.mode, p.payment_date, p.reference, p.narration, p.status, p.created_at from public.payments p where p.client_id=_client_id and p.firm_id=public.current_firm_id() and public.has_capability('payments','view') order by p.payment_date desc $$;
create or replace function public.client_lookup() returns table(id uuid, client_code text, name text) language sql stable security definer set search_path=public as $$ select id, client_code, name from public.clients where status='active' and firm_id=public.current_firm_id() and (public.has_capability('clients','view') or public.has_capability('payments','create')) order by name $$;
create or replace function public.update_job_status(_job_id uuid, _status text, _reason text) returns void language plpgsql security definer set search_path=public as $$ declare j record; begin perform public.firm_guard('jobs', _job_id); if not public.has_capability('jobs','edit') then raise exception 'Not authorised'; end if; perform set_config('app.status_reason', coalesce(_reason,''), true); update public.jobs set status=_status where id=_job_id; end $$;
create or replace function public.generate_recurring_jobs(_upto date) returns integer language plpgsql security definer set search_path=public as $$ declare cs record; ps date; pe date; step interval; n int := 0; svc record; lbl text; begin if not public.has_capability('recurring','edit') then raise exception 'Not authorised'; end if; for cs in select * from public.client_services where status='active' and firm_id=public.current_firm_id() loop select * into svc from public.services where id=cs.service_id; if cs.frequency='one_time' then insert into public.jobs(client_id, service_id, client_service_id, title, period_start, period_end, fee, due_date, assigned_staff, created_by) values (cs.client_id, cs.service_id, cs.id, svc.name, cs.start_date, cs.start_date, cs.agreed_fee, cs.start_date + cs.due_days, cs.assigned_staff, auth.uid()) on conflict do nothing; if found then n := n + 1; end if; continue; end if; step := case cs.frequency when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' when 'half_yearly' then interval '6 months' else interval '1 year' end; ps := date_trunc('month', cs.start_date)::date; while ps <= _upto and (cs.end_date is null or ps <= cs.end_date) loop pe := (ps + step - interval '1 day')::date; lbl := case cs.frequency when 'monthly' then to_char(ps,'Mon YYYY') when 'yearly' then 'FY ' || to_char(ps,'YYYY') else to_char(ps,'Mon YYYY') || ' – ' || to_char(pe,'Mon YYYY') end; insert into public.jobs(client_id, service_id, client_service_id, title, period_start, period_end, fee, due_date, assigned_staff, created_by) values (cs.client_id, cs.service_id, cs.id, svc.name || ' – ' || lbl, ps, pe, cs.agreed_fee, pe + cs.due_days, cs.assigned_staff, auth.uid()) on conflict do nothing; if found then n := n + 1; end if; ps := (ps + step)::date; end loop; end loop; return n; end $$;
create or replace function public.reverse_payment(_payment_id uuid, _reason text) returns void language plpgsql security definer set search_path=public as $$ declare r record; begin if not public.has_capability('payments','edit') then raise exception 'Not authorised'; end if; perform public.firm_guard('payments', _payment_id); if coalesce(trim(_reason),'') = '' then raise exception 'Reason is required'; end if; if exists(select 1 from public.payments where id=_payment_id and status='reversed') then raise exception 'Already reversed'; end if; update public.payments set status='reversed' where id=_payment_id; for r in select id from public.payment_allocations where payment_id=_payment_id and not reversed loop update public.payment_allocations set reversed=true, reversed_at=now() where id=r.id; end loop; insert into public.payment_reversals(payment_id, reason, reversed_by) values (_payment_id, _reason, auth.uid()); perform public.recalc_payment(_payment_id); end $$;
create or replace function public.reverse_allocation(_allocation_id uuid, _reason text) returns void language plpgsql security definer set search_path=public as $$ begin if not public.has_capability('payments','edit') then raise exception 'Not authorised'; end if; perform public.firm_guard('payment_allocations', _allocation_id); update public.payment_allocations set reversed=true, reversed_at=now() where id=_allocation_id and not reversed; insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(),'allocation_reversed','payment_allocations',_allocation_id::text,_reason); end $$;
do $$ begin if to_regclass('public.expenses') is not null then execute $f$ create or replace function public.delete_expense(_expense_id uuid, _reason text) returns void language plpgsql security definer set search_path=public as $b$ begin if not public.has_capability('expenses','delete') then raise exception 'Not authorised'; end if; if coalesce(btrim(_reason),'')='' then raise exception 'Reason is required'; end if; perform public.firm_guard('expenses', _expense_id); delete from public.expenses where id=_expense_id; insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(),'expense_deleted','expenses',_expense_id::text,_reason); end $b$ $f$; end if; end $$;
create or replace function public.create_firm(_name text, _owner_email text, _phone text, _city text, _logo_url text) returns uuid language plpgsql security definer set search_path=public as $$ declare fid uuid; begin if not public.is_super_admin() then raise exception 'Not authorised'; end if; if coalesce(trim(_name),'')='' then raise exception 'Firm name is required'; end if; insert into public.firms(name, owner_email, phone, city, logo_url) values (trim(_name), lower(trim(_owner_email)), _phone, _city, _logo_url) returning id into fid; insert into public.settings(firm_id, firm_name, phone, email) values (fid, trim(_name), _phone, lower(trim(_owner_email))); perform public.seed_role_permissions(fid); return fid; end $$;
grant delete on public.clients, public.services, public.jobs, public.client_services to authenticated;
do $$ begin if to_regclass('public.recurring_payments') is not null then execute 'grant delete on public.recurring_payments to authenticated'; end if; end $$;
do $$ begin if to_regclass('public.expenses') is not null then execute 'revoke delete on public.expenses from authenticated'; end if; if to_regclass('public.job_clearing') is not null then execute 'revoke delete on public.job_clearing from authenticated'; end if; end $$;
revoke delete on public.payments, public.invoices, public.invoice_items, public.discounts, public.payment_allocations, public.payment_reversals from authenticated;
revoke execute on function public.permission_defaults(public.app_role, text), public.effective_permissions(uuid, public.app_role, text), public.seed_role_permissions(uuid) from public, anon;
grant all on public.role_permissions to service_role;
/* has_capability must stay executable for authenticated: RLS policy expressions are evaluated with the querying user's privileges, so revoking it would make every module error out rather than merely stay locked. */
grant execute on function public.payments_list(), public.jobs_list(), public.recurring_list(), public.client_services_list(uuid), public.client_jobs_list(uuid), public.client_payments_list(uuid), public.has_capability(text, text), public.my_permissions(), public.permission_matrix(), public.set_role_permission(public.app_role, text, boolean, boolean, boolean, boolean, boolean), public.reset_role_permissions(), public.has_role(uuid, public.app_role), public.my_roles(), public.client_lookup(), public.update_job_status(uuid, text, text), public.generate_recurring_jobs(date), public.reverse_payment(uuid, text), public.reverse_allocation(uuid, text) to authenticated;
do $$ begin if to_regclass('public.expenses') is not null then execute 'grant execute on function public.delete_expense(uuid, text) to authenticated'; end if; end $$;



-- ==============================================================================
-- Migration 14 of 25: 20261006150000_doc_numbering.sql
-- ==============================================================================

/* ==========================================================================
   Document numbering: JOB0001-1026 / REC0001-1026 / INV0001-1026

   Replaces the column defaults ('JB' || lpad(job_seq,5,'0')) and the
   intermediate phase-1 hyphenated defaults. Numbers are per firm, per kind,
   per MMYY period, and restart at 0001 every month, so INV00011026 reads as
   "first invoice of October 2026" rather than a running global counter.

   The MMYY suffix comes from the document's own business date (invoice_date,
   payment_date, created_at), not the row insert time, so a back-dated invoice
   carries the month it is dated in.

   Generated in a before insert trigger rather than a column default because a
   default cannot read another column on the row, and because the old defaults
   have to be dropped anyway or they would fill the code before the trigger
   ever sees it.

   Paste-safe: no line comments and no blank lines, because the Supabase SQL
   editor strips newlines and would otherwise swallow the rest of the script.
   ========================================================================== */
create table if not exists public.doc_counters (
  firm_id uuid not null references public.firms(id) on delete cascade,
  kind text not null check (kind in ('INV','REC','JOB')),
  period text not null check (period ~ '^[0-9]{4}$'),
  last_no int not null default 0,
  primary key (firm_id, kind, period)
);
alter table public.doc_counters enable row level security;
revoke all on public.doc_counters from anon, authenticated;
grant all on public.doc_counters to service_role;
create or replace function public.next_doc_code(_kind text, _on date) returns text language plpgsql security definer set search_path=public as $$
declare v_period text; v_no int;
begin
  if _kind not in ('INV','REC','JOB') then raise exception 'Unknown document kind: %', _kind; end if;
  v_period := to_char(coalesce(_on, current_date), 'MMYY');
  insert into public.doc_counters as c (firm_id, kind, period, last_no) values (public.current_firm_id(), _kind, v_period, 1)
  on conflict (firm_id, kind, period) do update set last_no = c.last_no + 1  returning last_no into v_no;
  return _kind || lpad(v_no::text, 4, '0') || '-' || v_period;
end $$;
create or replace function public.stamp_job_doc_no() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.job_code is null then new.job_code := public.next_doc_code('JOB', coalesce(new.created_at::date, current_date)); end if;
  return new;
end $$;
create or replace function public.stamp_invoice_doc_no() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.invoice_no is null then new.invoice_no := public.next_doc_code('INV', coalesce(new.invoice_date, current_date)); end if;
  return new;
end $$;
create or replace function public.stamp_payment_doc_no() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.payment_code is null then new.payment_code := public.next_doc_code('REC', coalesce(new.payment_date, current_date)); end if;
  return new;
end $$;
alter table public.jobs alter column job_code drop default;
alter table public.invoices alter column invoice_no drop default;
alter table public.payments alter column payment_code drop default;
drop trigger if exists jobs_stamp_doc_no on public.jobs;
create trigger jobs_stamp_doc_no before insert on public.jobs for each row execute function public.stamp_job_doc_no();
drop trigger if exists invoices_stamp_doc_no on public.invoices;
create trigger invoices_stamp_doc_no before insert on public.invoices for each row execute function public.stamp_invoice_doc_no();
drop trigger if exists payments_stamp_doc_no on public.payments;
create trigger payments_stamp_doc_no before insert on public.payments for each row execute function public.stamp_payment_doc_no();
do $$
declare r record; c record;
begin
  for r in select * from (values ('jobs','job_code'),('invoices','invoice_no'),('payments','payment_code')) as v(tbl,col) loop
    for c in select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = format('public.%I', r.tbl)::regclass and contype = 'u' loop
      if c.def = format('UNIQUE (%s)', r.col) then execute format('alter table public.%I drop constraint %I', r.tbl, c.conname); end if;
    end loop;
    execute format('create unique index %I on public.%I (firm_id, %I)', r.tbl || '_' || r.col || '_firm_uniq', r.tbl, r.col);
  end loop;
end $$;



-- ==============================================================================
-- Migration 15 of 25: 20261006160000_sequential_master_codes.sql
-- ==============================================================================

/* ==========================================================================
   Sequential master numbering: clients and services count 1, 2, 3...

   Both codes keep their CL0001 / SV001 shape; what changes is where the numbers
   come from. They were previously drawn from a single global sequence per table,
   which produced two problems:

   1. The numbers were not contiguous. Deleting a client left a gap, and the
      next client was CL0028 after CL0020, which reads as random rather than
      sequential to anyone looking at the list.
   2. The sequence was global across all firms, so a second firm started at
      CL0029 and two firms could never both hold "CL0001".

   Numbers are now per firm, allocated by next_master_code() from doc_counters,
   which the document-numbering migration already introduced. Clients and
   services use the sentinel period 'ALL' because they never reset on a period
   boundary the way an invoice number does; only the firm and kind separate them.

   Existing rows are renumbered 1..N per firm in creation order, so the sequence
   is contiguous from the start rather than starting again after the old codes.
   This is safe because nothing references these columns by value: client_code
   and service_code are display labels, and every foreign key points at the uuid.
   Import/export reads client_code only to map a spreadsheet row back to a uuid,
   and it looks the value up at export time rather than storing it.

   The global UNIQUE constraints become per-firm composite indexes, matching what
   jobs/invoices/payments already do.

   Paste-safe: no line comments and no blank lines, because the Supabase SQL
   editor strips newlines and would otherwise swallow the rest of the script.
   ========================================================================== */
alter table public.doc_counters drop constraint if exists doc_counters_kind_check;
alter table public.doc_counters add constraint doc_counters_kind_check check (kind in ('INV','REC','JOB','CLI','SVC'));
alter table public.doc_counters drop constraint if exists doc_counters_period_check;
alter table public.doc_counters add constraint doc_counters_period_check check (period ~ '^[0-9]{4}$' or period = 'ALL');
create or replace function public.next_master_code(_kind text) returns text language plpgsql security definer set search_path=public as $$
declare v_no int; v_prefix text; v_width int;
begin
  if _kind = 'CLI' then v_prefix := 'CL'; v_width := 4;
  elsif _kind = 'SVC' then v_prefix := 'SV'; v_width := 3;
  else raise exception 'Unknown master kind: %', _kind;
  end if;
  insert into public.doc_counters as c (firm_id, kind, period, last_no) values (public.current_firm_id(), _kind, 'ALL', 1)
  on conflict (firm_id, kind, period) do update set last_no = c.last_no + 1 returning last_no into v_no;
  return v_prefix || lpad(v_no::text, v_width, '0');
end $$;
revoke execute on function public.next_master_code(text) from public, anon, authenticated;
/* One function serves both tables. The row is read as jsonb and written back,
   because plpgsql resolves new.<column> against the live row type: naming
   service_code while the trigger fires on clients raises "record new has no
   field service_code" at runtime. */
create or replace function public.stamp_master_code() returns trigger language plpgsql security definer set search_path=public as $$
declare v_code text; v_col text; v_kind text;
begin
  if tg_table_name = 'clients' then v_col := 'client_code'; v_kind := 'CLI';
  elsif tg_table_name = 'services' then v_col := 'service_code'; v_kind := 'SVC';
  else return new;
  end if;
  if coalesce(btrim(to_jsonb(new)->>v_col), '') = '' then
    v_code := public.next_master_code(v_kind);
    new := jsonb_populate_record(new, jsonb_build_object(v_col, v_code));
  end if;
  return new;
end $$;
alter table public.clients alter column client_code drop default;
alter table public.services alter column service_code drop default;
drop trigger if exists clients_stamp_master_code on public.clients;
create trigger clients_stamp_master_code before insert on public.clients for each row execute function public.stamp_master_code();
drop trigger if exists services_stamp_master_code on public.services;
create trigger services_stamp_master_code before insert on public.services for each row execute function public.stamp_master_code();
drop index if exists public.clients_client_code_firm_uniq;
drop index if exists public.services_service_code_firm_uniq;
do $$ declare c record; begin for c in select conname from pg_constraint where conrelid = 'public.clients'::regclass and contype = 'u' loop execute format('alter table public.clients drop constraint %I', c.conname); end loop; for c in select conname from pg_constraint where conrelid = 'public.services'::regclass and contype = 'u' loop execute format('alter table public.services drop constraint %I', c.conname); end loop; execute 'create unique index clients_client_code_firm_uniq on public.clients(firm_id, client_code)'; execute 'create unique index services_service_code_firm_uniq on public.services(firm_id, service_code)'; end $$;
/* Renumber to CL0001.. / SV001.. per firm in creation order, so the sequence is
   contiguous from the start instead of continuing from the old global numbers. */
with ranked as (select id, row_number() over (partition by firm_id order by created_at, id)::int as rn from public.clients)
update public.clients c set client_code = 'CL' || lpad(ranked.rn::text, 4, '0') from ranked where c.id = ranked.id;
with ranked as (select id, row_number() over (partition by firm_id order by created_at, id)::int as rn from public.services)
update public.services s set service_code = 'SV' || lpad(ranked.rn::text, 3, '0') from ranked where s.id = ranked.id;
insert into public.doc_counters (firm_id, kind, period, last_no)
select f.id, k.kind, 'ALL',
  case k.kind when 'CLI' then coalesce((select count(*) from public.clients c where c.firm_id=f.id), 0)
              else coalesce((select count(*) from public.services s where s.firm_id=f.id), 0) end
from public.firms f
cross join (values ('CLI'),('SVC')) k(kind)
on conflict (firm_id, kind, period) do update set last_no = excluded.last_no;



-- ==============================================================================
-- Migration 16 of 25: 20261006170000_expenses_module.sql
-- ==============================================================================

/* ==========================================================================
   Expenses module: one ledger for every kind of money the firm leaves, and a
   read-only view of it on the job's Payment Clearing screen.

   Why a "kind" column: the two cases behave differently and mixing them in one
   undifferentiated list makes the total meaningless. An overhead (rent,
   stationery) is the firm's own cost. A "tax" row is TDS deducted from a client
   and remitted to the government on their behalf, so it leaves the bank but was
   never the firm's money. A reimbursement is money paid out on a client's
   behalf and rebilled to them. Only overhead is a true cost, so the reporting
   groups by kind rather than pretending the sum is a single number.

   Two rules this file is responsible for:

   1. Expenses answer to the permission matrix, not to the old fixed roles. The
      job-payment workflow migration created these policies before role_permissions
      existed, so without this file the Expenses page would ignore the Admin's
      choices entirely.

   2. Expense amounts are masked server-side by expenses_list(), for the same
      reason payments and jobs are: RLS cannot hide a column, so a role that may
      see the record would otherwise still receive every amount.

   Deletion goes through delete_expense(id, reason) rather than a plain DELETE,
   because nothing references an expense row and no other table would leave a
   trace of its removal. A reason is mandatory and lands in audit_logs.

   Paste-safe: no line comments and no blank lines, because the Supabase SQL
   editor strips newlines and would otherwise swallow the rest of the script.
   ========================================================================== */
alter table public.expenses add column if not exists kind text not null default 'overhead';
alter table public.expenses drop constraint if exists expenses_kind_check;
alter table public.expenses add constraint expenses_kind_check check (kind in ('overhead','tax','reimbursement'));
create index if not exists expenses_job_idx2 on public.expenses(job_id);
create index if not exists expenses_kind_idx on public.expenses(firm_id, kind, expense_date desc);
drop policy if exists "expenses read" on public.expenses;
drop policy if exists "expenses write" on public.expenses;
create policy "expenses read" on public.expenses for select to authenticated using (public.has_capability('expenses','view'));
create policy "expenses ins" on public.expenses for insert to authenticated with check (public.has_capability('expenses','create'));
create policy "expenses upd" on public.expenses for update to authenticated using (public.has_capability('expenses','edit')) with check (public.has_capability('expenses','edit'));
/* A direct DELETE is never granted; the RPC below is the only route, so the
   mandatory reason cannot be bypassed. */
revoke delete on public.expenses from authenticated;
drop policy if exists "recurring_payments read" on public.recurring_payments;
drop policy if exists "recurring_payments write" on public.recurring_payments;
create policy "recurring_payments read" on public.recurring_payments for select to authenticated using (public.has_capability('recurring','view'));
create policy "recurring_payments ins" on public.recurring_payments for insert to authenticated with check (public.has_capability('recurring','create'));
create policy "recurring_payments upd" on public.recurring_payments for update to authenticated using (public.has_capability('recurring','edit')) with check (public.has_capability('recurring','edit'));
create or replace function public.expenses_list() returns table(id uuid, kind text, expense_date date, category text, description text, amount numeric, mode text, reference text, paid_to text, notes text, client_id uuid, client_name text, job_id uuid, job_code text, created_at timestamptz) language sql stable security definer set search_path=public as $$ select e.id, e.kind, e.expense_date, e.category, e.description, case when public.has_capability('expenses','amounts') then e.amount end, e.mode, e.reference, e.paid_to, e.notes, e.client_id, c.name, e.job_id, j.job_code, e.created_at from public.expenses e left join public.clients c on c.id=e.client_id left join public.jobs j on j.id=e.job_id where e.firm_id=public.current_firm_id() and public.has_capability('expenses','view') order by e.expense_date desc, e.created_at desc $$;
/* Read-only projection for the Payment Clearing screen. It reports what has been
   recorded against the job but deliberately does not feed job_clearing, so an
   expense can never move final_amount or the invoice total behind the user's back. */
create or replace function public.expenses_for_job(_job_id uuid) returns table(id uuid, kind text, category text, description text, amount numeric, mode text, paid_to text, reference text, expense_date date) language sql stable security definer set search_path=public as $$ select e.id, e.kind, e.category, e.description, case when public.has_capability('expenses','amounts') then e.amount end, e.mode, e.paid_to, e.reference, e.expense_date from public.expenses e where e.job_id=_job_id and e.firm_id=public.current_firm_id() and public.has_capability('expenses','view') order by e.expense_date desc $$;
create or replace function public.delete_expense(_expense_id uuid, _reason text) returns void language plpgsql security definer set search_path=public as $$ begin if not public.has_capability('expenses','delete') then raise exception 'Not authorised'; end if; if coalesce(btrim(_reason),'')='' then raise exception 'Reason is required'; end if; perform public.firm_guard('expenses', _expense_id); delete from public.expenses where id=_expense_id; insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(),'expense_deleted','expenses',_expense_id::text,_reason); end $$;
grant execute on function public.expenses_list(), public.expenses_for_job(uuid), public.delete_expense(uuid, text) to authenticated;



-- ==============================================================================
-- Migration 17 of 25: 20261006180000_fix_stamp_doc_no.sql
-- ==============================================================================

/* ==========================================================================
   Fix: Split shared stamp_doc_no trigger into separate per-table functions.
   PostgreSQL PL/pgSQL validates column references against the triggering table's
   row type, so referencing NEW.invoice_no inside a trigger attached to public.jobs
   raises "record 'new' has no field 'invoice_no'".
   ========================================================================== */

create or replace function public.stamp_job_doc_no() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.job_code is null then
    new.job_code := public.next_doc_code('JOB', coalesce(new.created_at::date, current_date));
  end if;
  return new;
end $$;

create or replace function public.stamp_invoice_doc_no() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.invoice_no is null then
    new.invoice_no := public.next_doc_code('INV', coalesce(new.invoice_date, current_date));
  end if;
  return new;
end $$;

create or replace function public.stamp_payment_doc_no() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.payment_code is null then
    new.payment_code := public.next_doc_code('REC', coalesce(new.payment_date, current_date));
  end if;
  return new;
end $$;

drop trigger if exists jobs_stamp_doc_no on public.jobs;
create trigger jobs_stamp_doc_no before insert on public.jobs for each row execute function public.stamp_job_doc_no();

drop trigger if exists invoices_stamp_doc_no on public.invoices;
create trigger invoices_stamp_doc_no before insert on public.invoices for each row execute function public.stamp_invoice_doc_no();

drop trigger if exists payments_stamp_doc_no on public.payments;
create trigger payments_stamp_doc_no before insert on public.payments for each row execute function public.stamp_payment_doc_no();



-- ==============================================================================
-- Migration 18 of 25: 20261007134500_relax_expense_description.sql
-- ==============================================================================

-- Relax expense description requirement
alter table public.expenses alter column description drop not null;
alter table public.expenses alter column description set default '';



-- ==============================================================================
-- Migration 19 of 25: 20261007140000_client_level_payments.sql
-- ==============================================================================

-- Allow lump-sum client level payments (job_id optional on payments)
alter table public.payments alter column job_id drop not null;

-- Update job_workflow to recognize client-level payments for a job
create or replace function public.job_workflow(_job_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare j record; c record; inv record; npay int; nopen numeric; blocked text; avail bool;
begin
  select * into j from public.jobs where id=_job_id;
  if j.id is null then raise exception 'Job not found'; end if;
  perform public.firm_guard('jobs', _job_id);
  select * into c from public.job_clearing where job_id=_job_id;
  select * into inv from public.invoices where job_id=_job_id and status<>'cancelled' limit 1;
  
  -- Count payments directly for this job OR general lump-sum payments from this client
  select count(*) into npay from public.payments where (job_id=_job_id or (client_id=j.client_id and job_id is null)) and status<>'reversed';
  select coalesce(sum(greatest(amount - allocated_amount, 0)),0) into nopen from public.payments where (job_id=_job_id or (client_id=j.client_id and job_id is null)) and status<>'reversed';
  
  blocked := null; avail := false;
  if inv.id is not null then
    avail := false; blocked := format('Invoice %s already exists for this job.', inv.invoice_no);
  elsif j.status = 'cancelled' then
    avail := false; blocked := 'Job is cancelled.';
  elsif j.status <> 'completed' then
    avail := false; blocked := 'Job must be completed before payment clearing.';
  elsif c.id is null or c.status = 'draft' then
    avail := false; blocked := 'Invoice cannot be created until payment clearing is completed.';
  elsif c.status = 'cleared' then
    avail := false; blocked := 'Invoice cannot be created until payment is squared off.';
  else
    avail := true; blocked := null;
  end if;
  return jsonb_build_object(
    'job_id', j.id, 'job_code', j.job_code, 'job_status', j.status,
    'job_completed_at', j.completed_at, 'due_date', j.due_date,
    'overdue', (j.due_date is not null and j.due_date < current_date and coalesce(c.status,'') <> 'squared_off' and j.status <> 'cancelled'),
    'gross_fee', j.fee, 'job_discount', j.discount, 'net_amount', j.net_amount,
    'advance', coalesce(c.advance,0), 'tds_tcs', coalesce(c.tds_tcs,0),
    'clearing_discount', coalesce(c.discount,0), 'other_deduction', coalesce(c.other_deduction,0), 'other_addition', coalesce(c.other_addition,0),
    'clearing_status', coalesce(c.status,'draft'), 'clearing_id', c.id,
    'cleared_at', c.cleared_at, 'squared_off_at', c.squared_off_at,
    'final_amount', coalesce(c.final_amount, 0),
    'payment_count', npay, 'payment_unallocated', nopen,
    'invoice_id', inv.id, 'invoice_no', inv.invoice_no, 'invoice_status', inv.status,
    'invoice_available', avail, 'blocked_reason', blocked,
    'stages', jsonb_build_object(
      'created', true,
      'completed', (j.status = 'completed'),
      'payment_created', (npay > 0 or coalesce(c.advance, 0) > 0),
      'payment_cleared', (c.status in ('cleared','squared_off')),
      'squared_off', (c.status = 'squared_off'),
      'invoiced', (inv.id is not null)
    )
  );
end $$;

-- Update create_invoice_for_job to allow client-level payments
create or replace function public.create_invoice_for_job(_job_id uuid, _payment_id uuid, _invoice_date date, _due_date date, _tax_rate numeric, _notes text, _extra_desc text, _extra_amount numeric) returns uuid language plpgsql security definer set search_path=public as $$
declare j record; c record; inv_id uuid; sub numeric; tax numeric; tot numeric;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  perform public.assert_invoice_eligible(_job_id);
  select * into j from public.jobs where id = _job_id;
  select * into c from public.job_clearing where job_id = _job_id;
  if _payment_id is not null then
    perform public.firm_guard('payments', _payment_id);
    if not exists(select 1 from public.payments where id = _payment_id and client_id = j.client_id) then
      raise exception 'Payment does not belong to client of job %', j.job_code;
    end if;
  end if;
  sub := c.final_amount + coalesce(_extra_amount, 0);
  if sub <= 0 then raise exception 'Invoice must have at least one item'; end if;
  tax := round(sub * coalesce(_tax_rate, 0) / 100, 2);
  tot := sub + tax;
  insert into public.invoices(client_id, job_id, payment_id, invoice_date, due_date, notes, created_by) values (j.client_id, _job_id, _payment_id, coalesce(_invoice_date, current_date), coalesce(_due_date, current_date + 15), _notes, auth.uid()) returning id into inv_id;
  insert into public.invoice_items(invoice_id, job_id, description, amount) values (inv_id, _job_id, j.title, c.final_amount);
  if coalesce(_extra_amount,0) > 0 then
    insert into public.invoice_items(invoice_id, description, amount) values (inv_id, coalesce(nullif(_extra_desc,''),'Professional fees'), _extra_amount);
  end if;
  update public.invoices set subtotal=sub, tax_rate=coalesce(_tax_rate,0), tax_amount=tax, total=tot, description=(select string_agg(description, ', ') from public.invoice_items where invoice_id=inv_id) where id=inv_id;
  update public.jobs set financial_status='invoiced' where id=_job_id;
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(), 'invoice_created', 'invoices', inv_id, j.job_code);
  return inv_id;
end $$;



-- ==============================================================================
-- Migration 20 of 25: 20261007142000_fix_invoice_generation_and_advance.sql
-- ==============================================================================

-- Fix invoice generation when advance covers full job fee and link advance allocation
create or replace function public.create_invoice_for_job(
  _job_id uuid, 
  _payment_id uuid, 
  _invoice_date date, 
  _due_date date, 
  _tax_rate numeric, 
  _notes text, 
  _extra_desc text, 
  _extra_amount numeric
) returns uuid language plpgsql security definer set search_path=public as $$
declare 
  j record; 
  c record; 
  inv_id uuid; 
  billable_sub numeric; 
  tax numeric; 
  tot numeric;
  alloc_amt numeric;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  perform public.assert_invoice_eligible(_job_id);
  select * into j from public.jobs where id = _job_id;
  select * into c from public.job_clearing where job_id = _job_id;

  if _payment_id is not null then
    perform public.firm_guard('payments', _payment_id);
    if not exists(select 1 from public.payments where id = _payment_id and client_id = j.client_id) then
      raise exception 'Payment does not belong to client of job %', j.job_code;
    end if;
  end if;

  -- The taxable billable fee is job fee minus discounts + additions
  billable_sub := coalesce(j.fee, 0) - coalesce(j.discount, 0) - coalesce(c.discount, 0) + coalesce(c.other_addition, 0) + coalesce(_extra_amount, 0);
  if billable_sub <= 0 then 
    billable_sub := coalesce(j.fee, 0);
  end if;
  if billable_sub <= 0 then 
    raise exception 'Invoice must have a billable amount greater than zero'; 
  end if;

  tax := round(billable_sub * coalesce(_tax_rate, 0) / 100, 2);
  tot := billable_sub + tax;

  insert into public.invoices(client_id, job_id, payment_id, invoice_date, due_date, notes, created_by)
  values (j.client_id, _job_id, _payment_id, coalesce(_invoice_date, current_date), coalesce(_due_date, current_date + 15), _notes, auth.uid())
  returning id into inv_id;

  insert into public.invoice_items(invoice_id, job_id, description, amount)
  values (inv_id, _job_id, j.title, billable_sub - coalesce(_extra_amount, 0));

  if coalesce(_extra_amount, 0) > 0 then
    insert into public.invoice_items(invoice_id, description, amount)
    values (inv_id, coalesce(nullif(_extra_desc, ''), 'Professional charges / Reimbursable expenses'), _extra_amount);
  end if;

  update public.invoices 
  set subtotal = billable_sub, 
      tax_rate = coalesce(_tax_rate, 0), 
      tax_amount = tax, 
      total = tot, 
      description = (select string_agg(description, ', ') from public.invoice_items where invoice_id = inv_id) 
  where id = inv_id;

  update public.jobs set financial_status = 'invoiced' where id = _job_id;
  insert into public.audit_logs(user_id, action, module, record_id, reason) 
  values (auth.uid(), 'invoice_created', 'invoices', inv_id, j.job_code);

  -- If payment was linked or advance was recorded, auto-allocate to this invoice
  if _payment_id is not null then
    alloc_amt := least(coalesce(c.advance, tot), tot);
    if alloc_amt > 0 then
      insert into public.payment_allocations(payment_id, invoice_id, amount)
      values (_payment_id, inv_id, alloc_amt)
      on conflict do nothing;
      perform public.recalc_invoice(inv_id);
      perform public.recalc_payment(_payment_id);
    end if;
  end if;

  return inv_id;
end $$;



-- ==============================================================================
-- Migration 21 of 25: 20261007142500_auto_invoice_on_square_off.sql
-- ==============================================================================

-- Allow re-saving job clearing as long as an invoice is not yet created
create or replace function public.save_job_clearing(
  _job_id uuid, 
  _advance numeric, 
  _tds_tcs numeric, 
  _discount numeric, 
  _other_deduction numeric, 
  _other_addition numeric, 
  _notes text
) returns uuid language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  if exists(select 1 from public.invoices where job_id=_job_id and status<>'cancelled') then 
    raise exception 'Invoice already exists for this job. Cancel the invoice before editing clearing.'; 
  end if;
  insert into public.job_clearing(job_id, advance, tds_tcs, discount, other_deduction, other_addition, notes)
  values (_job_id, coalesce(_advance,0), coalesce(_tds_tcs,0), coalesce(_discount,0), coalesce(_other_deduction,0), coalesce(_other_addition,0), _notes)
  on conflict (job_id) do update set 
    advance=excluded.advance, 
    tds_tcs=excluded.tds_tcs, 
    discount=excluded.discount, 
    other_deduction=excluded.other_deduction, 
    other_addition=excluded.other_addition, 
    notes=excluded.notes
  returning id into cid;
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(), 'clearing_saved', 'job_clearing', cid, _job_id::text);
  return cid;
end $$;

-- Allow squaring off without erroring if already squared off
create or replace function public.sq_off_job_clearing(_job_id uuid, _notes text) returns void language plpgsql security definer set search_path=public as $$
declare cid uuid; jc record;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  select * into jc from public.job_clearing where job_id=_job_id;
  if jc.id is null then raise exception 'Save the clearing details before squaring off.'; end if;
  update public.job_clearing set status='squared_off', squared_off_at=coalesce(squared_off_at, now()), squared_off_by=coalesce(squared_off_by, auth.uid()), notes=coalesce(_notes, notes) where id=jc.id returning id into cid;
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(), 'payment_squared_off', 'job_clearing', cid, _job_id::text);
end $$;

-- Single Atomic RPC: Square off job and automatically generate invoice + allocate from client money jar
create or replace function public.square_off_and_invoice_job(
  _job_id uuid,
  _advance numeric,
  _tds_tcs numeric,
  _discount numeric,
  _other_deduction numeric,
  _other_addition numeric,
  _tax_rate numeric,
  _notes text
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  j record;
  c record;
  inv_id uuid;
  billable_sub numeric;
  tax numeric;
  tot numeric;
  pay_rec record;
  needed_adv numeric;
  alloc_amt numeric;
  cid uuid;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  select * into j from public.jobs where id = _job_id;
  if j.id is null then raise exception 'Job not found'; end if;

  -- 1. Upsert job_clearing record as squared_off
  insert into public.job_clearing(
    job_id, advance, tds_tcs, discount, other_deduction, other_addition, notes, status, cleared_at, cleared_by, squared_off_at, squared_off_by
  )
  values (
    _job_id, coalesce(_advance, 0), coalesce(_tds_tcs, 0), coalesce(_discount, 0),
    coalesce(_other_deduction, 0), coalesce(_other_addition, 0), _notes,
    'squared_off', now(), auth.uid(), now(), auth.uid()
  )
  on conflict (job_id) do update set
    advance = excluded.advance,
    tds_tcs = excluded.tds_tcs,
    discount = excluded.discount,
    other_deduction = excluded.other_deduction,
    other_addition = excluded.other_addition,
    notes = excluded.notes,
    status = 'squared_off',
    cleared_at = coalesce(job_clearing.cleared_at, now()),
    cleared_by = coalesce(job_clearing.cleared_by, auth.uid()),
    squared_off_at = coalesce(job_clearing.squared_off_at, now()),
    squared_off_by = coalesce(job_clearing.squared_off_by, auth.uid())
  returning id into cid;

  select * into c from public.job_clearing where id = cid;

  -- 2. Calculate Billable Subtotal
  billable_sub := coalesce(j.fee, 0) - coalesce(j.discount, 0) - coalesce(_discount, 0) + coalesce(_other_addition, 0);
  if billable_sub <= 0 then
    billable_sub := coalesce(j.fee, 0);
  end if;
  if billable_sub <= 0 then
    billable_sub := 1;
  end if;

  tax := round(billable_sub * coalesce(_tax_rate, 0) / 100, 2);
  tot := billable_sub + tax;

  -- 3. Create Invoice automatically
  insert into public.invoices(client_id, job_id, invoice_date, due_date, notes, created_by)
  values (j.client_id, _job_id, current_date, current_date + 15, _notes, auth.uid())
  returning id into inv_id;

  insert into public.invoice_items(invoice_id, job_id, description, amount)
  values (inv_id, _job_id, j.title, billable_sub);

  update public.invoices 
  set subtotal = billable_sub, 
      tax_rate = coalesce(_tax_rate, 0), 
      tax_amount = tax, 
      total = tot, 
      description = (select string_agg(description, ', ') from public.invoice_items where invoice_id = inv_id) 
  where id = inv_id;

  update public.jobs set financial_status = 'invoiced' where id = _job_id;
  insert into public.audit_logs(user_id, action, module, record_id, reason) 
  values (auth.uid(), 'invoice_auto_generated_on_square_off', 'invoices', inv_id, j.job_code);

  -- 4. Auto-allocate advance payment from Money Jar to this invoice & update payment allocated amounts
  -- If _advance is > 0 use it; otherwise use tot if client has money in jar
  needed_adv := case when coalesce(_advance, 0) > 0 then least(_advance, tot) else tot end;
  if needed_adv > 0 then
    for pay_rec in 
      select id, amount, allocated_amount, greatest(0, amount - allocated_amount) as avail_amount 
      from public.payments 
      where client_id = j.client_id 
        and status <> 'reversed' 
        and (amount - allocated_amount) > 0 
      order by payment_date asc, created_at asc
    loop
      alloc_amt := least(needed_adv, pay_rec.avail_amount);
      if alloc_amt > 0 then
        insert into public.payment_allocations(payment_id, invoice_id, amount, allocated_by)
        values (pay_rec.id, inv_id, alloc_amt, auth.uid());
        
        needed_adv := needed_adv - alloc_amt;
        exit when needed_adv <= 0;
      end if;
    end loop;
  end if;

  return inv_id;
end $$;

grant execute on function public.square_off_and_invoice_job(uuid, numeric, numeric, numeric, numeric, numeric, numeric, text) to authenticated;

-- Helper RPC: Allocate available client money jar to any existing invoice
create or replace function public.allocate_client_jar_to_invoice(_invoice_id uuid) returns numeric language plpgsql security definer set search_path=public as $$
declare
  inv record;
  pay_rec record;
  needed numeric;
  alloc_amt numeric;
  total_allocated numeric := 0;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('invoices', _invoice_id);
  select * into inv from public.invoices where id = _invoice_id;
  if inv.id is null then raise exception 'Invoice not found'; end if;
  if inv.status in ('cancelled','draft','paid') then return 0; end if;

  needed := coalesce(inv.outstanding, inv.total - coalesce(inv.amount_paid, 0));
  if needed <= 0 then return 0; end if;

  for pay_rec in 
    select id, amount, allocated_amount, greatest(0, amount - allocated_amount) as avail_amount 
    from public.payments 
    where client_id = inv.client_id 
      and status <> 'reversed' 
      and (amount - allocated_amount) > 0 
    order by payment_date asc, created_at asc
  loop
    alloc_amt := least(needed, pay_rec.avail_amount);
    if alloc_amt > 0 then
      insert into public.payment_allocations(payment_id, invoice_id, amount, allocated_by)
      values (pay_rec.id, inv.id, alloc_amt, auth.uid());
      
      needed := needed - alloc_amt;
      total_allocated := total_allocated + alloc_amt;
      exit when needed <= 0;
    end if;
  end loop;

  return total_allocated;
end $$;

grant execute on function public.allocate_client_jar_to_invoice(uuid) to authenticated;

-- Update create_invoice_for_job to also allocate advance from client money jar
create or replace function public.create_invoice_for_job(
  _job_id uuid,
  _payment_id uuid,
  _invoice_date date,
  _due_date date,
  _tax_rate numeric,
  _notes text,
  _extra_desc text,
  _extra_amount numeric
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  j record;
  c record;
  inv_id uuid;
  sub numeric;
  tax numeric;
  tot numeric;
  needed_adv numeric;
  pay_rec record;
  alloc_amt numeric;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  perform public.assert_invoice_eligible(_job_id);
  select * into j from public.jobs where id = _job_id;
  select * into c from public.job_clearing where job_id = _job_id;
  
  sub := coalesce(j.fee, 0) - coalesce(j.discount, 0) - coalesce(c.discount, 0) + coalesce(c.other_addition, 0) + coalesce(_extra_amount, 0);
  if sub <= 0 then
    sub := coalesce(c.final_amount, 0) + coalesce(_extra_amount, 0);
  end if;
  if sub <= 0 then
    sub := coalesce(j.fee, 1);
  end if;
  
  tax := round(sub * coalesce(_tax_rate, 0) / 100, 2);
  tot := sub + tax;

  insert into public.invoices(client_id, job_id, payment_id, invoice_date, due_date, notes, created_by)
  values (j.client_id, _job_id, _payment_id, coalesce(_invoice_date, current_date), coalesce(_due_date, current_date + 15), _notes, auth.uid())
  returning id into inv_id;

  insert into public.invoice_items(invoice_id, job_id, description, amount)
  values (inv_id, _job_id, j.title, sub - coalesce(_extra_amount, 0));

  if coalesce(_extra_amount, 0) > 0 then
    insert into public.invoice_items(invoice_id, description, amount)
    values (inv_id, coalesce(nullif(_extra_desc, ''), 'Additional charges / expenses'), _extra_amount);
  end if;

  update public.invoices 
  set subtotal = sub, 
      tax_rate = coalesce(_tax_rate, 0), 
      tax_amount = tax, 
      total = tot, 
      description = (select string_agg(description, ', ') from public.invoice_items where invoice_id = inv_id) 
  where id = inv_id;

  update public.jobs set financial_status = 'invoiced' where id = _job_id;
  insert into public.audit_logs(user_id, action, module, record_id, reason) 
  values (auth.uid(), 'invoice_created', 'invoices', inv_id, j.job_code);

  -- Allocate from specific payment or client money jar
  needed_adv := case when coalesce(c.advance, 0) > 0 then least(c.advance, tot) else tot end;
  if needed_adv > 0 then
    if _payment_id is not null then
      select id, amount, allocated_amount, greatest(0, amount - allocated_amount) as avail_amount 
      into pay_rec 
      from public.payments 
      where id = _payment_id and status <> 'reversed';

      if pay_rec.id is not null and pay_rec.avail_amount > 0 then
        alloc_amt := least(needed_adv, pay_rec.avail_amount);
        insert into public.payment_allocations(payment_id, invoice_id, amount, allocated_by)
        values (pay_rec.id, inv_id, alloc_amt, auth.uid());
        needed_adv := needed_adv - alloc_amt;
      end if;
    end if;

    if needed_adv > 0 then
      for pay_rec in 
        select id, amount, allocated_amount, greatest(0, amount - allocated_amount) as avail_amount 
        from public.payments 
        where client_id = j.client_id 
          and status <> 'reversed' 
          and (amount - allocated_amount) > 0 
        order by payment_date asc, created_at asc
      loop
        alloc_amt := least(needed_adv, pay_rec.avail_amount);
        if alloc_amt > 0 then
          insert into public.payment_allocations(payment_id, invoice_id, amount, allocated_by)
          values (pay_rec.id, inv_id, alloc_amt, auth.uid());
          needed_adv := needed_adv - alloc_amt;
          exit when needed_adv <= 0;
        end if;
      end loop;
    end if;
  end if;

  return inv_id;
end $$;

grant execute on function public.create_invoice_for_job(uuid, uuid, date, date, numeric, text, text, numeric) to authenticated;



-- ==============================================================================
-- Migration 22 of 25: 20261007151000_security_advisor_hardening.sql
-- ==============================================================================

-- ==============================================================================
-- Supabase Security Advisor Hardening Migration
-- Resolves: 
-- 1. rls_disabled_in_public (Enables RLS on all public tables)
-- 2. sensitive_columns_exposed (Restricts anon/public access to sensitive tables)
-- 3. search_path & function execution security
-- ==============================================================================

-- 1. Enable RLS on all tables in public schema dynamically
do $$
declare
  t record;
begin
  for t in (
    select table_name 
    from information_schema.tables 
    where table_schema = 'public' 
      and table_type = 'BASE TABLE'
  ) loop
    execute format('alter table public.%I enable row level security;', t.table_name);
  end loop;
end $$;

-- 2. Revoke default public/anon read/write access from sensitive business & transaction tables
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- 3. Grant authenticated role standard access governed by RLS
grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Ensure financial tables have NO direct delete grants for any user (must go via RPCs)
revoke delete on public.payments from authenticated;
revoke delete on public.invoices from authenticated;
revoke delete on public.invoice_items from authenticated;
revoke delete on public.payment_allocations from authenticated;
revoke delete on public.payment_reversals from authenticated;
revoke delete on public.discounts from authenticated;

-- 4. Secure schema functions (Set explicit search_path and grant execute to authenticated)
grant execute on function public.is_manager() to authenticated;
grant execute on function public.is_finance() to authenticated;
grant execute on function public.is_staff_plus() to authenticated;
grant execute on function public.is_cashier() to authenticated;
grant execute on function public.has_capability(text, text) to authenticated;

-- 5. Add fallback catch-all deny policy for any table without explicit policy
do $$
declare
  t record;
begin
  for t in (
    select table_name 
    from information_schema.tables 
    where table_schema = 'public' 
      and table_type = 'BASE TABLE'
      and table_name not in (
        select tablename from pg_policies where schemaname = 'public'
      )
  ) loop
    -- Create default authenticated firm-isolation policy if none exists
    execute format('
      create policy "authenticated_firm_isolation_%I" on public.%I
      for all to authenticated
      using (firm_id = public.current_firm_id())
      with check (firm_id = public.current_firm_id());
    ', t.table_name, t.table_name);
  end loop;
end $$;



-- ==============================================================================
-- Migration 23 of 25: 20261007152000_invite_otp_support.sql
-- ==============================================================================

-- Add OTP support to firm_invites
alter table public.firm_invites add column if not exists otp_code text;
alter table public.firm_invites add column if not exists otp_expires_at timestamptz default (now() + interval '7 days');



-- ==============================================================================
-- Migration 24 of 25: 20261008130000_fix_recurring_jobs_generation.sql
-- ==============================================================================

-- ========================================================
-- Migration: Fix Recurring Jobs Generation & Populating
-- ========================================================

CREATE OR REPLACE FUNCTION public.generate_recurring_jobs_for_firm(_firm uuid, _upto date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  cs record;
  ps date;
  pe date;
  step interval;
  n int := 0;
  svc record;
  lbl text;
begin
  for cs in
    select cs.*
    from public.client_services cs
    where cs.status = 'active'
      and cs.firm_id = _firm
      and (cs.end_date is null or cs.end_date >= cs.start_date)
  loop
    select * into svc from public.services where id = cs.service_id;
    if svc.id is null then continue; end if;

    if cs.frequency = 'one_time' then
      if not exists (
        select 1 from public.jobs
        where client_service_id = cs.id
      ) then
        insert into public.jobs(
          firm_id,
          client_id,
          service_id,
          client_service_id,
          title,
          period_start,
          period_end,
          fee,
          discount,
          due_date,
          assigned_staff,
          created_by,
          auto_invoice,
          status,
          financial_status
        ) values (
          _firm,
          cs.client_id,
          cs.service_id,
          cs.id,
          svc.name,
          cs.start_date,
          cs.start_date,
          coalesce(cs.agreed_fee, 0),
          0,
          cs.start_date + coalesce(cs.due_days, 0),
          cs.assigned_staff,
          auth.uid(),
          coalesce(cs.auto_invoice, svc.auto_invoice, false),
          'pending',
          'open'
        );
        n := n + 1;
      end if;
      continue;
    end if;

    step := case cs.frequency
      when 'monthly' then interval '1 month'
      when 'quarterly' then interval '3 months'
      when 'half_yearly' then interval '6 months'
      else interval '1 year'
    end;

    ps := date_trunc('month', cs.start_date)::date;

    while ps <= _upto and (cs.end_date is null or ps <= cs.end_date) loop
      pe := (ps + step - interval '1 day')::date;
      lbl := case cs.frequency
        when 'monthly' then to_char(ps, 'Mon YYYY')
        when 'yearly' then 'FY ' || to_char(ps, 'YYYY')
        else to_char(ps, 'Mon YYYY') || ' – ' || to_char(pe, 'Mon YYYY')
      end;

      if not exists (
        select 1 from public.jobs
        where client_service_id = cs.id and period_start = ps
      ) then
        insert into public.jobs(
          firm_id,
          client_id,
          service_id,
          client_service_id,
          title,
          period_start,
          period_end,
          fee,
          discount,
          due_date,
          assigned_staff,
          created_by,
          auto_invoice,
          status,
          financial_status
        ) values (
          _firm,
          cs.client_id,
          cs.service_id,
          cs.id,
          svc.name || ' – ' || lbl,
          ps,
          pe,
          coalesce(cs.agreed_fee, 0),
          0,
          pe + coalesce(cs.due_days, 0),
          cs.assigned_staff,
          auth.uid(),
          coalesce(cs.auto_invoice, svc.auto_invoice, false),
          'pending',
          'open'
        );
        n := n + 1;
      end if;

      ps := (ps + step)::date;
    end loop;
  end loop;

  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.generate_recurring_jobs(_upto date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
begin
  if not (public.has_capability('recurring', 'edit') or public.is_manager() or public.is_finance()) then
    raise exception 'Not authorised';
  end if;
  return public.generate_recurring_jobs_for_firm(public.current_firm_id(), _upto);
end $function$;

GRANT EXECUTE ON FUNCTION public.generate_recurring_jobs(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_recurring_jobs_for_firm(uuid, date) TO service_role;



-- ==============================================================================
-- Migration 25 of 25: 20261009140000_multi_firm_and_recurring_tasks.sql
-- ==============================================================================

-- ========================================================
-- Migration: Multi-Firm Management, Recurring Jobs & Doc Numbering
-- ========================================================

-- 1. Make Primary Concerned Person mandatory in validation trigger
CREATE OR REPLACE FUNCTION public.validate_client_required() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
declare
  v_missing text;
begin
  v_missing := concat_ws(', ',
    case when btrim(coalesce(new.name, '')) = ''                 then 'Client Name' end,
    case when btrim(coalesce(new.client_type, '')) = ''           then 'Client Type' end,
    case when btrim(coalesce(new.address, '')) = ''               then 'Address' end,
    case when btrim(coalesce(new.mobile, '')) = ''                then 'Phone Number' end,
    case when btrim(coalesce(new.contact_person_name, '')) = ''   then 'Primary Concerned Person' end
  );
  if v_missing <> '' then
    raise exception 'Missing required field(s): %', v_missing using errcode = '23502';
  end if;
  return new;
end $$;

-- 2. Resilient Doc Numbering with explicit firm_id fallback
DROP FUNCTION IF EXISTS public.next_doc_code(text, date, uuid);
DROP FUNCTION IF EXISTS public.next_doc_code(text, date);

CREATE OR REPLACE FUNCTION public.next_doc_code(_kind text, _on date, _firm_id uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
declare
  v_period text;
  v_no int;
  v_firm_id uuid;
begin
  if _kind not in ('INV','REC','JOB') then
    raise exception 'Unknown document kind: %', _kind;
  end if;

  v_period := to_char(coalesce(_on, current_date), 'MMYY');
  v_firm_id := coalesce(
    _firm_id,
    public.current_firm_id(),
    (select firm_id from public.profiles where id = auth.uid()),
    (select id from public.firms where status = 'active' order by created_at limit 1)
  );

  if v_firm_id is null then
    raise exception 'Cannot generate doc code: No active firm found';
  end if;

  insert into public.doc_counters as c (firm_id, kind, period, last_no)
  values (v_firm_id, _kind, v_period, 1)
  on conflict (firm_id, kind, period) do update set last_no = c.last_no + 1
  returning last_no into v_no;

  return _kind || lpad(v_no::text, 4, '0') || '-' || v_period;
end $$;

CREATE OR REPLACE FUNCTION public.stamp_job_doc_no() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
begin
  if new.job_code is null then
    new.job_code := public.next_doc_code('JOB', coalesce(new.created_at::date, current_date), new.firm_id);
  end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.stamp_invoice_doc_no() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
begin
  if new.invoice_no is null then
    new.invoice_no := public.next_doc_code('INV', coalesce(new.invoice_date, current_date), new.firm_id);
  end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.stamp_payment_doc_no() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
begin
  if new.payment_code is null then
    new.payment_code := public.next_doc_code('REC', coalesce(new.payment_date, current_date), new.firm_id);
  end if;
  return new;
end $$;

-- 3. Automatic firm_id inheritance triggers for jobs and client_services
CREATE OR REPLACE FUNCTION public.stamp_client_service_firm() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
begin
  if new.firm_id is null then
    new.firm_id := coalesce(
      (select firm_id from public.clients where id = new.client_id),
      public.current_firm_id(),
      (select firm_id from public.profiles where id = auth.uid())
    );
  end if;
  return new;
end $$;

DROP TRIGGER IF EXISTS client_services_stamp_firm ON public.client_services;
CREATE TRIGGER client_services_stamp_firm BEFORE INSERT ON public.client_services
FOR EACH ROW EXECUTE FUNCTION public.stamp_client_service_firm();

CREATE OR REPLACE FUNCTION public.stamp_job_firm() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
begin
  if new.firm_id is null then
    new.firm_id := coalesce(
      (select firm_id from public.clients where id = new.client_id),
      public.current_firm_id(),
      (select firm_id from public.profiles where id = auth.uid())
    );
  end if;
  return new;
end $$;

DROP TRIGGER IF EXISTS jobs_stamp_firm ON public.jobs;
CREATE TRIGGER jobs_stamp_firm BEFORE INSERT ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.stamp_job_firm();

-- 4. Enhanced recurring jobs generator
DROP FUNCTION IF EXISTS public.generate_recurring_jobs_for_firm(uuid, date);
DROP FUNCTION IF EXISTS public.generate_recurring_jobs(date);
DROP FUNCTION IF EXISTS public.generate_recurring_jobs_all();

CREATE OR REPLACE FUNCTION public.generate_recurring_jobs_for_firm(_firm uuid, _upto date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  r_cs record;
  ps date;
  pe date;
  step interval;
  n int := 0;
  svc record;
  lbl text;
  target_upto date;
  target_firm uuid;
begin
  target_upto := coalesce(_upto, current_date);
  target_firm := coalesce(
    _firm,
    public.current_firm_id(),
    (select firm_id from public.profiles where id = auth.uid()),
    (select id from public.firms where status = 'active' order by created_at limit 1)
  );

  if target_firm is null then
    return 0;
  end if;

  for r_cs in
    select *
    from public.client_services
    where status = 'active'
      and (
        firm_id = target_firm
        or firm_id is null
        or coalesce(firm_id, (select c.firm_id from public.clients c where c.id = client_services.client_id)) = target_firm
      )
      and (end_date is null or end_date >= start_date)
  loop
    select * into svc from public.services where id = r_cs.service_id;
    if svc.id is null then continue; end if;

    if r_cs.frequency = 'one_time' then
      if not exists (
        select 1 from public.jobs
        where client_service_id = r_cs.id
      ) then
        insert into public.jobs(
          firm_id,
          client_id,
          service_id,
          client_service_id,
          title,
          period_start,
          period_end,
          fee,
          discount,
          due_date,
          assigned_staff,
          created_by,
          auto_invoice,
          status,
          financial_status
        ) values (
          coalesce(r_cs.firm_id, target_firm),
          r_cs.client_id,
          r_cs.service_id,
          r_cs.id,
          svc.name,
          r_cs.start_date,
          r_cs.start_date,
          coalesce(r_cs.agreed_fee, 0),
          0,
          r_cs.start_date + coalesce(r_cs.due_days, 0),
          r_cs.assigned_staff,
          coalesce(auth.uid(), r_cs.assigned_staff),
          coalesce(r_cs.auto_invoice, svc.auto_invoice, false),
          'pending',
          'open'
        )
        on conflict (client_service_id, period_start) do nothing;
        if found then n := n + 1; end if;
      end if;
      continue;
    end if;

    step := case r_cs.frequency
      when 'monthly' then interval '1 month'
      when 'quarterly' then interval '3 months'
      when 'half_yearly' then interval '6 months'
      else interval '1 year'
    end;

    ps := date_trunc('month', r_cs.start_date)::date;

    while ps <= target_upto and (r_cs.end_date is null or ps <= r_cs.end_date) loop
      pe := (ps + step - interval '1 day')::date;
      lbl := case r_cs.frequency
        when 'monthly' then to_char(ps, 'Mon YYYY')
        when 'yearly' then 'FY ' || to_char(ps, 'YYYY')
        else to_char(ps, 'Mon YYYY') || ' – ' || to_char(pe, 'Mon YYYY')
      end;

      if not exists (
        select 1 from public.jobs
        where client_service_id = r_cs.id and period_start = ps
      ) then
        insert into public.jobs(
          firm_id,
          client_id,
          service_id,
          client_service_id,
          title,
          period_start,
          period_end,
          fee,
          discount,
          due_date,
          assigned_staff,
          created_by,
          auto_invoice,
          status,
          financial_status
        ) values (
          coalesce(r_cs.firm_id, target_firm),
          r_cs.client_id,
          r_cs.service_id,
          r_cs.id,
          svc.name || ' – ' || lbl,
          ps,
          pe,
          coalesce(r_cs.agreed_fee, 0),
          0,
          pe + coalesce(r_cs.due_days, 0),
          r_cs.assigned_staff,
          coalesce(auth.uid(), r_cs.assigned_staff),
          coalesce(r_cs.auto_invoice, svc.auto_invoice, false),
          'pending',
          'open'
        )
        on conflict (client_service_id, period_start) do nothing;
        if found then n := n + 1; end if;
      end if;

      ps := (ps + step)::date;
    end loop;
  end loop;

  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.generate_recurring_jobs(_upto date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  target_firm uuid;
begin
  if not (
    public.has_capability('recurring', 'edit')
    or public.is_manager()
    or public.is_finance()
    or public.has_capability('jobs', 'create')
  ) then
    raise exception 'Not authorised';
  end if;

  target_firm := coalesce(
    public.current_firm_id(),
    (select firm_id from public.profiles where id = auth.uid()),
    (select id from public.firms where status = 'active' order by created_at limit 1)
  );

  return public.generate_recurring_jobs_for_firm(target_firm, coalesce(_upto, current_date));
end $function$;

CREATE OR REPLACE FUNCTION public.generate_recurring_jobs_all()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  f record;
  n int := 0;
begin
  for f in select id from public.firms where status = 'active' loop
    n := n + public.generate_recurring_jobs_for_firm(f.id, current_date);
  end loop;
  return n;
end $function$;

-- 5. Multi-Firm Management: Support current_firm_id and set_acting_firm for all firm members
DROP FUNCTION IF EXISTS public.set_acting_firm(uuid);

CREATE OR REPLACE FUNCTION public.current_firm_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select case
    when public.is_super_admin() then p.acting_firm_id
    when p.acting_firm_id is not null and exists (
      select 1 from public.firms f where f.id = p.acting_firm_id and f.status = 'active'
    ) then p.acting_firm_id
    else (select f.id from public.firms f where f.id = p.firm_id and f.status = 'active')
  end
  from public.profiles p where p.id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.set_acting_firm(_firm_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if _firm_id is not null then
    if not (
      public.is_super_admin()
      or exists (select 1 from public.profiles where id = auth.uid() and (firm_id = _firm_id or acting_firm_id = _firm_id))
      or exists (select 1 from public.firms where id = _firm_id and lower(owner_email) = lower(auth.jwt()->>'email'))
      or exists (select 1 from public.firm_invites fi where fi.firm_id = _firm_id and lower(fi.email) = lower(auth.jwt()->>'email'))
    ) then
      raise exception 'Not authorised to switch to this firm';
    end if;
  end if;

  update public.profiles set acting_firm_id = _firm_id where id = auth.uid();
end $$;

-- 6. User Firms List RPC
DROP FUNCTION IF EXISTS public.user_firms_list();

CREATE OR REPLACE FUNCTION public.user_firms_list()
RETURNS TABLE (
  id uuid,
  name text,
  logo_url text,
  owner_email text,
  phone text,
  city text,
  status text,
  role public.app_role,
  is_current boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select distinct on (f.id)
    f.id,
    f.name,
    f.logo_url,
    f.owner_email,
    f.phone,
    f.city,
    f.status,
    coalesce(ur.role, case when lower(f.owner_email) = lower(auth.jwt()->>'email') then 'admin'::public.app_role else 'staff'::public.app_role end) as role,
    (f.id = public.current_firm_id()) as is_current
  from public.firms f
  left join public.profiles p on p.id = auth.uid()
  left join public.user_roles ur on ur.user_id = auth.uid() and ur.firm_id = f.id
  where f.status = 'active'
    and (
      public.is_super_admin()
      or f.id = p.firm_id
      or f.id = p.acting_firm_id
      or lower(f.owner_email) = lower(auth.jwt()->>'email')
      or exists (select 1 from public.firm_invites fi where fi.firm_id = f.id and lower(fi.email) = lower(auth.jwt()->>'email'))
    )
  order by f.id, (f.id = public.current_firm_id()) desc;
$$;

-- 7. Register Firm RPC
DROP FUNCTION IF EXISTS public.register_firm(text, text, text, text, text, text, text, text, numeric);

CREATE OR REPLACE FUNCTION public.register_firm(
  _name text,
  _phone text DEFAULT NULL,
  _city text DEFAULT NULL,
  _logo_url text DEFAULT NULL,
  _address text DEFAULT NULL,
  _gstin text DEFAULT NULL,
  _pan text DEFAULT NULL,
  _bank_details text DEFAULT NULL,
  _default_tax_rate numeric DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  fid uuid;
  user_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if coalesce(trim(_name), '') = '' then
    raise exception 'Firm name is required';
  end if;

  user_email := lower(trim(coalesce(auth.jwt()->>'email', '')));

  -- 1. Create firm record
  insert into public.firms(name, owner_email, phone, city, logo_url, status)
  values (trim(_name), user_email, _phone, _city, _logo_url, 'active')
  returning id into fid;

  -- 2. Create firm settings
  insert into public.settings(
    firm_id,
    firm_name,
    address,
    gstin,
    pan,
    phone,
    email,
    bank_details,
    default_tax_rate
  ) values (
    fid,
    trim(_name),
    _address,
    _gstin,
    _pan,
    _phone,
    user_email,
    _bank_details,
    coalesce(_default_tax_rate, 0)
  );

  -- 3. Ensure role exists for the user
  if not exists (select 1 from public.user_roles where user_id = auth.uid()) then
    insert into public.user_roles(user_id, role)
    values (auth.uid(), 'admin'::public.app_role);
  end if;

  -- 4. Seed role permissions for this firm
  perform public.seed_role_permissions(fid);

  -- 5. Switch user's active firm to the newly created firm
  update public.profiles set acting_firm_id = fid where id = auth.uid();

  return fid;
end $$;

-- 8. Function grants
GRANT EXECUTE ON FUNCTION public.user_firms_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_firm(text, text, text, text, text, text, text, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_acting_firm(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_recurring_jobs(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_recurring_jobs_for_firm(uuid, date) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_recurring_jobs_all() TO service_role;
GRANT EXECUTE ON FUNCTION public.next_doc_code(text, date, uuid) TO authenticated, service_role;

-- ==============================================================================
-- Multi-Task Job Code Sharing (2 tasks can have same job code, 2 jobs cannot)
-- ==============================================================================

alter table public.jobs add column if not exists batch_id text;
update public.jobs
set batch_id = coalesce(substring(notes from '\[Batch:\s*([^\]]+)\]'), id::text)
where batch_id is null;

create index if not exists jobs_batch_id_idx on public.jobs(batch_id);

drop index if exists public.jobs_job_code_firm_uniq;
drop index if exists public.jobs_job_code_key;
alter table public.jobs drop constraint if exists jobs_job_code_key;
alter table public.jobs drop constraint if exists jobs_job_code_firm_uniq;

create index if not exists jobs_firm_job_code_idx on public.jobs(firm_id, job_code);

create or replace function public.stamp_job_doc_no() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.job_code is null then
    if new.batch_id is not null then
      select job_code into new.job_code
      from public.jobs
      where firm_id = new.firm_id
        and batch_id = new.batch_id
        and job_code is not null
      limit 1;
    end if;

    if new.job_code is null then
      new.job_code := public.next_doc_code('JOB', coalesce(new.created_at::date, current_date), new.firm_id);
    end if;
  end if;
  return new;
end $$;

create or replace function public.validate_job_code_uniqueness()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  existing_record record;
begin
  if new.job_code is not null then
    select id, batch_id, client_id into existing_record
    from public.jobs
    where firm_id = new.firm_id
      and job_code = new.job_code
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    limit 1;

    if existing_record.id is not null then
      if (new.batch_id is null or new.batch_id <> existing_record.batch_id or new.client_id <> existing_record.client_id) then
        raise exception 'Job code % is already assigned to a different job. Two different jobs cannot have the same job code.', new.job_code;
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists jobs_validate_job_code on public.jobs;
create trigger jobs_validate_job_code
before insert or update of job_code, batch_id, client_id on public.jobs
for each row execute function public.validate_job_code_uniqueness();


