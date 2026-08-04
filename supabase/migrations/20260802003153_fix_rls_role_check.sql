/*
# Fix role check in RLS policies

## Problem
The profiles, articles, and tournaments RLS policies check
`auth.jwt() ->> 'role' = 'coach'`. In Supabase, the top-level `role`
claim in the JWT is the database role (e.g. 'authenticated'), NOT the
custom role we store in app_metadata. So `auth.jwt() ->> 'role'` always
returns 'authenticated', never 'coach' — meaning coaches could only
see their own profile, not their students, and couldn't write articles
or tournaments.

## Fix
Change all coach-check policies from:
  auth.jwt() ->> 'role' = 'coach'
to:
  auth.jwt() -> 'raw_app_meta_data' ->> 'role' = 'coach'

`raw_app_meta_data` is the JWT claim that holds the user's app_metadata,
which is where the create-user and bootstrap-admin edge functions store
the role. This is user-immutable (set by the server), so it's safe for
authorization.

## Affected policies
- profiles: select_own_or_coach_all (SELECT)
- articles: insert_coach, update_coach, delete_coach
- tournaments: insert_coach, update_coach, delete_coach
*/

-- ===== profiles =====
DROP POLICY IF EXISTS "profiles_select_own_or_coach_all" ON profiles;
CREATE POLICY "profiles_select_own_or_coach_all"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR (auth.jwt() -> 'raw_app_meta_data' ->> 'role') = 'coach'
  );

-- ===== articles =====
DROP POLICY IF EXISTS "articles_insert_coach" ON articles;
CREATE POLICY "articles_insert_coach"
  ON articles FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() -> 'raw_app_meta_data' ->> 'role') = 'coach');

DROP POLICY IF EXISTS "articles_update_coach" ON articles;
CREATE POLICY "articles_update_coach"
  ON articles FOR UPDATE
  TO authenticated
  USING ((auth.jwt() -> 'raw_app_meta_data' ->> 'role') = 'coach')
  WITH CHECK ((auth.jwt() -> 'raw_app_meta_data' ->> 'role') = 'coach');

DROP POLICY IF EXISTS "articles_delete_coach" ON articles;
CREATE POLICY "articles_delete_coach"
  ON articles FOR DELETE
  TO authenticated
  USING ((auth.jwt() -> 'raw_app_meta_data' ->> 'role') = 'coach');

-- ===== tournaments =====
DROP POLICY IF EXISTS "tournaments_insert_coach" ON tournaments;
CREATE POLICY "tournaments_insert_coach"
  ON tournaments FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() -> 'raw_app_meta_data' ->> 'role') = 'coach');

DROP POLICY IF EXISTS "tournaments_update_coach" ON tournaments;
CREATE POLICY "tournaments_update_coach"
  ON tournaments FOR UPDATE
  TO authenticated
  USING ((auth.jwt() -> 'raw_app_meta_data' ->> 'role') = 'coach')
  WITH CHECK ((auth.jwt() -> 'raw_app_meta_data' ->> 'role') = 'coach');

DROP POLICY IF EXISTS "tournaments_delete_coach" ON tournaments;
CREATE POLICY "tournaments_delete_coach"
  ON tournaments FOR DELETE
  TO authenticated
  USING ((auth.jwt() -> 'raw_app_meta_data' ->> 'role') = 'coach');
