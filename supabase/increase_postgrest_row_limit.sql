-- ==============================================================================
-- Increase PostgREST max rows limit from default (1000) to 100,000 rows
-- Run this in the Supabase SQL Editor to allow large tables to return all rows.
-- ==============================================================================

ALTER ROLE authenticator SET pgrst.db_max_rows = 100000;
ALTER ROLE anon SET pgrst.db_max_rows = 100000;
NOTIFY pgrst, 'reload config';
