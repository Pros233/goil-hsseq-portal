-- ================================================================
-- GOIL HSSEQ – Supabase Database Setup
-- Run this entire script once in your Supabase SQL Editor:
--   Dashboard → SQL Editor → New Query → Paste → Run
-- ================================================================


-- ── 1. Inspection Records ─────────────────────────────────────────────────────
-- Stores every inspection record synced from the app's localStorage.
-- Each row = one unique (inspection_ref, version) pair.

CREATE TABLE IF NOT EXISTS public.inspection_records (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  inspection_ref TEXT        NOT NULL,
  version_number INTEGER     NOT NULL DEFAULT 1,
  user_email     TEXT,
  record_data    JSONB       NOT NULL,
  synced_at      TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_inspection_records UNIQUE (inspection_ref, version_number)
);

-- Index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_inspection_records_user
  ON public.inspection_records (user_email);

-- Index for chronological queries
CREATE INDEX IF NOT EXISTS idx_inspection_records_synced
  ON public.inspection_records (synced_at DESC);


-- ── 2. Notifications ─────────────────────────────────────────────────────────
-- Stores workflow notification objects.

CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  notif_id   TEXT        NOT NULL UNIQUE,
  user_email TEXT,
  notif_data JSONB       NOT NULL,
  synced_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON public.notifications (user_email);


-- ── 3. Row Level Security ─────────────────────────────────────────────────────
-- The app uses its own frontend auth (no Supabase Auth users), so we allow
-- the anon key to read and write all rows.
-- When you add real user accounts, tighten these policies.

ALTER TABLE public.inspection_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications       ENABLE ROW LEVEL SECURITY;

-- Allow full access via the anon/publishable key
CREATE POLICY "anon_all_inspection_records"
  ON public.inspection_records
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "anon_all_notifications"
  ON public.notifications
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);


-- ── Done ──────────────────────────────────────────────────────────────────────
-- After running this script you should see two new tables in
-- Table Editor → public: inspection_records, notifications
