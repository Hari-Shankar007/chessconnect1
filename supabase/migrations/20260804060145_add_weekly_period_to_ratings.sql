/*
# Add weekly period support to rating_entries

## Changes
- Adds `period` column (text, 'weekly' | 'monthly', default 'monthly') to
  rating_entries. This lets a coach log ratings either every week or every
  month for each student.
- Replaces the unique index on (student_id, month) with one on
  (student_id, month, period) so a student can have one weekly entry per
  week AND one monthly entry per month without conflict. The `month` column
  stores the start date of the period (first of month for monthly, Monday
  of the week for weekly).

## Notes
- No columns dropped or renamed; `month` is reused as the period start date.
- No data loss — existing monthly entries keep working with period='monthly'.
- RLS policies unchanged (they already allow coach full CRUD, students read own).
*/

ALTER TABLE rating_entries
  ADD COLUMN IF NOT EXISTS period text NOT NULL DEFAULT 'monthly'
  CHECK (period IN ('weekly', 'monthly'));

-- Replace the unique index to include period
DROP INDEX IF EXISTS idx_rating_entries_student_month;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rating_entries_student_period
  ON rating_entries (student_id, month, period);
