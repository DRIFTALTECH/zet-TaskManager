"""Pytest fixtures: isolated temp SQLite + a TestClient against the real app."""

import os
import pathlib
import sys
import tempfile
import uuid
import warnings

# Point the app at a throwaway DB and dev config BEFORE importing it.
_TMP = tempfile.mkdtemp(prefix="zet-test-")
os.environ["TASKMANAGER_SQLITE_PATH"] = str(pathlib.Path(_TMP) / "test.db")
os.environ["APP_ENV"] = "development"
os.environ.setdefault("AI_OLLAMA_FALLBACK", "0")

warnings.filterwarnings("ignore")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))  # backend/

import pytest
from fastapi.testclient import TestClient

from main import app

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
