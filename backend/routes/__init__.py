from fastapi import APIRouter

from routes import admin, audit, auth, kanban, notifications, projects, tasks, timesheet, users
from routes import checklists, attachments, sync
from ai.router import router as ai_router


def register_routes() -> APIRouter:
    root = APIRouter()
    root.include_router(auth.router, prefix="/auth", tags=["auth"])
    root.include_router(admin.router, prefix="/admin", tags=["admin"])
    root.include_router(users.router, prefix="/users", tags=["users"])
    root.include_router(projects.router, prefix="/projects", tags=["projects"])
    root.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
    root.include_router(kanban.router, prefix="/kanban", tags=["kanban"])
    root.include_router(timesheet.router, prefix="/timesheet", tags=["timesheet"])
    root.include_router(audit.router, prefix="/audit", tags=["audit"])
    root.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
    root.include_router(sync.router, prefix="/sync", tags=["sync"])
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
    root.include_router(ai_router, prefix="/ai", tags=["ai"])
    return root
