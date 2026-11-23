SET local check_function_bodies = off;

CREATE TABLE "public"."game_submissions" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"     uuid                     NOT NULL,
  "title"       text                     NOT NULL,
  "description" text                     NOT NULL,
  "controls"    text                     NOT NULL,
  "source_code" text                     NOT NULL,
  "status"      text                     NOT NULL DEFAULT 'submitted'::text,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "game_submissions_controls_length" CHECK (((char_length(controls) >= 1) AND (char_length(controls) <= 1000))),
  CONSTRAINT "game_submissions_description_length" CHECK (((char_length(description) >= 1) AND (char_length(description) <= 2000))),
  CONSTRAINT "game_submissions_pkey" PRIMARY KEY (id),
  CONSTRAINT "game_submissions_source_length" CHECK (((octet_length(source_code) >= 1) AND (octet_length(source_code) <= 102400))),
  CONSTRAINT "game_submissions_status_valid" CHECK ((status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'changes_requested'::text, 'approved'::text, 'rejected'::text]))),
  CONSTRAINT "game_submissions_title_length" CHECK (((char_length(title) >= 3) AND (char_length(title) <= 100)))
);

ALTER TABLE "public"."game_submissions"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."game_submissions" FROM "anon";

CREATE TABLE "public"."profiles" (
  "id"         uuid                     NOT NULL,
  "username"   text                     NOT NULL,
  "role"       text                     NOT NULL DEFAULT 'player'::text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id),
  CONSTRAINT "profiles_username_format" CHECK ((username ~ '^[A-Za-z0-9_]{3,20}$'::text)),
  CONSTRAINT "profiles_username_key" UNIQUE (username)
);

ALTER TABLE "public"."profiles"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."profiles" FROM "anon";

CREATE TABLE "public"."submission_events" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "submission_id" uuid                     NOT NULL,
  "actor_id"      uuid,
  "event_type"    text                     NOT NULL,
  "details"       jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "submission_events_pkey" PRIMARY KEY (id),
  CONSTRAINT "submission_events_type_valid"
    CHECK
    ((event_type = ANY (ARRAY['submitted'::text, 'source_updated'::text, 'metadata_updated'::text, 'review_started'::text, 'changes_requested'::text, 'approval_recommended'::text,
    'rejection_recommended'::text, 'approved'::text, 'rejected'::text, 'published'::text])))
);

ALTER TABLE "public"."submission_events"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."submission_events" FROM "anon";

