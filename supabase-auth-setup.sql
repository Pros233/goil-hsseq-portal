-- ================================================================
-- GOIL HSSEQ – Supabase Auth & User Setup
-- Run this in Supabase Dashboard → SQL Editor → New Query → Run
-- ================================================================

-- ── 1. User Profiles Table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id                   UUID        REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name            TEXT        NOT NULL,
  office               TEXT,
  email                TEXT        NOT NULL,
  role                 TEXT        NOT NULL DEFAULT 'submitter'
                                   CHECK (role IN ('admin', 'submitter')),
  must_change_password BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger: keep updated_at current
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 2. Role helper (SECURITY DEFINER avoids RLS recursion) ───────────────────

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;


-- ── 3. Row Level Security – user_profiles ────────────────────────────────────

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profile_select_own"   ON public.user_profiles;
DROP POLICY IF EXISTS "profile_select_admin" ON public.user_profiles;
DROP POLICY IF EXISTS "profile_update_own"   ON public.user_profiles;

CREATE POLICY "profile_select_own"
  ON public.user_profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.get_my_role() = 'admin');

CREATE POLICY "profile_update_own"
  ON public.user_profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());


-- ── 4. Row Level Security – inspection_records ───────────────────────────────
-- (replaces the open anon policy from the initial setup)

DROP POLICY IF EXISTS "anon_all_inspection_records" ON public.inspection_records;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='inspection_records') THEN

    DROP POLICY IF EXISTS "records_select" ON public.inspection_records;
    DROP POLICY IF EXISTS "records_insert" ON public.inspection_records;
    DROP POLICY IF EXISTS "records_update" ON public.inspection_records;
    DROP POLICY IF EXISTS "records_delete" ON public.inspection_records;

    CREATE POLICY "records_select" ON public.inspection_records
      FOR SELECT TO authenticated USING (true);

    CREATE POLICY "records_insert" ON public.inspection_records
      FOR INSERT TO authenticated WITH CHECK (true);

    CREATE POLICY "records_update" ON public.inspection_records
      FOR UPDATE TO authenticated USING (true);

    -- Only admins can delete
    CREATE POLICY "records_delete" ON public.inspection_records
      FOR DELETE TO authenticated
      USING (public.get_my_role() = 'admin');

  END IF;
END $$;


-- ── 5. Helper function to create a user + identity + profile ─────────────────

CREATE OR REPLACE FUNCTION public.create_goil_user(
  p_email      TEXT,
  p_full_name  TEXT,
  p_office     TEXT,
  p_role       TEXT DEFAULT 'submitter'
)
RETURNS void AS $$
DECLARE
  v_uid UUID;
BEGIN
  -- Skip if user already exists
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_email) THEN
    RAISE NOTICE 'User % already exists – skipping.', p_email;
    RETURN;
  END IF;

  v_uid := gen_random_uuid();

  -- Auth user
  INSERT INTO auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_uid, 'authenticated', 'authenticated', p_email,
    crypt('Goilstaff1234', gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}', '{}',
    false, NOW(), NOW(), '', '', '', ''
  );

  -- Auth identity (email provider)
  INSERT INTO auth.identities (
    id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', p_email),
    'email', NOW(), NOW(), NOW()
  );

  -- Public profile
  INSERT INTO public.user_profiles (id, full_name, office, email, role, must_change_password)
  VALUES (v_uid, p_full_name, p_office, p_email, p_role, true);

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── 6. Create all GOIL HSSEQ users ───────────────────────────────────────────

