"""Seed a throwaway SQLite database for the dashboard end-to-end run.

Never Aurora: the env vars are set before any backend import, exactly the way
`tests/conftest.py` does it, so importing `main` builds the schema in the file
named by ZET_SQLITE_PATH and nothing else is reachable.

Produces one project with the shape the dashboard is built around — sections,
top-level tasks, a story holding tasks, a story nested in another story, a task
with subtasks — plus enough variation in status, priority, assignee, sprint and
due date that every filter and grouping has something to bite on.
"""
from __future__ import annotations

import os
import pathlib
import sys
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
DB = pathlib.Path(os.environ.get("ZET_SQLITE_PATH") or (ROOT / "data" / "e2e.db"))
DB.parent.mkdir(parents=True, exist_ok=True)
if DB.exists():
    DB.unlink()

os.environ["ZET_TEST_SQLITE"] = "1"
os.environ["ZET_SQLITE_PATH"] = str(DB)
os.environ["APP_ENV"] = "development"
os.environ["MICROSOFT_CLIENT_ID"] = ""
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from db_wrapper import reset_database_singleton  # noqa: E402
from db_wrapper.pool import ConnectionPools  # noqa: E402

reset_database_singleton()
ConnectionPools.dispose_all()

from main import app  # noqa: E402

client = TestClient(app)

PASSWORD = "T3st!passphrase"
ADMIN = "e2e-admin@example.com"
MEMBER = "e2e-dev@example.com"


def seed_user(name: str, email: str, role: str) -> dict:
    import crud.users as users_crud
    from database.database import SessionLocal
    from logic import auth_logic, user_logic

    db = SessionLocal()
    try:
        user = users_crud.create_user(
            db,
            user_id=str(uuid.uuid4()),
            name=name,
            email=email,
            password_hash=auth_logic.hash_password(PASSWORD),
            role=role,
            is_active=True,
        )
        return user_logic.to_user_out(db, user).model_dump()
    finally:
        db.close()


def login(email: str) -> dict:
    import ratelimit

    ratelimit.reset()
    r = client.post("/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def post(path: str, body: dict, headers: dict) -> dict:
    r = client.post(path, json=body, headers=headers)
    assert r.status_code == 200, f"{path} -> {r.status_code} {r.text}"
    return r.json()


def patch(path: str, body: dict, headers: dict) -> dict:
    r = client.patch(path, json=body, headers=headers)
    assert r.status_code == 200, f"{path} -> {r.status_code} {r.text}"
    return r.json()


def main() -> None:
    admin = seed_user("E2E Admin", ADMIN, "superadmin")
    dev = seed_user("Dana Dev", MEMBER, "employee")
    h = login(ADMIN)

    cl = post("/clients", {"name": "Acme"}, h)
    project = post(
        "/projects",
        {"name": "Argus", "description": "E2E fixture project", "clientId": cl["id"]},
        h,
    )
    pid = project["id"]
    post(f"/projects/{pid}/members", {"user_id": dev["id"]}, h)

    sections = project.get("sections") or []
    if not sections:
        project = post(f"/projects/{pid}/sections", {"name": "Build"}, h)
        sections = project["sections"]
    sec = sections[0]["id"]

    def task(title, **kw):
        body = {
            "projectId": pid,
            "sectionId": sec,
            "title": title,
            "description": "",
            "assignedBy": admin["id"],
            "createdBy": admin["id"],
            "dueDate": kw.pop("dueDate", ""),
            "priority": kw.pop("priority", "Medium"),
            "status": kw.pop("status", "backlog"),
            "assigneeIds": kw.pop("assigneeIds", []),
        }
        body.update(kw)
        return post("/tasks", body, h)

    def story(title, **kw):
        body = {
            "projectId": pid,
            "sectionId": sec,
            "title": title,
            "description": "",
            "acceptanceCriteria": "",
            "priority": kw.pop("priority", "Medium"),
        }
        body.update(kw)
        return post("/user-stories", body, h)

    out: dict[str, object] = {}

    # Standalone tasks across every column, priority and assignment state.
    out["task_backlog"] = task("Wire up export endpoint", priority="High", assigneeIds=[dev["id"]])
    out["task_progress"] = task("Refactor scheduler", priority="Urgent", status="in_progress")
    out["task_review"] = task("Tidy migration script", priority="Low", status="in_review")
    out["task_done"] = task("Ship release notes", priority="Medium", status="done")
    out["task_overdue"] = task("Renew certificate", priority="Urgent", dueDate="2024-01-01")

    # A task holding subtasks.
    parent = task("Rebuild import pipeline", priority="High")
    out["task_parent"] = parent
    out["subtask_a"] = task("Parse the header row", parentTaskId=parent["id"])
    out["subtask_b"] = task("Backfill old records", parentTaskId=parent["id"], status="in_progress")

    # A story holding tasks.
    s1 = story("Business process configuration", priority="High")
    out["story_with_tasks"] = s1
    out["story_task_a"] = task("Model the approval queue", userStoryId=s1["id"])
    out["story_task_b"] = task("Draft the state machine", userStoryId=s1["id"], status="in_progress")

    # A story nested inside another story — the block-move case.
    parent_story = story("Platform hardening", priority="Urgent")
    child_story = story("Rotate secrets", priority="Medium")
    patch(f"/user-stories/{child_story['id']}", {"parentStoryId": parent_story["id"]}, h)
    out["story_parent"] = parent_story
    out["story_child"] = child_story
    out["nested_story_task"] = task("Audit the key store", userStoryId=child_story["id"])

    # An empty story, so the zero-task path is covered.
    out["story_empty"] = story("No work yet", priority="Low")

    print("E2E seed complete")
    print(f"  db       {DB}")
    print(f"  admin    {ADMIN} / {PASSWORD}")
    print(f"  member   {MEMBER} / {PASSWORD}")
    print(f"  project  {project['name']} ({pid})")
    print(f"  seeded   {len(out)} work items")


if __name__ == "__main__":
    main()
