from sqlalchemy.orm import Session

import realtime
from database.models import Project, ProjectMember


def get_by_id(db: Session, project_id: str) -> Project | None:
    return db.query(Project).get(project_id)


def list_all(db: Session) -> list[Project]:
    return db.query(Project).order_by(Project.name).all()


def list_for_member(db: Session, user_id: str) -> list[Project]:
    """Projects the user is a member of — filtered in SQL via a join."""
    return (
        db.query(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .filter(ProjectMember.user_id == user_id)
        .order_by(Project.name)
        .all()
    )


def create_project(
    db: Session,
    *,
    project_id: str,
    name: str,
    description: str,
    created_by: str,
    created_at: str,
) -> Project:
    p = Project(
        id=project_id,
        name=name,
        description=description,
        created_by=created_by,
        created_at=created_at,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    realtime.bump("projects")
    return p


def update_appearance(
    db: Session, project_id: str, background_image: str, accent_color: str, project_image: str
) -> None:
    p = db.query(Project).get(project_id)
    if not p:
        return
    p.background_image = background_image
    p.accent_color = accent_color
    p.project_image = project_image
    db.commit()
    realtime.bump("projects")


def add_member(db: Session, project_id: str, user_id: str) -> None:
    exists = (
        db.query(ProjectMember)
        .filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
        .first()
    )
    if exists:
        return
    db.add(ProjectMember(project_id=project_id, user_id=user_id))
    db.commit()
    # Membership affects both the project's roster and the user's project list.
    realtime.bump("projects", "users")


def remove_member(db: Session, project_id: str, user_id: str) -> None:
    db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user_id,
    ).delete()
    db.commit()
    realtime.bump("projects", "users")


def delete_project(db: Session, project_id: str) -> None:
    """Delete a project and everything under it. Project-referencing FKs have no
    DB cascade, so we delete dependents in order; task children (assignees, logs,
    feedback, checklists, attachments, timer runs) DO cascade on task delete via
    their ondelete=CASCADE FKs (SQLite foreign_keys pragma is enabled)."""
    from database.models import Section, Task, TimesheetEntry

    db.query(TimesheetEntry).filter(TimesheetEntry.project_id == project_id).delete(synchronize_session=False)
    db.query(Task).filter(Task.project_id == project_id).delete(synchronize_session=False)
    db.query(Section).filter(Section.project_id == project_id).delete(synchronize_session=False)
    db.query(ProjectMember).filter(ProjectMember.project_id == project_id).delete(synchronize_session=False)
    db.query(Project).filter(Project.id == project_id).delete(synchronize_session=False)
    db.commit()
    realtime.bump("projects", "tasks", "users")


def member_ids(db: Session, project_id: str) -> list[str]:
    rows = db.query(ProjectMember.user_id).filter(ProjectMember.project_id == project_id).all()
    return [r[0] for r in rows]


def project_ids_for_user(db: Session, user_id: str) -> set[str]:
    """All project ids the user is a member of — one query (for visibility checks)."""
    rows = db.query(ProjectMember.project_id).filter(ProjectMember.user_id == user_id).all()
    return {r[0] for r in rows}
