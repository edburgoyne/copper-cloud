"""Run the database suite against the local Supabase stack only."""

import os
import re
import subprocess
import sys
import unittest


def main():
    status = subprocess.run(
        ["supabase", "status", "--output", "env"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    values = dict(re.findall(r'^(API_URL|ANON_KEY|DB_URL)="?([^"\r\n]*)"?$', status, re.M))
    if set(values) != {"API_URL", "ANON_KEY", "DB_URL"}:
        sys.exit("Could not read local Supabase settings. Start the local stack first.")
    os.environ["SUPABASE_TEST_URL"] = values["API_URL"]
    os.environ["SUPABASE_TEST_ANON_KEY"] = values["ANON_KEY"]
    os.environ["SUPABASE_TEST_DATABASE_URL"] = values["DB_URL"]

    suite = unittest.defaultTestLoader.discover("supabase/tests", pattern="test_db.py")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
