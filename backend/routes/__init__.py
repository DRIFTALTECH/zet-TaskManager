from fastapi import APIRouter

from routes import auth, kanban, projects, tasks, timesheet, users


def register_routes() -> APIRouter:
    root = APIRouter()
    root.include_router(auth.router, prefix="/auth", tags=["auth"])
    root.include_router(users.router, prefix="/users", tags=["users"])
    root.include_router(projects.router, prefix="/projects", tags=["projects"])
    root.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
    root.include_router(kanban.router, prefix="/kanban", tags=["kanban"])
    root.include_router(timesheet.router, prefix="/timesheet", tags=["timesheet"])
    return root
