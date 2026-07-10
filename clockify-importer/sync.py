import json
import logging
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any

from db import Db
import clockify_client
import mapper

# Import CRUD, models, and helper functions from ZET backend
import crud.clients as clients_crud  # type: ignore
import crud.projects as projects_crud  # type: ignore
import crud.sections as sections_crud  # type: ignore
import crud.settings as settings_crud  # type: ignore
import crud.task_assignees as task_assignees_crud  # type: ignore
import crud.tasks as tasks_crud  # type: ignore
import crud.timesheet_entries as te_crud  # type: ignore
import crud.users as users_crud  # type: ignore
from database.init_db import new_id  # type: ignore
from database.models import TimesheetEntry  # type: ignore
from logic.auth_logic import hash_password  # type: ignore

log = logging.getLogger("clockify_importer.sync")

_KEY_LAST_SYNC = "clockify.last_sync"
_KEY_LAST_STATUS = "clockify.last_status"
_ENTRY_ID_PREFIX = "clk_"
_TASK_ID_PREFIX = "clk_task_"
_TENTRY_ID_PREFIX = "clk_tentry_"

def _get_setting(db: Db, key: str) -> str | None:
    return settings_crud.get(db, key)

def _set_setting(db: Db, key: str, value: str) -> None:
    settings_crud.set(db, key, value)

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _fix_clockify_placeholder_due_dates(db: Db) -> int:
    """Clear bogus due dates that were set to the sync day during import."""
    return db.write(
        f"""UPDATE tasks SET due_date = ''
            WHERE id LIKE %s
              AND description = %s
              AND LENGTH(created_at) >= 10
              AND due_date = SUBSTR(created_at, 1, 10)""",
        (f"{_TASK_ID_PREFIX}%", "Imported from Clockify"),
    ) or 0

def _default_owner_id(db: Db) -> str:
    for u in users_crud.list_all(db):
        if u.role in ("admin", "manager"):
            return u.id
    users = users_crud.list_all(db)
    if not users:
        raise ValueError("No users in ZET to own Clockify imports")
    return users[0].id

def _ensure_client_id(
    db: Db, client_name: str, cache: dict[str, str], now: str
) -> str | None:
    trimmed = client_name.strip()
    if not trimmed:
        return None
    key = trimmed.lower()
    if key in cache:
        return cache[key]
    existing = clients_crud.get_by_name_ci(db, trimmed)
    if existing:
        cache[key] = existing.id
        return existing.id
    client_id = new_id("c")
    clients_crud.create(db, client_id=client_id, name=trimmed, created_at=now)
    cache[key] = client_id
    return client_id

def _add_managers_to_project(db: Db, project_id: str) -> None:
    for u in users_crud.list_all(db):
        if u.role in ("manager", "admin"):
            projects_crud.add_member(db, project_id, u.id)

def _ensure_zet_project(
    db: Db,
    meta: dict[str, str],
    owner_id: str,
    client_cache: dict[str, str],
    zet_projects_by_name: dict[str, tuple[str, str]],
    now: str,
) -> tuple[str, str]:
    """Find or create ZET project + section for a Clockify project."""
    ck_name = meta.get("name", "").strip()
    if not ck_name:
        raise ValueError("Clockify project missing name")
    client_id = _ensure_client_id(db, meta.get("clientName", ""), client_cache, now)
    key = ck_name.lower()
    hit = zet_projects_by_name.get(key)
    if not hit:
        project_id = new_id("p")
        section_id = new_id("s")
        projects_crud.create_project(
            db,
            project_id=project_id,
            name=ck_name,
            description="Imported from Clockify",
            client_id=client_id,
            created_by=owner_id,
            created_at=now,
        )
        sections_crud.create_section(db, section_id=section_id, name="General", project_id=project_id)
        hit = (project_id, section_id)
        zet_projects_by_name[key] = hit
    elif client_id:
        projects_crud.update_client(db, hit[0], client_id)
    return hit

