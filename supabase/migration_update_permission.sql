-- Migration: add an "update" action (status-only changes) to the permission matrix.
-- Run this in the Supabase SQL editor. Safe to re-run.

-- 1. Column on role_permissions
alter table public.role_permissions
  add column if not exists can_update boolean not null default false;

-- Drop functions whose return type changed
drop function if exists public.permission_defaults(public.app_role, text);
drop function if exists public.effective_permissions(uuid, public.app_role, text);
drop function if exists public.permission_matrix();

-- 2. permission_defaults: add can_update column to the returned table
create or replace function public.permission_defaults(_role public.app_role, _module text)
returns table(can_view boolean, can_create boolean, can_edit boolean, can_update boolean, can_delete boolean, can_amounts boolean)
language sql immutable as $$
  select
    case when _role='admin' then true when _role='cashier' then _module='payments' else true end,
    case when _role='admin' then true when _role='cashier' then _module='payments' else false end,
    case when _role='admin' then true when _role='staff' then _module='jobs' else false end,
    case when _role='admin' then true when _role='staff' then _module='jobs' else false end,
    case when _role='admin' then _module<>'payments' else false end,
    case when _role='admin' then true when _role='cashier' then _module='payments' else false end
$$;

-- 3. effective_permissions
create or replace function public.effective_permissions(_firm_id uuid, _role public.app_role, _module text)
returns table(can_view boolean, can_create boolean, can_edit boolean, can_update boolean, can_delete boolean, can_amounts boolean)
language sql stable security definer set search_path=public as $$
  select
    coalesce(rp.can_view, d.can_view),
    coalesce(rp.can_create, d.can_create),
    coalesce(rp.can_edit, d.can_edit),
    coalesce(rp.can_update, d.can_update),
    case when _module='payments' then false else coalesce(rp.can_delete, d.can_delete) end,
    coalesce(rp.can_amounts, d.can_amounts)
  from public.permission_defaults(_role, _module) d
  left join public.role_permissions rp
    on rp.firm_id=_firm_id and rp.role=_role and rp.module=_module
$$;

