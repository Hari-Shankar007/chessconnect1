/*
# Update get_chat_partners to include student profile image

## Changes
- Adds `student_image` (text) to the return columns of get_chat_partners().
  This lets the coach sidebar display the student's profile photo alongside
  their name, without a separate query.

## Notes
- Must DROP FUNCTION first because the return type changed (new column).
- No new tables, no RLS changes.
*/

DROP FUNCTION IF EXISTS get_chat_partners(uuid);

CREATE FUNCTION get_chat_partners(p_coach uuid)
RETURNS TABLE (
  chat_id uuid,
  student_id uuid,
  student_name text,
  student_image text,
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
    p.image_url AS student_image,
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
