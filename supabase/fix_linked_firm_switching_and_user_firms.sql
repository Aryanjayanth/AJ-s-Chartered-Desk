-- Fix user_firms_list, current_firm_id, and set_acting_firm for multi-firm support
-- 1. Fix user_firms_list: user_roles has NO firm_id column, so joining on ur.firm_id = f.id crashed the function
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
  left join public.user_roles ur on ur.user_id = auth.uid()
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

-- 2. Enhance current_firm_id to gracefully resolve active firm
CREATE OR REPLACE FUNCTION public.current_firm_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select case
    when public.is_super_admin() then coalesce(
      p.acting_firm_id,
      p.firm_id,
      (select id from public.firms where status = 'active' order by (id <> '00000000-0000-0000-0000-000000000001'), created_at desc limit 1)
    )
    when p.acting_firm_id is not null and exists (
      select 1 from public.firms f where f.id = p.acting_firm_id and f.status = 'active'
    ) then p.acting_firm_id
    when p.firm_id is not null and exists (
      select 1 from public.firms f where f.id = p.firm_id and f.status = 'active'
    ) then p.firm_id
    else (
      select f.id from public.firms f
      where f.status = 'active'
        and (
          lower(f.owner_email) = lower(auth.jwt()->>'email')
          or exists (select 1 from public.firm_invites fi where fi.firm_id = f.id and lower(fi.email) = lower(auth.jwt()->>'email'))
        )
      order by (f.id <> '00000000-0000-0000-0000-000000000001'), f.created_at desc
      limit 1
    )
  end
  from public.profiles p where p.id = auth.uid() $$;

-- 3. Enhance set_acting_firm to update both acting_firm_id and firm_id
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

  update public.profiles
  set acting_firm_id = _firm_id,
      firm_id = coalesce(_firm_id, firm_id)
  where id = auth.uid();
end $$;

-- 4. Ensure grants are intact
GRANT EXECUTE ON FUNCTION public.user_firms_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_firm_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_acting_firm(uuid) TO authenticated;