def _ensure_zet_task(
    db: Db,
    ck_task: dict[str, Any],
    project_id: str,
    section_id: str,
    ck_user_email: dict[str, str],
    users_by_email: dict[str, str],
    owner_id: str,
    now: str,
) -> bool:
    safe = mapper.safe_clockify_id(ck_task.get("id"))
    if not safe:
        return False
    zet_id = f"{_TASK_ID_PREFIX}{safe}"
    if tasks_crud.get_by_id(db, zet_id):
        return False
    assignee_id = owner_id
    ck_assignee = ck_task.get("assigneeId")
    if ck_assignee:
        email = ck_user_email.get(str(ck_assignee), "").lower()
        assignee_id = users_by_email.get(email, owner_id)
    title = (ck_task.get("name") or "Clockify task").strip()[:200] or "Clockify task"
    due_date = mapper.parse_clockify_due(ck_task)
    tasks_crud.create_task(
        db,
        task_id=zet_id,
        title=title,
        description="Imported from Clockify",
        project_id=project_id,
        section_id=section_id,
        assigned_to=assignee_id,
        assigned_by=owner_id,
        created_by=owner_id,
        due_date=due_date,
        priority="Medium",
        status=mapper.ck_task_status(str(ck_task.get("status") or "")),
        is_started=False,
        approved_by_manager=False,
        time_tracked=0,
        tags=[],
        created_at=now,
    )
    task_assignees_crud.set_assignees(db, zet_id, [assignee_id])
    projects_crud.add_member(db, project_id, assignee_id)
    return True

def _ensure_task_from_time_entry(
    db: Db,
    entry: dict[str, Any],
    project_id: str,
    section_id: str,
    zet_uid: str,
    owner_id: str,
    seconds: int,
    work_date: str,
    now: str,
) -> bool:
    """One ZET task per Clockify time entry (matches time log 1:1)."""
    ck_eid = mapper.entry_clockify_id(entry)
    if not ck_eid:
        return False
    zet_id = f"{_TENTRY_ID_PREFIX}{ck_eid}"
    if tasks_crud.get_by_id(db, zet_id):
        return False
    desc = (entry.get("description") or "").strip()
    title = (desc[:200] if desc else f"Time log {work_date}") or f"Time log {work_date}"
    tasks_crud.create_task(
        db,
        task_id=zet_id,
        title=title,
        description=desc or "Imported from Clockify time entry",
        project_id=project_id,
        section_id=section_id,
        assigned_to=zet_uid,
        assigned_by=owner_id,
        created_by=owner_id,
        due_date=work_date,
        priority="Medium",
        status="completed" if seconds > 0 else "backlog",
        is_started=False,
        approved_by_manager=False,
        time_tracked=seconds,
        tags=[],
        created_at=now,
    )
    task_assignees_crud.set_assignees(db, zet_id, [zet_uid])
    return True

def _build_zet_project_lookup(db: Db) -> dict[str, tuple[str, str]]:
    """Lowercase project name → (project_id, first_section_id)."""
    out: dict[str, tuple[str, str]] = {}
    for project in projects_crud.list_all(db):
        sections = sections_crud.list_for_project(db, project.id)
        if not sections:
            continue
        key = project.name.strip().lower()
        if key and key not in out:
            out[key] = (project.id, sections[0].id)
    return out

def _resolve_clockify_project_section(
    db: Db,
    user_id: str,
    clockify_project_id: str | None,
    ck_projects: dict[str, dict[str, str]],
    ck_id_to_zet: dict[str, tuple[str, str]],
    zet_projects_by_name: dict[str, tuple[str, str]],
    owner_id: str,
    client_cache: dict[str, str],
    now: str,
) -> tuple[str, str] | None:
    if clockify_project_id:
        hit = ck_id_to_zet.get(str(clockify_project_id))
        if hit:
            return hit
        meta = ck_projects.get(str(clockify_project_id))
        if meta:
            hit = _ensure_zet_project(db, meta, owner_id, client_cache, zet_projects_by_name, now)
            ck_id_to_zet[str(clockify_project_id)] = hit
            return hit
    return None

