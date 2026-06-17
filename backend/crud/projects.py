from sqlalchemy.orm import Session

import realtime
from database.models import Project, ProjectMember


def get_by_id(db: Session, project_id: str) -> Project | None:
    return db.query(Project).get(project_id)


def list_all(db: Session) -> list[Project]:
    return db.query(Project).order_by(Project.name).all()


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


def member_ids(db: Session, project_id: str) -> list[str]:
    rows = db.query(ProjectMember.user_id).filter(ProjectMember.project_id == project_id).all()
    return [r[0] for r in rows]


def project_ids_for_user(db: Session, user_id: str) -> set[str]:
    """All project ids the user is a member of — one query (for visibility checks)."""
    rows = db.query(ProjectMember.project_id).filter(ProjectMember.user_id == user_id).all()
    return {r[0] for r in rows}
