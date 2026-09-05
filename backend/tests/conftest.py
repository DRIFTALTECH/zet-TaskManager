"""Pytest fixtures — isolated SQLite only (never Aurora)."""

from __future__ import annotations

import os
import pathlib
import sys
import uuid
import warnings

# ── MUST run before any backend import that touches the database ─────────────
_TEST_DATA = pathlib.Path(__file__).resolve().parent / "data"
_TEST_DATA.mkdir(parents=True, exist_ok=True)
_TEST_DB = _TEST_DATA / "test_taskmanager.db"

if _TEST_DB.exists():
    _TEST_DB.unlink()

os.environ["ZET_TEST_SQLITE"] = "1"
os.environ["ZET_SQLITE_PATH"] = str(_TEST_DB)
os.environ["APP_ENV"] = "development"
os.environ.setdefault("DEEPSEEK_API_KEY", "")
# Keep Teams/Graph integration tests hermetic — never use dev .env creds in pytest.
os.environ["MICROSOFT_CLIENT_ID"] = ""
os.environ["MICROSOFT_CLIENT_SECRET"] = ""
os.environ["MICROSOFT_TENANT_ID"] = ""

warnings.filterwarnings("ignore")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))  # backend/

import pytest
from fastapi.testclient import TestClient

from db_wrapper import reset_database_singleton
from db_wrapper.pool import ConnectionPools

reset_database_singleton()
ConnectionPools.dispose_all()

from main import app  # noqa: E402 — after test DB env is set

_client = TestClient(app)


@pytest.fixture(scope="session")
def client():
    return _client


TEST_PASSWORD = "T3st!passphrase"


def _register(role: str, *, email: str | None = None, name: str | None = None):
    """Create an ACTIVE user at `role` and return (user, auth headers).

    Self-service registration deliberately cannot do this any more: it always
    creates an inactive employee that a superadmin has to approve. Tests need an
    account that can act, so they are seeded directly.
    """
    import crud.users as users_crud
    import ratelimit
    from database.database import SessionLocal
    from logic import auth_logic, user_logic

    addr = email or f"{role}-{uuid.uuid4().hex[:8]}@example.com"
    db = SessionLocal()
    try:
        user = users_crud.create_user(
            db,
            user_id=str(uuid.uuid4()),
            name=name or role.title(),
            email=addr,
            password_hash=auth_logic.hash_password(TEST_PASSWORD),
            role=role,
            is_active=True,
        )
        out = user_logic.to_user_out(db, user)
    finally:
        db.close()

    # Login is rate-limited per IP/email; tests share one client address.
    ratelimit.reset()
    r = _client.post("/auth/login", json={"email": addr, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    return out.model_dump(), {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def manager():
    return _register("manager")


@pytest.fixture
def employee():
    return _register("employee")


@pytest.fixture
def superadmin():
    return _register("superadmin")


@pytest.fixture
def register():
    """Seed extra active users inside a test: `register("manager", email=..., name=...)`.

    Use this rather than importing `_register` — importing this module re-runs its
    body, which deletes the test database.
    """
    return _register


def make_client(api_client, headers, name: str = "Acme"):
    r = api_client.post("/clients", json={"name": name}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def make_project(api_client, headers, name: str = "Proj", description: str = "", client_name: str = "Acme"):
    c = make_client(api_client, headers, client_name)
    r = api_client.post(
        "/projects",
        json={"name": name, "description": description, "clientId": c["id"]},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()


def make_user_story(api_client, headers, project_id: str, section_id: str, title: str = "Story"):
    r = api_client.post(
        "/user-stories",
        json={
            "projectId": project_id,
            "sectionId": section_id,
            "title": title,
            "description": "",
            "acceptanceCriteria": "",
            "priority": "Medium",
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()


# Tables cleared before each test (kanban_columns seed is kept).
_CLEAR_TABLES = (
    "ai_prompts",
    "teams_transcript_imports",
    "scrums",
    "personal_access_tokens",
    "oauth_grants",
    "oauth_clients",
    "notifications",
    "audit_logs",
    "task_attachments",
    "task_checklists",
    "task_feedback",
    "timesheet_entries",
    "timesheet_submissions",
    "task_time_logs",
    "task_timer_runs",
    "task_assignees",
    "temp_tasks",
    "tasks",
    "user_story_attachments",
    "user_story_assignees",
    "user_stories",
    "sections",
    "project_members",
    "projects",
    "clients",
    "users",
    "app_settings",
)


@pytest.fixture(autouse=True)
def _isolated_db():
    from database.database import SessionLocal

    db = SessionLocal()
    db.enter_request_scope()
    try:
        db.write("PRAGMA foreign_keys = OFF")
        for table in _CLEAR_TABLES:
            db.write(f"DELETE FROM {table}")
        db.write("PRAGMA foreign_keys = ON")
    finally:
        db.close()
    # Prompt overrides are held in the module as well as the table, so wiping
    # only the rows would leave one test's wording steering the next one.
    from ai import prompts

    prompts.set_overrides({})
    yield
