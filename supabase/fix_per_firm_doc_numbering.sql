-- ==============================================================================
-- Fix: Enforce Per-Firm Sequential Document Numbering for Jobs, Invoices & Payments
-- ==============================================================================
-- Run this in your Supabase SQL Editor.
-- This removes the global sequences and forces every firm to start at 0001 independently.

-- 1. Drop the legacy global sequences from table defaults
ALTER TABLE public.jobs ALTER COLUMN job_code DROP DEFAULT;
ALTER TABLE public.invoices ALTER COLUMN invoice_no DROP DEFAULT;
ALTER TABLE public.payments ALTER COLUMN payment_code DROP DEFAULT;

-- 2. Resilient next_doc_code that counts per firm and period with standard hyphen format
CREATE OR REPLACE FUNCTION public.next_doc_code(_kind text, _on date, _firm_id uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_period text;
  v_no int;
  v_firm_id uuid;
BEGIN
  IF _kind NOT IN ('INV','REC','JOB') THEN
    RAISE EXCEPTION 'Unknown document kind: %', _kind;
  END IF;

  v_period := to_char(coalesce(_on, current_date), 'MMYY');
  v_firm_id := coalesce(
    _firm_id,
    public.current_firm_id(),
    (SELECT firm_id FROM public.profiles WHERE id = auth.uid()),
    (SELECT id FROM public.firms WHERE status = 'active' ORDER BY created_at LIMIT 1)
  );

  IF v_firm_id IS NULL THEN
    RAISE EXCEPTION 'Cannot generate doc code: No active firm found';
  END IF;

  INSERT INTO public.doc_counters AS c (firm_id, kind, period, last_no)
  VALUES (v_firm_id, _kind, v_period, 1)
  ON CONFLICT (firm_id, kind, period) DO UPDATE SET last_no = c.last_no + 1
  RETURNING last_no INTO v_no;

  RETURN _kind || '-' || lpad(v_no::text, 4, '0') || '-' || v_period;
END $$;

-- 3. Stamping triggers for jobs, invoices, and payments
CREATE OR REPLACE FUNCTION public.stamp_job_doc_no() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF new.job_code IS NULL THEN
    IF new.batch_id IS NOT NULL THEN
      SELECT job_code INTO new.job_code
      FROM public.jobs
      WHERE firm_id = new.firm_id
        AND batch_id = new.batch_id
        AND job_code IS NOT NULL
      LIMIT 1;
    END IF;

    IF new.job_code IS NULL THEN
      new.job_code := public.next_doc_code('JOB', coalesce(new.created_at::date, current_date), new.firm_id);
    END IF;
  END IF;
  RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.stamp_invoice_doc_no() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF new.invoice_no IS NULL THEN
    new.invoice_no := public.next_doc_code('INV', coalesce(new.invoice_date, current_date), new.firm_id);
  END IF;
  RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.stamp_payment_doc_no() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF new.payment_code IS NULL THEN
    new.payment_code := public.next_doc_code('REC', coalesce(new.payment_date, current_date), new.firm_id);
  END IF;
  RETURN new;
END $$;

-- 4. Re-attach triggers
DROP TRIGGER IF EXISTS jobs_stamp_doc_no ON public.jobs;
CREATE TRIGGER jobs_stamp_doc_no BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.stamp_job_doc_no();

DROP TRIGGER IF EXISTS invoices_stamp_doc_no ON public.invoices;
CREATE TRIGGER invoices_stamp_doc_no BEFORE INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.stamp_invoice_doc_no();

DROP TRIGGER IF EXISTS payments_stamp_doc_no ON public.payments;
CREATE TRIGGER payments_stamp_doc_no BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.stamp_payment_doc_no();
