"""Integration tests for the local Copper Cloud Supabase baseline."""

import json
import base64
import os
import threading
import unittest
import urllib.error
import urllib.request
from urllib.parse import quote
import uuid
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

import psycopg


BASE_URL = os.environ.get("SUPABASE_TEST_URL")
ANON_KEY = os.environ.get("SUPABASE_TEST_ANON_KEY")
DB_URL = os.environ.get("SUPABASE_TEST_DATABASE_URL")
VALID = {
    "p_title": "Cloud Hopper",
    "p_description": "A tiny arcade game",
    "p_controls": "Arrow keys move",
    "p_source_code": "print('safe test source')",
}
lock = threading.Lock()


def api(path, body=None, token=None, method=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        method=method or ("POST" if data is not None else "GET"),
        headers={
            "apikey": ANON_KEY,
            "Authorization": f"Bearer {token or ANON_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    try:
        with urllib.request.urlopen(request) as response:
            payload = response.read()
            return response.status, json.loads(payload) if payload else None
    except urllib.error.HTTPError as error:
        payload = error.read()
        try:
            details = json.loads(payload)
        except ValueError:
            details = {"message": payload.decode(errors="replace")}
        return error.code, details


class SupabaseDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not all((BASE_URL, ANON_KEY, DB_URL)):
            raise RuntimeError("Run this suite via python scripts/test_supabase_db.py")
        cls.db = psycopg.connect(DB_URL)
        cls.api_base = "/rest/v1"

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def account(self, role="player"):
        suffix = uuid.uuid4().hex
        username = f"p{suffix[:12]}"
        status, result = api("/auth/v1/signup", {
            "email": f"db-test-{suffix}@example.invalid",
            "password": f"Test-{suffix}-Password!",
            "data": {"username": username},
        })
        self.assertEqual(status, 200, result)
        self.assertIn("access_token", result, "email confirmations must be disabled locally")
        user = {"id": result["user"]["id"], "username": username, "token": result["access_token"]}
        if role != "player":
            with lock, self.db.cursor() as cursor:
                cursor.execute("UPDATE public.profiles SET role=%s WHERE id=%s", (role, user["id"]))
                self.db.commit()
        return user

    def rpc(self, user, name, body):
        return api(f"{self.api_base}/rpc/{name}", body, user.get("token") if user else None)

    def storage_request(self, user, path, payload=None, mime="application/octet-stream", method="POST"):
        request = urllib.request.Request(
            f"{BASE_URL}/storage/v1/{path}",
            data=payload,
            method=method,
            headers={
                "apikey": ANON_KEY,
                "Authorization": f"Bearer {user.get('token') if user else ANON_KEY}",
                "Content-Type": mime,
            },
        )
        try:
            with urllib.request.urlopen(request) as response:
                result = response.read()
                return response.status, json.loads(result) if result else None
        except urllib.error.HTTPError as error:
            result = error.read()
            try:
                body = json.loads(result)
            except ValueError:
                body = {"message": result.decode(errors="replace")}
            return error.code, body

    def submit(self, user, **overrides):
        values = VALID | overrides
        status, data = self.rpc(user, "submit_game", values)
        return status, data

    def create_submission(self, user, **overrides):
        status, data = self.submit(user, **overrides)
        self.assertEqual(status, 200, data)
        return data

    def sql(self, query, params=()):
        with lock, self.db.cursor() as cursor:
            cursor.execute(query, params)
            rows = cursor.fetchall() if cursor.description else []
            self.db.commit()
            return rows

    def events(self, submission_id):
        return self.sql(
            "SELECT event_type, details, created_at FROM public.submission_events WHERE submission_id=%s ORDER BY created_at,id",
            (submission_id,),
        )

    def assert_rpc_error(self, user, name, body, message=None):
        status, data = self.rpc(user, name, body)
        self.assertGreaterEqual(status, 400, data)
        if message:
            self.assertRegex(str(data), message)

    def test_baseline_objects_and_rpc_grants(self):
        row = self.sql("""
            SELECT
              (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('profiles','game_submissions','submission_events')),
              (SELECT count(*) FROM pg_constraint WHERE conrelid IN ('public.profiles'::regclass,'public.game_submissions'::regclass,'public.submission_events'::regclass)),
              (SELECT count(*) FROM pg_policies WHERE schemaname='public'),
              (SELECT count(*) FROM pg_trigger WHERE tgrelid IN ('auth.users'::regclass,'public.game_submissions'::regclass) AND NOT tgisinternal),
              has_function_privilege('authenticated','public.submit_game(text,text,text,text)','EXECUTE'),
              has_function_privilege('anon','public.submit_game(text,text,text,text)','EXECUTE'),
              has_function_privilege('authenticated','public.decide_submission(uuid,text,text)','EXECUTE')
        """)[0]
        self.assertEqual(row[0], 3)
        self.assertGreaterEqual(row[1], 12)
        self.assertGreaterEqual(row[2], 4)
        self.assertGreaterEqual(row[3], 4)
        self.assertEqual(row[4:], (True, False, True))
        rpc_grants = self.sql("""
            SELECT
              has_function_privilege('authenticated','public.change_username(text)','EXECUTE'),
              has_function_privilege('anon','public.change_username(text)','EXECUTE'),
              has_function_privilege('authenticated','public.edit_submission(uuid,text,text,text,text)','EXECUTE'),
              has_function_privilege('anon','public.edit_submission(uuid,text,text,text,text)','EXECUTE'),
              has_function_privilege('authenticated','public.submit_game(text,text,text,text,text)','EXECUTE'),
              has_function_privilege('anon','public.submit_game(text,text,text,text,text)','EXECUTE'),
              has_function_privilege('authenticated','public.edit_submission(uuid,text,text,text,text,text,boolean)','EXECUTE'),
              has_function_privilege('anon','public.edit_submission(uuid,text,text,text,text,text,boolean)','EXECUTE'),
              has_function_privilege('authenticated','public.review_submission(uuid,text,text)','EXECUTE'),
              has_function_privilege('anon','public.review_submission(uuid,text,text)','EXECUTE'),
              has_function_privilege('authenticated','public.get_submission_feedback(uuid)','EXECUTE'),
              has_function_privilege('anon','public.get_submission_feedback(uuid)','EXECUTE')
        """)[0]
        self.assertEqual(rpc_grants, (True, False, True, False, True, False, True, False, True, False, True, False))

    def test_signup_profile_username_rules_and_casefold_uniqueness(self):
        player = self.account()
        self.assertEqual(self.sql("SELECT id,username,role FROM public.profiles WHERE id=%s", (player["id"],))[0], (uuid.UUID(player["id"]), player["username"], "player"))
        self.assert_rpc_error(player, "change_username", {"new_username": "ab"}, "Username")
        self.assert_rpc_error(player, "change_username", {"new_username": "u" * 21}, "Username")
        self.assert_rpc_error(player, "change_username", {"new_username": "not allowed"}, "Username")
        changed = f"Changed_{player['id'][:8]}"
        self.assertEqual(self.rpc(player, "change_username", {"new_username": changed})[0], 204)
        other = self.account()
        self.assert_rpc_error(other, "change_username", {"new_username": changed.lower()}, "unique|duplicate")

    def test_profile_rls_and_no_direct_role_change_or_anonymous_write(self):
        player, other = self.account(), self.account()
        status, rows = api(f"/rest/v1/profiles?select=id,username,role", token=player["token"])
        self.assertEqual(status, 200)
        self.assertEqual([row["id"] for row in rows], [player["id"]])
        status, rows = api(f"/rest/v1/profiles?select=id&id=eq.{other['id']}", token=player["token"])
        self.assertEqual((status, rows), (200, []))
        status, _ = api(f"/rest/v1/profiles?id=eq.{player['id']}", {"role": "super_admin"}, player["token"], "PATCH")
        self.assertGreaterEqual(status, 400)
        status, _ = api("/rest/v1/profiles", {"id": player["id"], "username": "anonymous"})
        self.assertGreaterEqual(status, 400)

    def test_submit_validation_owner_status_event_and_anonymous_denial(self):
        player = self.account()
        submission_id = self.create_submission(player)
        self.assertEqual(submission_id, self.sql("SELECT id FROM public.game_submissions WHERE id=%s", (submission_id,))[0][0].__str__())
        self.assertEqual(self.sql("SELECT user_id,status FROM public.game_submissions WHERE id=%s", (submission_id,))[0], (uuid.UUID(player["id"]), "submitted"))
        self.assertEqual(self.events(submission_id)[0][0], "submitted")
        self.assertGreaterEqual(self.submit(None)[0], 400)
        for fields, value, expected in [
            ({"p_title"}, "ab", "title"),
            ({"p_title"}, "t" * 101, "title"),
            ({"p_description"}, "", "description"),
            ({"p_description"}, "d" * 2001, "description"),
            ({"p_controls"}, "", "controls"),
            ({"p_controls"}, "c" * 1001, "controls"),
            ({"p_source_code"}, "", "source"),
            ({"p_source_code"}, "x" * 5242881, "source"),
        ]:
            body = VALID.copy()
            body[next(iter(fields))] = value
            status, data = self.rpc(player, "submit_game", body)
            self.assertGreaterEqual(status, 400, data)

    def test_submission_source_limit_accepts_exactly_5_mib_for_submit_and_edit(self):
        player = self.account()
        exact_limit = "x" * 5242880
        submission_id = self.create_submission(player, p_source_code=exact_limit)
        self.assertEqual(self.sql("SELECT octet_length(source_code) FROM public.game_submissions WHERE id=%s", (submission_id,))[0][0], 5242880)
        update = {
            "p_submission_id": submission_id,
            "p_title": VALID["p_title"],
            "p_description": VALID["p_description"],
            "p_controls": VALID["p_controls"],
            "p_source_code": exact_limit,
        }
        self.assertEqual(self.rpc(player, "edit_submission", update)[0], 204)
        self.assertGreaterEqual(self.rpc(player, "edit_submission", update | {"p_source_code": "x" * 5242881})[0], 400)

    def test_private_cover_upload_submission_and_reviewer_access(self):
        player, other, reviewer = self.account(), self.account(), self.account("admin")
        image = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ZsAAAAASUVORK5CYII=")
        object_id = str(uuid.uuid4())
        path = f"{player['id']}/{object_id}.png"
        status, result = self.storage_request(player, f"object/submission-covers/{quote(path)}", image, "image/png")
        self.assertIn(status, (200, 201), result)
        submission = self.create_submission_with_cover(player, path)
        self.assertEqual(self.sql("SELECT cover_image_path FROM public.game_submissions WHERE id=%s", (submission,))[0][0], path)

        unchanged = VALID | {"p_submission_id": submission, "p_title": "Cover Test Updated"}
        self.assertEqual(self.rpc(player, "edit_submission", unchanged)[0], 204)
        self.assertEqual(self.sql("SELECT cover_image_path FROM public.game_submissions WHERE id=%s", (submission,))[0][0], path)

        sign_path = f"object/sign/submission-covers/{quote(path)}"
        self.assertLess(self.storage_request(player, sign_path, json.dumps({"expiresIn": 60}).encode(), "application/json")[0], 400)
        self.assertLess(self.storage_request(reviewer, sign_path, json.dumps({"expiresIn": 60}).encode(), "application/json")[0], 400)
        self.assertGreaterEqual(self.storage_request(other, sign_path, json.dumps({"expiresIn": 60}).encode(), "application/json")[0], 400)

        bad_path = f"{other['id']}/{uuid.uuid4()}.png"
        self.assertGreaterEqual(self.storage_request(other, f"object/submission-covers/{quote(bad_path)}", image, "image/svg+xml")[0], 400)
        oversized_path = f"{player['id']}/{uuid.uuid4()}.png"
        self.assertGreaterEqual(self.storage_request(player, f"object/submission-covers/{quote(oversized_path)}", b"x" * (3 * 1024 * 1024 + 1), "image/png")[0], 400)

        replacement = f"{player['id']}/{uuid.uuid4()}.png"
        self.assertIn(self.storage_request(player, f"object/submission-covers/{quote(replacement)}", image, "image/png")[0], (200, 201))
        edit_with_cover = {
            "p_submission_id": submission,
            "p_title": "Cover Test Updated",
            "p_description": VALID["p_description"],
            "p_controls": VALID["p_controls"],
            "p_source_code": VALID["p_source_code"],
            "p_cover_image_path": replacement,
            "p_remove_cover": False,
        }
        self.assertGreaterEqual(self.rpc(other, "edit_submission", edit_with_cover)[0], 400)
        self.assertEqual(self.rpc(player, "edit_submission", edit_with_cover)[0], 200)
        self.assertEqual(self.sql("SELECT cover_image_path FROM public.game_submissions WHERE id=%s", (submission,))[0][0], replacement)
        self.assertEqual(self.rpc(player, "edit_submission", edit_with_cover | {"p_cover_image_path": None, "p_remove_cover": True})[0], 200)
        self.assertIsNone(self.sql("SELECT cover_image_path FROM public.game_submissions WHERE id=%s", (submission,))[0][0])
        self.assertIn(self.storage_request(player, f"object/submission-covers/{quote(replacement)}", None, method="DELETE")[0], (200, 204))

    def create_submission_with_cover(self, user, path):
        values = VALID | {"p_cover_image_path": path}
        status, data = self.rpc(user, "submit_game", values)
        self.assertEqual(status, 200, data)
        return data

    def test_three_open_submission_limit_and_closed_slot_reuse(self):
        player, super_admin = self.account(), self.account("super_admin")
        ids = [self.create_submission(player, p_title=f"Cloud Game {i}") for i in range(3)]
        self.assertGreaterEqual(self.submit(player, p_title="Cloud Fourth")[0], 400)
        status, data = self.rpc(super_admin, "decide_submission", {"p_submission_id": ids[0], "p_decision": "approve", "p_feedback": "Ready"})
        self.assertEqual(status, 204, data)
        self.create_submission(player, p_title="Cloud Fourth")

    def test_edit_owner_only_content_events_and_updated_at_rules(self):
        player, other = self.account(), self.account()
        submission_id = self.create_submission(player)
        edit_body = {"p_submission_id": submission_id, "p_title": "Someone Else", "p_description": VALID["p_description"], "p_controls": VALID["p_controls"], "p_source_code": VALID["p_source_code"]}
        self.assertGreaterEqual(self.rpc(other, "edit_submission", edit_body)[0], 400)
        before = self.sql("SELECT updated_at FROM public.game_submissions WHERE id=%s", (submission_id,))[0][0]
        owner_body = edit_body | {"p_title": VALID["p_title"]}
        self.assertEqual(self.rpc(player, "edit_submission", owner_body)[0], 204)
        same = self.sql("SELECT updated_at FROM public.game_submissions WHERE id=%s", (submission_id,))[0][0]
        self.assertEqual(before, same)
        changed_body = owner_body | {"p_title": "Cloud Hopper Plus", "p_source_code": "print('updated')"}
        self.assertEqual(self.rpc(player, "edit_submission", changed_body)[0], 204)
        after = self.sql("SELECT updated_at FROM public.game_submissions WHERE id=%s", (submission_id,))[0][0]
        self.assertGreaterEqual(after, before)
        event_types = [row[0] for row in self.events(submission_id)]
        self.assertIn("source_updated", event_types)
        self.assertIn("metadata_updated", event_types)

    def test_changes_requested_reedit_and_finalized_edits_rejected(self):
        player, admin, super_admin = self.account(), self.account("admin"), self.account("super_admin")
        requested = self.create_submission(player)
        status, data = self.rpc(admin, "review_submission", {"p_submission_id": requested, "p_recommendation": "request_changes", "p_feedback": "Add scoring"})
        self.assertEqual(status, 204, data)
        body = {"p_submission_id": requested, "p_title": "Scored Game", "p_description": "desc", "p_controls": "keys", "p_source_code": "print('ok')"}
        self.assertEqual(self.rpc(player, "edit_submission", body)[0], 204)
        self.assertEqual(self.sql("SELECT status FROM public.game_submissions WHERE id=%s", (requested,))[0][0], "submitted")
        for decision in ("approve", "reject"):
            item = self.create_submission(player, p_title=f"{decision.title()} Game")
            self.assertEqual(self.rpc(super_admin, "decide_submission", {"p_submission_id": item, "p_decision": decision, "p_feedback": "Done"})[0], 204)
            expected_event = "approved" if decision == "approve" else "rejected"
            self.assertIn(expected_event, [event[0] for event in self.events(item)])
            self.assertGreaterEqual(self.rpc(player, "edit_submission", body | {"p_submission_id": item})[0], 400)

    def test_role_checks_recommendations_required_feedback_and_closed_review(self):
        player, admin, super_admin = self.account(), self.account("admin"), self.account("super_admin")
        item = self.create_submission(player)
        review = {"p_submission_id": item, "p_recommendation": "approve", "p_feedback": "Looks good"}
        self.assertGreaterEqual(self.rpc(player, "review_submission", review)[0], 400)
        self.assertGreaterEqual(self.rpc(player, "decide_submission", {"p_submission_id": item, "p_decision": "approve", "p_feedback": "ok"})[0], 400)
        self.assertGreaterEqual(self.rpc(admin, "decide_submission", {"p_submission_id": item, "p_decision": "approve", "p_feedback": "ok"})[0], 400)
        self.assertGreaterEqual(self.rpc(admin, "review_submission", review | {"p_feedback": "  "})[0], 400)
        for recommendation, expected in (("approve", "approval_recommended"), ("reject", "rejection_recommended"), ("request_changes", "changes_requested")):
            author = self.account()
            item = self.create_submission(author, p_title=f"Review {recommendation}")
            status, data = self.rpc(admin, "review_submission", {"p_submission_id": item, "p_recommendation": recommendation, "p_feedback": "Please review"})
            self.assertEqual(status, 204, data)
            event = self.events(item)[-1]
            self.assertEqual(event[0], expected)
            self.assertEqual(event[1]["feedback"], "Please review")
            self.assertIsNotNone(event[2])
        closed = self.create_submission(player, p_title="Closed Submission")
        self.assertEqual(self.rpc(super_admin, "decide_submission", {"p_submission_id": closed, "p_decision": "approve", "p_feedback": "Approved"})[0], 204)
        self.assertGreaterEqual(self.rpc(admin, "review_submission", review | {"p_submission_id": closed})[0], 400)
        self.assertGreaterEqual(self.rpc(super_admin, "decide_submission", {"p_submission_id": closed, "p_decision": "reject", "p_feedback": "Again"})[0], 400)
        super_review_item = self.create_submission(self.account(), p_title="Super Admin Review")
        self.assertEqual(self.rpc(super_admin, "review_submission", review | {"p_submission_id": super_review_item})[0], 204)

    def test_submission_and_audit_rls_feedback_privacy_and_anon_rpc(self):
        player, other, admin, super_admin = self.account(), self.account(), self.account("admin"), self.account("super_admin")
        own_id, other_id = self.create_submission(player), self.create_submission(other, p_title="Other Game")
        status, own_rows = api("/rest/v1/game_submissions?select=id", token=player["token"])
        self.assertEqual(status, 200)
        self.assertEqual([row["id"] for row in own_rows], [own_id])
        status, reviewer_rows = api("/rest/v1/game_submissions?select=id", token=admin["token"])
        self.assertEqual(status, 200)
        reviewer_ids = {row["id"] for row in reviewer_rows}
        self.assertTrue({own_id, other_id}.issubset(reviewer_ids))
        super_status, super_rows = api("/rest/v1/game_submissions?select=id", token=super_admin["token"])
        self.assertEqual(super_status, 200)
        self.assertTrue({own_id, other_id}.issubset({row["id"] for row in super_rows}))
        status, _ = api("/rest/v1/game_submissions", VALID | {"user_id": player["id"]}, player["token"])
        self.assertGreaterEqual(status, 400)
        status, rows = api(f"/rest/v1/game_submissions?id=eq.{own_id}", {"status": "approved"}, player["token"], "PATCH")
        self.assertGreaterEqual(status, 400)
        self.assertEqual(self.sql("SELECT status FROM public.game_submissions WHERE id=%s", (own_id,))[0][0], "submitted")
        for method, body in (("POST", {"submission_id": own_id, "event_type": "approved"}), ("PATCH", {"event_type": "approved"}), ("DELETE", None)):
            status, _ = api(f"/rest/v1/submission_events?submission_id=eq.{own_id}", body, player["token"], method)
            self.assertGreaterEqual(status, 400)
        status, rows = api("/rest/v1/submission_events?select=id", token=player["token"])
        self.assertEqual((status, rows), (200, []))
        status, rows = api("/rest/v1/submission_events?select=id", token=admin["token"])
        self.assertEqual((status, rows), (200, []))
        status, _ = self.rpc(admin, "review_submission", {"p_submission_id": own_id, "p_recommendation": "approve", "p_feedback": "Fix title"})
        self.assertEqual(status, 204)
        status, feedback = self.rpc(player, "get_submission_feedback", {"p_submission_id": own_id})
        self.assertEqual(status, 200)
        self.assertEqual(feedback[0]["feedback"], "Fix title")
        self.assertEqual(self.rpc(player, "get_submission_feedback", {"p_submission_id": other_id}), (200, []))
        status, history = api("/rest/v1/submission_events?select=id", token=super_admin["token"])
        self.assertEqual(status, 200)
        self.assertTrue(any(row["id"] for row in history))
        for name, body in (
            ("change_username", {"new_username": "Anonymous"}),
            ("edit_submission", {"p_submission_id": own_id, "p_title": "Title", "p_description": "Description", "p_controls": "Keys", "p_source_code": "pass"}),
            ("decide_submission", {"p_submission_id": own_id, "p_decision": "approve", "p_feedback": "anon"}),
            ("get_submission_feedback", {"p_submission_id": own_id}),
        ):
            self.assertGreaterEqual(self.rpc(None, name, body)[0], 400, name)
        self.assertGreaterEqual(self.rpc(None, "review_submission", {"p_submission_id": own_id, "p_recommendation": "approve", "p_feedback": "anon"})[0], 400)

    def test_recommendation_staleness_and_event_history(self):
        player, admin = self.account(), self.account("admin")
        item = self.create_submission(player)
        self.assertEqual(self.rpc(admin, "review_submission", {"p_submission_id": item, "p_recommendation": "approve", "p_feedback": "Looks good"})[0], 204)
        recommendation = next(row for row in self.events(item) if row[0] == "approval_recommended")
        body = {"p_submission_id": item, "p_title": VALID["p_title"], "p_description": VALID["p_description"], "p_controls": VALID["p_controls"], "p_source_code": "print('new source')"}
        self.assertEqual(self.rpc(player, "edit_submission", body)[0], 204)
        current = self.sql("SELECT updated_at FROM public.game_submissions WHERE id=%s", (item,))[0][0]
        reviewed_at = datetime.fromisoformat(recommendation[1]["reviewed_submission_updated_at"].replace("Z", "+00:00"))
        self.assertLess(reviewed_at, current)
        self.assertIn("approval_recommended", [row[0] for row in self.events(item)])
        self.assertIn("source_updated", [row[0] for row in self.events(item)])

    def test_concurrent_submission_limit(self):
        player = self.account()
        self.create_submission(player, p_title="Race First")
        self.create_submission(player, p_title="Race Second")
        def request(index):
            return self.submit(player, p_title=f"Race Item {index}")[0]
        with ThreadPoolExecutor(max_workers=6) as pool:
            statuses = list(pool.map(request, range(6)))
        self.assertEqual(statuses.count(200), 1)
        self.assertEqual(sum(status >= 400 for status in statuses), 5)
        count = self.sql("SELECT count(*) FROM public.game_submissions WHERE user_id=%s AND status IN ('submitted','under_review','changes_requested')", (player["id"],))[0][0]
        self.assertEqual(count, 3)

    def test_concurrent_decisions_are_serialized(self):
        player, super_admin = self.account(), self.account("super_admin")
        item = self.create_submission(player)
        decisions = (("approve", "Approved"), ("reject", "Rejected"))
        def request(pair):
            decision, feedback = pair
            return self.rpc(super_admin, "decide_submission", {"p_submission_id": item, "p_decision": decision, "p_feedback": feedback})[0]
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(request, decisions))
        self.assertEqual(statuses.count(204), 1)
        self.assertEqual(sum(status >= 400 for status in statuses), 1)
        final_events = [row for row in self.events(item) if row[0] in ("approved", "rejected")]
        self.assertEqual(len(final_events), 1)


if __name__ == "__main__":
    unittest.main()
