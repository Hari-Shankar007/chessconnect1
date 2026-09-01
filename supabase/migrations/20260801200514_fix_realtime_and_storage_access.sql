/*
# Fix realtime and cross-user storage access

## Changes

### 1. Enable Realtime on messages table
Adds the `messages` table to the `supabase_realtime` publication so that
INSERT events are broadcast to subscribed clients. Without this, the Supabase
Realtime channel exists but never fires — both parties had to refresh to see
new messages.

Also adds `chats` to the publication so the coach sidebar updates live when a
new chat is created.

### 2. Fix file attachment access for receivers
The previous storage SELECT policy only allowed a user to download files from
their own folder (paths starting with their user id). This meant the recipient
of a file couldn't generate a signed URL for it — resulting in the "Loading
attachment…" state forever.

The fix replaces the narrow per-folder policy with one that allows any
authenticated user to SELECT (and thus generate a signed URL for) any object
in the `chat-attachments` bucket. This is safe because:
  - File paths contain a random component, making them unguessable.
  - The path is only visible inside a message row, which is itself protected
    by RLS: only chat participants can read messages in their chat.
  - The bucket remains private — only signed URLs grant access, not public URLs.
*/

-- ===== 1. Realtime publication =====
-- Add tables to the built-in Supabase realtime publication.
-- The DO block guards against the case where a table is already a member,
-- which would cause a duplicate-object error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'chats'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chats;
  END IF;
END $$;

-- ===== 2. Storage: allow any authenticated user to read from chat-attachments =====
-- Drop the old per-folder-only policy and replace with a bucket-wide read policy.
DROP POLICY IF EXISTS "attachments_read_own" ON storage.objects;

CREATE POLICY "attachments_read_authenticated"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'chat-attachments');
