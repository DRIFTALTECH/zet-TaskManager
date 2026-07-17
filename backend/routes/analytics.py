"""
routes/analytics.py — Analytics API endpoints for ZET.

Provides:
  /analytics/organization        — org tree with metrics
  /analytics/employees           — employee roster + utilization
  /analytics/performance/{id}    — per-employee deep-dive
  /analytics/clients             — client hours summary
  /analytics/wip                 — who's working on what

Mounted at /analytics by routes/__init__.py.
RBAC enforced at the logic layer for each endpoint.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, status

from database.database import Db, get_db
from logic import analytics_logic, task_forecast_logic, user_story_forecast_logic
from routes.deps import get_current_user_id
import crud.users as users_crud

log = logging.getLogger("zet.analytics")
router = APIRouter()


def _get_current_user(user_id: str = Depends(get_current_user_id), db: Db = Depends(get_db)):
    user = users_crud.get_by_id(db, user_id)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return user


# ── Organisation Tree ──────────────────────────────────────────────────────────

@router.get("/organization")
def get_organization(
    start_date: str = Query(..., alias="startDate"),
    end_date: str = Query(..., alias="endDate"),
    current_user=Depends(_get_current_user),
    db: Db = Depends(get_db),
):
    """Return CEO → Manager → Employee hierarchy with workforce metrics.
    Employees see only themselves; managers see their subtree; admins see all.
    """
    return analytics_logic.get_organization_tree(db, start_date, end_date, current_user)


# ── Employee Roster ────────────────────────────────────────────────────────────

@router.get("/employees")
def get_employees(
    start_date: str = Query(..., alias="startDate"),
    end_date: str = Query(..., alias="endDate"),
    manager_id: str | None = Query(None, alias="managerId"),
    current_user=Depends(_get_current_user),
    db: Db = Depends(get_db),
):
    """Return employee roster with hours and utilization metrics."""
    return analytics_logic.get_employee_roster(db, start_date, end_date, current_user, manager_id)


# ── Employee Performance ────────────────────────────────────────────────────────

@router.get("/performance/{employee_id}")
def get_employee_performance(
    employee_id: str,
    start_date: str = Query(..., alias="startDate"),
    end_date: str = Query(..., alias="endDate"),
    current_user=Depends(_get_current_user),
    db: Db = Depends(get_db),
):
    """Return deep-dive performance for a single employee.
    Employees can only access their own; managers their direct reports; admins anyone.
    """
    return analytics_logic.get_employee_performance(db, employee_id, current_user, start_date, end_date)


# ── Client Hours ───────────────────────────────────────────────────────────────

@router.get("/clients")
def get_client_hours(
    start_date: str = Query(..., alias="startDate"),
    end_date: str = Query(..., alias="endDate"),
    current_user=Depends(_get_current_user),
    db: Db = Depends(get_db),
):
    """Return client-level hours breakdown (grouped by project)."""
    if current_user.role == "employee":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Manager or admin access required")
    return analytics_logic.get_client_hours(db, start_date, end_date)


# ── Who's Working On What ──────────────────────────────────────────────────────

@router.get("/wip")
def get_wip(
    start_date: str = Query(..., alias="startDate"),
    end_date: str = Query(..., alias="endDate"),
    manager_id: str | None = Query(None, alias="managerId"),
    current_user=Depends(_get_current_user),
    db: Db = Depends(get_db),
):
    """Return the Who's Working On What dataset.
    Shows employee → project → task → hours → status rows.
    """
    return analytics_logic.get_wip_data(db, start_date, end_date, current_user, manager_id)


# ── Overview Dashboard ─────────────────────────────────────────────────────────

@router.get("/overview")
def get_overview(
    start_date: str = Query(..., alias="startDate"),
    end_date: str = Query(..., alias="endDate"),
    project_id: str | None = Query(None, alias="projectId"),
    current_user=Depends(_get_current_user),
    db: Db = Depends(get_db),
):
    """Executive analytics overview (manager/admin only)."""
    if current_user.role == "employee":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Manager or admin access required")
    return analytics_logic.get_overview_dashboard(
        db, start_date, end_date, current_user, project_id,
    )


# ── Timesheet Analytics ────────────────────────────────────────────────────────

@router.get("/timesheet-analytics")
def get_timesheet_analytics(
    start_date: str = Query(..., alias="startDate"),
    end_date: str = Query(..., alias="endDate"),
    user_id: str | None = Query(None, alias="userId"),
    current_user=Depends(_get_current_user),
    db: Db = Depends(get_db),
):
    """Per-user timesheet analytics (weekly trend, billable breakdown, overtime, project breakdown)."""
    return analytics_logic.get_timesheet_analytics(db, start_date, end_date, current_user, user_id)


# ── Capacity Forecast ──────────────────────────────────────────────────────────

@router.get("/forecast")
def get_forecast(
    start_date: str | None = Query(None, alias="startDate"),
    end_date: str | None = Query(None, alias="endDate"),
    current_user=Depends(_get_current_user),
    db: Db = Depends(get_db),
):
    """Task due-date forecast: per-employee schedule, deadline risk, reassignment hints."""
    if current_user.role == "employee":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Manager or admin access required")
    return task_forecast_logic.get_task_due_forecast(db, current_user, start_date, end_date)


@router.get("/forecast/user-stories")
def get_user_story_forecast(
    start_date: str | None = Query(None, alias="startDate"),
    end_date: str | None = Query(None, alias="endDate"),
    current_user=Depends(_get_current_user),
    db: Db = Depends(get_db),
):
    """User-story due-date forecast — same conditions as task forecast, separate work unit."""
    if current_user.role == "employee":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Manager or admin access required")
    return user_story_forecast_logic.get_user_story_due_forecast(
        db, current_user, start_date, end_date
    )


@router.get("/smart-reassignment")
def get_smart_reassignment(
    current_user=Depends(_get_current_user),
    db: Db = Depends(get_db),
):
    """Smart Task Reassignment: high/critical tasks at risk → better assignee if schedule improves."""
    if current_user.role == "employee":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Manager or admin access required")
    return task_forecast_logic.get_smart_task_reassignment(db, current_user)


@router.get("/delivery-risk")
def get_delivery_risk(
    current_user=Depends(_get_current_user),
    db: Db = Depends(get_db),
):
    """Delivery Command Center: overdue tasks, blocked tasks, dependency risks, workload groups."""
    if current_user.role == "employee":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Manager or admin access required")
    return analytics_logic.get_delivery_risk(db, current_user)


from pydantic import BaseModel, Field
from datetime import datetime, timezone

class ForecastVisibilityPayload(BaseModel):
    entityType: str
    entityId: str
    hidden: bool


@router.post("/forecast/visibility", status_code=status.HTTP_204_NO_CONTENT)
def post_forecast_visibility(
    payload: ForecastVisibilityPayload,
    current_user=Depends(_get_current_user),
    db: Db = Depends(get_db),
):
    """Set visibility (hidden/completed state) of a task or user story in forecast views."""
    if current_user.role == "employee":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Manager or admin access required")
    
    import crud.forecast_visibility as fv_crud
    now_str = datetime.now(timezone.utc).isoformat()
    fv_crud.set_visibility(
        db,
        user_id=current_user.id,
        entity_type=payload.entityType,
        entity_id=payload.entityId,
        hidden=payload.hidden,
        timestamp=now_str,
    )
    db.commit()
