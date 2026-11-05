-- ==============================================================================
-- MIGRATION: 
-- 1. Prevent re-creation of deleted recurring cycle jobs (Dismissed/Deleted Cycles Tombstone)
-- 2. Cloak Superadmin completely (Hide superadmin profile, users & audit logs from firm managers/staff)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PART 1: Prevent Re-creation of Deleted Recurring Cycle Jobs
-- ------------------------------------------------------------------------------

-- Table to remember deleted recurring cycles so generate_recurring_jobs never recreates them
CREATE TABLE IF NOT EXISTS public.jobs_recurring_dismissed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid REFERENCES public.firms(id) DEFAULT public.current_firm_id(),
  client_service_id uuid NOT NULL REFERENCES public.client_services(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jobs_recurring_dismissed_unique UNIQUE (client_service_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_jobs_recurring_dismissed_cs ON public.jobs_recurring_dismissed(client_service_id, period_start);
CREATE INDEX IF NOT EXISTS idx_jobs_recurring_dismissed_firm ON public.jobs_recurring_dismissed(firm_id);

ALTER TABLE public.jobs_recurring_dismissed ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.jobs_recurring_dismissed TO service_role;
GRANT SELECT, INSERT, DELETE ON public.jobs_recurring_dismissed TO authenticated;

DROP POLICY IF EXISTS "firm isolation" ON public.jobs_recurring_dismissed;
CREATE POLICY "firm isolation" ON public.jobs_recurring_dismissed AS RESTRICTIVE FOR ALL TO authenticated
  USING (firm_id = public.current_firm_id() OR public.is_super_admin())
  WITH CHECK (firm_id = public.current_firm_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "dismissed cycles access" ON public.jobs_recurring_dismissed;
CREATE POLICY "dismissed cycles access" ON public.jobs_recurring_dismissed FOR ALL TO authenticated
  USING (public.has_capability('jobs', 'delete') OR public.is_manager() OR public.is_super_admin())
  WITH CHECK (public.has_capability('jobs', 'delete') OR public.is_manager() OR public.is_super_admin());

-- Trigger function: whenever a job that belongs to a recurring schedule is deleted,
-- record its (client_service_id, period_start) so it is never regenerated.
CREATE OR REPLACE FUNCTION public.track_deleted_recurring_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.client_service_id IS NOT NULL AND OLD.period_start IS NOT NULL THEN
    INSERT INTO public.jobs_recurring_dismissed (firm_id, client_service_id, period_start)
    VALUES (
      COALESCE(OLD.firm_id, (SELECT firm_id FROM public.client_services WHERE id = OLD.client_service_id), public.current_firm_id()),
      OLD.client_service_id,
      OLD.period_start
    )
    ON CONFLICT (client_service_id, period_start) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_deleted_recurring_job ON public.jobs;
CREATE TRIGGER trg_track_deleted_recurring_job
BEFORE DELETE ON public.jobs
FOR EACH ROW
EXECUTE FUNCTION public.track_deleted_recurring_job();

-- Update generate_recurring_jobs_for_firm to check jobs_recurring_dismissed
CREATE OR REPLACE FUNCTION public.generate_recurring_jobs_for_firm(_firm uuid, _upto date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  r_cs record;
  ps date;
  pe date;
  step interval;
  n int := 0;
  svc record;
  lbl text;
  target_upto date;
  target_firm uuid;
BEGIN
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
      ) and not exists (
        select 1 from public.jobs_recurring_dismissed
        where client_service_id = r_cs.id and period_start = r_cs.start_date
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

      -- Check that neither an existing job NOR a deleted/dismissed cycle tombstone exists
      if not exists (
        select 1 from public.jobs
        where client_service_id = r_cs.id and period_start = ps
      ) and not exists (
        select 1 from public.jobs_recurring_dismissed
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
END;
$function$;


-- ------------------------------------------------------------------------------
-- PART 2: Cloak Superadmin Completely (Profiles, User Names & Audit Trails)
-- ------------------------------------------------------------------------------

-- 1. Profiles Read Policy:
-- Firm members should ONLY be able to read regular profiles.
-- Superadmins (platform_admins) must NEVER be visible to non-superadmin users.
DROP POLICY IF EXISTS "profiles read" ON public.profiles;
CREATE POLICY "profiles read" ON public.profiles FOR SELECT TO authenticated
  USING (
    -- The caller can see themselves
    id = auth.uid()
    -- Superadmin can see all profiles
    OR public.is_super_admin()
    -- Other users can only see profiles of colleagues who are NOT platform_admins
    OR (
      (public.has_capability('clients', 'view') OR public.has_capability('jobs', 'view') OR public.is_manager())
      AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = profiles.id)
    )
  );

-- 2. Audit Logs Read Policy:
-- Superadmin actions/audit records must NEVER be visible to non-superadmins.
DROP POLICY IF EXISTS "audit read" ON public.audit_logs;
CREATE POLICY "audit read" ON public.audit_logs FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_manager()
      AND (
        user_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = audit_logs.user_id)
      )
    )
  );

-- 3. Update jobs_list and recurring_list RPCs to mask superadmin names if assigned
CREATE OR REPLACE FUNCTION public.jobs_list()
RETURNS TABLE (
  id uuid,
  job_code text,
  client_id uuid,
  client_name text,
  service_id uuid,
  service_name text,
  client_service_id uuid,
  title text,
  period_start date,
  period_end date,
  fee numeric,
  discount numeric,
  net_amount numeric,
  due_date date,
  assigned_staff uuid,
  assigned_staff_name text,
  status text,
  financial_status text,
  notes text,
  auto_invoice boolean,
  created_at timestamptz,
  invoice_id uuid,
  invoice_no text,
  invoice_status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    j.id,
    j.job_code,
    j.client_id,
    c.name,
    j.service_id,
    s.name,
    j.client_service_id,
    j.title,
    j.period_start,
    j.period_end,
    CASE WHEN public.has_capability('jobs', 'amounts') THEN j.fee END,
    CASE WHEN public.has_capability('jobs', 'amounts') THEN j.discount END,
    CASE WHEN public.has_capability('jobs', 'amounts') THEN j.net_amount END,
    j.due_date,
    CASE WHEN EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = j.assigned_staff) THEN NULL ELSE j.assigned_staff END,
    CASE WHEN EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = j.assigned_staff) THEN NULL ELSE pf.full_name END,
    j.status,
    j.financial_status,
    j.notes,
    j.auto_invoice,
    j.created_at,
    inv.id,
    inv.invoice_no,
    inv.status
  FROM public.jobs j
  LEFT JOIN public.clients c ON c.id = j.client_id
  LEFT JOIN public.services s ON s.id = j.service_id
  LEFT JOIN public.profiles pf ON pf.id = j.assigned_staff
  LEFT JOIN LATERAL (
    SELECT i.id, i.invoice_no, i.status
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE ii.job_id = j.id AND i.status <> 'cancelled'
    ORDER BY i.created_at DESC
    LIMIT 1
  ) inv ON true
  WHERE j.firm_id = public.current_firm_id()
    AND public.has_capability('jobs', 'view')
  ORDER BY j.due_date ASC NULLS LAST
