from fastapi import APIRouter

from routes import audit, auth, kanban, projects, tasks, timesheet, users
from routes import checklists, attachments


def register_routes() -> APIRouter:
    root = APIRouter()
    root.include_router(auth.router, prefix="/auth", tags=["auth"])
    root.include_router(users.router, prefix="/users", tags=["users"])
    root.include_router(projects.router, prefix="/projects", tags=["projects"])
    root.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
    root.include_router(kanban.router, prefix="/kanban", tags=["kanban"])
    root.include_router(timesheet.router, prefix="/timesheet", tags=["timesheet"])
    root.include_router(audit.router, prefix="/audit", tags=["audit"])
    # Nested sub-resources under /tasks/{task_id}
    root.include_router(
        checklists.router,
        prefix="/tasks/{task_id}/checklists",
        tags=["checklists"],
    )
    root.include_router(
        attachments.router,
        prefix="/tasks/{task_id}/attachments",
        tags=["attachments"],
    )
    return root
