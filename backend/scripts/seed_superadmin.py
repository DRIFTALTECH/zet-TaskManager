"""One-time cutover to superadmin-controlled access.

Run once, from the backend directory, after deploying the superadmin change:

    python scripts/seed_superadmin.py                      # dry run — prints the plan
    python scripts/seed_superadmin.py --apply              # writes
    python scripts/seed_superadmin.py --apply --email me@x  # different superadmin

What it does:
  1. Makes SUPERADMIN_EMAIL an active superadmin. If no such user exists it is
     created and a one-time password is printed — change it after first sign-in.
  2. Demotes every other user to "employee" and deactivates them, so nobody gets
     in until the superadmin approves them from the console.

Safe to re-run: it is idempotent, and it refuses to run if it would leave the app
without an active superadmin.
"""

import argparse
import os
import secrets
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import crud.users as users_crud  # noqa: E402
from database.database import get_db  # noqa: E402
from logic import auth_logic  # noqa: E402

DEFAULT_SUPERADMIN_EMAIL = "swamy@driftal.tech"


def main() -> int:
    ap = argparse.ArgumentParser(description="Promote one user to superadmin and lock everyone else.")
    ap.add_argument("--email", default=os.environ.get("SUPERADMIN_EMAIL", DEFAULT_SUPERADMIN_EMAIL))
    ap.add_argument("--apply", action="store_true", help="write the changes (otherwise dry run)")
    args = ap.parse_args()

    email = args.email.strip().lower()
    if "@" not in email:
        print(f"error: {email!r} is not an email address")
        return 1

    db = next(get_db())
    users = users_crud.list_all(db)
    target = next((u for u in users if (u.email or "").strip().lower() == email), None)

    plan: list[str] = []
    new_password = None

    if target is None:
        new_password = secrets.token_urlsafe(12)
        plan.append(f"CREATE  {email}  role=superadmin  active=yes  (new password will be printed)")
    else:
        changes = []
        if target.role != auth_logic.SUPERADMIN_ROLE:
            changes.append(f"role {target.role} -> superadmin")
        if not bool(getattr(target, "is_active", True)):
            changes.append("activate")
        plan.append(f"PROMOTE {email}  ({', '.join(changes) if changes else 'already a superadmin — no change'})")

    others = [u for u in users if u is not target]
    for u in others:
        changes = []
        if u.role != "employee":
            changes.append(f"role {u.role} -> employee")
        if bool(getattr(u, "is_active", True)):
            changes.append("deactivate")
        if changes:
            plan.append(f"LOCK    {u.email}  ({', '.join(changes)})")

    print(f"\n{len(users)} user(s) in the database. Plan:\n")
    for line in plan:
        print(f"  {line}")
    if len(plan) == 1 and "no change" in plan[0]:
        print("\nNothing to do.")
        return 0

    if not args.apply:
        print("\nDry run. Re-run with --apply to write these changes.\n")
        return 0

    if target is None:
        target = users_crud.create_user(
            db,
            user_id=str(uuid.uuid4()),
            name=email.split("@", 1)[0],
            email=email,
            password_hash=auth_logic.hash_password(new_password),
            role=auth_logic.SUPERADMIN_ROLE,
            is_active=True,
        )
    else:
        if target.role != auth_logic.SUPERADMIN_ROLE:
            target = users_crud.set_role(db, target, auth_logic.SUPERADMIN_ROLE)
        if not bool(getattr(target, "is_active", True)):
            target = users_crud.set_active(db, target, True)

    for u in others:
        if u.role != "employee":
            u = users_crud.set_role(db, u, "employee")
        if bool(getattr(u, "is_active", True)):
            users_crud.set_active(db, u, False)

    # Re-read and refuse to finish in a locked-out state.
    check = [
        u for u in users_crud.list_all(db)
        if u.role == auth_logic.SUPERADMIN_ROLE and bool(getattr(u, "is_active", True))
    ]
    if not check:
        print("\nERROR: no active superadmin after the run. Investigate before deploying.")
        return 1

    print(f"\nDone. Active superadmin(s): {', '.join(u.email for u in check)}")
    if new_password:
        print("\n" + "=" * 68)
        print(f"  One-time password for {email}:\n\n      {new_password}\n")
        print("  Sign in with it, then change it in Settings. It is not stored anywhere.")
        print("=" * 68)
    print(f"\n{len(others)} other user(s) are now inactive employees. Approve them at /superadmin.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