$$;

CREATE OR REPLACE FUNCTION public.recurring_list()
RETURNS TABLE (
  id uuid,
  client_id uuid,
  client_name text,
  service_id uuid,
  service_name text,
  agreed_fee numeric,
  frequency text,
  start_date date,
  end_date date,
  due_days int,
  assigned_staff uuid,
  assigned_staff_name text,
  status text,
  notes text,
  auto_invoice boolean,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    cs.id,
    cs.client_id,
    c.name,
    cs.service_id,
    s.name,
    CASE WHEN public.has_capability('recurring', 'amounts') THEN cs.agreed_fee END,
    cs.frequency,
    cs.start_date,
    cs.end_date,
    cs.due_days,
    CASE WHEN EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = cs.assigned_staff) THEN NULL ELSE cs.assigned_staff END,
    CASE WHEN EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = cs.assigned_staff) THEN NULL ELSE pf.full_name END,
    cs.status,
    cs.notes,
    cs.auto_invoice,
    cs.created_at
  FROM public.client_services cs
  LEFT JOIN public.clients c ON c.id = cs.client_id
  LEFT JOIN public.services s ON s.id = cs.service_id
  LEFT JOIN public.profiles pf ON pf.id = cs.assigned_staff
  WHERE cs.firm_id = public.current_firm_id()
    AND public.has_capability('recurring', 'view')
  ORDER BY cs.created_at
$$;

GRANT EXECUTE ON FUNCTION public.jobs_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.recurring_list() TO authenticated;
