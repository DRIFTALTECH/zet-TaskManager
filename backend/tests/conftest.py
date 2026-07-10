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
os.environ.setdefault("AI_OLLAMA_FALLBACK", "0")
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


def _register(role: str):
    email = f"{role}-{uuid.uuid4().hex[:8]}@t.test"
    r = _client.post(
        "/auth/register",
        json={"name": role.title(), "email": email, "password": "secret123", "role": role},
    )
    assert r.status_code == 200, r.text
    j = r.json()
    return j["user"], {"Authorization": f"Bearer {j['access_token']}"}


@pytest.fixture
def manager():
    return _register("manager")


@pytest.fixture
def employee():
    return _register("employee")


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


# Tables cleared before each test (kanban_columns seed is kept).
_CLEAR_TABLES = (
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
    "tasks",
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
    yield