-- 4. seed_role_permissions
create or replace function public.seed_role_permissions(_firm_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  insert into public.role_permissions(firm_id, role, module, can_view, can_create, can_edit, can_update, can_delete, can_amounts)
  select _firm_id, r.role, m.module, d.can_view, d.can_create, d.can_edit, d.can_update, d.can_delete, d.can_amounts
  from unnest(array['admin','staff','cashier']::public.app_role[]) r(role)
  cross join unnest(array['clients','services','jobs','recurring','payments','expenses']) m(module)
  cross join lateral public.permission_defaults(r.role, m.module) d
  on conflict (firm_id, role, module) do nothing;
end $$;

-- Drop old 7-param overload to avoid ambiguity
drop function if exists public.set_role_permission(public.app_role, text, boolean, boolean, boolean, boolean, boolean);

-- 5. set_role_permission (add _update param)
create or replace function public.set_role_permission(_role public.app_role, _module text, _view boolean, _create boolean, _edit boolean, _update boolean, _delete boolean, _amounts boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_manager() then raise exception 'Not authorised'; end if;
  if _role = 'admin' then raise exception 'The Admin role always has full access and cannot be restricted.'; end if;
  if _module not in ('clients','services','jobs','recurring','payments','expenses') then raise exception 'Unknown module'; end if;
  if _delete and _module = 'payments' then raise exception 'Payment records are never deleted. Reverse the payment instead.'; end if;
  insert into public.role_permissions(firm_id, role, module, can_view, can_create, can_edit, can_update, can_delete, can_amounts)
  values (public.current_firm_id(), _role, _module,
    coalesce(_view,false),
    coalesce(_view,false) and coalesce(_create,false),
    coalesce(_view,false) and coalesce(_edit,false),
    coalesce(_view,false) and coalesce(_update,false),
    coalesce(_view,false) and coalesce(_delete,false),
    coalesce(_view,false) and coalesce(_amounts,false))
  on conflict (firm_id, role, module) do update set
    can_view=excluded.can_view, can_create=excluded.can_create, can_edit=excluded.can_edit,
    can_update=excluded.can_update, can_delete=excluded.can_delete, can_amounts=excluded.can_amounts,
    updated_by=auth.uid(), updated_at=now();
  insert into public.audit_logs(user_id, action, module, record_id, new_value)
  values (auth.uid(), 'role_permission_changed', 'role_permissions', _role::text || ':' || _module,
    jsonb_build_object('view', coalesce(_view,false), 'create', coalesce(_view,false) and coalesce(_create,false),
      'edit', coalesce(_view,false) and coalesce(_edit,false), 'update', coalesce(_view,false) and coalesce(_update,false),
      'delete', coalesce(_view,false) and coalesce(_delete,false), 'amounts', coalesce(_view,false) and coalesce(_amounts,false)));
end $$;

-- 6. my_permissions: include update
create or replace function public.my_permissions() returns jsonb
language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_object_agg(s.module, jsonb_build_object('view', s.can_view, 'create', s.can_create, 'edit', s.can_edit, 'update', s.can_update, 'delete', s.can_delete, 'amounts', s.can_amounts)), '{}'::jsonb)
  from (
    select m.module, bool_or(p.can_view) as can_view, bool_or(p.can_create) as can_create,
           bool_or(p.can_edit) as can_edit, bool_or(p.can_update) as can_update,
           bool_or(p.can_delete) as can_delete, bool_or(p.can_amounts) as can_amounts
    from unnest(array['clients','services','jobs','recurring','payments','expenses']) m(module)
    cross join public.my_roles() rr
    cross join lateral public.effective_permissions(public.current_firm_id(), rr, m.module) p
    group by m.module
  ) s
$$;

-- 7. permission_matrix: include can_update
create or replace function public.permission_matrix() returns table(role public.app_role, module text, can_view boolean, can_create boolean, can_edit boolean, can_update boolean, can_delete boolean, can_amounts boolean, editable boolean)
language plpgsql security definer set search_path=public as $$
begin
  if not public.is_manager() then raise exception 'Not authorised'; end if;
  return query
  select r.role, m.module,
    coalesce(rp.can_view, d.can_view),
    coalesce(rp.can_create, d.can_create),
    coalesce(rp.can_edit, d.can_edit),
    coalesce(rp.can_update, d.can_update),
    case when m.module='payments' then false else coalesce(rp.can_delete, d.can_delete) end,
    coalesce(rp.can_amounts, d.can_amounts),
    r.role <> 'admin'
  from unnest(array['admin','staff','cashier']::public.app_role[]) r(role)
  cross join unnest(array['clients','services','jobs','recurring','payments','expenses']) m(module)
  cross join lateral public.permission_defaults(r.role, m.module) d
  left join public.role_permissions rp
    on rp.firm_id=public.current_firm_id() and rp.role=r.role and rp.module=m.module;
end $$;

-- 8. Optionally enforce update in update_job_status (status changes). Uncomment if desired.
-- create or replace function public.update_job_status(_job_id uuid, _status text, _reason text) returns void
-- language plpgsql security definer set search_path=public as $$
-- begin
--   perform public.firm_guard('jobs', _job_id);
--   if not (public.is_finance() or exists(select 1 from public.jobs where id=_job_id and assigned_staff=auth.uid())) then raise exception 'Not authorised'; end if;
--   if not public.has_capability('jobs','update') and not public.has_capability('jobs','edit') then raise exception 'Not authorised to update status'; end if;
--   perform set_config('app.status_reason', coalesce(_reason,''), true);
--   update public.jobs set status=_status where id=_job_id;
-- end $$;

-- Backfill existing rows
update public.role_permissions set can_update = true where role = 'admin';
update public.role_permissions set can_update = can_edit where role = 'staff' and module = 'jobs';

-- has_capability: support 'update' action
create or replace function public.has_capability(_module text, _action text)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_manager() or exists (
    select 1 from public.my_roles() rr
    cross join lateral public.effective_permissions(public.current_firm_id(), rr, _module) p
    where case _action
      when 'view' then p.can_view
      when 'create' then p.can_create
      when 'edit' then p.can_edit
      when 'update' then p.can_update
      when 'delete' then p.can_delete
      when 'amounts' then p.can_amounts
      else false
    end
  )
$$;

-- Refresh defaults for existing firms
select public.seed_role_permissions(id) from public.firms;
