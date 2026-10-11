-- ============================================================================
-- VisionConnect Jobs — complete database schema (Supabase / PostgreSQL)
--
-- SAFE TO RE-RUN: works on a brand-new project AND on an existing one.
-- Run the whole file once in:  Supabase Dashboard -> SQL Editor -> New query.
--
-- SECURITY MODEL
--   The Express server talks to Supabase with the SERVICE ROLE key (server
--   side only, never sent to a browser). Every table has Row Level Security
--   ENABLED with NO policies for the public "anon"/"authenticated" roles, so
--   the public anon key can read or write NOTHING.
--   (The old schema allowed anon SELECT/INSERT on `users`, which exposed
--   password hashes and let anyone create an admin. Those policies are
--   dropped below.)
-- ============================================================================

-- 1. USERS --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('seeker', 'employer', 'admin')),
    name          TEXT NOT NULL,
    is_approved   BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. PROFILES (job seekers) ----------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    bio        TEXT,
    skills     TEXT,
    education  TEXT,
    phone      TEXT,
    location   TEXT,
    resume_path TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS disability_type        TEXT,
    ADD COLUMN IF NOT EXISTS disability_category    TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS disability_percent     INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS udid_number            TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS disability_certificate TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS accessibility_needs    TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS assistive_tech         TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS preferred_work_mode    TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS preferred_interview    TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS languages              TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS certifications         TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS work_experience        TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS linkedin_url           TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS portfolio_url          TEXT    DEFAULT '';

-- 3. JOBS ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
    id           SERIAL PRIMARY KEY,
    employer_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    company      TEXT NOT NULL,
    location     TEXT,
    job_type     TEXT NOT NULL,
    description  TEXT NOT NULL,
    requirements TEXT,
    salary_range TEXT,
    accessibility_features TEXT,
    is_approved  BOOLEAN DEFAULT FALSE,
    is_active    BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS disability_categories   TEXT    DEFAULT 'all',
    ADD COLUMN IF NOT EXISTS min_disability_percent  INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS udid_required           BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS work_mode               TEXT    DEFAULT 'office',
    ADD COLUMN IF NOT EXISTS interview_modes         TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS assistive_tech_provided TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS accommodation_details   TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS experience_required     TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS openings                INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS application_deadline    DATE,
    ADD COLUMN IF NOT EXISTS rejection_reason        TEXT,
    ADD COLUMN IF NOT EXISTS updated_at              TIMESTAMPTZ DEFAULT NOW();

-- 4. APPLICATIONS --------------------------------------------------------
CREATE TABLE IF NOT EXISTS applications (
    id             SERIAL PRIMARY KEY,
    job_id         INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
    seeker_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
    status         TEXT DEFAULT 'applied'
                   CHECK (status IN ('applied','reviewed','shortlisted','rejected','hired')),
    cover_letter   TEXT,
    is_quick_apply BOOLEAN DEFAULT FALSE,
    applied_at     TIMESTAMPTZ DEFAULT NOW()
);
-- One application per person per job (the server also checks this).
-- If this line fails, delete duplicate rows first, then run it again.
CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_job_seeker
    ON applications (job_id, seeker_id);

-- 5. SAVED JOBS ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_jobs (
    id       SERIAL PRIMARY KEY,
    user_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
    job_id   INTEGER REFERENCES jobs(id)  ON DELETE CASCADE,
    saved_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, job_id)
);

-- 6. SESSIONS (so logins survive server restarts / Render sleep) ---------
CREATE TABLE IF NOT EXISTS sessions (
    sid    TEXT PRIMARY KEY,
    sess   JSONB NOT NULL,
    expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions (expire);

-- 7. INDEXES -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_jobs_listing      ON jobs (is_approved, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_employer     ON jobs (employer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_disability   ON jobs (disability_categories);
CREATE INDEX IF NOT EXISTS idx_applications_job  ON applications (job_id);
CREATE INDEX IF NOT EXISTS idx_applications_seek ON applications (seeker_id);
CREATE INDEX IF NOT EXISTS idx_saved_user        ON saved_jobs (user_id);

-- 8. ROW LEVEL SECURITY: lock everything for public roles ------------------
ALTER TABLE users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_jobs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions     ENABLE ROW LEVEL SECURITY;

-- Remove every policy the older schema created (they were unsafe).
DROP POLICY IF EXISTS "Enable registration for anonymous users"        ON users;
DROP POLICY IF EXISTS "Enable select for email checking"               ON users;
DROP POLICY IF EXISTS "Enable profile creation for anonymous seekers"  ON profiles;
DROP POLICY IF EXISTS "Profiles are manageable by owners"              ON profiles;
DROP POLICY IF EXISTS "Anyone can view approved jobs"                  ON jobs;
DROP POLICY IF EXISTS "Employers manage their own jobs"                ON jobs;
DROP POLICY IF EXISTS "Seekers see their own applications"             ON applications;
DROP POLICY IF EXISTS "Users manage their own saved jobs"              ON saved_jobs;
-- The service role bypasses RLS, so the server keeps full access.

-- 9. PASSWORD RESET TOKENS (only a hash of the token is stored) ------------
CREATE TABLE IF NOT EXISTS password_resets (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id);
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
