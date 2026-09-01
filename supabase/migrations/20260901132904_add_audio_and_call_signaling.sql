/*
# Add audio support to messages + call signaling tables

## 1. messages.file_type constraint
- Drops and recreates the CHECK constraint on messages.file_type to add
  'audio' as an allowed value (alongside existing 'pdf' and 'image').
  This enables voice messages to be stored as file attachments.

## 2. call_signaling table
- Stores WebRTC call offers, answers, and ICE candidates so two peers
  (coach + student in a chat) can establish a peer-to-peer voice/video call
  without a separate signaling server. Supabase Realtime delivers the
  "call started" event; the offer/answer/ICE are polled or delivered via
  realtime inserts on this table.

  Columns:
  - id (uuid PK)
  - chat_id (uuid FK chats.id ON DELETE CASCADE) — which conversation
  - caller_id (uuid FK profiles.id) — who initiated the call
  - callee_id (uuid FK profiles.id) — who is being called
  - call_type (text: 'audio' | 'video') — what kind of call
  - status (text: 'ringing' | 'accepted' | 'declined' | 'ended' | 'missed')
  - sdp_offer (text, nullable) — SDP offer from caller
  - sdp_answer (text, nullable) — SDP answer from callee
  - caller_ice (jsonb, nullable) — ICE candidates from caller
  - callee_ice (jsonb, nullable) — ICE candidates from callee
  - created_at (timestamptz default now())
  - updated_at (timestamptz default now())

## 3. RLS on call_signaling
- Both coach and student in the chat can SELECT/INSERT/UPDATE.
  Access scoped via EXISTS check on chats table (participant check).
- DELETE not needed (rows age out or are updated to 'ended').

## 4. Realtime
- Adds call_signaling to supabase_realtime publication so both parties
  see call events instantly.
*/

-- ===== 1. messages file_type constraint =====
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_file_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_file_type_check
  CHECK (file_type IS NULL OR file_type IN ('pdf', 'image', 'audio'));

-- ===== 2. call_signaling table =====
CREATE TABLE IF NOT EXISTS call_signaling (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  caller_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  callee_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  call_type text NOT NULL CHECK (call_type IN ('audio', 'video')),
  status text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'accepted', 'declined', 'ended', 'missed')),
  sdp_offer text,
  sdp_answer text,
  caller_ice jsonb,
  callee_ice jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_signaling_chat ON call_signaling (chat_id, created_at DESC);

ALTER TABLE call_signaling ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_select_participant" ON call_signaling;
CREATE POLICY "call_select_participant"
  ON call_signaling FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = call_signaling.chat_id
        AND (c.student_id = auth.uid() OR c.coach_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "call_insert_participant" ON call_signaling;
CREATE POLICY "call_insert_participant"
  ON call_signaling FOR INSERT TO authenticated
  WITH CHECK (
    caller_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = call_signaling.chat_id
        AND (c.student_id = auth.uid() OR c.coach_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "call_update_participant" ON call_signaling;
CREATE POLICY "call_update_participant"
  ON call_signaling FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = call_signaling.chat_id
        AND (c.student_id = auth.uid() OR c.coach_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = call_signaling.chat_id
        AND (c.student_id = auth.uid() OR c.coach_id = auth.uid())
    )
  );

-- ===== 3. Realtime =====
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'call_signaling'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE call_signaling;
  END IF;
END $$;