CREATE OR REPLACE FUNCTION public.change_username (
  new_username text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
    -- Make sure the caller is authenticated.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'You must be logged in';
    END IF;

    -- Validate the requested username.
    IF new_username IS NULL
       OR new_username !~ '^[A-Za-z0-9_]{3,20}$'
    THEN
        RAISE EXCEPTION
            'Username must contain 3-20 letters, numbers, or underscores';
    END IF;

    -- Update only the username column.
    UPDATE public.profiles
    SET username = new_username
    WHERE id = (SELECT auth.uid());

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Profile not found';
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."change_username"(text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.check_submission_limit()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
    open_count INTEGER;
BEGIN
    -- Only check newly created submissions.
    IF TG_OP = 'INSERT' THEN

        -- Serialize submission creation for this user.
        PERFORM 1
        FROM public.profiles
        WHERE id = NEW.user_id
        FOR UPDATE;

        SELECT COUNT(*)
        INTO open_count
        FROM public.game_submissions
        WHERE user_id = NEW.user_id
          AND status IN (
              'submitted',
              'under_review',
              'changes_requested'
          );

        IF open_count >= 3 THEN
            RAISE EXCEPTION
                'You already have three open game submissions';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."check_submission_limit"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.decide_submission (
  p_submission_id uuid,
  p_decision      text,
  p_feedback      text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_user_id UUID;
    v_account_role TEXT;
    v_status TEXT;
    v_content_updated_at TIMESTAMPTZ;
BEGIN
    v_user_id := (SELECT auth.uid());

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'You must be logged in';
    END IF;

    SELECT p.role
    INTO v_account_role
    FROM public.profiles AS p
    WHERE p.id = v_user_id;

    IF v_account_role IS DISTINCT FROM 'super_admin' THEN
        RAISE EXCEPTION 'Super Admin permissions required';
    END IF;

    IF p_decision IS NULL
       OR p_decision NOT IN ('approve', 'reject') THEN
        RAISE EXCEPTION 'Invalid decision';
    END IF;

    IF p_feedback IS NULL
       OR char_length(trim(p_feedback)) NOT BETWEEN 1 AND 2000 THEN
        RAISE EXCEPTION 'Feedback must contain 1-2000 characters';
    END IF;

    SELECT s.status, s.updated_at
    INTO v_status, v_content_updated_at
    FROM public.game_submissions AS s
    WHERE s.id = p_submission_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Submission not found';
    END IF;

    IF v_status NOT IN (
        'submitted',
        'under_review',
        'changes_requested'
    ) THEN
        RAISE EXCEPTION
            'This submission already has a final decision';
    END IF;

    UPDATE public.game_submissions
    SET status = CASE p_decision
        WHEN 'approve' THEN 'approved'
        ELSE 'rejected'
    END
    WHERE id = p_submission_id;

    INSERT INTO public.submission_events (
        submission_id,
        actor_id,
        event_type,
        details
    )
    VALUES (
        p_submission_id,
        v_user_id,
        CASE p_decision
            WHEN 'approve' THEN 'approved'
            ELSE 'rejected'
        END,
        jsonb_build_object(
            'decision', p_decision,
            'feedback', trim(p_feedback),
            'reviewed_submission_updated_at',
                v_content_updated_at
        )
    );
END;
$function$;

REVOKE ALL ON FUNCTION "public"."decide_submission"(uuid, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.edit_submission (
  p_submission_id uuid,
  p_title         text,
  p_description   text,
  p_controls      text,
  p_source_code   text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    current_user_id UUID;
    current_status TEXT;
BEGIN
    current_user_id := (SELECT auth.uid());

    IF current_user_id IS NULL THEN
        RAISE EXCEPTION
            'You must be logged in to edit a submission';
    END IF;

    -- Lock the submission and verify ownership.
    SELECT status
    INTO current_status
    FROM public.game_submissions
    WHERE id = p_submission_id
      AND user_id = current_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Submission not found or editing is not allowed';
    END IF;

    IF current_status NOT IN (
        'submitted',
        'under_review',
        'changes_requested'
    ) THEN
        RAISE EXCEPTION
            'This submission can no longer be edited';
    END IF;

    -- Update the game and reset the review status
    -- when responding to requested changes.
    UPDATE public.game_submissions
    SET
        title = p_title,
        description = p_description,
        controls = p_controls,
        source_code = p_source_code,
        status = CASE
            WHEN current_status = 'changes_requested'
                THEN 'submitted'
            ELSE status
        END
    WHERE id = p_submission_id;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."edit_submission"(uuid, text, text, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_submission_feedback (
  p_submission_id uuid
)
  RETURNS TABLE (
    event_type text,
    feedback   text,
    created_at timestamp with time zone
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    SELECT
        e.event_type,
        e.details ->> 'feedback',
        e.created_at
    FROM public.submission_events AS e
    JOIN public.game_submissions AS s
      ON s.id = e.submission_id
    WHERE s.id = p_submission_id
      AND s.user_id = (SELECT auth.uid())
      AND e.event_type IN (
          'approval_recommended',
          'rejection_recommended',
          'changes_requested',
          'approved',
          'rejected'
      )
    ORDER BY e.created_at DESC, e.id DESC;
$function$;

REVOKE ALL ON FUNCTION "public"."get_submission_feedback"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
    INSERT INTO public.profiles (id, username, role)
    VALUES (
        NEW.id,
        NEW.raw_user_meta_data ->> 'username',
        'player'
    );

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.is_game_reviewer()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = (SELECT auth.uid())
          AND role IN ('admin', 'super_admin')
    );
$function$;

REVOKE ALL ON FUNCTION "public"."is_game_reviewer"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.is_super_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = (SELECT auth.uid())
          AND role = 'super_admin'
    );
$function$;

REVOKE ALL ON FUNCTION "public"."is_super_admin"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.record_submission_changes()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.submission_events (
            submission_id,
            actor_id,
            event_type
        )
        VALUES (
            NEW.id,
            NEW.user_id,
            'submitted'
        );

    ELSIF TG_OP = 'UPDATE' THEN

        IF OLD.source_code IS DISTINCT FROM NEW.source_code THEN
            INSERT INTO public.submission_events (
                submission_id,
                actor_id,
                event_type
            )
            VALUES (
                NEW.id,
                auth.uid(),
                'source_updated'
            );
        END IF;

        IF OLD.title IS DISTINCT FROM NEW.title
           OR OLD.description IS DISTINCT FROM NEW.description
           OR OLD.controls IS DISTINCT FROM NEW.controls
        THEN
            INSERT INTO public.submission_events (
                submission_id,
                actor_id,
                event_type
            )
            VALUES (
                NEW.id,
                auth.uid(),
                'metadata_updated'
            );
        END IF;

    END IF;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."record_submission_changes"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.review_submission (
  p_submission_id  uuid,
  p_recommendation text,
  p_feedback       text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_user_id UUID;
    v_account_role TEXT;
    v_status TEXT;
    v_content_updated_at TIMESTAMPTZ;
BEGIN
    v_user_id := (SELECT auth.uid());

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'You must be logged in';
    END IF;

    SELECT p.role
    INTO v_account_role
    FROM public.profiles AS p
    WHERE p.id = v_user_id;

    IF v_account_role IS NULL
       OR v_account_role NOT IN ('admin', 'super_admin') THEN
        RAISE EXCEPTION 'Admin permissions required';
    END IF;

    IF p_recommendation IS NULL
       OR p_recommendation NOT IN (
           'approve',
           'reject',
           'request_changes'
       ) THEN
        RAISE EXCEPTION 'Invalid recommendation';
    END IF;

    IF p_feedback IS NULL
       OR char_length(trim(p_feedback)) NOT BETWEEN 1 AND 2000 THEN
        RAISE EXCEPTION 'Feedback must contain 1-2000 characters';
    END IF;

    SELECT s.status, s.updated_at
    INTO v_status, v_content_updated_at
    FROM public.game_submissions AS s
    WHERE s.id = p_submission_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Submission not found';
    END IF;

    IF v_status NOT IN (
        'submitted',
        'under_review',
        'changes_requested'
    ) THEN
        RAISE EXCEPTION
            'This submission is no longer open for review';
    END IF;

    IF p_recommendation = 'request_changes' THEN
        UPDATE public.game_submissions
        SET status = 'changes_requested'
        WHERE id = p_submission_id;
    ELSE
        UPDATE public.game_submissions
        SET status = 'under_review'
        WHERE id = p_submission_id;
    END IF;

    INSERT INTO public.submission_events (
        submission_id,
        actor_id,
        event_type,
        details
    )
    VALUES (
        p_submission_id,
        v_user_id,
        CASE p_recommendation
            WHEN 'approve' THEN 'approval_recommended'
            WHEN 'reject' THEN 'rejection_recommended'
            ELSE 'changes_requested'
        END,
        jsonb_build_object(
            'recommendation', p_recommendation,
            'feedback', trim(p_feedback),
            'reviewed_submission_updated_at',
                v_content_updated_at
        )
    );
END;
$function$;

REVOKE ALL ON FUNCTION "public"."review_submission"(uuid, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_submission_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
    -- Only change updated_at when game content changes.
    IF OLD.title IS DISTINCT FROM NEW.title
       OR OLD.description IS DISTINCT FROM NEW.description
       OR OLD.controls IS DISTINCT FROM NEW.controls
       OR OLD.source_code IS DISTINCT FROM NEW.source_code
    THEN
        NEW.updated_at = now();
    ELSE
        NEW.updated_at = OLD.updated_at;
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."set_submission_updated_at"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.submit_game (
  p_title       text,
  p_description text,
  p_controls    text,
  p_source_code text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    new_submission_id UUID;
    current_user_id UUID;
BEGIN
    current_user_id := (SELECT auth.uid());

    IF current_user_id IS NULL THEN
        RAISE EXCEPTION 'You must be logged in to submit a game';
    END IF;

    INSERT INTO public.game_submissions (
        user_id,
        title,
        description,
        controls,
        source_code,
        status
    )
    VALUES (
        current_user_id,
        p_title,
        p_description,
        p_controls,
        p_source_code,
        'submitted'
    )
    RETURNING id INTO new_submission_id;

    RETURN new_submission_id;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."submit_game"(text, text, text, text) FROM PUBLIC, "anon";

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."game_submissions"
  ADD CONSTRAINT "game_submissions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."submission_events"
  ADD CONSTRAINT "submission_events_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."submission_events"
  ADD CONSTRAINT "submission_events_submission_id_fkey" FOREIGN KEY (submission_id) REFERENCES public.game_submissions(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX profiles_username_lower_unique ON public.profiles USING btree (lower(username));

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER enforce_submission_limit
  BEFORE INSERT ON public.game_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.check_submission_limit();

CREATE TRIGGER on_submission_changed
  AFTER INSERT OR UPDATE ON public.game_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.record_submission_changes();

CREATE TRIGGER set_submission_updated_at
  BEFORE UPDATE ON public.game_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_submission_updated_at();

CREATE POLICY "Reviewers can read all submissions" ON "public"."game_submissions"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_game_reviewer() AS is_game_reviewer));

CREATE POLICY "Users can read their own submissions" ON "public"."game_submissions"
  FOR SELECT
  TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "Users can read their own profile" ON "public"."profiles"
  FOR SELECT
  TO "authenticated"
  USING ((( SELECT auth.uid() AS uid) = id));

CREATE POLICY "Super Admin can read submission history" ON "public"."submission_events"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_super_admin() AS is_super_admin));

COMMENT ON COLUMN "public"."profiles"."created_at" IS '[SENSITIVE]';

COMMENT ON COLUMN "public"."profiles"."id" IS '[SENSITIVE]';

GRANT EXECUTE ON FUNCTION "public"."change_username"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."change_username"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."change_username"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."change_username"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."check_submission_limit"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."check_submission_limit"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."check_submission_limit"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."decide_submission"(uuid, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."decide_submission"(uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."decide_submission"(uuid, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."decide_submission"(uuid, text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."edit_submission"(uuid, text, text, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."edit_submission"(uuid, text, text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."edit_submission"(uuid, text, text, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."edit_submission"(uuid, text, text, text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_submission_feedback"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_submission_feedback"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_submission_feedback"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_submission_feedback"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_game_reviewer"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."is_game_reviewer"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_game_reviewer"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_game_reviewer"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_super_admin"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."is_super_admin"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_super_admin"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_super_admin"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."record_submission_changes"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."record_submission_changes"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."record_submission_changes"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."review_submission"(uuid, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."review_submission"(uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."review_submission"(uuid, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."review_submission"(uuid, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_submission_updated_at"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_submission_updated_at"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_submission_updated_at"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."submit_game"(text, text, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."submit_game"(text, text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."submit_game"(text, text, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."submit_game"(text, text, text, text) TO "service_role";

REVOKE ALL ON TABLE "public"."game_submissions" FROM "authenticated";

GRANT SELECT ON TABLE "public"."game_submissions" TO "authenticated";

REVOKE ALL ON TABLE "public"."game_submissions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."game_submissions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."game_submissions" TO "service_role";

REVOKE ALL ON TABLE "public"."profiles" FROM "authenticated";

GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ON TABLE "public"."profiles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "service_role";

REVOKE ALL ON TABLE "public"."submission_events" FROM "authenticated";

GRANT SELECT ON TABLE "public"."submission_events" TO "authenticated";

REVOKE ALL ON TABLE "public"."submission_events" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."submission_events" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."submission_events" TO "service_role";

