from sqlalchemy.orm import Session

from database.models import PersonalAccessToken


def create(db: Session, token: PersonalAccessToken) -> PersonalAccessToken:
    db.add(token)
    db.commit()
    db.refresh(token)
    return token


def get_by_hash(db: Session, token_hash: str) -> PersonalAccessToken | None:
    return (
        db.query(PersonalAccessToken)
        .filter(PersonalAccessToken.token_hash == token_hash, PersonalAccessToken.revoked == False)  # noqa: E712
        .first()
    )


def get_for_user(db: Session, token_id: str, user_id: str) -> PersonalAccessToken | None:
    return (
        db.query(PersonalAccessToken)
        .filter(PersonalAccessToken.id == token_id, PersonalAccessToken.user_id == user_id)
        .first()
    )


def list_for_user(db: Session, user_id: str) -> list[PersonalAccessToken]:
    return (
        db.query(PersonalAccessToken)
        .filter(PersonalAccessToken.user_id == user_id, PersonalAccessToken.revoked == False)  # noqa: E712
        .order_by(PersonalAccessToken.created_at.desc())
        .all()
    )


def update(db: Session, token: PersonalAccessToken) -> PersonalAccessToken:
    db.add(token)
    db.commit()
    db.refresh(token)
    return token


def touch_last_used(db: Session, token: PersonalAccessToken, when: str) -> None:
    token.last_used_at = when
    db.add(token)
    db.commit()
