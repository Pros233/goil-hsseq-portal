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
-- Require Supabase Auth (authenticated role). Unauthenticated (anon) requests
-- are denied at the policy layer. See supabase-auth-setup.sql for full policies.

ALTER TABLE public.inspection_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_inspection_records" ON public.inspection_records;
DROP POLICY IF EXISTS "anon_all_notifications"       ON public.notifications;

CREATE POLICY "auth_all_inspection_records"
  ON public.inspection_records
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "auth_all_notifications"
  ON public.notifications
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ── 4. NPA Monitoring Shortcomings ───────────────────────────────────────────
-- Stores NPA communiqué records, stations, shortcomings, evidence, and activity.
-- The frontend also keeps full record JSON in record_data for fast reads.
-- All tables use soft deletion via deleted_at / archived_at where applicable.

-- 4a. NPA Monitoring Records (one per NPA communiqué)
CREATE TABLE IF NOT EXISTS public.npa_monitoring_records (
  id                    TEXT        PRIMARY KEY,                  -- frontend-generated ID
  record_number         TEXT        NOT NULL UNIQUE,              -- e.g. NPA-MSC-2026-0001
  record_date           DATE,
  record_time           TEXT,
  inspection_date_from  DATE,
  inspection_date_to    DATE,
  communique_date       DATE,
  communique_reference  TEXT,
  communique_subject    TEXT,
  general_notes         TEXT,
  overall_status        TEXT        NOT NULL DEFAULT 'Draft',     -- Draft|Open|In Progress|Partially Closed|Closed|Archived
  created_by            TEXT,
  created_by_email      TEXT,
  updated_by            TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  archived_at           TIMESTAMPTZ,
  record_data           JSONB       NOT NULL                      -- full denormalised record (for fast reads)
);

CREATE INDEX IF NOT EXISTS idx_npa_records_communique_ref
  ON public.npa_monitoring_records (communique_reference);

CREATE INDEX IF NOT EXISTS idx_npa_records_communique_date
  ON public.npa_monitoring_records (communique_date DESC);

CREATE INDEX IF NOT EXISTS idx_npa_records_status
  ON public.npa_monitoring_records (overall_status);

CREATE INDEX IF NOT EXISTS idx_npa_records_created_by
  ON public.npa_monitoring_records (created_by_email);

CREATE INDEX IF NOT EXISTS idx_npa_records_created_at
  ON public.npa_monitoring_records (created_at DESC);


