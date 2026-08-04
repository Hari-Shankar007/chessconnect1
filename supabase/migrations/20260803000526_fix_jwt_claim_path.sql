/*
# Fix JWT claim path in RLS policies

## Problem
All coach-check RLS policies use:
  auth.jwt() -> 'raw_app_meta_data' ->> 'role' = 'coach'

But `raw_app_meta_data` is the COLUMN NAME in auth.users, NOT the JWT claim name.
In the Supabase JWT, app metadata is stored under the `app_metadata` claim.
So `auth.jwt() -> 'raw_app_meta_data'` always returns NULL, meaning:
  - Coaches can't see student profiles (print credentials shows "no students")
  - Coaches can't insert/update/delete articles or tournaments (RLS violation)

## Fix
Change all coach-check policies from:
  auth.jwt() -> 'raw_app_meta_data' ->> 'role' = 'coach'
to:
  auth.jwt() -> 'app_metadata' ->> 'role' = 'coach'

## Affected policies
- profiles: profiles_select_own_or_coach_all (SELECT)
- articles: articles_insert_coach, articles_update_coach, articles_delete_coach
- tournaments: tournaments_insert_coach, tournaments_update_coach, tournaments_delete_coach
*/

-- ===== profiles =====
DROP POLICY IF EXISTS "profiles_select_own_or_coach_all" ON profiles;
CREATE POLICY "profiles_select_own_or_coach_all"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'coach'
  );

-- ===== articles =====
DROP POLICY IF EXISTS "articles_insert_coach" ON articles;
CREATE POLICY "articles_insert_coach"
  ON articles FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach');

DROP POLICY IF EXISTS "articles_update_coach" ON articles;
CREATE POLICY "articles_update_coach"
  ON articles FOR UPDATE
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach');

DROP POLICY IF EXISTS "articles_delete_coach" ON articles;
CREATE POLICY "articles_delete_coach"
  ON articles FOR DELETE
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach');

-- ===== tournaments =====
DROP POLICY IF EXISTS "tournaments_insert_coach" ON tournaments;
CREATE POLICY "tournaments_insert_coach"
  ON tournaments FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach');

DROP POLICY IF EXISTS "tournaments_update_coach" ON tournaments;
CREATE POLICY "tournaments_update_coach"
  ON tournaments FOR UPDATE
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach');

DROP POLICY IF EXISTS "tournaments_delete_coach" ON tournaments;
CREATE POLICY "tournaments_delete_coach"
  ON tournaments FOR DELETE
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'coach');
