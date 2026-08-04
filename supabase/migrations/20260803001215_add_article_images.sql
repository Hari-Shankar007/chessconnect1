/*
# Add image support to articles

1. Schema changes
- Add `image_url` (text, nullable) column to the `articles` table.
  Stores the public URL of an uploaded image, or null if no image.

2. Storage
- Create a new PUBLIC bucket `article-images` for article cover images.
  Public is appropriate here because articles are visible to all students
  and the image is meant to be displayed inline.
- Add storage policies:
  - INSERT: only coaches can upload (role check via app_metadata)
  - SELECT: public read (anyone, including anon) — bucket is public
  - DELETE: only coaches can delete

3. Notes
- The column is nullable so existing articles without images are unaffected.
- The bucket is public so images render via plain <img> tags without signed URLs.
*/

-- ===== 1. Add image_url column =====
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS image_url text;

-- ===== 2. Create public storage bucket =====
INSERT INTO storage.buckets (id, name, public)
VALUES ('article-images', 'article-images', true)
ON CONFLICT (id) DO NOTHING;

-- ===== 3. Storage policies =====
-- Coaches can upload to article-images
DROP POLICY IF EXISTS "article_images_insert_coach" ON storage.objects;
CREATE POLICY "article_images_insert_coach"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'article-images'
    AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'coach'
  );

-- Anyone can read (public bucket)
DROP POLICY IF EXISTS "article_images_read_all" ON storage.objects;
CREATE POLICY "article_images_read_all"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'article-images');

-- Coaches can delete
DROP POLICY IF EXISTS "article_images_delete_coach" ON storage.objects;
CREATE POLICY "article_images_delete_coach"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'article-images'
    AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'coach'
  );
