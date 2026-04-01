from sqlalchemy.orm import Session

from database.models import Section


def list_for_project(db: Session, project_id: str) -> list[Section]:
    return db.query(Section).filter(Section.project_id == project_id).order_by(Section.name).all()


def get_by_id(db: Session, section_id: str) -> Section | None:
    return db.query(Section).get(section_id)


def create_section(db: Session, *, section_id: str, name: str, project_id: str) -> Section:
    s = Section(id=section_id, name=name, project_id=project_id)
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def delete_section(db: Session, section_id: str) -> None:
    s = db.query(Section).filter(Section.id == section_id).first()
    if s:
        db.delete(s)
        db.commit()