-- 4b. NPA Record Attachments (communiqué documents)
CREATE TABLE IF NOT EXISTS public.npa_record_attachments (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  npa_record_id TEXT        NOT NULL REFERENCES public.npa_monitoring_records(id) ON DELETE CASCADE,
  file_name     TEXT        NOT NULL,
  file_path     TEXT,
  file_type     TEXT,
  file_size     BIGINT,
  uploaded_by   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_npa_attachments_record
  ON public.npa_record_attachments (npa_record_id);


-- 4c. NPA Record Stations (one per outlet/facility in the communiqué)
CREATE TABLE IF NOT EXISTS public.npa_record_stations (
  id                 TEXT        PRIMARY KEY,   -- frontend-generated
  npa_record_id      TEXT        NOT NULL REFERENCES public.npa_monitoring_records(id) ON DELETE CASCADE,
  outlet_type        TEXT,
  facility_id        TEXT,
  facility_name      TEXT,
  station_code       TEXT,
  region             TEXT,
  station_contact    TEXT,
  display_order      INTEGER     DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_npa_stations_record
  ON public.npa_record_stations (npa_record_id);

CREATE INDEX IF NOT EXISTS idx_npa_stations_facility
  ON public.npa_record_stations (facility_id);


-- 4d. NPA Station Shortcomings (one per shortcoming, child of station)
CREATE TABLE IF NOT EXISTS public.npa_station_shortcomings (
  id                      TEXT        PRIMARY KEY,   -- frontend-generated
  npa_record_station_id   TEXT        NOT NULL REFERENCES public.npa_record_stations(id) ON DELETE CASCADE,
  npa_record_id           TEXT        NOT NULL,      -- denormalised for direct queries
  shortcoming_number      INTEGER,
  shortcoming_description TEXT,
  corrective_action       TEXT,
  responsible_person      TEXT,
  responsible_person_email TEXT,
  target_completion_date  DATE,
  priority                TEXT        NOT NULL DEFAULT 'Medium',  -- Low|Medium|High|Critical
  status                  TEXT        NOT NULL DEFAULT 'Open',    -- Open|In Progress|Pending Verification|Closed|Reopened
  progress_update         TEXT,
  closure_remarks         TEXT,
  closed_by               TEXT,
  closed_at               TIMESTAMPTZ,
  verified_by             TEXT,
  verified_at             TIMESTAMPTZ,
  verification_remarks    TEXT,
  reopened_by             TEXT,
  reopened_at             TIMESTAMPTZ,
  created_by              TEXT,
  updated_by              TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_npa_shortcomings_station
  ON public.npa_station_shortcomings (npa_record_station_id);

CREATE INDEX IF NOT EXISTS idx_npa_shortcomings_record
  ON public.npa_station_shortcomings (npa_record_id);

CREATE INDEX IF NOT EXISTS idx_npa_shortcomings_responsible
  ON public.npa_station_shortcomings (responsible_person_email);

CREATE INDEX IF NOT EXISTS idx_npa_shortcomings_target_date
  ON public.npa_station_shortcomings (target_completion_date);

CREATE INDEX IF NOT EXISTS idx_npa_shortcomings_status
  ON public.npa_station_shortcomings (status);

CREATE INDEX IF NOT EXISTS idx_npa_shortcomings_priority
  ON public.npa_station_shortcomings (priority);


-- 4e. NPA Shortcoming Evidence (files uploaded as proof of corrective action)
CREATE TABLE IF NOT EXISTS public.npa_shortcoming_evidence (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  shortcoming_id  TEXT        NOT NULL REFERENCES public.npa_station_shortcomings(id) ON DELETE CASCADE,
  file_name       TEXT        NOT NULL,
  file_path       TEXT,
  file_type       TEXT,
  file_size       BIGINT,
  uploaded_by     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_npa_evidence_shortcoming
  ON public.npa_shortcoming_evidence (shortcoming_id);


-- 4f. NPA Shortcoming Activity Log (audit trail per shortcoming)
CREATE TABLE IF NOT EXISTS public.npa_shortcoming_activity_log (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  shortcoming_id TEXT,                          -- NULL for record-level events
  npa_record_id  TEXT        NOT NULL,
  action_type    TEXT        NOT NULL,          -- record_saved|shortcoming_closed|shortcoming_reopened|status_changed|etc.
  old_value      TEXT,
  new_value      TEXT,
  remarks        TEXT,
  performed_by   TEXT,
  performed_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_npa_activity_shortcoming
  ON public.npa_shortcoming_activity_log (shortcoming_id);

CREATE INDEX IF NOT EXISTS idx_npa_activity_record
  ON public.npa_shortcoming_activity_log (npa_record_id);

CREATE INDEX IF NOT EXISTS idx_npa_activity_performed_at
  ON public.npa_shortcoming_activity_log (performed_at DESC);


-- 4g. Row Level Security for NPA tables
-- Require Supabase Auth (authenticated role) for all NPA data access.
-- Unauthenticated (anon) requests are denied at the policy layer.

ALTER TABLE public.npa_monitoring_records     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.npa_record_attachments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.npa_record_stations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.npa_station_shortcomings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.npa_shortcoming_evidence   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.npa_shortcoming_activity_log ENABLE ROW LEVEL SECURITY;

-- Drop any previously created permissive anon policies before creating the correct ones
DROP POLICY IF EXISTS "anon_all_npa_monitoring_records"       ON public.npa_monitoring_records;
DROP POLICY IF EXISTS "anon_all_npa_record_attachments"       ON public.npa_record_attachments;
DROP POLICY IF EXISTS "anon_all_npa_record_stations"          ON public.npa_record_stations;
DROP POLICY IF EXISTS "anon_all_npa_station_shortcomings"     ON public.npa_station_shortcomings;
DROP POLICY IF EXISTS "anon_all_npa_shortcoming_evidence"     ON public.npa_shortcoming_evidence;
DROP POLICY IF EXISTS "anon_all_npa_shortcoming_activity_log" ON public.npa_shortcoming_activity_log;

-- npa_monitoring_records: authenticated users can read/insert/update; only admins can delete
CREATE POLICY "auth_select_npa_monitoring_records"
  ON public.npa_monitoring_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_npa_monitoring_records"
  ON public.npa_monitoring_records FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_npa_monitoring_records"
  ON public.npa_monitoring_records FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_delete_npa_monitoring_records"
  ON public.npa_monitoring_records FOR DELETE TO authenticated
  USING (public.get_my_role() = 'admin');

-- npa_record_attachments
CREATE POLICY "auth_all_npa_record_attachments"
  ON public.npa_record_attachments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- npa_record_stations
CREATE POLICY "auth_all_npa_record_stations"
  ON public.npa_record_stations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- npa_station_shortcomings
CREATE POLICY "auth_all_npa_station_shortcomings"
  ON public.npa_station_shortcomings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- npa_shortcoming_evidence
CREATE POLICY "auth_all_npa_shortcoming_evidence"
  ON public.npa_shortcoming_evidence FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- npa_shortcoming_activity_log
CREATE POLICY "auth_all_npa_shortcoming_activity_log"
  ON public.npa_shortcoming_activity_log FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── Done ──────────────────────────────────────────────────────────────────────
-- After running this script you should see two new tables in
-- Table Editor → public: inspection_records, notifications
--
-- And these six new NPA tables:
--   npa_monitoring_records
--   npa_record_attachments
--   npa_record_stations
--   npa_station_shortcomings
--   npa_shortcoming_evidence
--   npa_shortcoming_activity_log
