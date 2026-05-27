-- Perf indexes for tenant-scoped reads.
--
-- The karute list page filters by `customer_id` (business id) via RLS and orders
-- by session_date DESC. The existing idx_karute_records_client_id is keyed on the
-- salon-client id, not the business, so it can't serve the list scan. Add a
-- composite on (customer_id, session_date DESC) to keep the list page fast as
-- record counts grow past a few thousand.
CREATE INDEX IF NOT EXISTS idx_karute_records_customer_session
  ON public.karute_records (customer_id, session_date DESC NULLS LAST);

-- Entries are RLS-filtered by customer_id; a single-column index supports the
-- per-tenant scan that happens whenever a karute is opened.
CREATE INDEX IF NOT EXISTS idx_entries_customer_id
  ON public.entries (customer_id);

-- Customer photos and consents are looked up per-customer on the karute detail
-- page. Add indexes only if those tables exist (they may not in older branches).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'customer_photos'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customer_photos_customer_id ON public.customer_photos (customer_id, created_at DESC)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'customer_consents'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customer_consents_customer_id ON public.customer_consents (customer_id, granted_at DESC)';
  END IF;
END $$;
