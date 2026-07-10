import httpx
from datetime import datetime, timedelta
from typing import Any
import logging

log = logging.getLogger("clockify_importer.client")

_CLOCKIFY_BASE = "https://api.clockify.me/api/v1"

def headers(api_key: str) -> dict[str, str]:
    return {"X-Api-Key": api_key}

def fetch_workspace_users(api_key: str, ws_id: str) -> list[dict[str, Any]]:
    """Members list with email (falls back from /members to /users)."""
    for path in ("members", "users"):
        resp = httpx.get(
            f"{_CLOCKIFY_BASE}/workspaces/{ws_id}/{path}",
            headers=headers(api_key),
            timeout=30,
        )
        if resp.status_code == 404 and path == "members":
            continue
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list) and data:
            return [m for m in data if isinstance(m, dict)]
    return []

def fetch_projects(api_key: str, ws_id: str) -> dict[str, dict[str, str]]:
    """Clockify project id → {name, clientName}."""
    out: dict[str, dict[str, str]] = {}
    page = 1
    while True:
        resp = httpx.get(
            f"{_CLOCKIFY_BASE}/workspaces/{ws_id}/projects",
            headers=headers(api_key),
            params={"page": page, "page-size": 200},
            timeout=30,
        )
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        for p in batch:
            if isinstance(p, dict) and p.get("id"):
                out[str(p["id"])] = {
                    "name": str(p.get("name") or "").strip(),
                    "clientName": str(p.get("clientName") or "").strip(),
                }
        if len(batch) < 200:
            break
        page += 1
    return out

def fetch_tasks(api_key: str, ws_id: str, ck_project_id: str) -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    page = 1
    while True:
        resp = httpx.get(
            f"{_CLOCKIFY_BASE}/workspaces/{ws_id}/projects/{ck_project_id}/tasks",
            headers=headers(api_key),
            params={"page": page, "page-size": 200},
            timeout=30,
        )
        if resp.status_code == 404:
            break
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        tasks.extend(t for t in batch if isinstance(t, dict))
        if len(batch) < 200:
            break
        page += 1
    return tasks

def fetch_time_entries(
    api_key: str, ws_id: str, user_id: str, start_str: str, end_str: str
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    page = 1
    while True:
        resp = httpx.get(
            f"{_CLOCKIFY_BASE}/workspaces/{ws_id}/user/{user_id}/time-entries",
            headers=headers(api_key),
            params={"start": start_str, "end": end_str, "page": page, "page-size": 1000},
            timeout=60,
        )
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        entries.extend(e for e in batch if isinstance(e, dict))
        last_page = resp.headers.get("Last-Page", "").lower() == "true"
        if last_page or len(batch) < 1000:
            break
        page += 1
    return entries

def fetch_time_entries_for_period(
    api_key: str,
    ws_id: str,
    user_id: str,
    start_dt: datetime,
    end_dt: datetime,
) -> list[dict[str, Any]]:
    """Fetch entries in ~30-day chunks — Clockify drops rows on long single ranges."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    cursor = start_dt
    while cursor < end_dt:
        chunk_end = min(cursor + timedelta(days=30), end_dt)
        start_str = cursor.strftime("%Y-%m-%dT00:00:00Z")
        end_str = chunk_end.strftime("%Y-%m-%dT23:59:59Z")
        for entry in fetch_time_entries(api_key, ws_id, user_id, start_str, end_str):
            eid = entry.get("id")
            if eid:
                key = str(eid)
                if key in seen:
                    continue
                seen.add(key)
            out.append(entry)
        cursor = chunk_end + timedelta(seconds=1)
    return out
