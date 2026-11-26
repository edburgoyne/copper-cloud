ALTER TABLE public.game_submissions
  DROP CONSTRAINT game_submissions_source_length;

ALTER TABLE public.game_submissions
  ADD CONSTRAINT game_submissions_source_length
  CHECK (octet_length(source_code) BETWEEN 1 AND 5242880);

ALTER TABLE public.game_submissions
  ADD COLUMN cover_image_path text;

CREATE OR REPLACE FUNCTION public.set_submission_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
AS $function$
BEGIN
  IF OLD.title IS DISTINCT FROM NEW.title
     OR OLD.description IS DISTINCT FROM NEW.description
     OR OLD.controls IS DISTINCT FROM NEW.controls
     OR OLD.source_code IS DISTINCT FROM NEW.source_code
     OR OLD.cover_image_path IS DISTINCT FROM NEW.cover_image_path
  THEN
    NEW.updated_at = now();
  ELSE
    NEW.updated_at = OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_submission_changes()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.submission_events (submission_id, actor_id, event_type)
    VALUES (NEW.id, NEW.user_id, 'submitted');
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.source_code IS DISTINCT FROM NEW.source_code THEN
      INSERT INTO public.submission_events (submission_id, actor_id, event_type)
      VALUES (NEW.id, auth.uid(), 'source_updated');
    END IF;
    IF OLD.title IS DISTINCT FROM NEW.title
       OR OLD.description IS DISTINCT FROM NEW.description
       OR OLD.controls IS DISTINCT FROM NEW.controls
       OR OLD.cover_image_path IS DISTINCT FROM NEW.cover_image_path
    THEN
      INSERT INTO public.submission_events (submission_id, actor_id, event_type)
      VALUES (NEW.id, auth.uid(), 'metadata_updated');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('submission-covers', 'submission-covers', false, 3145728, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 3145728,
    allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];

DROP POLICY IF EXISTS "Users upload own submission covers" ON storage.objects;
CREATE POLICY "Users upload own submission covers" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'submission-covers'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
    AND split_part(name, '/', 1) = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS "Owners and reviewers read submission covers" ON storage.objects;
CREATE POLICY "Owners and reviewers read submission covers" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'submission-covers'
    AND (
      split_part(name, '/', 1) = (SELECT auth.uid())::text
      OR EXISTS (
        SELECT 1
        FROM public.game_submissions AS submission
        WHERE submission.cover_image_path = name
          AND public.is_game_reviewer()
      )
    )
  );

DROP POLICY IF EXISTS "Owners delete own submission covers" ON storage.objects;
CREATE POLICY "Owners delete own submission covers" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'submission-covers'
    AND split_part(name, '/', 1) = (SELECT auth.uid())::text
  );

CREATE OR REPLACE FUNCTION public.submit_game (
  p_title text,
  p_description text,
  p_controls text,
  p_source_code text,
  p_cover_image_path text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_submission_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be logged in to submit a game';
  END IF;

  IF p_cover_image_path IS NOT NULL AND (
    p_cover_image_path !~ ('^' || v_user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$')
    OR NOT EXISTS (
      SELECT 1 FROM storage.objects AS stored_file
      WHERE stored_file.bucket_id = 'submission-covers'
        AND stored_file.name = p_cover_image_path
        AND stored_file.metadata ->> 'mimetype' = CASE
          WHEN p_cover_image_path LIKE '%.png' THEN 'image/png'
          WHEN p_cover_image_path LIKE '%.jpg' THEN 'image/jpeg'
          WHEN p_cover_image_path LIKE '%.webp' THEN 'image/webp'
        END
    )
    OR EXISTS (SELECT 1 FROM public.game_submissions WHERE cover_image_path = p_cover_image_path)
  ) THEN
    RAISE EXCEPTION 'The cover image is unavailable or does not belong to this account';
  END IF;

  INSERT INTO public.game_submissions (
    user_id, title, description, controls, source_code, cover_image_path, status
  ) VALUES (
    v_user_id, p_title, p_description, p_controls, p_source_code, p_cover_image_path, 'submitted'
  ) RETURNING id INTO v_submission_id;

  RETURN v_submission_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_game(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_game(text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.edit_submission (
  p_submission_id uuid,
  p_title text,
  p_description text,
  p_controls text,
  p_source_code text,
  p_cover_image_path text,
  p_remove_cover boolean
)
  RETURNS timestamptz
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_status text;
  v_updated_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be logged in to edit a submission';
  END IF;

  SELECT status INTO v_status
  FROM public.game_submissions
  WHERE id = p_submission_id AND user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submission not found or editing is not allowed';
  END IF;
  IF v_status NOT IN ('submitted', 'under_review', 'changes_requested') THEN
    RAISE EXCEPTION 'This submission can no longer be edited';
  END IF;
  IF p_remove_cover AND p_cover_image_path IS NOT NULL THEN
    RAISE EXCEPTION 'Choose either a replacement image or remove the current image';
  END IF;
  IF p_cover_image_path IS NOT NULL AND (
    p_cover_image_path !~ ('^' || v_user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$')
    OR NOT EXISTS (
      SELECT 1 FROM storage.objects AS stored_file
      WHERE stored_file.bucket_id = 'submission-covers'
        AND stored_file.name = p_cover_image_path
        AND stored_file.metadata ->> 'mimetype' = CASE
          WHEN p_cover_image_path LIKE '%.png' THEN 'image/png'
          WHEN p_cover_image_path LIKE '%.jpg' THEN 'image/jpeg'
          WHEN p_cover_image_path LIKE '%.webp' THEN 'image/webp'
        END
    )
    OR EXISTS (
      SELECT 1 FROM public.game_submissions
      WHERE cover_image_path = p_cover_image_path AND id <> p_submission_id
    )
  ) THEN
    RAISE EXCEPTION 'The cover image is unavailable or does not belong to this account';
  END IF;

  UPDATE public.game_submissions
  SET title = p_title,
      description = p_description,
      controls = p_controls,
      source_code = p_source_code,
      cover_image_path = CASE
        WHEN p_cover_image_path IS NOT NULL THEN p_cover_image_path
        WHEN p_remove_cover THEN NULL
        ELSE cover_image_path
      END,
      status = CASE WHEN v_status = 'changes_requested' THEN 'submitted' ELSE status END
  WHERE id = p_submission_id
  RETURNING updated_at INTO v_updated_at;
  RETURN v_updated_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.edit_submission(uuid, text, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_submission(uuid, text, text, text, text, text, boolean) TO authenticated;
