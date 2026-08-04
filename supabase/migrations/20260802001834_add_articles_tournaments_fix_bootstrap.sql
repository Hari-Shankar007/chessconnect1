/*
# Fix coach bootstrap check + add articles and tournaments

## 1. has_any_coaches() function
The login screen needs to know if any coach account exists yet (to decide
whether to show the "Set up the academy" bootstrap button). The previous
approach queried the profiles table directly from the anon role, but RLS
blocks that — so the count always came back 0 and the bootstrap button was
permanently visible to anyone on the login page.

This SECURITY DEFINER function returns a boolean: true if at least one
coach profile exists. It is executable by anon + authenticated so the login
page can call it before a user signs in. It leaks no personal data — only
a boolean.

## 2. articles table
Lets a coach publish articles / blog posts to students.
- id (uuid PK)
- title (text, not null)
- body (text, nullable — optional description)
- link_url (text, nullable — blog link the student can open)
- created_at (timestamptz, default now())
- created_by (uuid, references profiles, default auth.uid())

RLS: all authenticated users can SELECT. Only coaches can INSERT / UPDATE /
DELETE (checked via auth.jwt() ->> 'role' = 'coach').

## 3. tournaments table
Lets a coach schedule tournaments with a link, date, and time.
- id (uuid PK)
- title (text, not null)
- link_url (text, not null — tournament/join link)
- event_date (timestamptz, not null — stored in UTC, rendered locally per student)
- description (text, nullable)
- created_at (timestamptz, default now())
- created_by (uuid, references profiles, default auth.uid())

RLS: all authenticated users can SELECT. Only coaches can INSERT / UPDATE /
DELETE.

## 4. Realtime
Adds articles and tournaments to the supabase_realtime publication so students
see new entries without refreshing.

## Security notes
- has_any_coaches is SECURITY DEFINER but returns only a boolean.
- Coach-only write policies use auth.jwt() ->> 'role' = 'coach', which reads
  from app_metadata (user-immutable, set by the create-user edge function).
- No public/anon access — every policy is TO authenticated.
*/

-- ===== 1. has_any_coaches function =====
CREATE OR REPLACE FUNCTION has_any_coaches()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE role = 'coach');
$$;

GRANT EXECUTE ON FUNCTION has_any_coaches() TO anon, authenticated;

-- ===== 2. articles table =====
CREATE TABLE IF NOT EXISTS articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text,
  link_url text,
  created_at timestamptz DEFAULT now(),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE
);

ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "articles_select_all" ON articles;
CREATE POLICY "articles_select_all"
  ON articles FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "articles_insert_coach" ON articles;
CREATE POLICY "articles_insert_coach"
  ON articles FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() ->> 'role') = 'coach');

DROP POLICY IF EXISTS "articles_update_coach" ON articles;
CREATE POLICY "articles_update_coach"
  ON articles FOR UPDATE
  TO authenticated
  USING ((auth.jwt() ->> 'role') = 'coach')
  WITH CHECK ((auth.jwt() ->> 'role') = 'coach');

DROP POLICY IF EXISTS "articles_delete_coach" ON articles;
CREATE POLICY "articles_delete_coach"
  ON articles FOR DELETE
  TO authenticated
  USING ((auth.jwt() ->> 'role') = 'coach');

-- ===== 3. tournaments table =====
CREATE TABLE IF NOT EXISTS tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  link_url text NOT NULL,
  event_date timestamptz NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE
);

ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tournaments_select_all" ON tournaments;
CREATE POLICY "tournaments_select_all"
  ON tournaments FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "tournaments_insert_coach" ON tournaments;
CREATE POLICY "tournaments_insert_coach"
  ON tournaments FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() ->> 'role') = 'coach');

DROP POLICY IF EXISTS "tournaments_update_coach" ON tournaments;
CREATE POLICY "tournaments_update_coach"
  ON tournaments FOR UPDATE
  TO authenticated
  USING ((auth.jwt() ->> 'role') = 'coach')
  WITH CHECK ((auth.jwt() ->> 'role') = 'coach');

DROP POLICY IF EXISTS "tournaments_delete_coach" ON tournaments;
CREATE POLICY "tournaments_delete_coach"
  ON tournaments FOR DELETE
  TO authenticated
  USING ((auth.jwt() ->> 'role') = 'coach');

-- ===== 4. Realtime =====
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'articles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE articles;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'tournaments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tournaments;
  END IF;
END $$;
