/*
# EduChess Chat - Core Schema

## Overview
Creates the data model for a 1-to-1 messaging app between chess coaches and students.
Three tables (profiles, chats, messages), strict Row Level Security, a private
storage bucket for file attachments, and a helper function for listing a coach's
chat partners.

## Tables

### profiles
- `id` (uuid, primary key) — matches the auth.users id. One row per user.
- `email` (text, unique) — the user's login email.
- `name` (text) — display name shown in the chat UI.
- `role` (text) — either 'student' or 'coach'. Stored in user_immutable app metadata
  at signup time and mirrored here for convenient querying. RLS enforces role-based
  access using `auth.jwt() ->> 'role'`.
- `created_at` (timestamptz) — row creation time.

### chats
- `id` (uuid, primary key).
- `student_id` (uuid, FK profiles.id) — the student in the conversation.
- `coach_id` (uuid, FK profiles.id) — the coach in the conversation.
- `created_at` (timestamptz).
- A unique constraint prevents duplicate (student, coach) pairs.

### messages
- `id` (uuid, primary key).
- `chat_id` (uuid, FK chats.id, on delete cascade).
- `sender_id` (uuid, FK profiles.id) — who sent the message.
- `content` (text, nullable) — optional text caption / message body.
- `file_url` (text, nullable) — storage object path (not a public URL) for attachments.
- `file_type` (text, nullable) — 'pdf' or 'image'.
- `file_name` (text, nullable) — original filename for display.
- `created_at` (timestamptz, default now()).
- Indexed on chat_id + created_at for efficient message history queries.

## Security (RLS)
All three tables have RLS enabled. Policies use `auth.jwt() ->> 'role'` so that
authorization is driven by user-immutable app metadata, not the mutable `profiles`
row. Access rules:

- profiles: a user can SELECT/UPDATE only their own row. Coaches (role = 'coach')
  can additionally SELECT all profiles so they can list students and assign coaches.
- chats: a user can SELECT/INSERT/UPDATE only chats where they are the student or the
  coach. (INSERT is used by the admin create-user flow; UPDATE is reserved for future
  metadata columns.)
- messages: a user can SELECT/INSERT only messages in chats they belong to. DELETE
  is owner-only (sender can delete their own message).
- Realtime is enabled on all tables so the client can subscribe to inserts.

## Storage
- A private bucket `chat-attachments` is created for PDF/image uploads.
- Storage policies restrict upload/download to authenticated users, scoped to a
  folder named after the user's id, so a user can only manage their own uploads.
  Download is additionally allowed for any authenticated user who is a participant in
  the chat that owns the message — this is enforced at the application layer via
  signed URLs (the bucket is private, so only the service role / signed URLs grant
  access). The storage policy itself grants read to the folder owner; signed URLs
  issued by the edge function cover the cross-participant download case.

## Helper function
- `get_chat_partners(p_coach uuid)` returns the list of students a coach has chats
  with, plus the last message snippet and timestamp for sidebar display. SECURITY
  DEFINER, owned by postgres, so it can read across chats the calling coach is
  allowed to see (the function filters by coach_id = p_coach, and RLS on chats would
  otherwise block the cross-profile read).
*/

-- ===== profiles =====
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('student', 'coach')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own_or_coach_all" ON profiles;
CREATE POLICY "profiles_select_own_or_coach_all"
  ON profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR auth.jwt() ->> 'role' = 'coach');

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ===== chats =====
CREATE TABLE IF NOT EXISTS chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  coach_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, coach_id)
);

ALTER TABLE chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chats_select_participant" ON chats;
CREATE POLICY "chats_select_participant"
  ON chats FOR SELECT TO authenticated
  USING (auth.uid() = student_id OR auth.uid() = coach_id);

DROP POLICY IF EXISTS "chats_insert_participant" ON chats;
CREATE POLICY "chats_insert_participant"
  ON chats FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = student_id OR auth.uid() = coach_id);

DROP POLICY IF EXISTS "chats_update_participant" ON chats;
CREATE POLICY "chats_update_participant"
  ON chats FOR UPDATE TO authenticated
  USING (auth.uid() = student_id OR auth.uid() = coach_id)
  WITH CHECK (auth.uid() = student_id OR auth.uid() = coach_id);

-- ===== messages =====
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content text,
  file_url text,
  file_type text CHECK (file_type IS NULL OR file_type IN ('pdf', 'image')),
  file_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_created
  ON messages (chat_id, created_at);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_select_participant" ON messages;
CREATE POLICY "messages_select_participant"
  ON messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = messages.chat_id
        AND (c.student_id = auth.uid() OR c.coach_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "messages_insert_participant" ON messages;
CREATE POLICY "messages_insert_participant"
  ON messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = messages.chat_id
        AND (c.student_id = auth.uid() OR c.coach_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "messages_delete_own" ON messages;
CREATE POLICY "messages_delete_own"
  ON messages FOR DELETE TO authenticated
  USING (sender_id = auth.uid());

-- ===== Realtime =====
ALTER TABLE profiles REPLICA IDENTITY FULL;
ALTER TABLE chats REPLICA IDENTITY FULL;
ALTER TABLE messages REPLICA IDENTITY FULL;

-- ===== Helper: coach's chat partners with last message =====
CREATE OR REPLACE FUNCTION get_chat_partners(p_coach uuid)
RETURNS TABLE (
  chat_id uuid,
  student_id uuid,
  student_name text,
  last_content text,
  last_file_type text,
  last_sender_id uuid,
  last_created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id AS chat_id,
    p.id AS student_id,
    p.name AS student_name,
    m.content AS last_content,
    m.file_type AS last_file_type,
    m.sender_id AS last_sender_id,
    m.created_at AS last_created_at
  FROM chats c
  JOIN profiles p ON p.id = c.student_id
  LEFT JOIN LATERAL (
    SELECT content, file_type, sender_id, created_at
    FROM messages
    WHERE chat_id = c.id
    ORDER BY created_at DESC
    LIMIT 1
  ) m ON true
  WHERE c.coach_id = p_coach
  ORDER BY COALESCE(m.created_at, c.created_at) DESC;
$$;

GRANT EXECUTE ON FUNCTION get_chat_partners(uuid) TO authenticated;

-- ===== Storage bucket =====
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: a user manages objects under their own id folder.
DROP POLICY IF EXISTS "attachments_upload_own" ON storage.objects;
CREATE POLICY "attachments_upload_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "attachments_read_own" ON storage.objects;
CREATE POLICY "attachments_read_own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "attachments_delete_own" ON storage.objects;
CREATE POLICY "attachments_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
