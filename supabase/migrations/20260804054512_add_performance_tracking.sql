/*
# Performance Tracking + Profile Images

## Overview
Adds a full performance-tracking module for coaches to track each student's
progress, plus profile image support for students.

## New columns on existing tables

### profiles
- `image_url` (text, nullable) — public URL of the student's profile image.
  Added via ADD COLUMN IF NOT EXISTS. The existing profiles_update_own policy
  already allows a user to UPDATE their own row, so students can set their
  image_url without any new policy.

## New tables

### rating_entries
Monthly chess rating tracking per student, plotted on a graph.
- `id` (uuid PK)
- `student_id` (uuid FK profiles.id ON DELETE CASCADE)
- `rating` (integer, not null) — the rating value
- `month` (date, not null) — first day of the month being tracked (e.g. 2026-08-01)
- `created_at` (timestamptz default now())
- `created_by` (uuid FK profiles.id, default auth.uid()) — the coach who logged it
- Unique constraint on (student_id, month) so there's one rating per student per month.

### worksheets
Coach assigns worksheets to a student with a deadline and tracks completion.
- `id` (uuid PK)
- `student_id` (uuid FK profiles.id ON DELETE CASCADE)
- `title` (text, not null) — name of the worksheet
- `completed` (boolean, not null, default false)
- `assigned_at` (timestamptz, not null, default now()) — when the worksheet was given
- `deadline` (date, nullable) — due date
- `created_at` (timestamptz default now())
- `created_by` (uuid FK profiles.id, default auth.uid()) — the coach

### games_played
Tracks number of games played per student per month.
- `id` (uuid PK)
- `student_id` (uuid FK profiles.id ON DELETE CASCADE)
- `count` (integer, not null, default 0) — number of games played
- `month` (date, not null) — first day of the month
- `created_at` (timestamptz default now())
- `created_by` (uuid FK profiles.id, default auth.uid())
- Unique constraint on (student_id, month).

### tournament_participation
Tracks which tournaments each student has played in.
- `id` (uuid PK)
- `student_id` (uuid FK profiles.id ON DELETE CASCADE)
- `tournament_id` (uuid FK tournaments.id ON DELETE CASCADE, nullable)
  — links to the scheduled tournament if it exists in the tournaments table.
  Nullable so a coach can log a tournament that isn't in the calendar.
- `title` (text, not null) — name of the tournament (denormalized for display
  even when tournament_id is null)
- `played_at` (date, not null) — date the tournament was played
- `created_at` (timestamptz default now())
- `created_by` (uuid FK profiles.id, default auth.uid())

## Security (RLS)
All four new tables have RLS enabled. Access rules:
- rating_entries: coaches can SELECT/INSERT/UPDATE/DELETE all rows (they manage
  ratings). Students can SELECT their own rows.
- worksheets: coaches can SELECT/INSERT/UPDATE/DELETE all rows. Students can
  SELECT their own rows.
- games_played: coaches can SELECT/INSERT/UPDATE/DELETE all rows. Students can
  SELECT their own rows.
- tournament_participation: coaches can SELECT/INSERT/UPDATE/DELETE all rows.
  Students can SELECT their own rows.

Coach checks use `auth.jwt() -> 'app_metadata' ->> 'role' = 'coach'` (matching
the existing pattern from fix_jwt_claim_path.sql).

## Storage
- Creates a PUBLIC bucket `profile-images` for student profile photos.
  Public so avatars render via plain <img> tags without signed URLs.
- Storage policies: any authenticated user can upload (students set their own
  avatar), anyone can read (public bucket), only the owner can delete their own
  objects.

## Realtime
Adds all four new tables to the supabase_realtime publication so both coach and
student see updates without refreshing.
*/

-- ===== 1. profiles: add image_url =====
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS image_url text;

-- ===== 2. rating_entries =====
CREATE TABLE IF NOT EXISTS rating_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating integer NOT NULL,
  month date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rating_entries_student_month
  ON rating_entries (student_id, month);

ALTER TABLE rating_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rating_select_coach_or_own" ON rating_entries;
CREATE POLICY "rating_select_coach_or_own"
  ON rating_entries FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'coach'
    OR student_id = auth.uid()
  );