def _first_project_section_for_user(db: Db, user_id: str) -> tuple[str, str] | None:
    """ponytail: fallback when Clockify project name has no ZET match."""
    for project_id in users_crud.project_ids_for_user(db, user_id):
        sections = sections_crud.list_for_project(db, project_id)
        if sections:
            return project_id, sections[0].id
    return None

def _default_project_section(db: Db) -> tuple[str, str] | None:
    """ponytail: last resort — first ZET project with a section."""
    for project in projects_crud.list_all(db):
        sections = sections_crud.list_for_project(db, project.id)
        if sections:
            return project.id, sections[0].id
    return None

def _ensure_clockify_user(db: Db, email: str, display_name: str) -> str:
    existing = users_crud.get_by_email(db, email)
    if existing:
        return existing.id
    user_id = str(uuid.uuid4())
    users_crud.create_user(
        db,
        user_id=user_id,
        name=display_name.strip() or email.split("@")[0],
        email=email,
        password_hash=hash_password(secrets.token_urlsafe(24)),
        role="employee",
    )
    return user_id

def run_reconciliation_sync(db: Db, api_key: str, ws_id: str, *, days: int = 365) -> dict[str, Any]:
    """Fetch Clockify entries and upsert into timesheet_entries (synchronous)."""
    fixed = _fix_clockify_placeholder_due_dates(db)
    if fixed:
        db.commit()
        log.info("Clockify: cleared placeholder due dates on %s catalog tasks", fixed)
    
    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=days)

    imported = updated = unchanged = skipped = failed = 0
    users_created = projects_created = tasks_imported = 0
    errors: list[str] = []
    skip_counts: dict[str, int] = {}

    def _bump_skip(reason: str) -> None:
        skip_counts[reason] = skip_counts.get(reason, 0) + 1

    try:
        users_by_email: dict[str, str] = {}
        for u in users_crud.list_all(db):
            users_by_email[u.email.strip().lower()] = u.id

        ck_members = clockify_client.fetch_workspace_users(api_key, ws_id)
        ck_user_email: dict[str, str] = {}
        ck_name_by_email: dict[str, str] = {}
        for m in ck_members:
            uid = m.get("id") or m.get("userId")
            email = (m.get("email") or (m.get("user") or {}).get("email") or "").strip().lower()
            if uid and email:
                ck_user_email[str(uid)] = email
                ck_name_by_email[email] = str(m.get("name") or email.split("@")[0])

        ck_projects = clockify_client.fetch_projects(api_key, ws_id)
        zet_projects_by_name = _build_zet_project_lookup(db)
        zet_project_count = len(zet_projects_by_name)
        now = _now_iso()
        owner_id = _default_owner_id(db)
        client_cache: dict[str, str] = {}
        ck_id_to_zet: dict[str, tuple[str, str]] = {}

        for ck_pid, meta in ck_projects.items():
            if not meta.get("name"):
                continue
            try:
                project_id, section_id = _ensure_zet_project(
                    db, meta, owner_id, client_cache, zet_projects_by_name, now
                )
                ck_id_to_zet[ck_pid] = (project_id, section_id)
                _add_managers_to_project(db, project_id)
                for ck_task in clockify_client.fetch_tasks(api_key, ws_id, ck_pid):
                    try:
                        if _ensure_zet_task(
                            db,
                            ck_task,
                            project_id,
                            section_id,
                            ck_user_email,
                            users_by_email,
                            owner_id,
                            now,
                        ):
                            tasks_imported += 1
                    except Exception as exc:
                        log.warning("Clockify task import failed: %s", exc)
            except Exception as exc:
                log.warning("Clockify project catalog failed for %s: %s", ck_pid, exc)

        projects_created = len(zet_projects_by_name) - zet_project_count

        for ck_uid, email in ck_user_email.items():
            zet_uid = users_by_email.get(email)
            if not zet_uid:
                zet_uid = _ensure_clockify_user(db, email, ck_name_by_email.get(email, email))
                users_by_email[email] = zet_uid
                users_created += 1
            for entry in clockify_client.fetch_time_entries_for_period(api_key, ws_id, ck_uid, start_dt, end_dt):
                try:
                    ck_eid = mapper.entry_clockify_id(entry)
                    interval = entry.get("timeInterval") or {}
                    start_iso = interval.get("start")
                    end_iso = interval.get("end")
                    if not ck_eid or not start_iso or not end_iso:
                        skipped += 1
                        _bump_skip("Missing timestamps")
                        continue

                    mapped = _resolve_clockify_project_section(
                        db,
                        zet_uid,
                        entry.get("projectId"),
                        ck_projects,
                        ck_id_to_zet,
                        zet_projects_by_name,
                        owner_id,
                        client_cache,
                        now,
                    )
                    if not mapped:
                        mapped = _first_project_section_for_user(db, zet_uid)
                    if not mapped:
                        mapped = _default_project_section(db)
                    if not mapped:
                        skipped += 1
                        _bump_skip("Project not found")
                        continue
                    project_id, section_id = mapped
                    projects_crud.add_member(db, project_id, zet_uid)

                    zet_id = f"{_ENTRY_ID_PREFIX}{ck_eid}"
                    work_date = mapper.parse_clockify_dt(start_iso).date().isoformat()
                    row = TimesheetEntry(
                        id=zet_id,
                        user_id=zet_uid,
                        work_date=work_date,
                        project_id=project_id,
                        section_id=section_id,
                        description=(entry.get("description") or "").strip(),
                        time_from=mapper.hm_from_iso(start_iso),
                        time_to=mapper.hm_from_iso(end_iso),
                        seconds=mapper.entry_seconds(entry, start_iso, end_iso),
                        billable=bool(entry.get("billable", True)),
                        created_at=now,
                    )
                    outcome = te_crud.upsert_entry(db, row)
                    if _ensure_task_from_time_entry(
                        db, entry, project_id, section_id, zet_uid, owner_id, row.seconds, work_date, now
                    ):
                        tasks_imported += 1
                    if outcome == "imported":
                        imported += 1
                    elif outcome == "updated":
                        updated += 1
                    elif outcome == "unchanged":
                        unchanged += 1
                    else:
                        skipped += 1
                except Exception as exc:
                    failed += 1
                    _bump_skip("Other")
                    if len(errors) < 5:
                        errors.append(str(exc))
                    log.warning("Clockify entry failed: %s", exc)

        result = {
            "status": "success",
            "imported": imported,
            "updated": updated,
            "unchanged": unchanged,
            "skipped": skipped,
            "failed": failed,
            "usersCreated": users_created,
            "projectsCreated": projects_created,
            "tasksImported": tasks_imported,
            "days": days,
            "skipSummary": {k: skip_counts[k] for k in sorted(skip_counts)},
        }
        _set_setting(db, _KEY_LAST_SYNC, now)
        _set_setting(db, _KEY_LAST_STATUS, json.dumps(result))
        fixed_due = _fix_clockify_placeholder_due_dates(db)
        if fixed_due:
            log.info("Clockify: cleared placeholder due dates on %s catalog tasks", fixed_due)
        db.commit()
        log.info("Clockify sync complete: %s", result)
        return result

    except Exception as exc:
        now = _now_iso()
        result = {
            "status": "failed",
            "imported": imported,
            "updated": updated,
            "unchanged": unchanged,
            "skipped": skipped,
            "failed": failed,
            "usersCreated": users_created,
            "error": str(exc),
            "days": days,
        }
        _set_setting(db, _KEY_LAST_SYNC, now)
        _set_setting(db, _KEY_LAST_STATUS, json.dumps(result))
        db.commit()
        log.exception("Clockify sync failed")
        raise exc
