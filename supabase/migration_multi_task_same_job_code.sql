-- Migration: Allow multiple tasks in the same job to share the same job_code,
-- while ensuring two different jobs can NEVER have the same job_code.

-- 1. Add batch_id column to jobs if not present
alter table public.jobs add column if not exists batch_id text;

-- 2. Backfill batch_id from existing notes or id
update public.jobs
set batch_id = coalesce(substring(notes from '\[Batch:\s*([^\]]+)\]'), id::text)
where batch_id is null;

create index if not exists jobs_batch_id_idx on public.jobs(batch_id);

-- 3. Drop the strict single-row unique constraint/index on (firm_id, job_code)
drop index if exists public.jobs_job_code_firm_uniq;
drop index if exists public.jobs_job_code_key;
alter table public.jobs drop constraint if exists jobs_job_code_key;
alter table public.jobs drop constraint if exists jobs_job_code_firm_uniq;

-- Fast index for job_code lookups
create index if not exists jobs_firm_job_code_idx on public.jobs(firm_id, job_code);

-- 4. Update stamp_job_doc_no trigger function:
-- If inserting a task that belongs to an existing batch/job, automatically inherit that job's code
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

-- 5. Business rule trigger:
-- Multiple tasks belonging to the SAME job (same batch_id & client_id) CAN share the same job_code.
-- Two DIFFERENT jobs can NEVER share the same job_code!
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
      -- A record with this job_code exists.
      -- It is permitted ONLY if it belongs to the exact same job (same batch_id and client_id).
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
