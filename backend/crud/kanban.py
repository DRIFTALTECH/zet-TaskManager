from sqlalchemy.orm import Session

from database.models import KanbanColumn


def list_ordered(db: Session) -> list[KanbanColumn]:
    return db.query(KanbanColumn).order_by(KanbanColumn.position, KanbanColumn.id).all()


def get_by_id(db: Session, column_id: str) -> KanbanColumn | None:
    return db.query(KanbanColumn).get(column_id)


def create_column(db: Session, *, column_id: str, label: str, position: int) -> KanbanColumn:
    c = KanbanColumn(id=column_id, label=label, position=position)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def update_column(db: Session, col: KanbanColumn) -> KanbanColumn:
    db.add(col)
    db.commit()
    db.refresh(col)
    return col


def delete_column(db: Session, column_id: str) -> None:
    db.query(KanbanColumn).filter(KanbanColumn.id == column_id).delete()
    db.commit()


def set_positions(db: Session, ordered_ids: list[str]) -> None:
    for pos, cid in enumerate(ordered_ids):
        col = db.query(KanbanColumn).get(cid)
        if col:
            col.position = pos
            db.add(col)
    db.commit()