DROP POLICY IF EXISTS "rating_insert_coach" ON rating_entries;
CREATE POLICY "rating_insert_coach"
  ON rating_entries FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach');

DROP POLICY IF EXISTS "rating_update_coach" ON rating_entries;
CREATE POLICY "rating_update_coach"
  ON rating_entries FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach');

DROP POLICY IF EXISTS "rating_delete_coach" ON rating_entries;
CREATE POLICY "rating_delete_coach"
  ON rating_entries FOR DELETE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach');

-- ===== 3. worksheets =====
CREATE TABLE IF NOT EXISTS worksheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  deadline date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE
);

ALTER TABLE worksheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "worksheets_select_coach_or_own" ON worksheets;
CREATE POLICY "worksheets_select_coach_or_own"
  ON worksheets FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'coach'
    OR student_id = auth.uid()
  );

DROP POLICY IF EXISTS "worksheets_insert_coach" ON worksheets;
CREATE POLICY "worksheets_insert_coach"
  ON worksheets FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach');

DROP POLICY IF EXISTS "worksheets_update_coach" ON worksheets;
CREATE POLICY "worksheets_update_coach"
  ON worksheets FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach');

DROP POLICY IF EXISTS "worksheets_delete_coach" ON worksheets;
CREATE POLICY "worksheets_delete_coach"
  ON worksheets FOR DELETE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach');

-- ===== 4. games_played =====
CREATE TABLE IF NOT EXISTS games_played (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  count integer NOT NULL DEFAULT 0,
  month date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_games_played_student_month
  ON games_played (student_id, month);

ALTER TABLE games_played ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "games_select_coach_or_own" ON games_played;
CREATE POLICY "games_select_coach_or_own"
  ON games_played FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'coach'
    OR student_id = auth.uid()
  );

DROP POLICY IF EXISTS "games_insert_coach" ON games_played;
CREATE POLICY "games_insert_coach"
  ON games_played FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach');

DROP POLICY IF EXISTS "games_update_coach" ON games_played;
CREATE POLICY "games_update_coach"
  ON games_played FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach');

DROP POLICY IF EXISTS "games_delete_coach" ON games_played;
CREATE POLICY "games_delete_coach"
  ON games_played FOR DELETE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach');

-- ===== 5. tournament_participation =====
CREATE TABLE IF NOT EXISTS tournament_participation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tournament_id uuid REFERENCES tournaments(id) ON DELETE SET NULL,
  title text NOT NULL,
  played_at date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE
);

ALTER TABLE tournament_participation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tp_select_coach_or_own" ON tournament_participation;
CREATE POLICY "tp_select_coach_or_own"
  ON tournament_participation FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'coach'
    OR student_id = auth.uid()
  );

DROP POLICY IF EXISTS "tp_insert_coach" ON tournament_participation;
CREATE POLICY "tp_insert_coach"
  ON tournament_participation FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach');

DROP POLICY IF EXISTS "tp_update_coach" ON tournament_participation;
CREATE POLICY "tp_update_coach"
  ON tournament_participation FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach');

DROP POLICY IF EXISTS "tp_delete_coach" ON tournament_participation;
CREATE POLICY "tp_delete_coach"
  ON tournament_participation FOR DELETE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach');

-- ===== 6. Realtime =====
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'rating_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE rating_entries;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'worksheets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE worksheets;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'games_played'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE games_played;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'tournament_participation'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tournament_participation;
  END IF;
END $$;

-- ===== 7. Storage: profile-images bucket (public) =====
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-images', 'profile-images', true)
ON CONFLICT (id) DO NOTHING;

-- Any authenticated user can upload (students set their own avatar)
DROP POLICY IF EXISTS "profile_images_upload" ON storage.objects;
CREATE POLICY "profile_images_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'profile-images');

-- Anyone can read (public bucket)
DROP POLICY IF EXISTS "profile_images_read_all" ON storage.objects;
CREATE POLICY "profile_images_read_all"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'profile-images');

-- Owner can delete their own objects
DROP POLICY IF EXISTS "profile_images_delete_own" ON storage.objects;
CREATE POLICY "profile_images_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'profile-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
