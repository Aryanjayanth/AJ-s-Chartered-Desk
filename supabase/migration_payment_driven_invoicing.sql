-- Migration: Strict Payment-Driven Invoicing
-- Rule: Invoices must ONLY be generated when payment is received/allocated to a task.
-- Completing a job does NOT automatically generate an invoice.
-- Standalone invoice generation without payment is disabled.

-- 1. Update update_job_status: Do NOT trigger auto_invoice on job completion.
create or replace function public.update_job_status(_job_id uuid, _status text, _reason text)
returns void language plpgsql security definer set search_path=public as $$
declare
  j record;
begin
  perform public.firm_guard('jobs', _job_id);
  if not (public.is_finance() or exists(select 1 from public.jobs where id=_job_id and assigned_staff=auth.uid())) then
    if not public.has_capability('jobs','edit') then
      raise exception 'Not authorised';
    end if;
  end if;

  perform set_config('app.status_reason', coalesce(_reason,''), true);
  update public.jobs set status=_status where id=_job_id;

  -- NOTE: Under practice policy, completing a job leaves it in open/completed unbilled receivables.
  -- Invoices are strictly generated upon recording or clearing a payment against this job.
end $$;

-- 2. Guard auto_invoice_job against standalone unpaid execution
create or replace function public.auto_invoice_job(_job_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
begin
  raise exception 'Practice policy: Invoices cannot be generated without payment. Please clear or record a payment for this task on the Payment Clearing Desk.';
end $$;

grant execute on function public.update_job_status(uuid, text, text) to authenticated;
grant execute on function public.auto_invoice_job(uuid) to authenticated;
