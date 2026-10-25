-- Fix any existing duplicate job codes by giving each job a distinct sequential job code
-- Only run this in Supabase SQL Editor if you have past jobs that were created sharing the same job_code.

DO $$
DECLARE
  r RECORD;
  new_code TEXT;
  dup_cursor CURSOR FOR
    SELECT j.id, j.firm_id, j.created_at, j.job_code,
           ROW_NUMBER() OVER (PARTITION BY j.firm_id, j.job_code ORDER BY j.created_at, j.id) AS rn
    FROM public.jobs j
    WHERE j.job_code IN (
      SELECT job_code
      FROM public.jobs
      GROUP BY firm_id, job_code
      HAVING COUNT(*) > 1
    )
    ORDER BY j.firm_id, j.job_code, j.created_at;
BEGIN
  FOR r IN dup_cursor LOOP
    -- Keep the first record as is (rn = 1), re-number duplicates (rn > 1)
    IF r.rn > 1 THEN
      new_code := public.next_doc_code('JOB', COALESCE(r.created_at::date, CURRENT_DATE), r.firm_id);
      UPDATE public.jobs
      SET job_code = new_code
      WHERE id = r.id;
      RAISE NOTICE 'Updated duplicate job % (row %) to new unique code %', r.id, r.rn, new_code;
    END IF;
  END LOOP;
END $$;