SELECT public.create_goil_user('marian@goil.com.gh',           'Marian T. Fordjor',          'Head Office',                'submitter');
SELECT public.create_goil_user('eric.oseibonsu@goil.com.gh',   'Eric Osei Bonsu',             'Head Office',                'submitter');
SELECT public.create_goil_user('patience.agyensem@goil.com.gh','Patience Agyensem',           'Head Office',                'submitter');
SELECT public.create_goil_user('prosper.amiibah@goil.com.gh',  'Prosper Amiibah',             'Head Office',                'admin');
SELECT public.create_goil_user('solomon.asiedu@goil.com.gh',   'Solomon Asiedu',              'Head Office',                'submitter');
SELECT public.create_goil_user('isaac.sackitey@goil.com.gh',   'Isaac Kojo Sackitey',         'Head Office',                'submitter');
SELECT public.create_goil_user('francis.bonsu@goil.com.gh',    'Francis Bonsu',               'Quality Control',            'submitter');
SELECT public.create_goil_user('gifty.wiredu@goil.com.gh',     'Gifty Animwaa Wiredu',        'Quality Control',            'submitter');
SELECT public.create_goil_user('michael.adigbo@goil.com.gh',   'Michael Selorm Adigbo',       'Quality Control',            'submitter');
SELECT public.create_goil_user('nanayaw.asamoah@goil.com.gh',  'Nana Yaw Asamoah',            'Quality Control',            'submitter');
SELECT public.create_goil_user('nathaniel.tetteh@goil.com.gh', 'Nathaniel Tetteh',            'Quality Control',            'submitter');
SELECT public.create_goil_user('ferdinard.boakye@goil.com.gh', 'Ferdinan Boakye',             'Tema',                       'submitter');
SELECT public.create_goil_user('kwaku.ahmed@goil.com.gh',      'Kweku Bashir Ahmed',          'South',                      'submitter');
SELECT public.create_goil_user('felicia.boatemaa@goil.com.gh', 'Felicia Boatemaa',            'South',                      'submitter');
SELECT public.create_goil_user('emmanuel.adu-gyamfi@goil.com.gh','Emmanuel Adu-Gyamfi',       'South East',                 'submitter');
SELECT public.create_goil_user('christian.amevor@goil.com.gh', 'Christian Amevor',            'Tema',                       'submitter');
SELECT public.create_goil_user('basil.akoto@goil.com.gh',      'Basil Yaw Akoto',             'West',                       'submitter');
SELECT public.create_goil_user('lucy.effah@goil.com.gh',       'Lucy Effie Effah',            'West',                       'submitter');
SELECT public.create_goil_user('michael.anning@goil.com.gh',   'Michael Anning',              'West',                       'submitter');
SELECT public.create_goil_user('eugene.atakorah@goil.com.gh',  'Eugene Kwabena Atakorah',     'Upper Middle Belt',          'submitter');
SELECT public.create_goil_user('seth.osei@goil.com.gh',        'Seth Prempeh',                'Upper Middle Belt',          'submitter');
SELECT public.create_goil_user('john.alpha@goil.com.gh',       'John Asamoah Alpha',          'Middle Belt',                'submitter');
SELECT public.create_goil_user('grace.afrifa@goil.com.gh',     'Grace Afrifa',                'Middle Belt',                'submitter');
SELECT public.create_goil_user('joseph.couri@goil.com.gh',     'Joseph Ofotsu Couri',         'North',                      'submitter');
SELECT public.create_goil_user('joy.bansah@goil.com.gh',       'Joy Afi Bansah',              'LPG Cylinder Filling Plant', 'submitter');
SELECT public.create_goil_user('zakiyu.mohammed@goil.com.gh',  'Mohammed Zakiyu',             'GoBitumen',                  'submitter');
SELECT public.create_goil_user('edna.akrasi@goil.com.gh',      'Edna Akrasi',                 'Head Office',                'submitter');
SELECT public.create_goil_user('elorm.klu@goil.com.gh',        'Irene Elorm Klu',             'Head Office',                'submitter');
SELECT public.create_goil_user('gyamfuahadun@gmail.com',       'Nana Akosua Gyamfuah Adu',   'Middle Belt',                'submitter');

-- Clean up helper (optional – keep if you want to add more users later)
-- DROP FUNCTION IF EXISTS public.create_goil_user;

-- ── Done ──────────────────────────────────────────────────────────────────────
-- Verify: SELECT email, role FROM public.user_profiles ORDER BY role, email;
